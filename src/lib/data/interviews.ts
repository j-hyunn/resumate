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
import { z } from "zod"
import { AppError, isAppError } from "@/lib/contracts/errors"
import { StartInterviewSessionInput } from "@/lib/contracts/interview"
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
import { deletedApplicationName, isDeletedApplicationSegment, SCORE_MAX_DEFAULT, type DeletedApplicationFields } from "./interview-session-view"
import { loadInterviewSessionDetail, loadInterviewSessionRows } from "./interview-rows"
import { previewOr, unwrap } from "./source"
import { requireConsentedUser } from "@/server/auth/session"
import { mapDbError } from "@/server/db/errors"
import * as interviewActions from "@/server/actions/interview"
import { interviewStartDeps } from "@/server/interview-routes"
import { INTERVIEW_INSUFFICIENT_DATA_MESSAGE, restartInterviewSession as restartInterviewSessionService, startInterviewSession as startInterviewSessionService, submitInterviewSession as submitInterviewSessionService } from "@/server/services/interview/start"

export interface InterviewSessionRow
  extends Omit<InterviewSession, "application_project_id" | "company_name_snapshot" | "position_title_snapshot">,
    DeletedApplicationFields {
  /** "" for a detached (자기소개서 삭제됨) session — read `application_deleted` instead (OD-I6) */
  application_project_id: string
  /**
   * application_projects.name for S-37 rows. OD-I6 자기소개서 삭제됨 → the snapshot name (R-OD-12,
   * deletedApplicationName). `application_deleted` / `*_snapshot` come from DeletedApplicationFields.
   */
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

const isUuid = (v: string) => z.guid().safeParse(v).success

const insufficientData = () => new AppError("insufficient_data", INTERVIEW_INSUFFICIENT_DATA_MESSAGE, { status: 422 })

async function realStartDeps() {
  const { supabase, user } = await requireConsentedUser()
  return interviewStartDeps(supabase, user.id)
}

function row(db: MockDb, s: MockDb["interview_sessions"][number]): InterviewSessionRow {
  const ap = db.application_projects.find((a) => a.id === s.application_project_id)
  // OD-I6: a kept session of a deleted 자기소개서 has application_project_id null (FK set null, mock delete too)
  const deleted = !ap
  const job = [...db.ai_jobs]
    .reverse()
    .find((j) => j.target_id === s.id && (j.status === "queued" || j.status === "running"))
  const latest = (type: "interview_questions" | "interview_evaluation") =>
    [...db.ai_jobs]
      .reverse()
      .find((j) => j.target_id === s.id && j.job_type === type && typeof j.params?.answer_id !== "string")
  return {
    ...s,
    application_project_id: s.application_project_id ?? "",
    application_name: ap ? applicationDisplayName(ap.name, ap.name_source, ap.created_at) : deletedApplicationName(s.company_name_snapshot, s.position_title_snapshot),
    application_deleted: deleted,
    company_name_snapshot: s.company_name_snapshot ?? null,
    position_title_snapshot: s.position_title_snapshot ?? null,
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
  return previewOr(
    async () => {
      const db = await mockRequest()
      return clone(
        db.interview_sessions
          .filter(
            (s) =>
              (!filter.application_project_id ||
                (isDeletedApplicationSegment(filter.application_project_id)
                  ? !db.application_projects.some((a) => a.id === s.application_project_id)
                  : s.application_project_id === filter.application_project_id)) &&
              (!filter.interview_type || s.interview_type === filter.interview_type) &&
              (!filter.status || s.status === filter.status),
          )
          .sort((a, b) => b.created_at.localeCompare(a.created_at))
          .map((s) => row(db, s)),
      )
    },
    async () => {
      if (filter.application_project_id && !isUuid(filter.application_project_id) && !isDeletedApplicationSegment(filter.application_project_id)) return []
      const { supabase } = await requireConsentedUser()
      return loadInterviewSessionRows(supabase, filter)
    },
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

/**
 * S-33 / S-22. `applicationProjectId` = DELETED_APPLICATION_SEGMENT ("deleted", a data-layer key, not a URL) reads a
 * session whose application project was deleted (OD-I6, S-22 at `/interviews/{sessionId}/result`); a live project id
 * never finds such a session.
 */
export async function getInterviewSession(applicationProjectId: string, sessionId: string): Promise<InterviewSessionDetail | null> {
  return previewOr(
    async () => {
      const db = await mockRequest()
      const apExists = (id: string) => db.application_projects.some((a) => a.id === id)
      const s = db.interview_sessions.find(
        (x) =>
          x.id === sessionId &&
          (isDeletedApplicationSegment(applicationProjectId) ? !x.application_project_id || !apExists(x.application_project_id) : x.application_project_id === applicationProjectId),
      )
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
    },
    async () => {
      if ((!isUuid(applicationProjectId) && !isDeletedApplicationSegment(applicationProjectId)) || !isUuid(sessionId)) return null
      const { supabase } = await requireConsentedUser()
      return loadInterviewSessionDetail(supabase, isDeletedApplicationSegment(applicationProjectId) ? null : applicationProjectId, sessionId)
    },
  )
}

/**
 * U36-1: where a session's S-22 lives, from the session id alone — `application_project_id` null = 자기소개서
 * 삭제됨 (→ `/interviews/{sessionId}/result`), else its 자기소개서 (→ `/applications/{id}/interview/…`). Null when the
 * session isn't this user's.
 */
export async function getInterviewSessionLocation(sessionId: string): Promise<{ application_project_id: string | null } | null> {
  return previewOr(
    async () => {
      const db = await mockRequest()
      const s = db.interview_sessions.find((x) => x.id === sessionId)
      if (!s) return null
      // mock delete sets a kept session's application_project_id to null like the FK (deletion.ts)
      return { application_project_id: s.application_project_id }
    },
    async () => {
      if (!isUuid(sessionId)) return null
      const { supabase } = await requireConsentedUser()
      const { data, error } = await supabase.from("interview_sessions").select("application_project_id").eq("id", sessionId).maybeSingle()
      if (error) throw mapDbError(error)
      if (!data) return null
      // OD-I6 (DM v4.11 11.6 #1): null = the session's 자기소개서 was deleted
      return { application_project_id: data.application_project_id }
    },
  )
}

/**
 * QA-W5-07: the start / restart input arrives from a Server Action (any JSON). Bad shapes answer
 * `invalid_input` (AppError) instead of a TypeError or a ZodError.
 */
const StartArgs = z.object({ application_project_id: z.guid(), interview_type: z.string(), question_count: z.unknown() })
function realStartInput(input: unknown): { applicationProjectId: string; body: z.output<typeof StartInterviewSessionInput> } {
  const args = StartArgs.safeParse(input)
  if (!args.success) throw new AppError("invalid_input")
  const body = StartInterviewSessionInput.safeParse({ interviewType: args.data.interview_type, questionCount: args.data.question_count })
  if (!body.success) throw new AppError("invalid_input")
  return { applicationProjectId: args.data.application_project_id, body: body.data }
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
  return previewOr(
    async () => {
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
        company_name_snapshot: null, // R11 최소 수정 (OD-I6 columns)
        position_title_snapshot: null,
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
    },
    async () => {
      // AI-05 job: `prepare` does the D-30 extraction; a failed one fails this job with the same cause.
      const { applicationProjectId, body } = realStartInput(input)
      const outcome = await startInterviewSessionService(await realStartDeps(), applicationProjectId, body)
      if (outcome.kind === "insufficient_data") throw insufficientData() // the screen's C-09 stops this first
      return { session_id: outcome.data.sessionId, job_id: outcome.data.jobId }
    },
  )
}

/** Autosave one answer. Editable only when draft + not submitted + generation ready (S-33). */
export async function saveInterviewAnswer(answerId: string, answerText: string, opts?: { fail?: boolean }): Promise<InterviewAnswer> {
  return previewOr(
    async () => {
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
    },
    async () => {
      unwrap(await interviewActions.saveInterviewAnswer({ answerId, answerText }))
      const { supabase } = await requireConsentedUser()
      const { data, error } = await supabase.from("interview_answers").select("*").eq("id", answerId).single()
      if (error) throw mapDbError(error)
      return data as unknown as InterviewAnswer
    },
  )
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
  return previewOr(
    async () => {
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
        // AI-07 not called. OD-I1 / R-OD-3 (d14.v1): every question unanswered → session scored 0 / 100
        // ("답변이 없어 0점이에요"), each answer "미응답 · 0점".
        Object.assign(session, {
          status: "completed",
          completed_at: now,
          score_status: "scored",
          score_value: 0,
          score_max: SCORE_MAX_DEFAULT,
          score_method_version: "d14.v1",
          score_counted_count: answers.length,
        })
        for (const a of answers) Object.assign(a, { score_status: "unanswered", score_value: 0, score_max: SCORE_MAX_DEFAULT, score_method_version: "d14.v1" })
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
    },
    async () => {
      const { jobId } = await submitInterviewSessionService(await realStartDeps(), sessionId)
      return { job_id: jobId }
    },
  )
}

export async function abandonInterviewSession(sessionId: string): Promise<void> {
  return previewOr(
    async () => {
      const db = await mockRequest()
      const session = db.interview_sessions.find((s) => s.id === sessionId)
      if (!session || session.status !== "in_progress") return
      const now = new Date().toISOString()
      Object.assign(session, { status: "abandoned", abandoned_at: now, last_activity_at: now })
    },
    async () => {
      // Same as the mock: already finished or gone is not an error for this button.
      try {
        unwrap(await interviewActions.abandonInterviewSession({ sessionId }))
      } catch (err) {
        if (!isAppError(err) || (err.code !== "interview_not_in_progress" && err.code !== "not_found")) throw err
      }
    },
  )
}

/**
 * mark_interview_result_viewed (S-22 첫 열람): completed, or evaluation_failed with nothing left to do
 * (Q53-10). Any other screen keeps the 새 결과 표식 without an error (`changed: false`).
 */
export async function markResultViewed(sessionId: string): Promise<{ changed: boolean }> {
  return previewOr(
    async () => {
      const db = await mockRequest()
      const session = db.interview_sessions.find((s) => s.id === sessionId)
      if (!session || session.result_viewed_at || !clearsNewResultOnView(session.status, gradingDecisionOf(db, session))) return { changed: false }
      session.result_viewed_at = new Date().toISOString()
      return { changed: true }
    },
    async () => {
      // The RPC decides (Q53-10): anything but the two rows of clearsNewResultOnView stays `changed: false`.
      try {
        const { changed } = unwrap(await interviewActions.markInterviewResultViewed({ sessionId }))
        return { changed }
      } catch (err) {
        if (isAppError(err) && err.code === "not_found") return { changed: false }
        throw err
      }
    },
  )
}

/**
 * S-20 "그만두고 새로 시작" (04 §2.7.1: abandon_interview_session → create_interview_session). Goes
 * through the same checks as 시작하기 **before** abandoning, so a refusal leaves the session as it is.
 */
export async function restartInterviewSession(
  sessionId: string,
  input: { application_project_id: string; interview_type: InterviewType; question_count: QuestionCount },
): Promise<{ session_id: string; job_id: string } | { insufficient: true }> {
  return previewOr(
    async () => {
      const db = await mockRequest()
      assertAiRunnable(db)
      if (input.interview_type === "job" && !computeReadiness(db).features.job_interview.ready) return { insufficient: true }
      await abandonInterviewSession(sessionId)
      return startInterviewSession(input)
    },
    async () => {
      const { applicationProjectId, body } = realStartInput(input)
      if (!z.guid().safeParse(sessionId).success) throw new AppError("invalid_input")
      const outcome = await restartInterviewSessionService(await realStartDeps(), sessionId, applicationProjectId, body)
      if (outcome.kind === "insufficient_data") return { insufficient: true as const }
      return { session_id: outcome.data.sessionId, job_id: outcome.data.jobId }
    },
  )
}

/** S-22 / S-37 다시 채점 · 종합 평가 다시 정리 — see ai-jobs regradeFailedAnswers */
export { regradeFailedAnswers }
