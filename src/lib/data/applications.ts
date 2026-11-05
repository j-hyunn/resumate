/**
 * 지원 프로젝트 data layer: application_projects, job_descriptions, jd_requirements,
 * application_stage_events, insights, drafts (+ sections/sources). Server only.
 * Board RPCs: move_application_stage / set_application_outcome (04 §2.6).
 */
import type {
  AiJobType,
  AiErrorCode,
  AiJob,
  ApplicationProject,
  ApplicationStage,
  Draft,
  DraftSection,
  DraftSectionSource,
  Insight,
  InterviewSession,
  JdRequirement,
  JdRawTextRefusalCode,
  JobDescription,
  MoveApplicationStageResult,
  StageOutcome,
} from "@/types/db"
import { clone, mockRequest } from "@/lib/mock/store"
import type { MockDb } from "@/lib/mock/fixtures"
import { newId, USER_ID } from "@/lib/mock/ids"
import { activeKey, assertAiRunnable, createMockJob, MockAiError } from "@/lib/mock/ai"
import { consentRequired } from "@/lib/mock/consent"
import { mockAiMeta } from "@/lib/mock/ai-meta"
import { effectiveGenerationStatus, savedQuestionCount } from "@/lib/mock/grading"
import { STAGE_ORDER, countsAsDraft, countsAsInterview, defaultApplicationName } from "./labels"
import { resolveAiFeatureStatus, type AiFeatureStatusView } from "./ai-feature-status"
import { errorCategoryOf, failureCauseOf, failureTimestamps } from "./ai-errors"
import { refreshApplicationJobs } from "./ai-jobs"
import { isInputCausedJdFailure, JD_RAW_TEXT_MAX } from "./jd-raw-text"
import { previewOr } from "./source"
import { realMoveApplicationStage, realSetApplicationOutcome, realUpdateApplicationProject } from "./board-real"
import {
  realCreateApplicationProject,
  realGetApplicationProject,
  realGetInsightState,
  realGetJdRequirement,
  realGetJobDescription,
  realListApplicationProjects,
  realStartInsight,
  realUpdateFailedJdRawText,
} from "./applications-real"
import { realGetDraft, realListDrafts, realSaveDraftSection } from "./drafts-real"

/** List/board/hub summary of one application project (S-13 행, S-39 카드, S-31 헤더) */
export interface ApplicationSummary extends ApplicationProject {
  job_description: Pick<JobDescription, "id" | "company_name" | "position_title" | "extraction_status"> | null
  /** 인사이트 없음 / 생성 중 / 있음 */
  insight_state: "none" | "generating" | "ready"
  /** 서류 초안 수: 경력기술서 `composing` 제외 (S-17, Q53-7) */
  draft_count: number
  /** 면접 세션 수: 질문 0개인 그만둔 세션 제외 (Q53-9) */
  interview_session_count: number
  in_progress_session:
    | (Pick<InterviewSession, "id" | "interview_type" | "answered_count" | "question_count" | "last_activity_at"> & {
        /** S-20 배너: 실효 generation_status (`generating`인데 작업이 끝난 행 = failed) */
        effective_generation_status: InterviewSession["generation_status"]
        saved_question_count: number
      })
    | null
  /** running async AI jobs on this project (C-03 축약형) */
  running_job_ids: string[]
  /** running AI-02 job (생성 중 incl. 재생성), else null — S-13 인사이트 칸 (A3 UQ-74) */
  insight_job_id: string | null
  /** v5.3 C-03 진행 표시 우선순위 — insight (S-13 / S-31 / S-39 / S-16): <AiFeatureStatus status={…} /> */
  insight_status: AiFeatureStatusView
  /** v5.3 C-03 진행 표시 우선순위 — interview (latest session's question / grading job) */
  interview_status: AiFeatureStatusView
}

/**
 * Mock: a running AI-01 extraction finishes after its simulated duration (the real backend
 * updates the row itself). Called wherever a JD is read, so no screen has to poke it.
 */
function advanceJdExtraction(db: MockDb, applicationProjectId: string) {
  const jd = db.job_descriptions.find((j) => j.application_project_id === applicationProjectId)
  if (!jd || jd.extraction_status !== "running") return
  const job = db.ai_jobs.find((j) => j.id === jd.extraction_job_id)
  if (!job || Date.now() - Date.parse(job.created_at) <= 4_000) return
  const injected = (job.params?.mock_fail as AiErrorCode | null | undefined) ?? null
  if (injected) failJdExtraction(db, jd, job, injected)
  else completeJdExtraction(db, jd, job)
}

/**
 * fail_jd_extraction (04 §2.6 v4.2): JD `failed`, job `failed` with the cause, and a null name gets
 * the same rule as creation — "회사명 – 포지션명" when both were entered, else the default name.
 * Reproduce with mock_controls.next_jd_extraction_failure (A3 request 2).
 */
