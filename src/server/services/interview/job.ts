import { errorCategoryOf } from "@/lib/contracts/ai";
import type { AiErrorCode, AiProvider, ConnectionTier, ModelTier } from "@/lib/contracts/enums";
import { AppError } from "@/lib/contracts/errors";
import type { CareerRows } from "@/server/ai/context-pack/career-rows";
import { AiError, isAiError, ProviderError } from "@/server/ai/errors";
import type { Llm } from "@/server/ai/llm";
import { resolveModel } from "@/server/ai/providers/models";
import type { AiWriterSupabaseClient } from "@/server/db/types";
import { STEP_CONTINUE, type JobStep, type JobTypeDefinition, type StepContext } from "@/server/jobs/types";
import type { EnsureJdResult } from "@/server/services/application/extraction";
import { pickFailure } from "@/server/services/insight/job";
import {
  GONE_RAISES,
  InterviewRpcError,
  loadInterviewInsightSignal,
  loadInterviewJd,
  loadQuestionEvidence,
  loadRecentQuestions,
  loadSessionForEvaluation,
  type InterviewInsightSignal,
  type InterviewJdInputs,
  type InterviewStore,
  type QuestionEvidence,
  type SessionForEvaluation,
  type WriterQuestion,
} from "./db";
import { EVALUATION_JOB_TYPE, INTERVIEW_TARGET_TYPE, QUESTIONS_JOB_TYPE } from "./view";

/**
 * S8 interview jobs (plan "계약 — API" 1; AI C-6 비동기, C-11.3, C-12;
 * target `interview_session`, default tier).
 *
 * interview_questions (AI-05)
 *   prepare  → D-30 ensureJdExtracted → begin_interview_questions
 *   generate → ONE provider call per run: stream, save each validated question
 *              as it completes (save_interview_question; progress {generate,
 *              saved, count}). Short of the count after the call → the next
 *              run regenerates the remaining count (STEP_CONTINUE, so C-12
 *              spacing / the 60 s budget apply), at most `maxAttempts` calls
 *              per job run; still short → schema_invalid (saved questions stay,
 *              "남은 질문 다시 만들기"). A failure mid-stream keeps what was
 *              saved; a retry reads the saved questions back and makes only the rest.
 *   complete → complete_interview_questions (no call) → the runner completes the job.
 *
 * interview_evaluation (AI-06 + AI-07)
 *   prepare   → begin_interview_evaluation (records evaluation provider / model;
 *               gives the answers to evaluate = submitted without a success)
 *   evaluate  → paid: pending answers in parallel, each saved the moment it
 *               succeeds (S6 QA lesson); free (C-12): one answer per run via
 *               STEP_CONTINUE. An answer whose failure the runner would no
 *               longer retry (`ctx.wouldRetry`) is closed with
 *               fail_answer_evaluation (`not_scored`) and the job goes on
 *               [가정 2]; key / account / provider-limit causes fail the job.
 *   summarize → AI-07 over the succeeded evaluations (skipped without a call when none)
 *   score     → D-14 pending: nothing
 *   complete  → complete_interview_evaluation; `evaluation_failed` (all answers
 *               failed) ends the job failed with the answers' cause.
 *   Summary failure fails the job → the trigger marks `evaluation_failed`;
 *   다시 채점 then redoes only the summary [가정 1].
 */

export type QuestionsContextInput = {
  interviewType: "job" | "culture_fit";
  questionCount: 3 | 5 | 7;
  dataSufficiency: "ok" | "thin" | "none";
  careerRows: CareerRows | null;
  jd: InterviewJdInputs;
  insightSignal: InterviewInsightSignal | null;
  recentQuestions: string[];
};

export type ExistingQuestion = {
  sequence: number;
  source_kind: string;
  anchor: string;
  question_text: string;
  target_requirement_ids: string[];
  target_gap_requirement_ids: string[];
  evidence_sources: Array<{ source_type: string; source_id: string }>;
};

export type QuestionsAttemptResult = {
  remaining: number;
  weakRequirementIds: string[];
  model: string;
  usage: unknown;
  report: Record<string, number>;
  /** V-5 numbers that got questions dropped (fed to the regeneration). */
  unsupportedNumbers: string[];
};

export type EvaluationContextInput = {
  interviewType: "job" | "culture_fit";
  dataSufficiency: "ok" | "thin" | "none";
  careerRows: CareerRows | null;
  jd: InterviewJdInputs;
  question: WriterQuestion & { evidence: QuestionEvidence[] };
  answer: { id: string; answer_text: string; updated_at: string | null };
};

