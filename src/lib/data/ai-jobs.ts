/**
 * ai_jobs (async job mode) read/write + mock side effects. Server only.
 * Client polling goes through server actions in ./actions.ts → useAiJob().
 */
import type { AiErrorCode, AiJob, AiJobType, AnswerEvaluation, InterviewEvaluationRefusalCode, InterviewQuestion, QuestionSourceKind } from "@/types/db"
import { clone, mockRequest } from "@/lib/mock/store"
import type { MockDb } from "@/lib/mock/fixtures"
import { advanceMockJob, createMockJob, recordMockUsage, retryMockJob, type MockJobOptions } from "@/lib/mock/ai"
import { mockAiMeta } from "@/lib/mock/ai-meta"
import { gradingDecisionOf, regradeTargetIds } from "@/lib/mock/grading"
import { newId, USER_ID } from "@/lib/mock/ids"
import { routes } from "@/lib/routes"
import { gradingRefusal, isInputCausedAnswer, isInputCausedGrading } from "./interview-grading"
import { ensureJdRequirementsInDb } from "./applications"
import { applicationDisplayName } from "./labels"

/** Async-job view model for C-03 / completion toast */
export interface AiJobView extends AiJob {
  application_name: string | null
  /** completion toast copy (C-03) */
  done_message: string
  /** "보기" target */
  result_href: string | null
}

function jobView(db: MockDb, job: AiJob): AiJobView {
  const ap = db.application_projects.find((a) => a.id === job.application_project_id)
  const name = ap ? applicationDisplayName(ap.name, ap.name_source, ap.created_at) : null
  let result_href: string | null = null
  // [UI-가정] only the interview copy is in the spec (C-03); others follow the same pattern
  let done_message = "AI 작업이 끝났어요"
  if (ap) {
    switch (job.job_type) {
      case "insight":
        result_href = routes.applicationInsight(ap.id)
        done_message = `${name} 인사이트가 준비됐어요`
        break
      case "interview_questions":
        result_href = job.target_id ? routes.interviewSession(ap.id, job.target_id) : null
        done_message = `${name} 면접 질문이 준비됐어요`
        break
      case "interview_evaluation":
        result_href = job.target_id ? routes.interviewResult(ap.id, job.target_id) : null
        done_message = `${name} 면접 채점이 끝났어요`
        break
    }
  }
  return { ...job, application_name: name, done_message, result_href }
}

const QUESTION_TEMPLATES: Array<{ text: string; kind: QuestionSourceKind }> = [
  { text: "가장 자신 있는 프로젝트에서 본인이 직접 한 일을 설명해 주세요.", kind: "project_deep_dive" },
  { text: "공고의 핵심 요건과 맞닿는 경험을 하나 들려주세요.", kind: "requirement_fit" },
  { text: "경험이 부족한 영역을 어떻게 보완하겠어요?", kind: "gap_probe" },
  { text: "팀원과 의견이 갈렸을 때 어떻게 풀었나요?", kind: "conflict" },
  { text: "실패에서 배운 점을 말해 주세요.", kind: "failure_growth" },
  { text: "일할 때 가장 중요하게 여기는 가치는 무엇인가요?", kind: "values" },
  { text: "새 조직에 적응할 때 무엇부터 하나요?", kind: "org_adaptation" },
]

/** Mock AI-02 stage-1 matches for an application's requirements (deterministic by order). */
function mockMatches(db: MockDb, applicationProjectId: string) {
  const jd = db.job_descriptions.find((j) => j.application_project_id === applicationProjectId)
  const reqs = db.jd_requirements.filter((r) => r.job_description_id === jd?.id).sort((a, b) => a.sort_order - b.sort_order)
  const statuses = ["met", "partial", "no_evidence"] as const
  return reqs.map((r, i) => ({
    item_key: `requirement_matches.${r.id}`,
    requirement_id: r.id,
    status: statuses[i % 3],
    rationale: "입력된 경력 데이터 기준 판단입니다.",
    missing_aspect: i % 3 === 0 ? null : "구체적인 본인 기여",
  }))
}

