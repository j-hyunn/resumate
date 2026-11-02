import { describe, expect, it } from "vitest";
import { AiError, ProviderError } from "@/server/ai/errors";
import type { Llm } from "@/server/ai/llm";
import { createRecordingKeyStatusReporter, createStaticProviderContext, type KeySource, type ProviderContext } from "@/server/jobs/provider-context";
import { createJobRunner } from "@/server/jobs/runner";
import type { JobTypeDefinition } from "@/server/jobs/types";
import { MemoryJobStore, MemoryUsageStore, createScriptedAdapter, fakeClock, memoryScope, scriptedLlmFactory, type ScriptedResponse } from "@/test/job-fakes";
import type { BegunEvaluation, BegunQuestions, InterviewStore, SessionForEvaluation } from "./db";
import {
  createInterviewEvaluationJobDefinition,
  createInterviewQuestionsJobDefinition,
  summarizeInput,
  type ExistingQuestion,
  type InterviewPipelines,
} from "./job";

/**
 * S8 interview jobs on the REAL runner (memory job / usage stores, scripted
 * provider through the real createLlm, an in-memory interview DB):
 * questions saved as they stream with progress, short sets regenerated once,
 * partial failure keeps saved questions (a new job makes only the rest),
 * paid parallel vs free one-answer-per-run evaluation, per-answer final
 * failure → not_scored while the job goes on, retry of only the failed
 * answer, key loss (D-36), cancel.
 */

const USER = "00000000-0000-4000-8000-000000000001";
const PROJECT = "00000000-0000-4000-8000-0000000000aa";
const SESSION = "00000000-0000-4000-8000-0000000000cc";
const PAID: ProviderContext = { provider: "anthropic", connectionTier: "paid", keyStatus: "valid" };
const FREE: ProviderContext = { provider: "gemini", connectionTier: "free", keyStatus: "valid" };
const OK: ScriptedResponse = { json: { ok: true } };

const qid = (n: number) => `00000000-0000-4000-8000-1000000000${String(n).padStart(2, "0")}`;
const aid = (n: number) => `00000000-0000-4000-8000-2000000000${String(n).padStart(2, "0")}`;

/** In-memory interview tables + the app_ai_writer RPCs over them. */
class FakeInterviewDb implements InterviewStore {
  questionCount: number;
  generation: "generating" | "ready" | "failed" = "generating";
  status: "in_progress" | "evaluating" | "completed" | "evaluation_failed" = "in_progress";
  questions = new Map<number, { id: string; text: string }>();
  answers = new Map<string, { questionId: string; text: string; status: "draft" | "submitted" | "unanswered"; score: string | null }>();
  evaluations = new Map<string, "succeeded" | "failed">();
  feedback: "succeeded" | null = null;
  completedQuestions: unknown[] = [];
  failCalls: string[] = [];
  evaluationProvider: string | null = null;