function failJdExtraction(db: MockDb, jd: JobDescription, job: AiJob, code: AiErrorCode) {
  const now = new Date().toISOString()
  jd.extraction_status = "failed"
  Object.assign(job, {
    status: "failed",
    error_code: code,
    error_category: errorCategoryOf(code),
    failure_cause: failureCauseOf(code),
    ...failureTimestamps(code),
    // A14: request-path wait — same 20 s window the screens count down
    retry_after: code === "rate_limited" || code === "provider_unavailable" ? new Date(Date.now() + 20_000).toISOString() : null,
    finished_at: now,
    updated_at: now,
  })
  const ap = db.application_projects.find((a) => a.id === jd.application_project_id)
  if (ap && !ap.name) {
    const both = jd.company_name && jd.position_title ? `${jd.company_name} – ${jd.position_title}`.slice(0, 100) : null
    ap.name = both ?? defaultApplicationName(ap.created_at)
    ap.name_source = both ? "user" : "default"
  }
}

/** Mock AI-01 result: marks the JD extracted and, if it has no requirements yet, derives them from the raw text. */
function completeJdExtraction(db: MockDb, jd: JobDescription, job: AiJob) {
  const now = new Date().toISOString()
  jd.extraction_status = "succeeded"
  jd.extraction = { is_likely_jd: true, seniority: null }
  jd.extraction_provider = job.provider
  jd.extraction_model = job.model
  jd.company_name = jd.company_name ?? "새 회사"
  jd.position_title = jd.position_title ?? "새 포지션"
  Object.assign(job, { status: "succeeded", finished_at: now, updated_at: now })
  if (!db.jd_requirements.some((r) => r.job_description_id === jd.id)) {
    // [UI-가정] mock: one requirement per substantial raw-text line (max 6), first half 자격요건
    const lines = jd.raw_text
      .split(/\n+/)
      .map((l) => l.replace(/^[\s•\-*·]+/, "").trim())
      .filter((l) => l.length >= 8)
      .slice(0, 6)
    lines.forEach((content, i) =>
      db.jd_requirements.push({
        id: newId(),
        user_id: USER_ID,
        created_at: now,
        updated_at: now,
        job_description_id: jd.id,
        category: i < Math.ceil(lines.length / 2) ? "required" : "preferred",
        content,
        keywords: [],
        importance: i === 0 ? "high" : "normal",
        source_sids: [],
        sort_order: i + 1,
        origin: "ai",
        is_user_edited: false,
      }),
    )
    jd.requirements_hash = `mock-${jd.id}-${lines.length}`
  }
  const ap = db.application_projects.find((a) => a.id === jd.application_project_id)
  if (ap && (!ap.name || ap.name_source === "default")) {
    ap.name = `${jd.company_name} – ${jd.position_title}`
    ap.name_source = "ai"
  }
}

/**
 * D-30 / UQ-232: "요건 추출 먼저" as one server-side flow. Before an AI feature that needs
 * requirements (인사이트·서류·면접), a JD whose extraction has not succeeded (created without a key,
 * or failed) is extracted **inline** (AI-01, ~1.5 s mock) and only then does the caller create its
 * own job. Checks the key first (throws MockAiError before any change). No-op when already extracted.
 * `failed`: mock_controls.next_jd_extraction_failure — the `prepare` step failed with that cause, so the
 * caller's job ends there the same way, nothing saved (`fail_at_prepare`; S-16, S-20 → C-20 "입력 원인
 * 실패의 이동", Q53-9).
 */
export async function ensureJdRequirementsInDb(db: MockDb, applicationProjectId: string): Promise<{ ran: boolean; failed: AiErrorCode | null }> {
  const jd = db.job_descriptions.find((j) => j.application_project_id === applicationProjectId)
  if (!jd || jd.extraction_status === "succeeded") return { ran: false, failed: null }
  assertAiRunnable(db)
  let job = db.ai_jobs.find((j) => j.id === jd.extraction_job_id)
  if (!job || job.status === "failed" || job.status === "canceled") {
    job = createMockJob(db, { job_type: "jd_extraction", application_project_id: applicationProjectId, target_type: "job_description", target_id: jd.id })
    jd.extraction_job_id = job.id
  }
  jd.extraction_status = "running"
  await new Promise((r) => setTimeout(r, 1_500))
  const failNext = db.mock_controls.next_jd_extraction_failure
  if (failNext) {
    db.mock_controls.next_jd_extraction_failure = null
    failJdExtraction(db, jd, job, failNext)
    return { ran: true, failed: failNext }
  }
  completeJdExtraction(db, jd, job)
  return { ran: true, failed: null }
}