/** Mock AI-06 result for one answer (stored form, evidence removed). */
function mockEvaluation(db: MockDb, sessionId: string, answerId: string): AnswerEvaluation {
  const now = new Date().toISOString()
  const session = db.interview_sessions.find((s) => s.id === sessionId)
  const culture = session?.interview_type === "culture_fit"
  return {
    id: newId(),
    user_id: USER_ID,
    created_at: now,
    updated_at: now,
    ...mockAiMeta(null),
    schema_version: 2,
    session_id: sessionId,
    answer_id: answerId,
    status: "succeeded",
    error_code: null,
    result: {
      schema_version: 2,
      criteria: [
        { key: "specificity", grade: "fair", reason: "상황은 구체적이지만 본인 행동이 팀 성과와 섞여 있어요.", answer_quotes: [], missing: "본인이 직접 한 일" },
        { key: "intent_fit", grade: "good", reason: "질문 의도에 맞게 답했어요.", answer_quotes: [], missing: null },
        { key: "structure", grade: "good", reason: "상황 → 행동 → 결과 순서가 보여요.", answer_quotes: [], missing: null },
        culture
          ? { key: "job_relevance", grade: "not_applicable", reason: "컬처핏 질문이라 해당하지 않아요.", answer_quotes: [], missing: null }
          : { key: "job_relevance", grade: "fair", reason: "공고 요건과의 연결을 한 문장 더하면 좋아요.", answer_quotes: [], missing: "요건 연결" },
      ],
      strengths: [{ text: "결과를 구체적으로 말했어요.", answer_quotes: [] }],
      improvements: [{ item_key: "improvements.0", text: "본인이 직접 한 일을 주어로 말해 보세요.", how: "'제가 …했습니다'로 행동 → 결과 순서로 말해 보세요.", related_criteria: ["specificity"] }],
      intent_reveal: "문제를 진단하는 방법과 본인 기여 범위를 확인하려는 질문이었어요.",
      model_answer: { text: "제가 먼저 지표로 병목을 찾고 구조를 바꿔 [사례 입력 필요] 결과를 만들었습니다.", placeholders: [{ token: "[사례 입력 필요]", hint: "실제로 바뀐 결과" }], suggestions_if_true: [] },
      consistency_notes: [],
      score: { status: "pending_method", value: null, max: null, method_version: null, rationale: null },
    },
  }
}