export type SummarizeInput = {
  interviewType: "job" | "culture_fit";
  dataSufficiency: "ok" | "thin" | "none";
  questions: Array<{
    id: string;
    sequence: number;
    question_text: string;
    source_kind: string;
    anchor: string;
    intent: string | null;
    target_requirement_ids: string[];
    answer_status: "submitted" | "unanswered";
    evaluation: unknown;
  }>;
  requirements: Array<{ id: string; content: string }>;
  weakRequirementIds: string[];
  /** interview_sessions.career_snapshot_hash (AI-07 payload hashes). */
  careerSnapshotHash: string;
};

/** The generation-time facts complete_interview_questions stores (QA-S8-04). */
export type QuestionsSnapshot = {
  interviewType: "job" | "culture_fit";
  /** The insight actually put into the prompt (null when none). */
  insightId: string | null;
  careerSnapshotHash: string;
  /** jd_requirements ids of the context (weak ids are kept only when they belong here). */
  requirementIds: string[];
};

/** One AI-06 call's JSON-safe result (ai `AnswerEvaluationAttempt`, narrowed to what the job reads). */
export type EvaluationAttempt = { violations: readonly string[] } & Record<string, unknown>;

export type InterviewCallDeps = { llm: Llm; signal: AbortSignal; jobId: string; callKey: string };

/** The AI-05 / 06 / 07 pipelines as the jobs use them (production: src/server/jobs/interview.ts; tests: fakes). */
export interface InterviewPipelines<QC = unknown, EC = unknown> {
  questions: {
    promptVersion: string;
    tier: ModelTier;
    /** Calls per job run (first + regeneration of the remaining count). */
    maxAttempts: number;
    buildContext(input: QuestionsContextInput): QC;
    generate(
      input: { context: QC; existing: readonly ExistingQuestion[]; attempt: number; unsupportedNumbers: readonly string[] },
      deps: InterviewCallDeps & { onQuestion: (payload: unknown) => Promise<void> },
    ): Promise<QuestionsAttemptResult>;
    /**
     * QA-S8-04: what complete_interview_questions stores from the context the
     * questions were made with (JSON-safe, kept in the generate checkpoint).
     */
    snapshot(context: QC): QuestionsSnapshot;
    /**
     * R1 A22: folds one generation call into the set-level record (report counts summed,
     * usage added). Production: ai `accumulateQuestionSetRecord`.
     */
    accumulate(prev: QuestionSetRecord | null, attempt: { report: Record<string, number>; usage: unknown }): QuestionSetRecord;
    completePayload(input: {
      snapshot: QuestionsSnapshot;
      /** `usage` / `report` are the whole set's (every generation call of the job, A22); `attempts` = calls. */
      run: Omit<QuestionsAttemptResult, "remaining" | "unsupportedNumbers"> & { attempts: number | null };
      existingWeakRequirementIds: readonly string[];
      provider: AiProvider;
      connectionTier: ConnectionTier;
    }): unknown;
  };
  evaluation: {
    promptVersion: string;
    tier: ModelTier;
    buildContext(input: EvaluationContextInput): EC;
    /**
     * QA-S8-01: AI-06 as separate provider calls so each is its own unit
     * (free-tier spacing between them; a retry never repeats a finished call).
     * Attempts are JSON-safe (kept in savePartial).
     */
    evaluateFirst(input: { context: EC }, deps: InterviewCallDeps): Promise<EvaluationAttempt>;
    /** The V-5 regeneration; only when `first.violations` is non-empty. */
    regenerate(input: { context: EC; violations: readonly string[] }, deps: InterviewCallDeps): Promise<EvaluationAttempt>;
    /** No call: regen ?? first → validated save_answer_evaluation payload. */
    finalize(input: { context: EC; first: EvaluationAttempt; regen: EvaluationAttempt | null; provider: AiProvider; connectionTier: ConnectionTier; jobId: string }): { payload: unknown };
    summarize(input: SummarizeInput, deps: InterviewCallDeps): Promise<{ payload: unknown }>;
  };
}

export type InterviewJdExtractor = (
  ctx: { userId: string; jobId: string; provider: AiProvider; connectionTier: ConnectionTier; db: AiWriterSupabaseClient; signal: AbortSignal },
  applicationProjectId: string,
) => Promise<EnsureJdResult>;

/** Input reads of the job steps (app_ai_writer); tests replace them. */
export type InterviewInputLoaders = {
  jd: (db: AiWriterSupabaseClient, applicationProjectId: string) => Promise<InterviewJdInputs | null>;
  insightSignal: (db: AiWriterSupabaseClient, applicationProjectId: string) => Promise<InterviewInsightSignal | null>;
  recentQuestions: (db: AiWriterSupabaseClient, args: { applicationProjectId: string; interviewType: string; excludeSessionId: string }) => Promise<string[]>;
  /** Saved questions (user-visible columns) + evidence sources, sequence order. */
  existingQuestions: (db: AiWriterSupabaseClient, sessionId: string) => Promise<ExistingQuestion[]>;
  questionEvidence: (db: AiWriterSupabaseClient, questionIds: readonly string[]) => Promise<Map<string, QuestionEvidence[]>>;
  session: (db: AiWriterSupabaseClient, sessionId: string) => Promise<SessionForEvaluation>;
};