/** `advanceMock: false` = real rows (applications-real.ts): the same rules, no simulated extraction. */
export function summarize(db: MockDb, ap: ApplicationProject, opts: { advanceMock: boolean } = { advanceMock: true }): ApplicationSummary {
  if (opts.advanceMock) advanceJdExtraction(db, ap.id)
  const jd = db.job_descriptions.find((j) => j.application_project_id === ap.id) ?? null
  const insights = db.insights.filter((i) => i.application_project_id === ap.id)
  const sessions = db.interview_sessions.filter((s) => s.application_project_id === ap.id)
  const inProgress = sessions.find((s) => s.status === "in_progress") ?? null
  return {
    ...ap,
    job_description: jd && {
      id: jd.id,
      company_name: jd.company_name,
      position_title: jd.position_title,
      extraction_status: jd.extraction_status,
    },
    insight_state: insights.some((i) => i.status === "ready")
      ? "ready"
      : insights.some((i) => i.status === "generating")
        ? "generating"
        : "none",
    draft_count: db.drafts.filter((d) => d.application_project_id === ap.id && countsAsDraft(d)).length,
    interview_session_count: sessions.filter((s) => countsAsInterview(s, savedQuestionCount(db, s.id))).length,
    in_progress_session: inProgress && {
      id: inProgress.id,
      interview_type: inProgress.interview_type,
      answered_count: inProgress.answered_count,
      question_count: inProgress.question_count,
      last_activity_at: inProgress.last_activity_at,
      effective_generation_status: effectiveGenerationStatus(db, inProgress),
      saved_question_count: savedQuestionCount(db, inProgress.id),
    },
    running_job_ids: db.ai_jobs
      .filter((j) => j.application_project_id === ap.id && (j.status === "queued" || j.status === "running") && j.job_type !== "jd_extraction")
      .map((j) => j.id),
    insight_job_id:
      db.ai_jobs.find(
        (j) => j.application_project_id === ap.id && j.job_type === "insight" && (j.status === "queued" || j.status === "running"),
      )?.id ?? null,
    insight_status: insightFeatureStatus(db, ap.id),
    interview_status: interviewFeatureStatus(db, ap.id),
  }
}

/** latest job of the given types on an application project (C-03 진행 표시 우선순위) */
function latestJob(db: MockDb, applicationProjectId: string, types: AiJobType[], targetId?: string) {
  return (
    [...db.ai_jobs]
      .filter((j) => j.application_project_id === applicationProjectId && types.includes(j.job_type) && (!targetId || j.target_id === targetId))
      .sort((a, b) => a.created_at.localeCompare(b.created_at))
      .pop() ?? null
  )
}

export function insightFeatureStatus(db: MockDb, applicationProjectId: string): AiFeatureStatusView {
  const insights = db.insights.filter((i) => i.application_project_id === applicationProjectId)
  const latest = insights.filter((i) => i.status === "ready").sort((a, b) => (b.completed_at ?? "").localeCompare(a.completed_at ?? ""))[0]
  return resolveAiFeatureStatus({
    job: latestJob(db, applicationProjectId, ["insight"]),
    resultAt: latest ? (latest.completed_at ?? latest.updated_at) : null,
    resultPending: insights.some((i) => i.status === "generating"),
    failuresAfter: rawTextEditedAt(db, applicationProjectId),
  })
}

/** C-03 / 04 §2.6.1 지난 실패 표시: failures that ended before this were about the previous 공고 원문 */
function rawTextEditedAt(db: MockDb, applicationProjectId: string): string | null {
  return db.job_descriptions.find((j) => j.application_project_id === applicationProjectId)?.raw_text_edited_at ?? null
}

export function interviewFeatureStatus(db: MockDb, applicationProjectId: string): AiFeatureStatusView {
  const sessions = db.interview_sessions
    .filter((s) => s.application_project_id === applicationProjectId && s.status !== "abandoned")
    .sort((a, b) => b.last_activity_at.localeCompare(a.last_activity_at))
  const session = sessions[0]
  if (!session) return resolveAiFeatureStatus({ job: null, resultAt: null })
  const done = sessions.find((s) => s.status === "completed")
  return resolveAiFeatureStatus({
    job: latestJob(db, applicationProjectId, ["interview_questions", "interview_evaluation"], session.id),
    resultAt: done ? (done.completed_at ?? done.updated_at) : null,
    resultPending: session.generation_status === "generating" || session.status === "evaluating",
    failuresAfter: rawTextEditedAt(db, applicationProjectId),
  })
}

export interface ListApplicationsOptions {
  sort?: "last_activity" | "deadline"
  stage?: ApplicationStage
}