  constructor(questionCount = 5) {
    this.questionCount = questionCount;
  }
  async beginQuestions(): Promise<BegunQuestions> {
    this.generation = "generating";
    return {
      sessionId: SESSION,
      applicationProjectId: PROJECT,
      interviewType: "job",
      questionCount: this.questionCount,
      dataSufficiency: "ok",
      reopened: false,
      savedCount: this.questions.size,
      remaining: this.questionCount - this.questions.size,
      existingQuestions: [],
    };
  }
  async saveQuestion({ payload }: { payload: unknown }) {
    const seq = (payload as { sequence: number }).sequence;
    if (!this.questions.has(seq)) {
      const id = qid(seq);
      this.questions.set(seq, { id, text: `Q${seq}` });
      this.answers.set(aid(seq), { questionId: id, text: "", status: "draft", score: null });
    }
    return { applied: true, savedCount: this.questions.size, questionCount: this.questionCount, sequence: seq };
  }
  async completeQuestions({ payload }: { payload: unknown }) {
    if (this.questions.size !== this.questionCount) throw new Error("interview_questions_incomplete");
    this.completedQuestions.push(payload);
    this.generation = "ready";
    return { applied: true };
  }
  async failQuestions() {
    this.generation = "failed";
    return true;
  }
  /** Simulates the user's answers + submit_interview_session. */
  submit(texts: Record<number, string>) {
    for (const [seq, q] of this.questions) {
      const a = this.answers.get(aid(seq))!;
      a.text = texts[seq] ?? "";
      a.status = a.text.trim() ? "submitted" : "unanswered";
      a.score = a.status === "unanswered" ? "unanswered" : null;
      void q;
    }
    this.status = "evaluating";
  }
  async beginEvaluation({ provider }: { provider: string }): Promise<BegunEvaluation> {
    this.evaluationProvider = provider;
    this.status = "evaluating";
    const toEvaluate = [...this.answers.entries()].filter(([id, a]) => a.status === "submitted" && this.evaluations.get(id) !== "succeeded");
    return {
      sessionId: SESSION,
      applicationProjectId: PROJECT,
      interviewType: "job",
      dataSufficiency: "ok",
      reopened: false,
      answersToEvaluate: toEvaluate.map(([id, a]) => ({ answer_id: id, question_id: a.questionId, sequence: Number(a.questionId.slice(-2)) })),
      evaluatedAnswerIds: [...this.evaluations.entries()].filter(([, s]) => s === "succeeded").map(([id]) => id),
      unansweredAnswerIds: [...this.answers.entries()].filter(([, a]) => a.status === "unanswered").map(([id]) => id),
    };
  }
  async saveAnswerEvaluation({ answerId }: { answerId: string }) {
    this.evaluations.set(answerId, "succeeded");
    this.answers.get(answerId)!.score = "pending_method";
    return { applied: true };
  }
  async failAnswerEvaluation(answerId: string) {
    this.failCalls.push(answerId);
    this.evaluations.set(answerId, "failed");
    this.answers.get(answerId)!.score = "not_scored";
    return true;
  }
  async saveSessionFeedback() {
    this.feedback = "succeeded";
    return { applied: true };
  }
  async completeEvaluation() {
    const ok = [...this.evaluations.values()].some((s) => s === "succeeded") && this.feedback === "succeeded";
    this.status = ok ? "completed" : "evaluation_failed";
    const notScored = [...this.answers.entries()].filter(([id, a]) => a.status === "submitted" && this.evaluations.get(id) !== "succeeded").map(([id]) => id);
    return { applied: true, status: this.status as "completed" | "evaluation_failed", notScoredAnswerIds: notScored };
  }
  existing(): ExistingQuestion[] {
    return [...this.questions.entries()]
      .sort(([a], [b]) => a - b)
      .map(([seq, q]) => ({ sequence: seq, source_kind: "project_deep_dive", anchor: "experience", question_text: q.text, target_requirement_ids: [], target_gap_requirement_ids: [], evidence_sources: [] }));
  }
  sessionView(): SessionForEvaluation {
    return {
      questions: [...this.questions.entries()].map(([seq, q]) => ({
        id: q.id,
        sequence: seq,
        source_kind: "project_deep_dive",
        anchor: "experience",
        question_text: q.text,
        intent: "hidden intent",
        focus_criteria: [],
        good_answer_signals: ["signal"],
        target_requirement_ids: [],
        target_gap_requirement_ids: [],
      })),
      answers: [...this.answers.entries()].map(([id, a]) => ({ id, question_id: a.questionId, answer_text: a.text, status: a.status, updated_at: null })),
      evaluations: [...this.evaluations.entries()].map(([answer_id, status]) => ({ answer_id, status, result: { criteria: [] } })),
      weakRequirementIds: [],
      careerSnapshotHash: "career-h",
    };
  }
}

function call(llm: Llm, callKey: string, signal: AbortSignal) {
  return llm.complete({ feature: "AI-05.test", promptVersion: "t", callKey, systemBlocks: [], userBlocks: [{ text: "u" }], outputSchema: null, signal });
}