export async function loadExistingQuestions(db: AiWriterSupabaseClient, sessionId: string): Promise<ExistingQuestion[]> {
  const { data, error } = await db
    .from("interview_questions")
    .select("id, sequence, source_kind, anchor, question_text, target_requirement_ids, target_gap_requirement_ids")
    .eq("session_id", sessionId)
    .order("sequence", { ascending: true });
  if (error) throw systemFailure();
  const rows = data ?? [];
  const evidence = await loadQuestionEvidence(db, rows.map((r) => r.id));
  return rows.map((r) => ({
    sequence: r.sequence,
    source_kind: r.source_kind,
    anchor: r.anchor,
    question_text: r.question_text,
    target_requirement_ids: r.target_requirement_ids ?? [],
    target_gap_requirement_ids: r.target_gap_requirement_ids ?? [],
    evidence_sources: (evidence.get(r.id) ?? []).map((e) => ({ source_type: e.source_type, source_id: e.source_id })),
  }));
}

export const DB_INPUT_LOADERS: InterviewInputLoaders = {
  jd: loadInterviewJd,
  insightSignal: loadInterviewInsightSignal,
  recentQuestions: loadRecentQuestions,
  existingQuestions: loadExistingQuestions,
  questionEvidence: loadQuestionEvidence,
  session: loadSessionForEvaluation,
};

export type InterviewJobDeps<QC, EC> = {
  pipelines: InterviewPipelines<QC, EC>;
  storeFor: (db: AiWriterSupabaseClient) => InterviewStore;
  ensureJd: InterviewJdExtractor;
  loadCareerRows: (db: AiWriterSupabaseClient) => Promise<CareerRows>;
  /** Default: DB_INPUT_LOADERS. */
  loaders?: Partial<InterviewInputLoaders>;
  log?: (event: string, fields: Record<string, string | number | boolean | null>) => void;
};

export type InterviewJobParams = { sessionId: string; applicationProjectId: string };

export function interviewParams(params: Record<string, unknown>): InterviewJobParams {
  const { sessionId, applicationProjectId } = params;
  if (typeof sessionId !== "string" || !sessionId || typeof applicationProjectId !== "string" || !applicationProjectId) {
    throw new AiError("stalled", { retryable: false });
  }
  return { sessionId, applicationProjectId };
}

const systemFailure = () => new AiError("stalled", { retryable: false });

/**
 * RPC refusals: the session / answer / project is gone (deleted, delete_results)
 * or the session left the expected state (abandoned) → `canceled` (db notes);
 * anything else is a system failure.
 */
export function fromRpc(err: unknown, log?: InterviewJobDeps<unknown, unknown>["log"], jobId?: string): never {
  if (err instanceof InterviewRpcError) {
    log?.("interview.rpc_refused", { jobId: jobId ?? null, raise: err.raise });
    if (err.raise && (GONE_RAISES.has(err.raise) || err.raise === "interview_not_in_progress")) throw new AiError("canceled");
    throw systemFailure();
  }
  throw err;
}

const asType = (v: string): "job" | "culture_fit" => (v === "culture_fit" ? "culture_fit" : "job");
const asSufficiency = (v: string): "ok" | "thin" | "none" => (v === "ok" || v === "thin" ? v : "none");
const asCount = (v: number): 3 | 5 | 7 => (v === 3 || v === 7 ? v : 5);

/** D-30 inside the job (same handling as the S6 insight prepare). */
async function ensureJd<QC, EC>(deps: InterviewJobDeps<QC, EC>, ctx: StepContext<Llm>, applicationProjectId: string): Promise<string | null> {
  const log = deps.log ?? (() => {});
  const extracted = await deps
    .ensureJd({ userId: ctx.userId, jobId: ctx.jobId, provider: ctx.provider, connectionTier: ctx.connectionTier, db: ctx.db, signal: ctx.signal }, applicationProjectId)
    .catch((err: unknown) => {
      if (err instanceof AppError && !(err instanceof AiError)) {
        log("interview.prepare_refused", { jobId: ctx.jobId, code: String(err.code) });
        throw systemFailure();
      }
      throw err;
    });
  if (extracted.status === "failed") {
    log("interview.prepare_extraction_failed", { jobId: ctx.jobId, code: extracted.code });
    throw new ProviderError(extracted.code, {
      retryable: false,
      retryAfter: extracted.retryAfter ? new Date(extracted.retryAfter) : undefined,
      quotaResetsAt: extracted.quotaResetsAt ? new Date(extracted.quotaResetsAt) : undefined,
    });
  }
  return extracted.status === "succeeded" ? extracted.jobId : null;
}