/** S-13 (최근 활동순 기본 / 마감일순, 단계 필터) */
async function mockListApplicationProjects(opts: ListApplicationsOptions = {}): Promise<ApplicationSummary[]> {
  const db = await mockRequest()
  let rows = db.application_projects.map((ap) => summarize(db, ap))
  if (opts.stage) rows = rows.filter((r) => r.stage === opts.stage)
  rows.sort((a, b) =>
    opts.sort === "deadline"
      ? (a.deadline ?? "9999").localeCompare(b.deadline ?? "9999")
      : b.last_activity_at.localeCompare(a.last_activity_at),
  )
  return clone(rows)
}

async function mockGetApplicationProject(id: string): Promise<ApplicationSummary | null> {
  const db = await mockRequest()
  const ap = db.application_projects.find((a) => a.id === id)
  return ap ? clone(summarize(db, ap)) : null
}

/** S-39: cards grouped by stage, each column ordered by stage_changed_at desc (D-26 (a)) */
export async function getBoard(): Promise<Record<ApplicationStage, ApplicationSummary[]>> {
  const board = Object.fromEntries(STAGE_ORDER.map((s) => [s, [] as ApplicationSummary[]])) as Record<
    ApplicationStage,
    ApplicationSummary[]
  >
  for (const ap of await listApplicationProjects()) board[ap.stage].push(ap)
  for (const stage of STAGE_ORDER) board[stage].sort((a, b) => b.stage_changed_at.localeCompare(a.stage_changed_at))
  return board
}

/** [{ sid, text, start, end }] per non-empty line (splitJdSentences of create and update_failed_jd_raw_text) */
function splitJdSentences(rawText: string) {
  const lines = rawText.split(/\n+/).filter(Boolean)
  let pos = 0
  return lines.map((text, i) => {
    const start = pos
    pos += text.length + 1
    return { sid: `S${i + 1}`, text, start, end: start + text.length }
  })
}

/**
 * RPC create_application_project — JD 필수·교체 불가 (U-6). AI-01 extraction runs automatically.
 * Q53-1 (04 §2.11.7 경로 ⑥): the gate is checked **before any insert**. No active provider → passes
 * (추출 없이 저장, D-30); invalid key → `key_invalid`; consent needed → `ai_consent_required`
 * (MockAiError, no row). `needs_check` passes. The screen normally stops earlier from readiness.
 */
export interface CreateApplicationInput {
  raw_text: string
  name?: string | null
  deadline?: string | null
  /**
   * A3 request 1: S-14 회사명·포지션명 입력란 (키 없음: 펼침). Stored on the JD with source 'user';
   * the AI extraction keeps user values (it only fills empty ones).
   * v5.3 name rule (S-14): `name` given → that; else **both** company and position → "회사명 –
   * 포지션명" (user, first 100 chars); else no key → default "새 자기소개서 (YYYY-MM-DD)", key →
   * null (추출 대기, the AI name on success / the same rule on failure).
   */
  company_name?: string | null
  position_title?: string | null
}

async function mockCreateApplicationProject(input: CreateApplicationInput): Promise<ApplicationProject> {
  const company = input.company_name?.trim() || null
  const position = input.position_title?.trim() || null
  const name = input.name?.trim() || (company && position ? `${company} – ${position}`.slice(0, 100) : null)
  const db = await mockRequest()
  const key = activeKey(db)
  if (key?.status === "invalid") throw MockAiError.refuse("key_invalid")
  if (key && consentRequired(db, key.provider, key.connection_tier)) throw MockAiError.refuse("ai_consent_required")
  const now = new Date().toISOString()
  const ap: ApplicationProject = {
    id: newId(),
    user_id: USER_ID,
    created_at: now,
    updated_at: now,
    name,
    name_source: name ? "user" : null,
    deadline: input.deadline ?? null,
    memo: null,
    stage: "before_apply",
    stage_outcome: null,
    stage_changed_at: now,
    last_activity_at: now,
    duplicated_from_id: null,
  }
  const jdId = newId()
  // v4 (D-30): with a key AI-01 runs automatically; without one the JD stays `pending` (요건 정리하기
  // later) and the name is the user's or the default "새 자기소개서 (날짜)".
  const failNext = db.mock_controls.next_jd_extraction_failure
  if (key && failNext) db.mock_controls.next_jd_extraction_failure = null
  const job = key
    ? createMockJob(db, {
        job_type: "jd_extraction",
        application_project_id: ap.id,
        target_type: "job_description",
        target_id: jdId,
        path: "request",
        fail: failNext,
      })
    : null
  if (!job && !ap.name) {
    ap.name = defaultApplicationName(now)
    ap.name_source = "default"
  }
  db.application_projects.push(ap)
  db.job_descriptions.push({
    id: jdId,
    user_id: USER_ID,
    created_at: now,
    updated_at: now,
    application_project_id: ap.id,
    raw_text: input.raw_text,
    raw_text_hash: `hash-${jdId}`,
    sentences: splitJdSentences(input.raw_text),
    detected_language: "ko",
    company_name: company,
    company_name_source: company ? "user" : null,
    position_title: position,
    position_title_source: position ? "user" : null,
    extraction_status: job ? "running" : "pending",
    extraction: null,
    extraction_job_id: job?.id ?? null,
    extraction_provider: null,
    extraction_model: null,
    tech_keywords: [],
    requirements_hash: null,
    raw_text_edited_at: null,
  })
  db.application_stage_events.push({
    id: newId(),
    user_id: USER_ID,
    application_project_id: ap.id,
    event_type: "created",
    from_stage: null,
    to_stage: "before_apply",
    from_outcome: null,
    to_outcome: null,
    created_at: now,
  })
  return clone(ap)
}

