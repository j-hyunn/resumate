/**
 * 모의 면접 data layer: interview_sessions / questions / answers / answer_evaluations /
 * session_feedbacks. Server only.
 */
import type {
  AiErrorCode,
  AiJob,
  ModelTier,
  AnswerEvaluation,
  InterviewAnswer,
  InterviewQuestion,
  InterviewSession,
  InterviewSessionStatus,
  InterviewType,
  QuestionCount,
  SessionFeedback,
} from "@/types/db"
import { clone, mockRequest } from "@/lib/mock/store"
import type { MockDb } from "@/lib/mock/fixtures"
import { newId, USER_ID } from "@/lib/mock/ids"
import { assertAiRunnable, createMockJob } from "@/lib/mock/ai"
import { gradingDecisionOf, gradingFactsOf, savedQuestionCount } from "@/lib/mock/grading"
import { ensureJdRequirementsInDb } from "./applications"
import { refreshApplicationJobs, regradeFailedAnswers } from "./ai-jobs"
import { clearsNewResultOnView, hasNewResult, type GradingDecision } from "./interview-grading"
import { computeReadiness } from "./readiness"
import { applicationDisplayName } from "./labels"

export interface InterviewSessionRow extends InterviewSession {
  /** application_projects.name for S-37 rows */
  application_name: string
  /** running evaluation / generation job (C-03 축약형) */
  running_job_id: string | null
  /**
   * A4 request 2: model_tier of the latest question / session-wide evaluation job (not a table
   * column — derived from ai_jobs) → providerRunLabel / ProviderResultTag "{공급자} · {단계}".
   */
  question_model_tier: ModelTier | null
  evaluation_model_tier: ModelTier | null
  /** 04 §2.7.1 다시 채점 대상 수 ("실패한 답변 {n}개 다시 채점", `pending` 포함, 입력 원인 제외) */
  failed_answer_count: number
  /** 04 §2.7.1 판정표 — S-22 버튼, S-37 메뉴 (lib/data/interview-grading.ts) */
  grading: GradingDecision
  /** v4.2 A9: 새 결과 표식 — submitted + (completed | evaluation_failed) + result_viewed_at null */
  has_new_result: boolean
  /** questions stored so far. 0 + abandoned = "질문을 만들지 못함" (S-20 · S-37, 면접 수에서 제외) */
  saved_question_count: number
}

export { hasNewResult }

function row(db: MockDb, s: InterviewSession): InterviewSessionRow {
  const ap = db.application_projects.find((a) => a.id === s.application_project_id)
  const job = [...db.ai_jobs]
    .reverse()
    .find((j) => j.target_id === s.id && (j.status === "queued" || j.status === "running"))
  const latest = (type: "interview_questions" | "interview_evaluation") =>
    [...db.ai_jobs]
      .reverse()
      .find((j) => j.target_id === s.id && j.job_type === type && typeof j.params?.answer_id !== "string")
  return {
    ...s,
    application_name: ap ? applicationDisplayName(ap.name, ap.name_source, ap.created_at) : "",
    running_job_id: job?.id ?? null,
    question_model_tier: latest("interview_questions")?.model_tier ?? (s.question_provider ? "default" : null),
    evaluation_model_tier: latest("interview_evaluation")?.model_tier ?? (s.evaluation_provider ? "default" : null),
    failed_answer_count: s.status === "evaluation_failed" || s.status === "completed" ? gradingFactsOf(db, s).regrade_target_count : 0,
    grading: gradingDecisionOf(db, s),
    has_new_result: hasNewResult(s),
    saved_question_count: savedQuestionCount(db, s.id),
  }
}

export interface ListSessionsFilter {
  application_project_id?: string
  interview_type?: InterviewType
  status?: InterviewSessionStatus
}

/** S-37 / S-20 list, newest first */
export async function listInterviewSessions(filter: ListSessionsFilter = {}): Promise<InterviewSessionRow[]> {
  const db = await mockRequest()
  return clone(
    db.interview_sessions
      .filter(
        (s) =>
          (!filter.application_project_id || s.application_project_id === filter.application_project_id) &&
          (!filter.interview_type || s.interview_type === filter.interview_type) &&
          (!filter.status || s.status === filter.status),
      )
      .sort((a, b) => b.created_at.localeCompare(a.created_at))
      .map((s) => row(db, s)),
  )
}

export interface InterviewSessionDetail extends InterviewSessionRow {
  questions: Array<
    InterviewQuestion & {
      answer: InterviewAnswer | null
      evaluation: AnswerEvaluation | null
      /**
       * Why this submitted answer has no (succeeded) evaluation: answer_evaluations.error_code first
       * (Q53-3), else the failed evaluation job that covered it (rows from before the column).
       */
      evaluation_error: Pick<AiJob, "error_code" | "provider" | "retry_after" | "quota_resets_at"> | null
    }
  >
  feedback: SessionFeedback | null
}