// ======================= interview_questions (AI-05) =======================

export type QuestionsPrepareOutput = {
  interviewType: "job" | "culture_fit";
  questionCount: 3 | 5 | 7;
  dataSufficiency: "ok" | "thin" | "none";
  extractedJobId: string | null;
};

/** R1 A22: the question set's validation report + usage over every generation call (→ interview_sessions). */
export type QuestionSetRecord = { report: Record<string, number>; usage: unknown; attempts: number };

export type QuestionsGeneratePartial = {
  /** Calls that ended short of the count in this job (the regeneration budget). */
  attempts: number;
  weakRequirementIds: string[];
  unsupportedNumbers: string[];
  last: Omit<QuestionsAttemptResult, "remaining" | "weakRequirementIds" | "unsupportedNumbers"> | null;
  /** A22: running set-level record (null before the first call). */
  set: QuestionSetRecord | null;
  /** From the first call's context: what the set was made with. */
  snapshot: QuestionsSnapshot | null;
};

export type QuestionsGenerateOutput = Omit<QuestionsAttemptResult, "remaining" | "unsupportedNumbers"> & { snapshot: QuestionsSnapshot; attempts?: number | null };

function setRecordOf(value: unknown): QuestionSetRecord | null {
  if (!value || typeof value !== "object") return null;
  const v = value as Partial<QuestionSetRecord>;
  if (typeof v.attempts !== "number" || !v.report || typeof v.report !== "object") return null;
  return { report: v.report, usage: v.usage ?? null, attempts: v.attempts };
}

function generatePartialOf(value: unknown): QuestionsGeneratePartial {
  const v = value && typeof value === "object" ? (value as Partial<QuestionsGeneratePartial>) : {};
  return {
    attempts: typeof v.attempts === "number" ? v.attempts : 0,
    weakRequirementIds: Array.isArray(v.weakRequirementIds) ? v.weakRequirementIds.filter((x): x is string => typeof x === "string") : [],
    unsupportedNumbers: Array.isArray(v.unsupportedNumbers) ? v.unsupportedNumbers.filter((x): x is string => typeof x === "string") : [],
    last: v.last ?? null,
    set: setRecordOf(v.set),
    snapshot: v.snapshot ?? null,
  };
}

const union = (a: readonly string[], b: readonly string[]) => [...new Set([...a, ...b])];