/** S-31 헤더 인라인 수정 (name, deadline, memo only) */
export async function updateApplicationProject(
  id: string,
  patch: Partial<Pick<ApplicationProject, "name" | "deadline" | "memo">>,
): Promise<ApplicationProject | null> {
  return previewOr(
    async () => {
      const db = await mockRequest()
      const ap = db.application_projects.find((a) => a.id === id)
      if (!ap) return null
      Object.assign(ap, patch)
      if (patch.name !== undefined) ap.name_source = "user"
      ap.updated_at = ap.last_activity_at = new Date().toISOString()
      return clone(ap)
    },
    () => realUpdateApplicationProject(id, patch),
  )
}

export class MoveFailedError extends Error {
  constructor() {
    super("move failed (mock)")
  }
}

/**
 * RPC move_application_stage(application_project_id, to_stage, outcome default null).
 * No AI call, no usage. `opts.fail` simulates ST-MOVE-FAILED.
 */
export async function moveApplicationStage(
  id: string,
  toStage: ApplicationStage,
  outcome: StageOutcome | null = null,
  opts?: { fail?: boolean },
): Promise<MoveApplicationStageResult> {
  return previewOr(
    async () => {
      const db = await mockRequest(250)
      if (opts?.fail) throw new MoveFailedError()
      const ap = db.application_projects.find((a) => a.id === id)
      if (!ap) throw new MoveFailedError()
      const promptFor = (stage: ApplicationStage): MoveApplicationStageResult["interview_prompt"] => {
        if (stage !== "job_interview" && stage !== "culture_fit_interview") return null
        const inProgress = db.interview_sessions.find((s) => s.application_project_id === id && s.status === "in_progress")
        return {
          interview_type: stage === "job_interview" ? "job" : "culture_fit",
          in_progress_session_id: inProgress?.id ?? null,
          // v4.2: details for C-14 (any interview type — one in-progress session per application)
          in_progress_session: inProgress
            ? {
                session_id: inProgress.id,
                interview_type: inProgress.interview_type,
                answered_count: inProgress.answered_count,
                question_count: inProgress.question_count,
                generation_status: inProgress.generation_status,
                last_activity_at: inProgress.last_activity_at,
              }
            : null,
        }
      }
      if (ap.stage === toStage) return clone({ application_project: ap, interview_prompt: null })
      const now = new Date().toISOString()
      const fromStage = ap.stage
      const fromOutcome = ap.stage_outcome
      if (fromStage === "closed" && toStage !== "closed") ap.stage_outcome = null // D-UX-12 (a)
      if (toStage === "closed" && outcome) ap.stage_outcome = outcome
      Object.assign(ap, { stage: toStage, stage_changed_at: now, last_activity_at: now, updated_at: now })
      db.application_stage_events.push({
        id: newId(),
        user_id: USER_ID,
        application_project_id: id,
        event_type: "stage_changed",
        from_stage: fromStage,
        to_stage: toStage,
        from_outcome: fromOutcome,
        to_outcome: ap.stage_outcome,
        created_at: now,
      })
      return clone({ application_project: ap, interview_prompt: promptFor(toStage) })
    },
    () => realMoveApplicationStage(id, toStage, outcome),
  )
}

/** RPC set_application_outcome — only when stage = 'closed' */
export async function setApplicationOutcome(id: string, outcome: StageOutcome | null): Promise<ApplicationProject | null> {
  return previewOr(
    async () => {
      const db = await mockRequest(200)
      const ap = db.application_projects.find((a) => a.id === id)
      if (!ap || ap.stage !== "closed") return null
      const now = new Date().toISOString()
      db.application_stage_events.push({
        id: newId(),
        user_id: USER_ID,
        application_project_id: id,
        event_type: "outcome_changed",
        from_stage: "closed",
        to_stage: "closed",
        from_outcome: ap.stage_outcome,
        to_outcome: outcome,
        created_at: now,
      })
      Object.assign(ap, { stage_outcome: outcome, updated_at: now, last_activity_at: now })
      return clone(ap)
    },
    () => realSetApplicationOutcome(id, outcome),
  )
}