type Behavior = {
  /** Per generate attempt: how many questions this call saves (default: all remaining), and an error thrown after saving. */
  generate?: Array<{ save?: number; throwAfter?: Error }>;
  /** Per answer sequence → errors thrown by evaluate (consumed one per call; OK after). */
  evaluateErrors?: Record<number, Error[]>;
  summarizeError?: Error;
  /** Answer sequences whose first evaluation has V-5 violations (→ a regeneration call). */
  regenFor?: number[];
  /** Per answer sequence → errors thrown by the regeneration. */
  regenErrors?: Record<number, Error[]>;
};

const finalized: Array<{ seq: number; regen: string | null }> = [];

function fakePipelines(db: FakeInterviewDb, calls: string[], b: Behavior): InterviewPipelines<{ k: string }, { seq: number }> {
  let genAttempt = 0;
  let summaryFailed = false;
  let snapshots = 0;
  const regenErrors = Object.fromEntries(Object.entries(b.regenErrors ?? {}).map(([k, v]) => [k, [...v]]));
  const evalErrors = Object.fromEntries(Object.entries(b.evaluateErrors ?? {}).map(([k, v]) => [k, [...v]]));
  return {
    questions: {
      promptVersion: "ai-05.test",
      tier: "default",
      maxAttempts: 2,
      buildContext: () => ({ k: "q" }),
      async generate(input, deps) {
        const plan = b.generate?.[genAttempt++] ?? {};
        calls.push(`generate.${input.attempt}:${input.existing.length}`);
        await call(deps.llm, deps.callKey, deps.signal);
        const empty = Array.from({ length: db.questionCount }, (_, i) => i + 1).filter((s) => !input.existing.some((e) => e.sequence === s));
        const toSave = empty.slice(0, plan.save ?? empty.length);
        for (const seq of toSave) await deps.onQuestion({ sequence: seq });
        if (plan.throwAfter) throw plan.throwAfter;
        return {
          remaining: empty.length - toSave.length,
          weakRequirementIds: [`weak-${input.attempt}`],
          model: "m",
          usage: { inputTokens: 10 },
          report: { questions_total: toSave.length },
          unsupportedNumbers: [],
        };
      },
      snapshot: () => ({ interviewType: "job", insightId: null, careerSnapshotHash: `career-${++snapshots}`, requirementIds: [] }),
      // R1 A22: fake fold = sums (production: ai accumulateQuestionSetRecord).
      accumulate: (prev, attempt) => ({
        report: Object.fromEntries(
          [...new Set([...Object.keys(prev?.report ?? {}), ...Object.keys(attempt.report)])].map((k) => [k, (prev?.report[k] ?? 0) + (attempt.report[k] ?? 0)]),
        ),
        usage: { inputTokens: ((prev?.usage as { inputTokens?: number } | null)?.inputTokens ?? 0) + ((attempt.usage as { inputTokens?: number } | null)?.inputTokens ?? 0) },
        attempts: (prev?.attempts ?? 0) + 1,
      }),
      completePayload: (input) => ({
        weak: input.run.weakRequirementIds,
        provider: input.provider,
        hash: input.snapshot.careerSnapshotHash,
        validation_report: input.run.report,
        usage: input.run.usage,
        attempts: input.run.attempts,
      }),
    },
    evaluation: {
      promptVersion: "ai-06.test",
      tier: "default",
      buildContext: (input) => {
        // Hidden columns reach AI-06 (app_ai_writer read), never a client.
        expect(input.question.intent).toBe("hidden intent");
        return { seq: input.question.sequence };
      },
      async evaluateFirst(input, deps) {
        calls.push(`evaluate.${input.context.seq}`);
        await call(deps.llm, deps.callKey, deps.signal);
        const err = evalErrors[input.context.seq]?.shift();
        if (err) throw err;
        return { kind: "first", seq: input.context.seq, violations: b.regenFor?.includes(input.context.seq) ? ["99%"] : [] };
      },
      async regenerate(input, deps) {
        calls.push(`regen.${input.context.seq}`);
        await call(deps.llm, `${deps.callKey}.regen`, deps.signal);
        const err = regenErrors[input.context.seq]?.shift();
        if (err) throw err;
        return { kind: "regen", seq: input.context.seq, violations: [] };
      },
      finalize: (input) => {
        finalized.push({ seq: (input.first as unknown as { seq: number }).seq, regen: input.regen ? "regen" : null });
        return { payload: { seq: (input.first as unknown as { seq: number }).seq } };
      },
      async summarize(input, deps) {
        calls.push(`summarize:${input.questions.filter((q) => q.evaluation).length}`);
        await call(deps.llm, deps.callKey, deps.signal);
        if (b.summarizeError && !summaryFailed) {
          summaryFailed = true;
          throw b.summarizeError;
        }
        return { payload: {} };
      },
    },
  };
}

