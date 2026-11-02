import { AppError } from "@/lib/contracts/errors";
import type { CareerRows } from "@/server/ai/context-pack/career-rows";
import type { JdRequirementInput, JdSentence } from "@/server/ai/context-pack/jd";
import type { Json } from "@/server/db/database.types";
import { mapDbError } from "@/server/db/errors";
import type { AiWriterSupabaseClient, UserSupabaseClient } from "@/server/db/types";
import { loadDraftJd } from "@/server/services/drafts/db";
import { loadInsightRequirements, raiseName } from "@/server/services/insight/db";

/**
 * S8 interview persistence (db notes "RPC 시그니처와 반환 형태"). Job steps
 * read inputs and call the AI RPCs through app_ai_writer (DM-13); reads and
 * user RPCs go through the user session (RLS). Hidden question columns
 * (`intent`, `good_answer_signals`) are read only here, by app_ai_writer,
 * for AI-06 / AI-07 input — never returned to a client.
 */

type Client = AiWriterSupabaseClient | UserSupabaseClient;
type RpcError = Parameters<typeof mapDbError>[0];

const obj = (v: unknown): Record<string, unknown> => (v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {});
const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
const str = (v: unknown): string | null => (typeof v === "string" ? v : null);
const strs = (v: unknown): string[] => arr(v).filter((x): x is string => typeof x === "string");
const num = (v: unknown, d = 0): number => (typeof v === "number" ? v : d);

// ---------------- errors ----------------

/** An RPC refusal with its raise name (P0001 message) and the mapped AppError. */
export class InterviewRpcError extends Error {
  constructor(
    readonly raise: string | null,
    readonly appError: AppError,
  ) {
    super(`interview rpc failed: ${raise ?? "db_error"}`);
    this.name = "InterviewRpcError";
  }
}

function rpcFailure(error: RpcError): InterviewRpcError {
  return new InterviewRpcError(raiseName(error), mapDbError(error));
}

/** Raises that mean the session / project / answer is gone (deleted mid-run) — db notes: treat like canceled. */
export const GONE_RAISES: ReadonlySet<string> = new Set(["interview_session_not_found", "interview_answer_not_found", "application_project_not_found"]);

// ---------------- inputs (AI-05 / AI-06 / AI-07) ----------------

export type InterviewJdInputs = {
  jobDescriptionId: string;
  updatedAt: string | null;
  extractionStatus: string;
  sentences: JdSentence[];
  positionTitle: string | null;
  /** extraction.other_sids (컬처핏 `jd` 앵커용). */
  cultureSids: string[];
  requirements: JdRequirementInput[];
};

export async function loadInterviewJd(db: Client, applicationProjectId: string): Promise<InterviewJdInputs | null> {
  const jd = await loadDraftJd(db, applicationProjectId);
  if (!jd || jd.extractionStatus !== "succeeded") return null;
  const requirements = await loadInsightRequirements(db, jd.jobDescriptionId);
  return {
    jobDescriptionId: jd.jobDescriptionId,
    updatedAt: jd.updatedAt,
    extractionStatus: jd.extractionStatus,
    sentences: jd.sentences,
    positionTitle: jd.positionTitle,
    cultureSids: jd.otherSids,
    requirements,
  };
}

export type InterviewInsightSignal = {
  insightId: string;
  matches: Array<{ requirement_id: string; status: "met" | "partial" | "no_evidence"; missing_aspect: string | null }>;
};

/** AI-05 참고 신호 (직무만): the latest ready insight's requirement matches. */
export async function loadInterviewInsightSignal(db: Client, applicationProjectId: string): Promise<InterviewInsightSignal | null> {
  const { data, error } = await db
    .from("insights")
    .select("id, result")
    .eq("application_project_id", applicationProjectId)
    .eq("is_latest", true)
    .eq("status", "ready")
    .limit(1);
  if (error) throw mapDbError(error);
  const row = data?.[0];
  if (!row) return null;
  const matches = arr(obj(row.result).requirement_matches).flatMap((raw) => {
    const m = obj(raw);
    const id = str(m.requirement_id);
    const status = str(m.status);
    if (!id || (status !== "met" && status !== "partial" && status !== "no_evidence")) return [];
    return [{ requirement_id: id, status: status as "met" | "partial" | "no_evidence", missing_aspect: str(m.missing_aspect) }];
  });
  return { insightId: row.id, matches };
}