/** Apply the mock job's progress to the rows it produces (partial results, completion). */
function syncEffects(db: MockDb, job: AiJob, terminalNow: boolean) {
  const now = new Date().toISOString()

  if (job.job_type === "interview_questions" && job.target_id) {
    const session = db.interview_sessions.find((s) => s.id === job.target_id)
    if (session) {
      // "남은 질문 다시 만들기" jobs start after the questions already saved (params.mock_base)
      const base = typeof job.params?.mock_base === "number" ? job.params.mock_base : 0
      const target =
        job.status === "succeeded" || job.progress?.stage === "complete"
          ? session.question_count
          : job.progress?.stage === "generate"
            ? base + (job.progress.done ?? 0)
            : 0
      const existing = db.interview_questions.filter((q) => q.session_id === session.id)
      for (let i = existing.length; i < target; i += 1) {
        const template = QUESTION_TEMPLATES[i % QUESTION_TEMPLATES.length]
        const question: InterviewQuestion = {
          id: newId(),
          user_id: USER_ID,
          created_at: now,
          updated_at: now,
          ...mockAiMeta(job.id, { provider: job.provider, connection_tier: job.connection_tier ?? "free" }),
          session_id: session.id,
          sequence: i + 1,
          source_kind: template.kind,
          anchor: "experience",
          question_text: template.text,
          intent: null,
          focus_criteria: [],
          target_requirement_ids: [],
          target_gap_requirement_ids: [],
          good_answer_signals: null,
          copied_from_question_id: null,
        }
        db.interview_questions.push(question)
        // 질문 저장 시 빈 답변 행이 함께 생긴다 (S-33)
        db.interview_answers.push({
          id: newId(),
          user_id: USER_ID,
          created_at: now,
          updated_at: now,
          session_id: session.id,
          question_id: question.id,
          answer_text: "",
          status: "draft",
          score_status: null,
          score_value: null,
          score_max: null,
          score_method_version: null,
          score_rationale: null,
        })
      }
      if (terminalNow && job.status === "succeeded")
        Object.assign(session, { generation_status: "ready", question_provider: job.provider, question_model: job.model })
      if (terminalNow && job.status === "failed") session.generation_status = "failed"
    }
  }

  // AI-02 stage 1 partial result: fill match_stage_result per finished batch (A3 UQ-65)
  if (job.job_type === "insight") {
    const insight = db.insights.find((i) => i.ai_job_id === job.id)
    const p = job.progress
    if (insight && p && p.stage !== "prepare") {
      const total = p.stage === "match" ? (p.total ?? 1) : (job.params?.mock_units as number | undefined) ?? p.total ?? 1
      const done = p.stage === "match" ? (p.done ?? 0) : total
      if (done > 0 && (insight.match_stage_result?.batches_done ?? 0) < done) {
        const all = mockMatches(db, insight.application_project_id)
        const per = Math.ceil(all.length / Math.max(1, total))
        insight.match_stage_result = {
          schema_version: 1,
          batches_done: done,
          batches_total: total,
          requirement_matches: all.slice(0, Math.min(all.length, per * done)),
        }
      }
    }
  }

  // AI-06 partial results: evaluations appear as `evaluate done/total` advances (UQ-48)
  if (job.job_type === "interview_evaluation" && job.target_id) {
    const sessionId = job.target_id
    // v4.1: evaluation_provider / model recorded when grading starts (re-score overwrites)
    const graded = db.interview_sessions.find((x) => x.id === sessionId)
    if (graded && graded.evaluation_provider !== job.provider)
      Object.assign(graded, { evaluation_provider: job.provider, evaluation_model: job.model })
    const onlyAnswer = typeof job.params?.answer_id === "string" ? (job.params.answer_id as string) : null
    const submitted = db.interview_answers
      .filter((a) => a.session_id === sessionId && a.status === "submitted" && (!onlyAnswer || a.id === onlyAnswer))
      .sort((a, b) => {
        const qa = db.interview_questions.find((q) => q.id === a.question_id)?.sequence ?? 0
        const qb = db.interview_questions.find((q) => q.id === b.question_id)?.sequence ?? 0
        return qa - qb
      })
    // v4.2 A9: a re-grade job only re-evaluates answers without a successful evaluation
    const regrade = Array.isArray(job.params?.answer_ids) ? (job.params.answer_ids as string[]) : null
    // UQ-612 (04 §2.7.1): input-caused answers stay out of every run over the session, same-row retry included
    const inputCausedRow = (answerId: string) => {
      const e = db.answer_evaluations.find((x) => x.answer_id === answerId)
      return !!e && isInputCausedAnswer({ evaluation_status: e.status, error_code: e.error_code })
    }
    const pool = regrade ? submitted.filter((a) => regrade.includes(a.id)) : onlyAnswer ? submitted : submitted.filter((a) => !inputCausedRow(a.id))
    const stage = job.progress?.stage
    const target =
      job.status === "succeeded"
        ? pool.length
        : stage === "evaluate"
          ? (job.progress?.done ?? 0)
          : stage && stage !== "prepare"
            ? pool.length
            : 0
    for (const a of pool.slice(0, target)) {
      const existing = db.answer_evaluations.find((e) => e.answer_id === a.id)
      if (existing && existing.status === "succeeded" && existing.ai_job_id === job.id) continue
      if (existing && !onlyAnswer && !regrade && existing.status === "succeeded") continue
      if (existing) db.answer_evaluations = db.answer_evaluations.filter((e) => e.id !== existing.id)
      const ev = mockEvaluation(db, sessionId, a.id)
      ev.ai_job_id = job.id
      db.answer_evaluations.push(ev)
      a.score_status = "pending_method"
    }
  }

  if (!terminalNow) return

  // C-13: one usage row per provider call (failed calls too). No reserve/charge (D-34).
  if (job.status !== "canceled")
    recordMockUsage(db, {
      // a `prepare` failure never reached this job's own AI call: the failed call is the requirement extraction
      job_type: job.params?.mock_fail_at_prepare === true ? "jd_extraction" : job.job_type,
      ai_job_id: job.id,
      application_project_id: job.application_project_id,
      provider: job.provider,
      connection_tier: job.connection_tier ?? "free",
      outcome: job.status === "succeeded" ? "succeeded" : "failed",
      error_code: job.error_code,
      calls: job.status === "succeeded" ? Math.max(1, Number(job.params?.mock_units ?? 1)) : 1,
    })

  if (job.job_type === "insight") {
    const insight = db.insights.find((i) => i.ai_job_id === job.id)
    if (insight && job.status === "succeeded") {
      const matches = mockMatches(db, insight.application_project_id)
      for (const other of db.insights.filter((i) => i.application_project_id === insight.application_project_id)) other.is_latest = false
      Object.assign(insight, {
        status: "ready",
        is_latest: true,
        completed_at: now,
        updated_at: now,
        result: {
          schema_version: 1,
          basis_note: "입력된 경력 데이터 기준 분석입니다",
          data_sufficiency: { level: "ok", hints: [] },
          requirement_matches: matches,
          summary_counts: {
            met: matches.filter((m) => m.status === "met").length,
            partial: matches.filter((m) => m.status === "partial").length,
            no_evidence: matches.filter((m) => m.status === "no_evidence").length,
          },
          strengths: [],
          gaps: [],
          strategy: { positioning: "결제·커머스 도메인 경험을 앞세웁니다.", project_priorities: [] },
        },
      })
    }
    if (insight && job.status !== "succeeded") Object.assign(insight, { status: "failed", updated_at: now })
  }

  if (job.job_type === "interview_evaluation" && job.target_id) {
    const session = db.interview_sessions.find((s) => s.id === job.target_id)
    const singleAnswer = typeof job.params?.answer_id === "string"
    if (session && job.status === "succeeded" && !singleAnswer) {
      // C-17 "반영 질문": 평가 성공 답변만 (입력 원인 답변이 남은 완료 세션, UQ-613)
      const counted = db.answer_evaluations.filter((e) => e.session_id === session.id && e.status === "succeeded").length
      Object.assign(session, { status: "completed", completed_at: now, score_status: "pending_method", score_counted_count: counted })
      // summary is always rebuilt (A9): drop a previous failed / stale feedback row
      db.session_feedbacks = db.session_feedbacks.filter((f) => f.session_id !== session.id || f.ai_job_id === job.id)
      for (const a of db.interview_answers.filter((x) => x.session_id === session.id))
        a.score_status =
          a.status === "unanswered"
            ? "unanswered"
            : db.answer_evaluations.some((e) => e.answer_id === a.id && e.status === "succeeded")
              ? "pending_method"
              : "not_scored" // Q53-3: an input-caused answer stays failed in a completed session
      // AI-07 session feedback (not called when no answer was submitted)
      if (session.answered_count > 0 && !db.session_feedbacks.some((f) => f.session_id === session.id)) {
        db.session_feedbacks.push({
          id: newId(),
          user_id: USER_ID,
          created_at: now,
          updated_at: now,
          ...mockAiMeta(job.id, { provider: job.provider, connection_tier: job.connection_tier ?? "free" }),
          schema_version: 2,
          session_id: session.id,
          status: "succeeded",
          result: {
            schema_version: 2,
            headline: "상황 설명은 좋지만, 본인 기여를 팀 성과와 구분하는 연습이 필요해요.",
            overall_strengths: [{ text: "결과를 구체적으로 말해요.", related_criteria: ["structure"] }],
            overall_weaknesses: [{ text: "'팀이' 주어로 말해 본인 역할이 흐려져요.", related_criteria: ["specificity"] }],
            next_practice: [{ type: "focus_session", text: "직무 면접 3문항으로 본인 행동 중심 답변을 연습해 보세요.", interview_type: "job" }],
            unanswered_note: session.unanswered_count > 0 ? `미응답 ${session.unanswered_count}문항은 평가하지 않았어요.` : null,
          },
        })
      }
    }
    if (session && job.status === "failed" && !singleAnswer) {
      session.status = "evaluation_failed"
      // answers this run did not reach end as failed evaluations (S-22 "실패한 답변 n개")
      for (const a of db.interview_answers.filter((x) => x.session_id === session.id && x.status === "submitted")) {
        const existing = db.answer_evaluations.find((e) => e.answer_id === a.id)
        if (existing?.status === "succeeded") continue
        a.score_status = "not_scored"
        // Q53-3: an input-caused answer keeps its own cause — this run did not touch it
        if (existing?.status === "failed" && isInputCausedGrading(existing.error_code)) continue
        db.answer_evaluations = db.answer_evaluations.filter((e) => e.answer_id !== a.id)
        // fail_answer_evaluation(p_error_code): the cause is stored on the answer (04 §2.7.1)
        db.answer_evaluations.push({ ...mockEvaluation(db, session.id, a.id), ai_job_id: job.id, status: "failed", result: null, error_code: job.error_code })
      }
    }
    if (job.status === "failed" && singleAnswer) {
      const a = db.interview_answers.find((x) => x.id === job.params?.answer_id)
      if (a) a.score_status = "not_scored"
    }
  }
}