function setup(opts: { context?: ProviderContext; responses?: ScriptedResponse[]; questionCount?: number; behavior?: Behavior; keySource?: KeySource } = {}) {
  const clock = fakeClock();
  const context = opts.context ?? PAID;
  const store = new MemoryJobStore(clock.now);
  const usage = new MemoryUsageStore(USER);
  const scripted = createScriptedAdapter(context.provider, opts.responses ?? Array.from({ length: 30 }, () => OK), clock.ms);
  const db = new FakeInterviewDb(opts.questionCount ?? 5);
  const calls: string[] = [];
  finalized.length = 0;
  const deps = {
    pipelines: fakePipelines(db, calls, opts.behavior ?? {}),
    storeFor: () => db,
    ensureJd: async () => ({ status: "already_extracted" as const }),
    loadCareerRows: async () => ({ profile: null, experiences: [], educations: [], projects: [], projectDetails: [], achievements: [], skills: [], projectSkills: [] }),
    loaders: {
      jd: async () => ({ jobDescriptionId: "jd", updatedAt: null, extractionStatus: "succeeded", sentences: [], positionTitle: null, cultureSids: [], requirements: [] }),
      insightSignal: async () => null,
      recentQuestions: async () => [],
      existingQuestions: async () => db.existing(),
      questionEvidence: async () => new Map(),
      session: async () => db.sessionView(),
    },
  };
  const questions = createInterviewQuestionsJobDefinition(deps);
  const evaluation = createInterviewEvaluationJobDefinition(deps);
  const keySource: KeySource = opts.keySource ?? { forJob: async () => "sk-test-key-0000" };
  const scheduled: (() => Promise<void>)[] = [];
  const runner = createJobRunner<Llm>({
    forUser: () => memoryScope(store, usage, { keySource, keyStatus: createRecordingKeyStatusReporter() }),
    providerContext: createStaticProviderContext(context),
    createLlm: scriptedLlmFactory(scripted.adapter, clock.ms),
    settleLlm: (llm, ms) => llm.settle(ms),
    getDefinition: (t) => ({ interview_questions: questions, interview_evaluation: evaluation })[t as string] as JobTypeDefinition<Llm> | undefined,
    schedule: (task) => void scheduled.push(task),
    continueJob: async () => {},
    now: clock.now,
    random: () => 0,
    timing: { stepTimeoutMs: 2_000, heartbeatIntervalMs: 5, invocationBudgetMs: 55_000 },
  });
  async function drain() {
    while (scheduled.length) await scheduled.shift()!();
    await new Promise((r) => setTimeout(r, 0));
  }
  async function start(jobType: "interview_questions" | "interview_evaluation") {
    const res = await runner.startJob({
      userId: USER,
      jobType,
      target: { type: "interview_session", id: SESSION },
      applicationProjectId: PROJECT,
      params: { sessionId: SESSION, applicationProjectId: PROJECT },
      regenerate: true,
    });
    return res.jobId;
  }
  async function wake(jobId: string) {
    const at = store.jobs.get(jobId)!.nextRunAt;
    expect(at).not.toBeNull();
    clock.advance(Date.parse(at!) - clock.ms());
    await runner.getStatus({ jobId, userId: USER });
    await drain();
  }
  /** Wakes until the job is terminal (free tier spacing / scheduled retries). */
  async function settle(jobId: string, max = 20) {
    await drain();
    for (let i = 0; i < max && store.jobs.get(jobId)!.status === "queued"; i++) await wake(jobId);
  }
  return { clock, store, usage, db, calls, runner, drain, start, wake, settle, job: (id: string) => store.jobs.get(id)! };
}