/** AI-05 "최근 세션 질문": question texts of the 2 newest other sessions of the same project and type. */
export async function loadRecentQuestions(db: Client, args: { applicationProjectId: string; interviewType: string; excludeSessionId: string }): Promise<string[]> {
  const { data: sessions, error } = await db
    .from("interview_sessions")
    .select("id")
    .eq("application_project_id", args.applicationProjectId)
    .eq("interview_type", args.interviewType)
    .neq("id", args.excludeSessionId)
    .order("created_at", { ascending: false })
    .limit(2);
  if (error) throw mapDbError(error);
  const ids = (sessions ?? []).map((s) => s.id);
  if (ids.length === 0) return [];
  const { data, error: qError } = await db.from("interview_questions").select("question_text, session_id, sequence").in("session_id", ids).order("sequence", { ascending: true });
  if (qError) throw mapDbError(qError);
  return (data ?? []).map((q) => q.question_text);
}

/** One evidence_links row of a question (UUID form; `sid` = source_locator.sid for JD sentences). */
export type QuestionEvidence = { source_type: string; source_id: string; source_field: string | null; quote: string | null; sid: string | null };

/** evidence_links sources of the given questions (AI-05 `existingQuestions[].evidence_sources`, AI-06 question evidence). */
export async function loadQuestionEvidence(
  db: Client,
  questionIds: readonly string[],
): Promise<Map<string, QuestionEvidence[]>> {
  const out = new Map<string, QuestionEvidence[]>();
  if (questionIds.length === 0) return out;
  const { data, error } = await db
    .from("evidence_links")
    .select("owner_id, source_type, source_id, source_field, quote, source_locator, sort_order")
    .eq("owner_type", "interview_question")
    .in("owner_id", [...questionIds])
    .order("sort_order", { ascending: true });
  if (error) throw mapDbError(error);
  for (const r of data ?? []) {
    const list = out.get(r.owner_id) ?? [];
    const sid = str(obj(r.source_locator).sid);
    list.push({ source_type: r.source_type, source_id: r.source_id, source_field: r.source_field, quote: r.quote, sid });
    out.set(r.owner_id, list);
  }
  return out;
}

/** A question with its hidden columns — app_ai_writer only (AI-06 / AI-07 input). */
export type WriterQuestion = {
  id: string;
  sequence: number;
  source_kind: string;
  anchor: string;
  question_text: string;
  intent: string | null;
  focus_criteria: string[];
  good_answer_signals: string[];
  target_requirement_ids: string[];
  target_gap_requirement_ids: string[];
};

export type WriterAnswer = { id: string; question_id: string; answer_text: string; status: string; updated_at: string | null };

export type WriterEvaluation = { answer_id: string; status: string; result: Json | null };

export type SessionForEvaluation = {
  questions: WriterQuestion[];
  answers: WriterAnswer[];
  evaluations: WriterEvaluation[];
  weakRequirementIds: string[];
  careerSnapshotHash: string | null;
};

function signalsOf(v: Json | null): string[] {
  // good_answer_signals is a jsonb array of strings (DM A.13, save_interview_question payload).
  return strs(v);
}