function refresh(db: MockDb, job: AiJob) {
  const terminal = advanceMockJob(job, db)
  syncEffects(db, job, terminal)
}

export async function getAiJob(id: string): Promise<AiJobView | null> {
  const db = await mockRequest(60)
  const job = db.ai_jobs.find((j) => j.id === id)
  if (!job) return null
  refresh(db, job)
  return clone(jobView(db, job))
}

/** Running/queued jobs plus jobs that finished in the last `sinceMs` (for completion toasts). */
export async function listActiveAiJobs(sinceMs = 15_000): Promise<AiJobView[]> {
  const db = await mockRequest(60)
  const cutoff = Date.now() - sinceMs
  const out: AiJobView[] = []
  for (const job of db.ai_jobs) {
    if (job.job_type === "writing_chat_turn" || job.job_type === "jd_extraction") continue
    const wasActive = job.status === "queued" || job.status === "running"
    if (wasActive) refresh(db, job)
    const recent = job.finished_at && Date.parse(job.finished_at) >= cutoff
    if (job.status === "queued" || job.status === "running" || recent) out.push(jobView(db, job))
  }
  return clone(out)
}

/**
 * Latest job for a target. `jobType` narrows the type; `sessionWide` skips per-answer
 * re-score jobs (params.answer_id) so a session "다시 시도" re-runs the whole grading (A4 UQ-51).
 */