describe("interview_questions job (AI-05)", () => {
  it("saves each question as it streams with progress, then completes the set (one call, one usage record)", async () => {
    const h = setup();
    const jobId = await h.start("interview_questions");
    await h.drain();
    const job = h.job(jobId);
    expect(job.status).toBe("succeeded");
    expect(h.calls).toEqual(["generate.0:0"]);
    expect(h.db.questions.size).toBe(5);
    expect(h.db.answers.size).toBe(5); // an empty answer per question
    expect(h.db.generation).toBe("ready");
    expect(h.db.completedQuestions).toEqual([{ weak: ["weak-0"], provider: "anthropic", hash: "career-1", validation_report: { questions_total: 5 }, usage: { inputTokens: 10 }, attempts: 1 }]);
    expect(h.usage.forJob(jobId)).toHaveLength(1);
    expect(job.stepOutputs.generate).toMatchObject({ weakRequirementIds: ["weak-0"] });
  });

  it("a short set is regenerated once for the remaining count (existing passed, weak ids merged)", async () => {
    const h = setup({ behavior: { generate: [{ save: 3 }, {}] } });
    const jobId = await h.start("interview_questions");
    await h.drain();
    expect(h.job(jobId).status).toBe("succeeded");
    expect(h.calls).toEqual(["generate.0:0", "generate.1:3"]);
    // R1 A22: the set-level report / usage add up both calls (not just the last one).
    expect(h.db.completedQuestions).toEqual([
      { weak: ["weak-0", "weak-1"], provider: "anthropic", hash: "career-1", validation_report: { questions_total: 5 }, usage: { inputTokens: 20 }, attempts: 2 },
    ]);
    expect(h.usage.forJob(jobId)).toHaveLength(2);
  });

  it("still short after the regeneration → failed schema_invalid; saved questions stay (D-36)", async () => {
    const h = setup({ behavior: { generate: [{ save: 2 }, { save: 1 }] } });
    const jobId = await h.start("interview_questions");
    await h.drain();
    const job = h.job(jobId);
    expect(job.status).toBe("failed");
    expect(job.errorCode).toBe("schema_invalid");
    expect(h.db.questions.size).toBe(3);
    expect(h.db.completedQuestions).toHaveLength(0);
  });

  it("a stream failing after 2 questions fails the job; a new job (남은 질문 다시 만들기) makes only the remaining 3", async () => {
    const h = setup({ behavior: { generate: [{ save: 2, throwAfter: new ProviderError("provider_unavailable", { beforeFirstToken: false }) }, {}] } });
    const first = await h.start("interview_questions");
    await h.drain();
    expect(h.job(first).status).toBe("failed");
    expect(h.job(first).errorCode).toBe("provider_unavailable");
    expect(h.db.questions.size).toBe(2);

    const second = await h.start("interview_questions");
    await h.drain();
    expect(h.job(second).status).toBe("succeeded");
    expect(h.calls).toEqual(["generate.0:0", "generate.0:2"]);
    expect(h.db.questions.size).toBe(5);
  });

  it("free tier: the regeneration call waits for the call spacing (C-12)", async () => {
    const h = setup({ context: FREE, behavior: { generate: [{ save: 4 }, {}] } });
    const jobId = await h.start("interview_questions");
    await h.drain();
    expect(h.job(jobId).status).toBe("queued");
    expect(h.job(jobId).nextRunAt).not.toBeNull();
    await h.settle(jobId);
    expect(h.job(jobId).status).toBe("succeeded");
    expect(h.calls).toEqual(["generate.0:0", "generate.1:4"]);
  });

  it("a cancel (그만두기) during generation ends canceled; nothing completes", async () => {
    const h = setup({ responses: [{ hang: true }] });
    const jobId = await h.start("interview_questions");
    const run = h.drain();
    await new Promise((r) => setTimeout(r, 20));
    h.store.requestCancel(jobId);
    await run;
    expect(h.job(jobId).status).toBe("canceled");
    expect(h.db.completedQuestions).toHaveLength(0);
  });
});