export async function loadSessionForEvaluation(db: AiWriterSupabaseClient, sessionId: string): Promise<SessionForEvaluation> {
  const [questions, answers, evaluations, session] = await Promise.all([
    db
      .from("interview_questions")
      .select("id, sequence, source_kind, anchor, question_text, intent, focus_criteria, good_answer_signals, target_requirement_ids, target_gap_requirement_ids")
      .eq("session_id", sessionId)
      .order("sequence", { ascending: true }),
    db.from("interview_answers").select("id, question_id, answer_text, status, updated_at").eq("session_id", sessionId),
    db.from("answer_evaluations").select("answer_id, status, result").eq("session_id", sessionId),
    db.from("interview_sessions").select("weak_requirement_ids, career_snapshot_hash").eq("id", sessionId).maybeSingle(),
  ]);
  for (const r of [questions, answers, evaluations, session]) if (r.error) throw mapDbError(r.error);
  return {
    questions: (questions.data ?? []).map((q) => ({
      id: q.id,
      sequence: q.sequence,
      source_kind: q.source_kind,
      anchor: q.anchor,
      question_text: q.question_text,
      intent: q.intent,
      focus_criteria: q.focus_criteria ?? [],
      good_answer_signals: signalsOf(q.good_answer_signals),
      target_requirement_ids: q.target_requirement_ids ?? [],
      target_gap_requirement_ids: q.target_gap_requirement_ids ?? [],
    })),
    answers: (answers.data ?? []).map((a) => ({ id: a.id, question_id: a.question_id, answer_text: a.answer_text ?? "", status: a.status, updated_at: a.updated_at })),
    evaluations: (evaluations.data ?? []).map((e) => ({ answer_id: e.answer_id, status: e.status, result: e.result })),
    weakRequirementIds: session.data?.weak_requirement_ids ?? [],
    careerSnapshotHash: session.data?.career_snapshot_hash ?? null,
  };
}

/** Career rows through the given client (complete rows only). */
export type LoadCareerRows = (db: AiWriterSupabaseClient) => Promise<CareerRows>;

// ---------------- AI RPCs (app_ai_writer) ----------------

export type BegunQuestions = {
  sessionId: string;
  applicationProjectId: string;
  interviewType: string;
  questionCount: number;
  dataSufficiency: string;
  reopened: boolean;
  savedCount: number;
  remaining: number;
  existingQuestions: Array<{
    question_id: string;
    sequence: number;
    source_kind: string;
    anchor: string;
    question_text: string;
    target_requirement_ids: string[];
    target_gap_requirement_ids: string[];
  }>;
};

export type BegunEvaluation = {
  sessionId: string;
  applicationProjectId: string;
  interviewType: string;
  dataSufficiency: string;
  reopened: boolean;
  answersToEvaluate: Array<{ answer_id: string; question_id: string; sequence: number }>;
  evaluatedAnswerIds: string[];
  unansweredAnswerIds: string[];
};

export type Applied = { applied: boolean };
export type SavedQuestion = Applied & { savedCount: number; questionCount: number; sequence: number | null };
export type CompletedEvaluation = Applied & { status: "completed" | "evaluation_failed" | null; notScoredAnswerIds: string[] };

export interface InterviewStore {
  beginQuestions(sessionId: string, jobId: string): Promise<BegunQuestions>;
  saveQuestion(args: { sessionId: string; jobId: string; runGeneration: number; payload: unknown }): Promise<SavedQuestion>;
  completeQuestions(args: { sessionId: string; jobId: string; runGeneration: number; payload: unknown }): Promise<Applied>;
  failQuestions(sessionId: string, jobId: string): Promise<boolean>;
  beginEvaluation(args: { sessionId: string; jobId: string; provider: string; model: string }): Promise<BegunEvaluation>;
  saveAnswerEvaluation(args: { answerId: string; jobId: string; runGeneration: number; payload: unknown }): Promise<Applied>;
  failAnswerEvaluation(answerId: string, jobId: string): Promise<boolean>;
  saveSessionFeedback(args: { sessionId: string; jobId: string; runGeneration: number; payload: unknown }): Promise<Applied>;
  completeEvaluation(args: { sessionId: string; jobId: string; runGeneration: number }): Promise<CompletedEvaluation>;
}

const applied = (data: unknown): boolean => obj(data).applied === true;