export async function getLatestJobFor(
  targetType: string,
  targetId: string,
  opts?: { jobType?: AiJobType; sessionWide?: boolean },
): Promise<AiJobView | null> {
  const db = await mockRequest(60)
  const job = [...db.ai_jobs]
    .reverse()
    .find(
      (j) =>
        j.target_type === targetType &&
        j.target_id === targetId &&
        (!opts?.jobType || j.job_type === opts.jobType) &&
        (!opts?.sessionWide || typeof j.params?.answer_id !== "string"),
    )
  if (!job) return null
  refresh(db, job)
  return clone(jobView(db, job))
}

/**
 * Start an async job pinned to the active provider. No usage reservation (v4, D-34).
 * Throws MockAiError("key_missing") when no active key — screens show C-18 before this.
 */
export async function startAiJob(opts: MockJobOptions): Promise<AiJobView> {
  const db = await mockRequest()
  const job = createMockJob(db, opts)
  return clone(jobView(db, job))
}

/** Sets cancel_requested_at (C-04 중단 / FL-06). */
export async function cancelAiJob(id: string): Promise<void> {
  const db = await mockRequest(60)
  const job = db.ai_jobs.find((j) => j.id === id)
  if (job && (job.status === "queued" || job.status === "running")) job.cancel_requested_at = new Date().toISOString()
}