export function createInterviewQuestionsJobDefinition<QC, EC>(deps: InterviewJobDeps<QC, EC>): JobTypeDefinition<Llm> {
  const p = deps.pipelines.questions;
  const log = deps.log ?? (() => {});
  const L: InterviewInputLoaders = { ...DB_INPUT_LOADERS, ...deps.loaders };

  function prepared(ctx: StepContext<Llm>): QuestionsPrepareOutput {
    const out = ctx.previous.prepare as QuestionsPrepareOutput | undefined;
    if (!out?.questionCount) throw systemFailure();
    return out;
  }

  async function contextFor(ctx: StepContext<Llm>): Promise<QC> {
    const { sessionId, applicationProjectId } = interviewParams(ctx.params);
    const prep = prepared(ctx);
    const [jd, careerRows, insightSignal, recentQuestions] = await Promise.all([
      L.jd(ctx.db, applicationProjectId),
      prep.dataSufficiency === "none" ? Promise.resolve(null) : deps.loadCareerRows(ctx.db),
      prep.interviewType === "job" ? L.insightSignal(ctx.db, applicationProjectId) : Promise.resolve(null),
      L.recentQuestions(ctx.db, { applicationProjectId, interviewType: prep.interviewType, excludeSessionId: sessionId }),
    ]);
    // Extracted in prepare; gone now = project deleted (job cascades → lost) or a re-extraction in flight.
    if (!jd) throw systemFailure();
    return p.buildContext({
      interviewType: prep.interviewType,
      questionCount: prep.questionCount,
      dataSufficiency: prep.dataSufficiency,
      careerRows,
      jd,
      insightSignal,
      recentQuestions,
    });
  }

  const prepare: JobStep<Llm> = {
    stage: "prepare",
    async run(ctx) {
      const { sessionId, applicationProjectId } = interviewParams(ctx.params);
      const extractedJobId = await ensureJd(deps, ctx, applicationProjectId);
      const begun = await deps.storeFor(ctx.db).beginQuestions(sessionId, ctx.jobId).catch((err: unknown) => fromRpc(err, log, ctx.jobId));
      const out: QuestionsPrepareOutput = {
        interviewType: asType(begun.interviewType),
        questionCount: asCount(begun.questionCount),
        dataSufficiency: asSufficiency(begun.dataSufficiency),
        extractedJobId,
      };
      return out;
    },
  };

  const generate: JobStep<Llm> = {
    stage: "generate",
    async run(ctx) {
      const { sessionId } = interviewParams(ctx.params);
      const { questionCount } = prepared(ctx);
      const partial = generatePartialOf(ctx.partial);
      const store = deps.storeFor(ctx.db);
      const existing = await L.existingQuestions(ctx.db, sessionId);
      let saved = existing.length;
      await ctx.reportProgress(Math.min(saved, questionCount), questionCount);

      // A22: usage / report of the whole set (every call), not just the last one.
      const finished = (run: QuestionsGeneratePartial["last"], set: QuestionSetRecord | null, weak: string[], snapshot: QuestionsSnapshot): QuestionsGenerateOutput => ({
        snapshot,
        weakRequirementIds: weak,
        model: run?.model ?? "",
        usage: set ? set.usage : (run?.usage ?? null),
        report: set ? set.report : (run?.report ?? {}),
        attempts: set?.attempts ?? null,
      });
      // Everything already saved (e.g. the stream ended right after the last question): nothing to call.
      if (saved >= questionCount) return finished(partial.last, partial.set, partial.weakRequirementIds, partial.snapshot ?? p.snapshot(await contextFor(ctx)));
      if (partial.attempts >= p.maxAttempts) throw new AiError("schema_invalid", { retryable: false });

      const context = await contextFor(ctx);
      const snapshot = partial.snapshot ?? p.snapshot(context);
      const result = await p.generate(
        { context, existing, attempt: partial.attempts, unsupportedNumbers: partial.unsupportedNumbers },
        {
          llm: ctx.llm,
          signal: ctx.signal,
          jobId: ctx.jobId,
          callKey: partial.attempts === 0 ? `${ctx.callKeyPrefix}` : `${ctx.callKeyPrefix}.${partial.attempts}`,
          onQuestion: async (payload) => {
            const r = await store.saveQuestion({ sessionId, jobId: ctx.jobId, runGeneration: ctx.runGeneration, payload }).catch((err: unknown) => fromRpc(err, log, ctx.jobId));
            // stale_run: a newer generation / another actor owns the session's generation.
            if (!r.applied) throw systemFailure();
            saved = r.savedCount;
            await ctx.reportProgress(Math.min(saved, questionCount), questionCount);
          },
        },
      );
      const weak = union(partial.weakRequirementIds, result.weakRequirementIds);
      const last = { model: result.model, usage: result.usage, report: result.report };
      const set = p.accumulate(partial.set, { report: result.report, usage: result.usage });
      if (result.remaining <= 0) return finished(last, set, weak, snapshot);

      const attempts = partial.attempts + 1;
      log("interview.questions_short", { jobId: ctx.jobId, remaining: result.remaining, attempt: attempts });
      const next: QuestionsGeneratePartial = { attempts, weakRequirementIds: weak, unsupportedNumbers: union(partial.unsupportedNumbers, result.unsupportedNumbers), last, set, snapshot };
      await ctx.savePartial(next);
      // [가정 3] one regeneration of the remaining count; still short → failed (saved questions stay).
      if (attempts >= p.maxAttempts) throw new AiError("schema_invalid", { retryable: false });
      return STEP_CONTINUE;
    },
  };

  const complete: JobStep<Llm> = {
    stage: "complete",
    callsProvider: false,
    async run(ctx) {
      const { sessionId } = interviewParams(ctx.params);
      const gen = ctx.previous.generate as QuestionsGenerateOutput | undefined;
      if (!gen?.snapshot) throw systemFailure();
      // QA-S8-04: no context rebuild / career reload — the values the questions were made with.
      const payload = p.completePayload({
        snapshot: gen.snapshot,
        run: { weakRequirementIds: gen.weakRequirementIds, model: gen.model || resolveModel(ctx.provider, p.tier), usage: gen.usage, report: gen.report, attempts: gen.attempts ?? null },
        existingWeakRequirementIds: [],
        provider: ctx.provider,
        connectionTier: ctx.connectionTier,
      });
      const r = await deps
        .storeFor(ctx.db)
        .completeQuestions({ sessionId, jobId: ctx.jobId, runGeneration: ctx.runGeneration, payload })
        .catch((err: unknown) => fromRpc(err, log, ctx.jobId));
      if (!r.applied) throw systemFailure();
      return { sessionId };
    },
  };

  return { jobType: QUESTIONS_JOB_TYPE, modelTier: p.tier, steps: [prepare, generate, complete] };
}

// ======================= interview_evaluation (AI-06 + AI-07) =======================