export function createInterviewStore(writer: AiWriterSupabaseClient): InterviewStore {
  return {
    async beginQuestions(sessionId, jobId) {
      const { data, error } = await writer.rpc("begin_interview_questions", { p_session_id: sessionId, p_ai_job_id: jobId });
      if (error) throw rpcFailure(error);
      const r = obj(data);
      return {
        sessionId: str(r.session_id) ?? sessionId,
        applicationProjectId: str(r.application_project_id) ?? "",
        interviewType: str(r.interview_type) ?? "job",
        questionCount: num(r.question_count, 5),
        dataSufficiency: str(r.data_sufficiency) ?? "none",
        reopened: r.reopened === true,
        savedCount: num(r.saved_count),
        remaining: num(r.remaining),
        existingQuestions: arr(r.existing_questions).map((raw) => {
          const q = obj(raw);
          return {
            question_id: str(q.question_id) ?? "",
            sequence: num(q.sequence),
            source_kind: str(q.source_kind) ?? "",
            anchor: str(q.anchor) ?? "general",
            question_text: str(q.question_text) ?? "",
            target_requirement_ids: strs(q.target_requirement_ids),
            target_gap_requirement_ids: strs(q.target_gap_requirement_ids),
          };
        }),
      };
    },
    async saveQuestion({ sessionId, jobId, runGeneration, payload }) {
      const { data, error } = await writer.rpc("save_interview_question", {
        p_session_id: sessionId,
        p_ai_job_id: jobId,
        p_run_generation: runGeneration,
        p_payload: payload as Json,
      });
      if (error) throw rpcFailure(error);
      const r = obj(data);
      return { applied: r.applied === true, savedCount: num(r.saved_count), questionCount: num(r.question_count), sequence: typeof r.sequence === "number" ? r.sequence : null };
    },
    async completeQuestions({ sessionId, jobId, runGeneration, payload }) {
      const { data, error } = await writer.rpc("complete_interview_questions", {
        p_session_id: sessionId,
        p_ai_job_id: jobId,
        p_run_generation: runGeneration,
        p_payload: payload as Json,
      });
      if (error) throw rpcFailure(error);
      return { applied: applied(data) };
    },
    async failQuestions(sessionId, jobId) {
      const { data, error } = await writer.rpc("fail_interview_questions", { p_session_id: sessionId, p_ai_job_id: jobId });
      if (error) throw rpcFailure(error);
      return data === true;
    },
    async beginEvaluation({ sessionId, jobId, provider, model }) {
      const { data, error } = await writer.rpc("begin_interview_evaluation", { p_session_id: sessionId, p_ai_job_id: jobId, p_provider: provider, p_model: model });
      if (error) throw rpcFailure(error);
      const r = obj(data);
      return {
        sessionId: str(r.session_id) ?? sessionId,
        applicationProjectId: str(r.application_project_id) ?? "",
        interviewType: str(r.interview_type) ?? "job",
        dataSufficiency: str(r.data_sufficiency) ?? "none",
        reopened: r.reopened === true,
        answersToEvaluate: arr(r.answers_to_evaluate).flatMap((raw) => {
          const a = obj(raw);
          const answerId = str(a.answer_id);
          return answerId ? [{ answer_id: answerId, question_id: str(a.question_id) ?? "", sequence: num(a.sequence) }] : [];
        }),
        evaluatedAnswerIds: strs(r.evaluated_answer_ids),
        unansweredAnswerIds: strs(r.unanswered_answer_ids),
      };
    },
    async saveAnswerEvaluation({ answerId, jobId, runGeneration, payload }) {
      const { data, error } = await writer.rpc("save_answer_evaluation", {
        p_answer_id: answerId,
        p_ai_job_id: jobId,
        p_run_generation: runGeneration,
        p_payload: payload as Json,
      });
      if (error) throw rpcFailure(error);
      return { applied: applied(data) };
    },
    async failAnswerEvaluation(answerId, jobId) {
      const { data, error } = await writer.rpc("fail_answer_evaluation", { p_answer_id: answerId, p_ai_job_id: jobId });
      if (error) throw rpcFailure(error);
      return data === true;
    },
    async saveSessionFeedback({ sessionId, jobId, runGeneration, payload }) {
      const { data, error } = await writer.rpc("save_session_feedback", {
        p_session_id: sessionId,
        p_ai_job_id: jobId,
        p_run_generation: runGeneration,
        p_payload: payload as Json,
      });
      if (error) throw rpcFailure(error);
      return { applied: applied(data) };
    },
    async completeEvaluation({ sessionId, jobId, runGeneration }) {
      const { data, error } = await writer.rpc("complete_interview_evaluation", { p_session_id: sessionId, p_ai_job_id: jobId, p_run_generation: runGeneration });
      if (error) throw rpcFailure(error);
      const r = obj(data);
      const status = str(r.status);
      return {
        applied: r.applied === true,
        status: status === "completed" || status === "evaluation_failed" ? status : null,
        notScoredAnswerIds: strs(r.not_scored_answer_ids),
      };
    },
  };
}