async function readySession(h: ReturnType<typeof setup>, answers: Record<number, string>) {
  const q = await h.start("interview_questions");
  await h.drain();
  expect(h.job(q).status).toBe("succeeded");
  h.calls.length = 0;
  h.db.submit(answers);
}

describe("interview_evaluation job (AI-06 + AI-07)", () => {
  it("paid: answered questions are evaluated in parallel, then the summary; unanswered ones are skipped", async () => {
    const h = setup();
    await readySession(h, { 1: "답 1", 2: "답 2", 3: "  ", 4: "답 4", 5: "" });
    const jobId = await h.start("interview_evaluation");
    await h.drain();
    const job = h.job(jobId);
    expect(job.status).toBe("succeeded");
    expect(h.calls.filter((c) => c.startsWith("evaluate")).sort()).toEqual(["evaluate.1", "evaluate.2", "evaluate.4"]);
    expect(h.calls.at(-1)).toBe("summarize:3");
    expect(h.db.status).toBe("completed");
    expect(h.db.evaluationProvider).toBe("anthropic");
    expect(h.usage.forJob(jobId).map((r) => r.callKey).sort()).toEqual([
      "interview_evaluation.evaluate.1",
      "interview_evaluation.evaluate.2",
      "interview_evaluation.evaluate.4",
      "interview_evaluation.summarize",
    ]);
    expect(job.progress).toMatchObject({ stage: "complete" });
    expect(job.stepOutputs.evaluate).toEqual({ succeededCount: 3, failed: {} });
  });

  it("an answer that finally fails is not_scored; the job goes on and the summary uses the rest [가정 2]", async () => {
    const h = setup({ behavior: { evaluateErrors: { 2: [new AiError("schema_invalid", { retryable: false })] } } });
    await readySession(h, { 1: "a", 2: "b", 3: "c", 4: "d", 5: "e" });
    const jobId = await h.start("interview_evaluation");
    await h.drain();
    expect(h.job(jobId).status).toBe("succeeded");
    expect(h.db.failCalls).toEqual([aid(2)]);
    expect(h.db.answers.get(aid(2))!.score).toBe("not_scored");
    expect(h.calls.at(-1)).toBe("summarize:4");
    expect(h.db.status).toBe("completed");

    // 다시 채점: a new job evaluates only the failed answer, then the summary again.
    h.calls.length = 0;
    const retry = await h.start("interview_evaluation");
    await h.drain();
    expect(h.job(retry).status).toBe("succeeded");
    expect(h.calls).toEqual(["evaluate.2", "summarize:5"]);
  });

  it("a retryable failure retries the step; answers already saved are not called again", async () => {
    const h = setup({ responses: [...Array.from({ length: 1 }, () => OK), OK, { error: "provider_unavailable" }, OK, OK, OK, OK, OK, OK] });
    await readySession(h, { 1: "a", 2: "b", 3: "c" });
    const jobId = await h.start("interview_evaluation");
    await h.drain();
    expect(h.job(jobId).status).toBe("queued");
    await h.settle(jobId);
    expect(h.job(jobId).status).toBe("succeeded");
    const evaluates = h.calls.filter((c) => c.startsWith("evaluate"));
    expect(evaluates).toHaveLength(4); // 3 + one retry of the failed answer
    expect(h.db.failCalls).toEqual([]);
    expect(h.usage.forJob(jobId)).toHaveLength(5); // failed call recorded too
  });

  it("key deleted mid-run (D-36): the job fails key_missing; saved evaluations and answers stay", async () => {
    let n = 0;
    const keySource: KeySource = {
      async forJob() {
        n++;
        // 1 call for the questions, then the first evaluation; the key is gone after that.
        if (n > 2) throw new ProviderError("key_missing");
        return "sk-test-key-0000";
      },
    };
    const h = setup({ context: FREE, keySource });
    await readySession(h, { 1: "a", 2: "b", 3: "c" });
    const jobId = await h.start("interview_evaluation");
    await h.settle(jobId);
    const job = h.job(jobId);
    expect(job.status).toBe("failed");
    expect(job.errorCode).toBe("key_missing");
    expect([...h.db.evaluations.values()]).toEqual(["succeeded"]);
    expect(h.db.failCalls).toEqual([]); // a key cause fails the job, not the answer
    expect([...h.db.answers.values()].filter((a) => a.text).every((a) => a.status === "submitted")).toBe(true);
  });

  it("free tier: one answer per run, spaced (C-12), then the summary", async () => {
    const h = setup({ context: FREE });
    await readySession(h, { 1: "a", 2: "b", 3: "c" });
    const jobId = await h.start("interview_evaluation");
    await h.drain();
    expect(h.job(jobId).status).toBe("queued"); // spaced after the questions call
    await h.settle(jobId);
    expect(h.job(jobId).status).toBe("succeeded");
    expect(h.calls).toEqual(["evaluate.1", "evaluate.2", "evaluate.3", "summarize:3"]);
    const times = h.usage.forJob(jobId).map((r) => Date.parse(r.occurredAt));
    for (let i = 1; i < times.length; i++) expect(times[i]! - times[i - 1]!).toBeGreaterThanOrEqual(6_000);
  });

  it("every answer fails → no summary call; the session is evaluation_failed and the job fails with that cause", async () => {
    const bad = () => new AiError("safety_blocked", { retryable: false });
    const h = setup({ behavior: { evaluateErrors: { 1: [bad()], 2: [bad()] } } });
    await readySession(h, { 1: "a", 2: "b" });
    const jobId = await h.start("interview_evaluation");
    await h.drain();
    const job = h.job(jobId);
    expect(job.status).toBe("failed");
    expect(job.errorCode).toBe("safety_blocked");
    expect(h.calls.some((c) => c.startsWith("summarize"))).toBe(false);
    expect(h.db.status).toBe("evaluation_failed");
  });

  it("summary failure fails the job; 다시 채점 then redoes only the summary [가정 1]", async () => {
    const h = setup({ behavior: { summarizeError: new AiError("schema_invalid", { retryable: false }) } });
    await readySession(h, { 1: "a", 2: "b" });
    const jobId = await h.start("interview_evaluation");
    await h.drain();
    expect(h.job(jobId).status).toBe("failed");
    expect(h.db.evaluations.size).toBe(2); // kept
    expect(h.db.feedback).toBeNull();

    h.calls.length = 0;
    const retry = await h.start("interview_evaluation");
    await h.drain();
    expect(h.job(retry).status).toBe("succeeded");
    expect(h.calls).toEqual(["summarize:2"]);
    expect(h.db.status).toBe("completed");
  });
});