export async function getInterviewSession(applicationProjectId: string, sessionId: string): Promise<InterviewSessionDetail | null> {
  const db = await mockRequest()
  const s = db.interview_sessions.find((x) => x.id === sessionId && x.application_project_id === applicationProjectId)
  if (!s) return null
  const questions = db.interview_questions
    .filter((q) => q.session_id === sessionId)
    .sort((a, b) => a.sequence - b.sequence)
    .map((q) => {
      const answer = db.interview_answers.find((a) => a.question_id === q.id) ?? null
      const evaluation = answer ? (db.answer_evaluations.find((e) => e.answer_id === answer.id) ?? null) : null
      let evaluation_error: InterviewSessionDetail["questions"][number]["evaluation_error"] = null
      if (answer?.status === "submitted" && evaluation?.status !== "succeeded") {
        const jobs = [...db.ai_jobs].reverse().filter((j) => j.target_id === sessionId && j.job_type === "interview_evaluation")
        const job = jobs.find((j) => j.params?.answer_id === answer.id) ?? jobs.find((j) => typeof j.params?.answer_id !== "string")
        const code = evaluation?.error_code ?? (job?.status === "failed" ? job.error_code : null)
        if (code) evaluation_error = { error_code: code, provider: job?.provider ?? "gemini", retry_after: job?.retry_after ?? null, quota_resets_at: job?.quota_resets_at ?? null }
      }
      return { ...q, answer, evaluation, evaluation_error }
    })
  return clone({ ...row(db, s), questions, feedback: db.session_feedbacks.find((f) => f.session_id === sessionId) ?? null })
}

/**
 * Starts a session (F-P3-01): one in_progress session per application project.
 * Creates the AI-05 async job; questions appear as the job progresses (D-UX-07: answers open
 * after all questions exist → generation_status = 'ready').
 */
export async function startInterviewSession(input: {
  application_project_id: string
  interview_type: InterviewType
  question_count: QuestionCount
  fail?: AiErrorCode | null
  rate_wait?: boolean
}): Promise<{ session_id: string; job_id: string }> {
  const db = await mockRequest()
  const existing = db.interview_sessions.find(
    (s) => s.application_project_id === input.application_project_id && s.status === "in_progress",
  )
  if (existing) throw new Error("in_progress session exists")
  // validate first (key), then D-30 extraction → question generation as one flow
  assertAiRunnable(db)
  const extraction = await ensureJdRequirementsInDb(db, input.application_project_id)
  const now = new Date().toISOString()
  const readiness = computeReadiness(db)
  const sessionId = newId()
  const job = createMockJob(db, {
    job_type: "interview_questions",
    application_project_id: input.application_project_id,
    target_type: "interview_session",
    target_id: sessionId,
    units: input.question_count,
    // a failed `prepare` extraction ends the job with the same cause, no question saved (S-20, 03 C-6, UQ-602)
    fail: extraction.failed ?? input.fail,
    fail_at_prepare: !!extraction.failed,
    rate_wait: input.rate_wait,
  })
  db.interview_sessions.push({
    id: sessionId,
    user_id: USER_ID,
    created_at: now,
    updated_at: now,
    application_project_id: input.application_project_id,
    insight_id: null,
    source_session_id: null,
    interview_type: input.interview_type,
    question_count: input.question_count,
    data_sufficiency:
      input.interview_type === "culture_fit"
        ? (readiness.features.culture_fit_interview.data_sufficiency ?? "ok")
        : "ok",
    weak_requirement_ids: [],
    status: "in_progress",
    generation_status: "generating",
    answered_count: 0,
    unanswered_count: 0,
    submitted_at: null,
    completed_at: null,
    result_viewed_at: null,
    abandoned_at: null,
    last_activity_at: now,
    career_snapshot_hash: null,
    score_status: null,
    score_value: null,
    score_max: null,
    score_method_version: null,
    score_rationale: null,
    score_counted_count: null,
    question_provider: null,
    question_model: null,
    evaluation_provider: null,
    evaluation_model: null,
    question_validation_report: null,
    question_usage: null,
  })
  // no job left running on this JD: S-15 can edit the text right away (04 §2.6.1 조건 1)
  if (extraction.failed) refreshApplicationJobs(db, input.application_project_id)
  return { session_id: sessionId, job_id: job.id }
}

