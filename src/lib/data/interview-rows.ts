import "server-only"
/**
 * W4: real rows → the screens' snake_case session view models (S-20, S-33, S-22, S-37). The screens
 * read raw row fields the camelCase contract views don't carry, so this reads the tables directly,
 * with the same shared rules as services/interview/read: `resolveSessionRun` for the effective status
 * (leftover rule) and `get_interview_grading_decisions` for the DM 2.7.1 판정표.
 *
 * Only columns the user session may read. `intent` comes from `get_interview_question_reveals` after
 * submission; `good_answer_signals` never leaves the server. Takes the client so Vitest can run it.
 */
import type { UserSupabaseClient } from "@/server/db/types"
import { mapDbError } from "@/server/db/errors"
import { loadGradingDecisions, NO_GRADING_DECISION, type GradingDecisionRow } from "@/server/services/interview/grading"
import {
  EVALUATION_JOB_TYPE,
  INTERVIEW_TARGET_TYPE,
  jobsOfSession,
  QUESTIONS_JOB_TYPE,
  resolveSessionRun,
  type InterviewJobRow,
} from "@/server/services/interview/view"
import type {
  AiErrorCode,
  AiProviderName,
  AnswerEvaluation,
  AnswerEvaluationResult,
  InterviewAnswer,
  InterviewQuestion,
  InterviewSession,
  ModelTier,
  SessionFeedback,
} from "@/types/db"
import { applicationDisplayName } from "./labels"
import { hasNewResult } from "./interview-grading"
import { deletedApplicationName, isDeletedApplicationSegment } from "./interview-session-view"
import type { InterviewSessionDetail, InterviewSessionRow, ListSessionsFilter } from "./interviews"

/** Everything the UI type has except the two jsonb reports, which no screen reads (they stay null). */
const SESSION_SELECT =
  "id, user_id, created_at, updated_at, application_project_id, insight_id, source_session_id, interview_type, question_count, data_sufficiency, weak_requirement_ids, status, generation_status, answered_count, unanswered_count, submitted_at, completed_at, result_viewed_at, abandoned_at, last_activity_at, career_snapshot_hash, score_status, score_value, score_max, score_method_version, score_rationale, score_counted_count, question_provider, question_model, evaluation_provider, evaluation_model"

/** The user-session column grant of interview_questions (S8 tables migration). */
const QUESTION_SELECT =
  "id, user_id, session_id, sequence, source_kind, anchor, question_text, focus_criteria, target_requirement_ids, target_gap_requirement_ids, copied_from_question_id, ai_job_id, schema_version, prompt_version, provider, model, model_tier, connection_tier, created_at, updated_at"

const EVALUATION_SELECT =
  "id, user_id, session_id, answer_id, status, result, error_code, schema_version, prompt_version, provider, model, model_tier, connection_tier, input_hash, career_snapshot_hash, ai_job_id, created_at, updated_at"

const FEEDBACK_SELECT =
  "id, user_id, session_id, status, result, schema_version, prompt_version, provider, model, model_tier, connection_tier, input_hash, career_snapshot_hash, ai_job_id, created_at, updated_at"

const JOB_SELECT = "id, job_type, target_id, status, progress, provider, connection_tier, model_tier, error_code, retry_after, quota_resets_at, finished_at, created_at"

type JobRow = InterviewJobRow & { model_tier: string | null }

type SessionRowData = Omit<InterviewSession, "question_validation_report" | "question_usage">

type ProjectNameRow = { id: string; name: string | null; name_source: string | null; created_at: string }

async function loadNames(db: UserSupabaseClient, rawIds: readonly (string | null)[]): Promise<Map<string, string>> {
  const ids = rawIds.filter((id): id is string => typeof id === "string")
  if (ids.length === 0) return new Map()
  const { data, error } = await db.from("application_projects").select("id, name, name_source, created_at").in("id", [...new Set(ids)])
  if (error) throw mapDbError(error)
  return new Map(((data ?? []) as ProjectNameRow[]).map((p) => [p.id, applicationDisplayName(p.name, p.name_source, p.created_at)]))
}

async function loadJobs(db: UserSupabaseClient, sessionIds: readonly string[]): Promise<JobRow[]> {
  if (sessionIds.length === 0) return []
  const { data, error } = await db
    .from("ai_jobs")
    .select(JOB_SELECT)
    .eq("target_type", INTERVIEW_TARGET_TYPE)
    .in("target_id", [...new Set(sessionIds)])
    .in("job_type", [QUESTIONS_JOB_TYPE, EVALUATION_JOB_TYPE])
    .order("created_at", { ascending: false })
  if (error) throw mapDbError(error)
  return (data ?? []) as JobRow[]
}