// ---------------------------------------------------------------------------
// JD · 요건 (S-15)
// ---------------------------------------------------------------------------

export interface JobDescriptionWithRequirements extends JobDescription {
  requirements: JdRequirement[]
  /** getJdView.rawTextEditable (04 §2.6.1 조건 1~5): S-15 "공고 원문 고치기" */
  raw_text_editable: boolean
  /** why it can't be edited. `jd_has_results` on a succeeded JD with no requirements → 새 자기소개서 안내 (Q53-11) */
  raw_text_lock: JdRawTextRefusalCode | null
}

async function mockGetJobDescription(applicationProjectId: string): Promise<JobDescriptionWithRequirements | null> {
  const db = await mockRequest()
  const jd = db.job_descriptions.find((j) => j.application_project_id === applicationProjectId)
  if (!jd) return null
  advanceJdExtraction(db, applicationProjectId)
  const rawTextLock = jdRawTextLock(db, jd)
  return clone({
    ...jd,
    raw_text_edited_at: jd.raw_text_edited_at ?? null,
    requirements: db.jd_requirements
      .filter((r) => r.job_description_id === jd.id)
      .sort((a, b) => a.sort_order - b.sort_order),
    raw_text_editable: rawTextLock === null,
    raw_text_lock: rawTextLock,
  })
}

/** Conditions 1~5 of update_failed_jd_raw_text (04 §2.6.1), in order. null = the text may be edited. */
function jdRawTextLock(db: MockDb, jd: JobDescription): JdRawTextRefusalCode | null {
  const apId = jd.application_project_id
  refreshApplicationJobs(db, apId)
  // 1. no job queued / running on this application (any type)
  if (db.ai_jobs.some((j) => j.application_project_id === apId && (j.status === "queued" || j.status === "running"))) return "jd_job_in_progress"
  // 2. extraction failed (`running` whose job already failed counts: same as the read rule), or succeeded (Q53-11)
  const job = db.ai_jobs.find((j) => j.id === jd.extraction_job_id) ?? null
  const failed = jd.extraction_status === "failed" || (jd.extraction_status === "running" && job?.status === "failed")
  if (!failed && jd.extraction_status !== "succeeded") return "jd_raw_text_locked"
  // 3. no requirements
  if (db.jd_requirements.some((r) => r.job_description_id === jd.id)) return "jd_raw_text_locked"
  // 4. a failed extraction failed for an input cause (job gone after 90 days → cause unknown)
  if (failed && (!job || job.job_type !== "jd_extraction" || job.status !== "failed" || !isInputCausedJdFailure(job.error_code))) return "jd_failure_not_input"
  // 5. nothing was built from this text
  const sessionIds = db.interview_sessions.filter((s) => s.application_project_id === apId).map((s) => s.id)
  const draftIds = db.drafts.filter((d) => d.application_project_id === apId).map((d) => d.id)
  const hasResults =
    db.insights.some((i) => i.application_project_id === apId && i.status === "ready") ||
    db.interview_questions.some((q) => sessionIds.includes(q.session_id)) ||
    db.draft_sections.some((s) => draftIds.includes(s.draft_id) && s.ai_content) ||
    db.evidence_links.some((e) => e.application_project_id === apId && (e.source_type === "jd_requirement" || e.source_type === "jd_sentence"))
  return hasResults ? "jd_has_results" : null
}

export type UpdateFailedJdRawTextResult =
  | { application_project_id: string; job_description_id: string; extraction_status: "pending"; raw_text_edited_at: string; ai_run_allowed: boolean }
  | { refused: JdRawTextRefusalCode }

/**
 * RPC update_failed_jd_raw_text (Q53-2, 04 §2.6.1): the one exception to "JD 교체 불가". Replaces the text
 * and sentences, sends the JD back to `pending`. No AI call, no tokens (D-30); works without a key.
 * name / name_source / stage / deadline don't change; earlier ai_jobs rows stay untouched.
 */