/**
 * C-20 "다시 시도" on the same row (POST /api/ai-jobs/{id}/retry, 04 §2.9.1 경우 (1), A1 변경).
 * Path ② order (04 §2.11.7): not found → null; queued / running → that job (follow, 202);
 * then retryGate() — ai_job_not_retryable (request-scoped types, input-caused failures, rows that
 * are not `failed`) → key_missing → key_invalid → ai_consent_required → ai_connection_changed —
 * thrown as MockAiError (withAiGuard → `{ rejected, refusal }`, nothing changed).
 * Runs on the **current** active provider / tier: different from the job row → restart from
 * `prepare` and reopen every result row the job wrote (R-63); same → resume, reopen failed rows.
 */
export async function retryAiJob(id: string, opts?: { fail?: AiErrorCode | null; rate_wait?: boolean }): Promise<AiJobView | null> {
  const db = await mockRequest()
  const job = db.ai_jobs.find((j) => j.id === id)
  if (!job) return null
  if (job.status === "queued" || job.status === "running") {
    refresh(db, job)
    return clone(jobView(db, job))
  }
  const prepareFailed = job.params?.mock_fail_at_prepare === true
  retryMockJob(job, opts, db)
  // `prepare`부터 다시 (S-16 · S-20): the requirements are extracted again; the same failure ends the job the same way
  if (prepareFailed && job.application_project_id) {
    const extraction = await ensureJdRequirementsInDb(db, job.application_project_id)
    if (extraction.failed) Object.assign(job, { params: { ...job.params, mock_fail: extraction.failed, mock_fail_at_prepare: true } })
  }
  const restarted = job.params?.mock_restarted === true
  // the rows the job produces go back to their in-progress state (UQ-49, R-63)
  const session = job.target_id ? db.interview_sessions.find((s) => s.id === job.target_id) : undefined
  if (session && job.job_type === "interview_questions") {
    session.generation_status = "generating"
    if (restarted) {
      // [가정] (04 §2.9.1 R-70) questions with empty answers are deleted and generated again
      const emptyQ = db.interview_answers
        .filter((a) => a.session_id === session.id && a.status === "draft" && !a.answer_text.trim())
        .map((a) => a.question_id)
      db.interview_questions = db.interview_questions.filter((q) => !emptyQ.includes(q.id))
      db.interview_answers = db.interview_answers.filter((a) => !emptyQ.includes(a.question_id))
    }
  }
  if (session && job.job_type === "interview_evaluation" && typeof job.params?.answer_id !== "string") {
    Object.assign(session, {
      status: "evaluating",
      ...(restarted ? { evaluation_provider: job.provider, evaluation_model: job.model } : {}),
    })
    // restarted → every evaluation of this job reopens; same provider → only failed ones.
    // Input-caused answers keep their row and cause (UQ-612)
    db.answer_evaluations = db.answer_evaluations.filter(
      (e) =>
        e.session_id !== session.id ||
        isInputCausedAnswer({ evaluation_status: e.status, error_code: e.error_code }) ||
        (e.status === "succeeded" && !(restarted && e.ai_job_id === job.id)),
    )
  }
  if (job.job_type === "insight") {
    const insight = db.insights.find((i) => i.ai_job_id === job.id)
    if (insight) insight.status = "generating"
  }
  return clone(jobView(db, job))
}