async function loadQuestionCounts(db: UserSupabaseClient, sessionIds: readonly string[]): Promise<Map<string, number>> {
  const out = new Map<string, number>()
  if (sessionIds.length === 0) return out
  const { data, error } = await db.from("interview_questions").select("session_id").in("session_id", [...new Set(sessionIds)])
  if (error) throw mapDbError(error)
  for (const q of data ?? []) out.set(q.session_id, (out.get(q.session_id) ?? 0) + 1)
  return out
}

function toRow(
  s: SessionRowData,
  names: ReadonlyMap<string, string>,
  jobs: readonly JobRow[],
  decisions: ReadonlyMap<string, GradingDecisionRow>,
  counts: ReadonlyMap<string, number>,
): InterviewSessionRow {
  const sessionJobs = jobsOfSession(jobs, s.id) as JobRow[]
  const run = resolveSessionRun(s, sessionJobs)
  const decision = decisions.get(s.id)
  const finished = run.status === "evaluation_failed" || run.status === "completed"
  const tierOf = (type: string) => (sessionJobs.find((j) => j.job_type === type)?.model_tier ?? null) as ModelTier | null
  // OD-I6 (DM v4.11 11.6 #1): application_project_id becomes nullable once the backend migration lands — the
  // generated type still says string, so read it as nullable here.
  // 연결 대기 (DM v4.11 11.6 #1~#6): company_name_snapshot / position_title_snapshot are not in SESSION_SELECT
  // yet (the columns don't exist); add them to SESSION_SELECT when the migration and generated types land.
  const apId = s.application_project_id as string | null
  const snapshot = s as SessionRowData & { company_name_snapshot?: string | null; position_title_snapshot?: string | null }
  const deleted = apId === null
  return {
    ...s,
    application_project_id: apId ?? "",
    application_deleted: deleted,
    company_name_snapshot: snapshot.company_name_snapshot ?? null,
    position_title_snapshot: snapshot.position_title_snapshot ?? null,
    question_validation_report: null,
    question_usage: null,
    career_snapshot_hash: null, // QA-W5-10: server bookkeeping, no screen reads it
    // Effective values: a `generating` / `evaluating` row whose job ended reads as failed (view.ts).
    status: run.status,
    generation_status: run.generationStatus,
    application_name: deleted ? deletedApplicationName(snapshot.company_name_snapshot, snapshot.position_title_snapshot) : (names.get(apId) ?? ""),
    running_job_id: run.activeJob?.jobId ?? null,
    question_model_tier: tierOf(QUESTIONS_JOB_TYPE) ?? (s.question_provider ? "default" : null),
    evaluation_model_tier: tierOf(EVALUATION_JOB_TYPE) ?? (s.evaluation_provider ? "default" : null),
    failed_answer_count: finished ? (decision?.regradeTargetCount ?? 0) : 0,
    grading: decision?.decision ?? NO_GRADING_DECISION,
    has_new_result: hasNewResult({ status: run.status, submitted_at: s.submitted_at, result_viewed_at: s.result_viewed_at }),
    saved_question_count: counts.get(s.id) ?? 0,
  }
}

async function toRows(db: UserSupabaseClient, sessions: readonly SessionRowData[]): Promise<InterviewSessionRow[]> {
  const ids = sessions.map((s) => s.id)
  const [names, jobs, decisions, counts] = await Promise.all([
    loadNames(db, sessions.map((s) => s.application_project_id)),
    loadJobs(db, ids),
    // Only a submitted session can have a decision other than `none`.
    loadGradingDecisions(db, sessions.filter((s) => s.submitted_at !== null).map((s) => s.id)),
    loadQuestionCounts(db, ids),
  ])
  return sessions.map((s) => toRow(s, names, jobs, decisions, counts))
}

/** S-37 / S-20 list, newest first. `status` filters on the effective status. */
export async function loadInterviewSessionRows(db: UserSupabaseClient, filter: ListSessionsFilter = {}): Promise<InterviewSessionRow[]> {
  let q = db.from("interview_sessions").select(SESSION_SELECT)
  if (filter.application_project_id)
    q = isDeletedApplicationSegment(filter.application_project_id)
      ? q.filter("application_project_id", "is", null) // OD-I6 "삭제된 자기소개서"
      : q.eq("application_project_id", filter.application_project_id)
  if (filter.interview_type) q = q.eq("interview_type", filter.interview_type)
  const { data, error } = await q.order("created_at", { ascending: false }).limit(500)
  if (error) throw mapDbError(error)
  const rows = await toRows(db, (data ?? []) as unknown as SessionRowData[])
  return filter.status ? rows.filter((r) => r.status === filter.status) : rows
}

/**
 * The stored AI-06 form has `consistency_notes: [{ text, answer_quotes }]`. S-22 reads that form; anything else in the
 * list (a plain string from an older row, an empty note) is normalized here. The rest of `result` already matches the UI type.
 */