describe("summarizeInput", () => {
  it("lists every question with its answer status and only succeeded evaluations; requirement contents for weak + target ids", () => {
    const db = new FakeInterviewDb(2);
    db.questions.set(1, { id: qid(1), text: "Q1" });
    db.questions.set(2, { id: qid(2), text: "Q2" });
    db.answers.set(aid(1), { questionId: qid(1), text: "a", status: "submitted", score: null });
    db.answers.set(aid(2), { questionId: qid(2), text: "", status: "unanswered", score: "unanswered" });
    db.evaluations.set(aid(1), "succeeded");
    const session = { ...db.sessionView(), weakRequirementIds: ["r1"] };
    const input = summarizeInput(
      { requirements: [{ id: "r1", content: "요건 1", category: "required", importance: "high", source_sids: [], sort_order: 0, updated_at: null }, { id: "r2", content: "x", category: "required", importance: "high", source_sids: [], sort_order: 1, updated_at: null }] },
      { interviewType: "job", dataSufficiency: "ok" },
      session,
    );
    expect(input.questions.map((q) => [q.sequence, q.answer_status, q.evaluation !== null])).toEqual([
      [1, "submitted", true],
      [2, "unanswered", false],
    ]);
    expect(input.requirements).toEqual([{ id: "r1", content: "요건 1" }]);
    expect(input.careerSnapshotHash).toBe("career-h");
  });
});