/** 다시 채점 route refusal (HTTP 409, 04 §2.7.1): nothing changed. `cause` = details of input_only */
export interface RegradeRefused {
  refused: InterviewEvaluationRefusalCode
  cause: AiErrorCode | null
}

/**
 * S-22 / S-37 다시 채점 (04 §2.7.1 판정표, new job — 04 §2.11.7 path ①), on the active provider.
 * - regrade: re-evaluates only the 다시 채점 대상 (input-caused answers stay out, Q53-3)
 * - resummarize (Q53-5 "종합 평가 다시 정리"): no answer is called, AI-07 only (`evaluate` skipped)
 * - otherwise refused without a job: interview_evaluation_input_only / _not_retryable
 * The summary is always rebuilt (the previous row stays `pending` so S-22 can dim it); clears
 * score_status / completed_at / result_viewed_at (A9).
 */
export async function regradeFailedAnswers(sessionId: string): Promise<AiJobView | RegradeRefused> {
  const db = await mockRequest()
  const session = db.interview_sessions.find((s) => s.id === sessionId)
  if (!session) return { refused: "interview_evaluation_not_retryable", cause: null }
  const decision = gradingDecisionOf(db, session)
  const refused = gradingRefusal(decision)
  if (refused) return { refused, cause: decision.kind === "input_only" ? decision.cause : null }
  const targets = regradeTargetIds(db, sessionId)
  const summaryOnly = decision.kind === "resummarize"
  const job = createMockJob(db, {
    job_type: "interview_evaluation",
    application_project_id: session.application_project_id,
    target_type: "interview_session",
    target_id: session.id,
    units: Math.max(1, targets.length),
    duration_ms: 6_000,
    params: { answer_ids: targets, mock_summary_only: summaryOnly },
  })
  Object.assign(session, {
    status: "evaluating",
    score_status: null,
    completed_at: null,
    result_viewed_at: null,
    evaluation_provider: job.provider,
    evaluation_model: job.model,
    updated_at: job.created_at,
  })
  db.answer_evaluations = db.answer_evaluations.filter((e) => !(e.session_id === sessionId && targets.includes(e.answer_id)))
  for (const f of db.session_feedbacks) if (f.session_id === sessionId) Object.assign(f, { status: "pending" })
  return clone(jobView(db, job))
}

/**
 * S-33 "남은 질문 다시 만들기" (A4 request 2, begin RPC 대응 — new job, 04 §2.11.7 path ①): reopens
 * the in-progress session to `generation_status = 'generating'` and starts a new
 * interview_questions job for the remaining count on the active provider. null when the session
 * is not in progress or already has every question.
 */
export async function startRemainingQuestions(sessionId: string): Promise<AiJobView | null> {
  const db = await mockRequest()
  const session = db.interview_sessions.find((s) => s.id === sessionId)
  if (!session || session.status !== "in_progress") return null
  const saved = db.interview_questions.filter((q) => q.session_id === sessionId).length
  const remaining = session.question_count - saved
  if (remaining <= 0) return null
  const job = createMockJob(db, {
    job_type: "interview_questions",
    application_project_id: session.application_project_id,
    target_type: "interview_session",
    target_id: session.id,
    units: remaining,
    params: { mock_base: saved },
  })
  Object.assign(session, { generation_status: "generating", updated_at: job.created_at })
  return clone(jobView(db, job))
}

/**
 * Mock: advances this application's running async jobs and writes what they produced. For rules that
 * read "no job is running" (update_failed_jd_raw_text condition 1). AI-01 jobs have their own path.
 */
export function refreshApplicationJobs(db: MockDb, applicationProjectId: string) {
  for (const job of db.ai_jobs) {
    if (job.application_project_id !== applicationProjectId || job.job_type === "jd_extraction") continue
    if (job.status === "queued" || job.status === "running") refresh(db, job)
  }
}