async function mockUpdateFailedJdRawText(applicationProjectId: string, rawText: string): Promise<UpdateFailedJdRawTextResult> {
  const db = await mockRequest()
  const text = rawText.trim()
  if (!text || text.length > JD_RAW_TEXT_MAX) return { refused: "invalid_raw_text" }
  const jd = db.job_descriptions.find((j) => j.application_project_id === applicationProjectId)
  if (!jd) return { refused: "job_description_not_found" }
  advanceJdExtraction(db, applicationProjectId)
  const lock = jdRawTextLock(db, jd)
  if (lock) return { refused: lock }
  if (text === jd.raw_text.trim()) return { refused: "jd_raw_text_unchanged" }
  const now = new Date().toISOString()
  Object.assign(jd, {
    raw_text: text,
    raw_text_hash: `hash-${jd.id}-${now}`,
    sentences: splitJdSentences(text),
    detected_language: null,
    extraction: null,
    tech_keywords: [],
    requirements_hash: null,
    extraction_status: "pending",
    extraction_job_id: null,
    extraction_provider: null,
    extraction_model: null,
    raw_text_edited_at: now,
    updated_at: now,
  })
  // AI-filled values belong to the previous text; what the user typed stays
  if (jd.company_name_source === "ai") Object.assign(jd, { company_name: null, company_name_source: null })
  if (jd.position_title_source === "ai") Object.assign(jd, { position_title: null, position_title_source: null })
  const ap = db.application_projects.find((a) => a.id === applicationProjectId)
  if (ap) ap.last_activity_at = now
  const key = activeKey(db)
  return {
    application_project_id: applicationProjectId,
    job_description_id: jd.id,
    extraction_status: "pending",
    raw_text_edited_at: now,
    ai_run_allowed: Boolean(key && key.status !== "invalid" && !consentRequired(db, key.provider, key.connection_tier)),
  }
}

/** One requirement (S-10 "관련 요건: {요건 content}" from an S-16 보완점) */
async function mockGetJdRequirement(id: string): Promise<JdRequirement | null> {
  const db = await mockRequest(0)
  const r = db.jd_requirements.find((x) => x.id === id)
  return r ? clone(r) : null
}

// ---------------------------------------------------------------------------
// 인사이트 (S-16)
// ---------------------------------------------------------------------------

function insightJobActive(db: MockDb, insight: Insight) {
  return db.ai_jobs.some((j) => j.id === insight.ai_job_id && (j.status === "queued" || j.status === "running"))
}

/**
 * Latest ready insight plus the row being generated (if any). UQ-581 (C-03 진행 표시 우선순위): a row
 * counts as generating only while its job is queued / running — one whose job ended or is gone is
 * `insight_status.failure` (`stalled`), same as S-13 · S-31.
 */
async function mockGetInsightState(applicationProjectId: string): Promise<{ latest: Insight | null; generating: Insight | null }> {
  const db = await mockRequest()
  const rows = db.insights.filter((i) => i.application_project_id === applicationProjectId)
  return clone({
    latest: rows.find((i) => i.is_latest && i.status === "ready") ?? null,
    generating: rows.find((i) => i.status === "generating" && insightJobActive(db, i)) ?? null,
  })
}

/** Creates a generating insight row + async job (AI-02). Returns the job id for C-03. */
async function mockStartInsight(
  applicationProjectId: string,
  opts?: { fail?: AiErrorCode | null; rate_wait?: boolean },
): Promise<{ insight_id: string; job_id: string }> {
  const db = await mockRequest()
  // validate first (key), then D-30 extraction → insight as one flow (UQ-232)
  assertAiRunnable(db)
  const extraction = await ensureJdRequirementsInDb(db, applicationProjectId)
  const now = new Date().toISOString()
  const jd = db.job_descriptions.find((j) => j.application_project_id === applicationProjectId)
  const units = Math.max(1, Math.ceil(db.jd_requirements.filter((r) => r.job_description_id === jd?.id).length / 8))
  const insightId = newId()
  const job = createMockJob(db, {
    job_type: "insight",
    application_project_id: applicationProjectId,
    // OD-D9: same target as the real AI-02 job (the insight row links back via ai_job_id)
    target_type: "application_project",
    target_id: applicationProjectId,
    units,
    // a failed `prepare` extraction ends the job with the same cause, before any match (S-16, Q53-2)
    fail: extraction.failed ?? opts?.fail,
    fail_at_prepare: !!extraction.failed,
    rate_wait: opts?.rate_wait,
  })
  const prev = db.insights.filter((i) => i.application_project_id === applicationProjectId)
  // UQ-581: the new run replaces a row stuck on "생성 중" so it can't report `stalled` again afterwards
  for (const stuck of prev) {
    if (stuck.id !== insightId && stuck.status === "generating" && !insightJobActive(db, stuck)) Object.assign(stuck, { status: "failed", updated_at: now })
  }
  db.insights.push({
    id: insightId,
    user_id: USER_ID,
    created_at: now,
    updated_at: now,
    ...mockAiMeta(job.id, { provider: job.provider, connection_tier: job.connection_tier ?? "free" }),
    application_project_id: applicationProjectId,
    version_no: prev.reduce((m, i) => Math.max(m, i.version_no), 0) + 1,
    is_latest: false,
    status: "generating",
    result: null,
    match_stage_result: null,
    requirements_hash: jd?.requirements_hash ?? null,
    completed_at: null,
  })
  // no job left running on this JD: S-15 can edit the text right away (04 §2.6.1 조건 1)
  if (extraction.failed) refreshApplicationJobs(db, applicationProjectId)
  return { insight_id: insightId, job_id: job.id }
}