export type EvaluationPrepareOutput = {
  interviewType: "job" | "culture_fit";
  dataSufficiency: "ok" | "thin" | "none";
  answers: Array<{ answerId: string; questionId: string; sequence: number }>;
};

export type EvaluatePartial = {
  /** Answers closed as failed in this job (not retried again within it), with the cause. */
  failed: Record<string, AiErrorCode>;
  /**
   * QA-S8-01: per answer, the finished AI-06 calls not yet saved as an
   * evaluation — `first` (and `regen`: an attempt, or null = regeneration
   * gave up → finalize with the first). Dropped once the answer is saved.
   */
  calls: Record<string, { first?: EvaluationAttempt; regen?: EvaluationAttempt | null }>;
};

export type EvaluateOutput = {
  /** Succeeded evaluations of the session after this stage (incl. earlier jobs). */
  succeededCount: number;
  failed: Record<string, AiErrorCode>;
};

function evaluatePartialOf(value: unknown): EvaluatePartial {
  const v = value && typeof value === "object" ? (value as Partial<EvaluatePartial>) : {};
  return {
    failed: v.failed && typeof v.failed === "object" ? { ...v.failed } : {},
    calls: v.calls && typeof v.calls === "object" ? { ...v.calls } : {},
  };
}

/** C-11 categories whose failure ends the whole evaluation job (the summary would hit them too). */
const JOB_FATAL_CATEGORIES = new Set(["user_account", "provider_limit"]);