describe("interview_evaluation — AI-06 V-5 regeneration as its own unit (QA-S8-01)", () => {
  it("free tier: first evaluation and regeneration are separate runs; every call ≥ 6 s apart", async () => {
    const h = setup({ context: FREE, behavior: { regenFor: [1, 2] } });
    await readySession(h, { 1: "a", 2: "b" });
    const jobId = await h.start("interview_evaluation");
    await h.settle(jobId, 40);
    expect(h.job(jobId).status).toBe("succeeded");
    expect(h.calls).toEqual(["evaluate.1", "regen.1", "evaluate.2", "regen.2", "summarize:2"]);
    const times = h.usage.forJob(jobId).map((r) => Date.parse(r.occurredAt));
    expect(times).toHaveLength(5);
    for (let i = 1; i < times.length; i++) expect(times[i]! - times[i - 1]!).toBeGreaterThanOrEqual(6_000);
    expect(finalized).toEqual([
      { seq: 1, regen: "regen" },
      { seq: 2, regen: "regen" },
    ]);
  });

  it("paid: a regeneration failing retryably is retried alone — the first evaluation is not called again", async () => {
    const h = setup({ behavior: { regenFor: [1], regenErrors: { 1: [new ProviderError("provider_unavailable", { beforeFirstToken: true })] } } });
    await readySession(h, { 1: "a", 2: "b" });
    const jobId = await h.start("interview_evaluation");
    await h.settle(jobId);
    expect(h.job(jobId).status).toBe("succeeded");
    expect(h.calls.filter((c) => c === "evaluate.1")).toHaveLength(1);
    expect(h.calls.filter((c) => c === "regen.1")).toHaveLength(2);
    expect(h.calls.filter((c) => c === "evaluate.2")).toHaveLength(1);
    expect(h.usage.forJob(jobId).filter((r) => r.callKey === "interview_evaluation.evaluate.1")).toHaveLength(1);
    expect(h.job(jobId).meta.partials).toBeUndefined();
  });

  it("free tier: a failed regeneration retry doesn't repeat the first call", async () => {
    const h = setup({ context: FREE, behavior: { regenFor: [1], regenErrors: { 1: [new ProviderError("provider_unavailable", { beforeFirstToken: true })] } } });
    await readySession(h, { 1: "a" });
    const jobId = await h.start("interview_evaluation");
    await h.settle(jobId, 40);
    expect(h.job(jobId).status).toBe("succeeded");
    expect(h.calls).toEqual(["evaluate.1", "regen.1", "regen.1", "summarize:1"]);
  });

  it("a regeneration that finally fails keeps the first answer (V-5 fallback in finalize), not not_scored", async () => {
    const h = setup({ behavior: { regenFor: [1], regenErrors: { 1: [new AiError("schema_invalid", { retryable: false })] } } });
    await readySession(h, { 1: "a" });
    const jobId = await h.start("interview_evaluation");
    await h.drain();
    expect(h.job(jobId).status).toBe("succeeded");
    expect(finalized).toEqual([{ seq: 1, regen: null }]);
    expect(h.db.failCalls).toEqual([]);
    expect(h.db.evaluations.get(aid(1))).toBe("succeeded");
  });
});