// ---------------------------------------------------------------------------
// 서류 초안 (S-17 ~ S-19)
// ---------------------------------------------------------------------------

async function mockListDrafts(applicationProjectId: string): Promise<Draft[]> {
  const db = await mockRequest()
  return clone(
    db.drafts
      .filter((d) => d.application_project_id === applicationProjectId)
      .sort((a, b) => b.created_at.localeCompare(a.created_at)),
  )
}

export interface DraftWithSections extends Draft {
  sections: Array<DraftSection & { sources: DraftSectionSource[] }>
}

async function mockGetDraft(applicationProjectId: string, draftId: string): Promise<DraftWithSections | null> {
  const db = await mockRequest()
  const draft = db.drafts.find((d) => d.id === draftId && d.application_project_id === applicationProjectId)
  if (!draft) return null
  return clone({
    ...draft,
    sections: db.draft_sections
      .filter((s) => s.draft_id === draftId)
      .sort((a, b) => a.sort_order - b.sort_order)
      .map((s) => ({ ...s, sources: db.draft_section_sources.filter((src) => src.draft_section_id === s.id) })),
  })
}

export type DraftSectionPatch = Partial<
  Pick<DraftSection, "question_text" | "char_limit" | "count_basis" | "user_note" | "edited_content" | "source_selection_mode" | "sources_modified_at">
>

async function mockSaveDraftSection(
  sectionId: string,
  patch: DraftSectionPatch,
  opts?: { fail?: boolean },
): Promise<DraftSection | null> {
  const db = await mockRequest()
  if (opts?.fail) throw new Error("save failed (mock)")
  const section = db.draft_sections.find((s) => s.id === sectionId)
  if (!section) return null
  Object.assign(section, patch, { updated_at: new Date().toISOString() })
  return clone(section)
}

// ---------------------------------------------------------------------------
// W3 wiring: `?state=` previews stay on the store above, everything else is real (applications-real.ts,
// drafts-real.ts). Moves and the S-31 edit are W4's (board-real.ts).
// ---------------------------------------------------------------------------

export function listApplicationProjects(opts: ListApplicationsOptions = {}): Promise<ApplicationSummary[]> {
  return previewOr(() => mockListApplicationProjects(opts), () => realListApplicationProjects(opts))
}

export function getApplicationProject(id: string): Promise<ApplicationSummary | null> {
  return previewOr(() => mockGetApplicationProject(id), () => realGetApplicationProject(id))
}

export function createApplicationProject(input: CreateApplicationInput): Promise<ApplicationProject> {
  return previewOr(() => mockCreateApplicationProject(input), () => realCreateApplicationProject(input))
}

export function getJobDescription(applicationProjectId: string): Promise<JobDescriptionWithRequirements | null> {
  return previewOr(() => mockGetJobDescription(applicationProjectId), () => realGetJobDescription(applicationProjectId))
}

export function updateFailedJdRawText(applicationProjectId: string, rawText: string): Promise<UpdateFailedJdRawTextResult> {
  return previewOr(() => mockUpdateFailedJdRawText(applicationProjectId, rawText), () => realUpdateFailedJdRawText(applicationProjectId, rawText))
}

export function getJdRequirement(id: string): Promise<JdRequirement | null> {
  return previewOr(() => mockGetJdRequirement(id), () => realGetJdRequirement(id))
}

export function getInsightState(applicationProjectId: string): Promise<{ latest: Insight | null; generating: Insight | null }> {
  return previewOr(() => mockGetInsightState(applicationProjectId), () => realGetInsightState(applicationProjectId))
}

export function startInsight(applicationProjectId: string, opts?: { fail?: AiErrorCode | null; rate_wait?: boolean }): Promise<{ insight_id: string; job_id: string }> {
  return previewOr(() => mockStartInsight(applicationProjectId, opts), () => realStartInsight(applicationProjectId))
}

export function listDrafts(applicationProjectId: string): Promise<Draft[]> {
  return previewOr(() => mockListDrafts(applicationProjectId), () => realListDrafts(applicationProjectId))
}

export function getDraft(applicationProjectId: string, draftId: string): Promise<DraftWithSections | null> {
  return previewOr(() => mockGetDraft(applicationProjectId, draftId), () => realGetDraft(applicationProjectId, draftId))
}

export function saveDraftSection(sectionId: string, patch: DraftSectionPatch, opts?: { fail?: boolean }): Promise<DraftSection | null> {
  return previewOr(() => mockSaveDraftSection(sectionId, patch, opts), () => realSaveDraftSection(sectionId, patch))
}