export function createInterviewEvaluationJobDefinition<QC, EC>(deps: InterviewJobDeps<QC, EC>): JobTypeDefinition<Llm> {
  const p = deps.pipelines.evaluation;
  const log = deps.log ?? (() => {});
  const L: InterviewInputLoaders = { ...DB_INPUT_LOADERS, ...deps.loaders };

  function prepared(ctx: StepContext<Llm>): EvaluationPrepareOutput {
    const out = ctx.previous.prepare as EvaluationPrepareOutput | undefined;
    if (!out?.answers) throw systemFailure();
    return out;
  }

  const prepare: JobStep<Llm> = {
    stage: "prepare",
    callsProvider: false,
    async run(ctx) {
      const { sessionId } = interviewParams(ctx.params);
      const begun = await deps
        .storeFor(ctx.db)
        .beginEvaluation({ sessionId, jobId: ctx.jobId, provider: ctx.provider, model: resolveModel(ctx.provider, p.tier) })
        .catch((err: unknown) => fromRpc(err, log, ctx.jobId));
      const out: EvaluationPrepareOutput = {
        interviewType: asType(begun.interviewType),
        dataSufficiency: asSufficiency(begun.dataSufficiency),
        answers: begun.answersToEvaluate.map((a) => ({ answerId: a.answer_id, questionId: a.question_id, sequence: a.sequence })).sort((a, b) => a.sequence - b.sequence),
      };
      return out;
    },
  };

  const evaluate: JobStep<Llm> = {
    stage: "evaluate",
    async run(ctx) {
      const { sessionId, applicationProjectId } = interviewParams(ctx.params);
      const prep = prepared(ctx);
      const store = deps.storeFor(ctx.db);
      const partial = evaluatePartialOf(ctx.partial);
      const session = await L.session(ctx.db, sessionId);
      const succeeded = new Set(session.evaluations.filter((e) => e.status === "succeeded").map((e) => e.answer_id));
      const total = prep.answers.length;
      const pending = prep.answers.filter((a) => !succeeded.has(a.answerId) && !(a.answerId in partial.failed));
      const progress = () => ctx.reportProgress(total - pending.filter((a) => !succeeded.has(a.answerId) && !(a.answerId in partial.failed)).length, total);
      await progress();

      const output = (): EvaluateOutput => ({ succeededCount: succeeded.size, failed: partial.failed });
      if (pending.length === 0) return output();

      const [jd, careerRows] = await Promise.all([
        L.jd(ctx.db, applicationProjectId),
        prep.dataSufficiency === "none" ? Promise.resolve(null) : deps.loadCareerRows(ctx.db),
      ]);
      if (!jd) throw systemFailure();
      const evidence = await L.questionEvidence(ctx.db, session.questions.map((q) => q.id));
      const questionById = new Map(session.questions.map((q) => [q.id, q]));
      const answerById = new Map(session.answers.map((a) => [a.id, a]));

      type Item = EvaluationPrepareOutput["answers"][number];
      const contextOf = (item: Item): EC => {
        const question = questionById.get(item.questionId);
        const answer = answerById.get(item.answerId);
        if (!question || !answer) throw new AiError("canceled"); // deleted mid-run
        return p.buildContext({
          interviewType: prep.interviewType,
          dataSufficiency: prep.dataSufficiency,
          careerRows,
          jd,
          question: { ...question, evidence: evidence.get(question.id) ?? [] },
          answer: { id: answer.id, answer_text: answer.answer_text, updated_at: answer.updated_at },
        });
      };
      const callDeps = (item: Item): InterviewCallDeps => ({ llm: ctx.llm, signal: ctx.signal, jobId: ctx.jobId, callKey: `${ctx.callKeyPrefix}.${item.sequence}` });
      const persist = () => ctx.savePartial({ failed: partial.failed, calls: partial.calls } satisfies EvaluatePartial);

      /** finalize (no call) → save_answer_evaluation; the answer leaves `calls`. */
      const finish = async (item: Item, context: EC) => {
        const state = partial.calls[item.answerId]!;
        const { payload } = p.finalize({ context, first: state.first!, regen: state.regen ?? null, provider: ctx.provider, connectionTier: ctx.connectionTier, jobId: ctx.jobId });
        const r = await store
          .saveAnswerEvaluation({ answerId: item.answerId, jobId: ctx.jobId, runGeneration: ctx.runGeneration, payload })
          .catch((err: unknown) => fromRpc(err, log, ctx.jobId));
        if (!r.applied) throw systemFailure();
        succeeded.add(item.answerId);
        delete partial.calls[item.answerId];
        await persist();
        await progress();
      };

      /**
       * Runs the answer's NEXT provider call (first evaluation, or the V-5
       * regeneration) and saves it; finalizes when nothing is left.
       * Returns true when the answer is done (saved).
       */
      const nextUnit = async (item: Item): Promise<boolean> => {
        const context = contextOf(item);
        const state = (partial.calls[item.answerId] ??= {});
        if (!state.first) {
          state.first = await p.evaluateFirst({ context }, callDeps(item));
          if (state.first.violations.length > 0) {
            await persist(); // the regeneration is its own unit; a retry never repeats this call
            return false;
          }
        } else if (state.regen === undefined) {
          try {
            state.regen = await p.regenerate({ context, violations: state.first.violations }, callDeps(item));
          } catch (err) {
            // A regeneration that won't be retried any more: keep the first answer ([수치 확인 필요] fallback) [구현 결정].
            if (ctx.signal.aborted || !isAiError(err) || err.code === "canceled" || ctx.wouldRetry(err) || JOB_FATAL_CATEGORIES.has(errorCategoryOf(err.code))) throw err;
            log("interview.regen_given_up", { jobId: ctx.jobId, sequence: item.sequence, code: err.code });
            state.regen = null;
          }
        }
        await finish(item, context);
        return true;
      };

      /** Paid: all of an answer's remaining calls in this run (each saved as it finishes). */
      const evaluateOne = async (item: Item) => {
        while (!(await nextUnit(item)));
      };

      /** Sorts one answer's failure: rethrow-now (abort / cancel / not ours), retry the step, fail the job, or close the answer. */
      const retryable: unknown[] = [];
      const fatal: unknown[] = [];
      const closeOrCollect = async (item: EvaluationPrepareOutput["answers"][number], err: unknown): Promise<void> => {
        if (ctx.signal.aborted || !isAiError(err) || err.code === "canceled" || err.code === "stalled") throw err;
        if (ctx.wouldRetry(err)) {
          retryable.push(err);
          return;
        }
        if (JOB_FATAL_CATEGORIES.has(errorCategoryOf(err.code))) {
          fatal.push(err);
          return;
        }
        // [가정 2] this answer is done for this job: not_scored + "다시 채점"; the summary uses the rest.
        await store.failAnswerEvaluation(item.answerId, ctx.jobId).catch((e: unknown) => fromRpc(e, log, ctx.jobId));
        partial.failed[item.answerId] = err.code;
        delete partial.calls[item.answerId];
        await persist();
        log("interview.answer_not_scored", { jobId: ctx.jobId, sequence: item.sequence, code: err.code });
        await progress();
      };

      if (ctx.sequential) {
        // C-12 free tier: one provider call per run (first evaluation or regeneration).
        const item = pending[0]!;
        let done = true;
        try {
          done = await nextUnit(item);
        } catch (err) {
          await closeOrCollect(item, err);
        }
        if (fatal.length > 0) throw fatal[0];
        if (retryable.length > 0) throw retryable[0];
        return !done || pending.length > 1 ? STEP_CONTINUE : output();
      }

      // Paid: in parallel; each success is saved as it settles, so a step retry calls only the rest.
      const results = await Promise.allSettled(pending.map((item) => evaluateOne(item)));
      const failures: Array<{ item: EvaluationPrepareOutput["answers"][number]; err: unknown }> = [];
      results.forEach((r, i) => {
        if (r.status === "rejected") failures.push({ item: pending[i]!, err: r.reason });
      });
      const passthrough: unknown[] = [];
      for (const f of failures) {
        try {
          await closeOrCollect(f.item, f.err);
        } catch (err) {
          passthrough.push(err);
        }
      }
      if (passthrough.length > 0) throw pickFailure(passthrough);
      if (fatal.length > 0) throw pickFailure(fatal);
      if (retryable.length > 0) {
        log("interview.evaluate_retry", { jobId: ctx.jobId, failed: retryable.length, of: pending.length });
        throw pickFailure(retryable);
      }
      return output();
    },
  };

  function evaluated(previous: Readonly<Record<string, unknown>>): EvaluateOutput | undefined {
    return previous.evaluate as EvaluateOutput | undefined;
  }

  const summarize: JobStep<Llm> = {
    stage: "summarize",
    // No call (and no C-12 spacing) when no answer has a succeeded evaluation.
    callsProvider: (previous) => (evaluated(previous)?.succeededCount ?? 0) > 0,
    async run(ctx) {
      const { sessionId, applicationProjectId } = interviewParams(ctx.params);
      const prep = prepared(ctx);
      const ev = evaluated(ctx.previous);
      if (!ev) throw systemFailure();
      if (ev.succeededCount === 0) return { skipped: true };
      const session = await L.session(ctx.db, sessionId);
      const input = summarizeInput(await L.jd(ctx.db, applicationProjectId), prep, session);
      const { payload } = await p.summarize(input, { llm: ctx.llm, signal: ctx.signal, jobId: ctx.jobId, callKey: ctx.callKeyPrefix });
      const r = await deps
        .storeFor(ctx.db)
        .saveSessionFeedback({ sessionId, jobId: ctx.jobId, runGeneration: ctx.runGeneration, payload })
        .catch((err: unknown) => fromRpc(err, log, ctx.jobId));
      if (!r.applied) throw systemFailure();
      return { skipped: false };
    },
  };

  // AI 4.3 / D-14: the score formula is pending, every score stays `pending_method` (set by the save RPCs).
  const score: JobStep<Llm> = { stage: "score", callsProvider: false, run: async () => ({ method: null }) };

  const complete: JobStep<Llm> = {
    stage: "complete",
    callsProvider: false,
    async run(ctx) {
      const { sessionId } = interviewParams(ctx.params);
      const ev = evaluated(ctx.previous);
      const r = await deps
        .storeFor(ctx.db)
        .completeEvaluation({ sessionId, jobId: ctx.jobId, runGeneration: ctx.runGeneration })
        .catch((err: unknown) => fromRpc(err, log, ctx.jobId));
      if (!r.applied) throw systemFailure();
      if (r.status === "evaluation_failed") {
        // Every answer failed: the session is evaluation_failed; the job ends with the answers' cause.
        const code = Object.values(ev?.failed ?? {})[0] ?? "schema_invalid";
        throw new AiError(code, { retryable: false });
      }
      return { status: r.status, notScored: r.notScoredAnswerIds.length };
    },
  };

  return { jobType: EVALUATION_JOB_TYPE, modelTier: p.tier, steps: [prepare, evaluate, summarize, score, complete] };
}