export function toUiEvaluationResult(result: unknown): AnswerEvaluationResult | null {
  if (!result || typeof result !== "object" || Array.isArray(result)) return null
  const r = result as AnswerEvaluationResult & { consistency_notes?: unknown }
  const notes = Array.isArray(r.consistency_notes) ? (r.consistency_notes as unknown[]) : []
  return {
    ...r,
    consistency_notes: notes.flatMap((n) => {
      if (typeof n === "string") return n ? [{ text: n, answer_quotes: [] }] : []
      const note = n as { text?: unknown; answer_quotes?: unknown } | null
      if (typeof note?.text !== "string" || !note.text) return []
      return [{ text: note.text, answer_quotes: Array.isArray(note.answer_quotes) ? note.answer_quotes.filter((q): q is string => typeof q === "string") : [] }]
    }),
  }
}

function evaluationErrorOf(
  evaluation: AnswerEvaluation | null,
  evaluationJobs: readonly JobRow[],
  session: SessionRowData,
): InterviewSessionDetail["questions"][number]["evaluation_error"] {
  const job = evaluationJobs[0] ?? null
  const code = evaluation?.error_code ?? (job?.status === "failed" ? (job.error_code as AiErrorCode | null) : null)
  if (!code) return null
  const provider = (job?.provider ?? evaluation?.provider ?? session.evaluation_provider ?? session.question_provider ?? "anthropic") as AiProviderName
  return { error_code: code, provider, retry_after: job?.retry_after ?? null, quota_resets_at: job?.quota_resets_at ?? null }
}

/**
 * S-33 / S-22. Null when the session isn't this user's or isn't under this application project.
 * `applicationProjectId` null = a session whose application project was deleted (OD-I6, application_project_id is null).
 */
export async function loadInterviewSessionDetail(db: UserSupabaseClient, applicationProjectId: string | null, sessionId: string): Promise<InterviewSessionDetail | null> {
  const base = db.from("interview_sessions").select(SESSION_SELECT).eq("id", sessionId)
  const { data, error } = await (applicationProjectId === null ? base.filter("application_project_id", "is", null) : base.eq("application_project_id", applicationProjectId)).maybeSingle()
  if (error) throw mapDbError(error)
  if (!data) return null
  const session = data as unknown as SessionRowData
  const [[row], questions, answers, evaluations, feedbacks, jobs, reveals] = await Promise.all([
    toRows(db, [session]),
    db.from("interview_questions").select(QUESTION_SELECT).eq("session_id", sessionId).order("sequence", { ascending: true }),
    db.from("interview_answers").select("*").eq("session_id", sessionId),
    db.from("answer_evaluations").select(EVALUATION_SELECT).eq("session_id", sessionId),
    db.from("session_feedbacks").select(FEEDBACK_SELECT).eq("session_id", sessionId).limit(1),
    loadJobs(db, [sessionId]),
    // AI-05: the intent is revealed only after submission (the RPC refuses before).
    session.submitted_at ? db.rpc("get_interview_question_reveals", { p_session_id: sessionId }) : Promise.resolve({ data: [], error: null }),
  ])
  for (const r of [questions, answers, evaluations, feedbacks, reveals]) if (r.error) throw mapDbError(r.error)

  const answerByQuestion = new Map(((answers.data ?? []) as unknown as InterviewAnswer[]).map((a) => [a.question_id, a]))
  const evaluationByAnswer = new Map(
    (evaluations.data ?? []).map((e) => {
      const evaluation = { ...e, result: toUiEvaluationResult(e.result), validation_report: null, usage: null } as unknown as AnswerEvaluation
      return [evaluation.answer_id, evaluation] as const
    }),
  )
  const intents = new Map(((reveals.data ?? []) as Array<{ question_id: string; intent: string | null }>).map((r) => [r.question_id, r.intent]))
  const evaluationJobs = jobsOfSession(jobs, sessionId, EVALUATION_JOB_TYPE) as JobRow[]

  const feedback = feedbacks.data?.[0] ?? null
  return {
    ...row!,
    questions: (questions.data ?? []).map((raw) => {
      const q = { ...raw, intent: intents.get(raw.id) ?? null, good_answer_signals: null, input_hash: null, career_snapshot_hash: null, validation_report: null, usage: null } as unknown as InterviewQuestion
      const answer = answerByQuestion.get(q.id) ?? null
      const evaluation = answer ? (evaluationByAnswer.get(answer.id) ?? null) : null
      const failedAnswer = answer?.status === "submitted" && evaluation?.status !== "succeeded"
      return { ...q, answer, evaluation, evaluation_error: failedAnswer ? evaluationErrorOf(evaluation, evaluationJobs, session) : null }
    }),
    feedback: feedback ? ({ ...feedback, validation_report: null, usage: null } as unknown as SessionFeedback) : null,
  }
}