/** Autosave one answer. Editable only when draft + not submitted + generation ready (S-33). */
export async function saveInterviewAnswer(answerId: string, answerText: string, opts?: { fail?: boolean }): Promise<InterviewAnswer> {
  const db = await mockRequest()
  if (opts?.fail) throw new Error("save failed (mock)")
  const answer = db.interview_answers.find((a) => a.id === answerId)
  const session = answer && db.interview_sessions.find((s) => s.id === answer.session_id)
  // v4.2 A8: an abandoned session is read-only even for unsubmitted answers
  if (
    !answer ||
    !session ||
    answer.status !== "draft" ||
    session.submitted_at ||
    session.status !== "in_progress" ||
    session.generation_status !== "ready"
  )
    throw new Error("answer not editable")
  const now = new Date().toISOString()
  Object.assign(answer, { answer_text: answerText, updated_at: now })
  session.answered_count = db.interview_answers.filter((a) => a.session_id === session.id && a.answer_text.trim() !== "").length
  session.last_activity_at = now
  return clone(answer)
}

/**
 * RPC submit_interview_session: blank answers → unanswered; starts the AI-06/07 evaluation job.
 * Validate first, then mutate (UQ-320): session state and — when there is anything to grade —
 * the AI key (assertAiRunnable → MockAiError key_missing / key_invalid) are checked before any
 * answer or session row changes, so a refusal leaves the draft exactly as it was.
 * `rate_wait` (mock) → C-03 요청 한도 대기 줄 on S-22.
 */
export async function submitInterviewSession(
  sessionId: string,
  opts?: { fail?: AiErrorCode | null; rate_wait?: boolean },
): Promise<{ job_id: string | null }> {
  const db = await mockRequest()
  const session = db.interview_sessions.find((s) => s.id === sessionId)
  if (!session) throw new Error("not found")
  if (session.status !== "in_progress" || session.submitted_at || session.generation_status !== "ready")
    throw new Error("session not submittable")
  const answers = db.interview_answers.filter((a) => a.session_id === sessionId)
  const answered = answers.filter((a) => a.answer_text.trim() !== "").length
  if (answered > 0) assertAiRunnable(db)

  // --- mutations (nothing below may throw a user-facing refusal) ---
  const now = new Date().toISOString()
  for (const a of answers) a.status = a.answer_text.trim() ? "submitted" : "unanswered"
  Object.assign(session, {
    submitted_at: now,
    answered_count: answered,
    unanswered_count: answers.length - answered,
    last_activity_at: now,
  })
  if (answered === 0) {
    // AI-07 not called: score_status = 'not_scored' ("답변이 없어 평가할 내용이 없어요")
    Object.assign(session, { status: "completed", completed_at: now, score_status: "not_scored" })
    for (const a of answers) a.score_status = "unanswered"
    return { job_id: null }
  }
  session.status = "evaluating"
  const job = createMockJob(db, {
    job_type: "interview_evaluation",
    application_project_id: session.application_project_id,
    target_type: "interview_session",
    target_id: sessionId,
    units: answered,
    fail: opts?.fail ?? null,
    rate_wait: opts?.rate_wait,
  })
  return { job_id: job.id }
}

export async function abandonInterviewSession(sessionId: string): Promise<void> {
  const db = await mockRequest()
  const session = db.interview_sessions.find((s) => s.id === sessionId)
  if (!session || session.status !== "in_progress") return
  const now = new Date().toISOString()
  Object.assign(session, { status: "abandoned", abandoned_at: now, last_activity_at: now })
}

/**
 * mark_interview_result_viewed (S-22 첫 열람): completed, or evaluation_failed with nothing left to do
 * (Q53-10). Any other screen keeps the 새 결과 표식 without an error (`changed: false`).
 */
export async function markResultViewed(sessionId: string): Promise<{ changed: boolean }> {
  const db = await mockRequest()
  const session = db.interview_sessions.find((s) => s.id === sessionId)
  if (!session || session.result_viewed_at || !clearsNewResultOnView(session.status, gradingDecisionOf(db, session))) return { changed: false }
  session.result_viewed_at = new Date().toISOString()
  return { changed: true }
}

/**
 * S-20 "그만두고 새로 시작" (04 §2.7.1: abandon_interview_session → create_interview_session). Goes
 * through the same checks as 시작하기 **before** abandoning, so a refusal leaves the session as it is.
 */
export async function restartInterviewSession(
  sessionId: string,
  input: { application_project_id: string; interview_type: InterviewType; question_count: QuestionCount },
): Promise<{ session_id: string; job_id: string } | { insufficient: true }> {
  const db = await mockRequest()
  assertAiRunnable(db)
  if (input.interview_type === "job" && !computeReadiness(db).features.job_interview.ready) return { insufficient: true }
  await abandonInterviewSession(sessionId)
  return startInterviewSession(input)
}

/** S-22 / S-37 다시 채점 · 종합 평가 다시 정리 — see ai-jobs regradeFailedAnswers */
export { regradeFailedAnswers }