/** AI-07 input: every question with its answer status and succeeded evaluation, plus the requirements it refers to. */
export function summarizeInput(
  jd: Pick<InterviewJdInputs, "requirements"> | null,
  prep: Pick<EvaluationPrepareOutput, "interviewType" | "dataSufficiency">,
  session: SessionForEvaluation,
): SummarizeInput {
  const answerByQuestion = new Map(session.answers.map((a) => [a.question_id, a]));
  const evalByAnswer = new Map(session.evaluations.filter((e) => e.status === "succeeded").map((e) => [e.answer_id, e.result]));
  const wanted = new Set([...session.weakRequirementIds, ...session.questions.flatMap((q) => q.target_requirement_ids)]);
  const requirements = (jd?.requirements ?? []).filter((r) => wanted.has(r.id)).map((r) => ({ id: r.id, content: r.content }));
  return {
    interviewType: prep.interviewType,
    dataSufficiency: prep.dataSufficiency,
    questions: session.questions.map((q) => {
      const answer = answerByQuestion.get(q.id);
      const status: "submitted" | "unanswered" = answer?.status === "submitted" ? "submitted" : "unanswered";
      return {
        id: q.id,
        sequence: q.sequence,
        question_text: q.question_text,
        source_kind: q.source_kind,
        anchor: q.anchor,
        intent: q.intent,
        target_requirement_ids: q.target_requirement_ids,
        answer_status: status,
        evaluation: answer && status === "submitted" ? (evalByAnswer.get(answer.id) ?? null) : null,
      };
    }),
    requirements,
    weakRequirementIds: session.weakRequirementIds,
    careerSnapshotHash: session.careerSnapshotHash ?? "",
  };
}

export { INTERVIEW_TARGET_TYPE };
