/**
 * 지원 프로젝트 data layer: application_projects, job_descriptions, jd_requirements,
 * application_stage_events, insights, drafts (+ sections/sources). Server only.
 * Board RPCs: move_application_stage / set_application_outcome (04 §2.6).
 */
import type {
  AiJobType,
  AiErrorCode,
  ApplicationProject,
  ApplicationStage,
  Draft,
  DraftSection,
  DraftSectionSource,
  Insight,
  JdRequirement,
  JdRawTextRefusalCode,
  JobDescription,
  MoveApplicationStageResult,
  StageOutcome,
} from "@/types/db"
import { clone, mockRequest } from "@/lib/mock/store"
import type { MockDb } from "@/lib/mock/fixtures"
import { newId, USER_ID } from "@/lib/mock/ids"
import { activeKey, assertAiRunnable, createMockJob } from "@/lib/mock/ai"
import { consentRequired } from "@/lib/mock/consent"
import { mockAiMeta } from "@/lib/mock/ai-meta"
import { STAGE_ORDER, composeCoverLetterName, countsAsDraft, defaultApplicationName } from "./labels"
import { resolveAiFeatureStatus, type AiFeatureStatusView } from "./ai-feature-status"
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

/** List/board/hub summary of one application project (S-13 행, S-39 카드, S-31 헤더) */
export interface ApplicationSummary extends ApplicationProject {
  job_description: Pick<JobDescription, "id" | "company_name" | "position_title" | "extraction_status"> | null
  /** 인사이트 없음 / 생성 중 / 있음 */
  insight_state: "none" | "generating" | "ready"
  /** @deprecated (v5.20, CF-A14) 화면 "서류 수" 폐기 — S-39 카드는 `listCoverLetterSlotCounts()`를 쓴다 */
  draft_count: number
  /** running async AI jobs on this project (C-03 축약형) */
  running_job_ids: string[]
  /** running AI-02 job (생성 중 incl. 재생성), else null — S-13 인사이트 칸 (A3 UQ-74) */
  insight_job_id: string | null
  /** v5.3 C-03 진행 표시 우선순위 — insight (S-13 / S-31 / S-39 / S-16): <AiFeatureStatus status={…} /> */
  insight_status: AiFeatureStatusView
}

// R17: the mock AI-01 extraction (advance / complete / fail, and the "요건 추출 먼저" step before AI
// features) is gone — the JD is used as raw text, like the real backend.

/** `advanceMock: false` = real rows (applications-real.ts): the same rules. R17: nothing to advance (no extraction). */
export function summarize(db: MockDb, ap: ApplicationProject, opts: { advanceMock: boolean } = { advanceMock: true }): ApplicationSummary {
  void opts
  const jd = db.job_descriptions.find((j) => j.application_project_id === ap.id) ?? null
  const insights = db.insights.filter((i) => i.application_project_id === ap.id)
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
    running_job_ids: db.ai_jobs
      // R17: `jd_extraction` = legacy rows only
      .filter((j) => j.application_project_id === ap.id && (j.status === "queued" || j.status === "running") && j.job_type !== "jd_extraction")
      .map((j) => j.id),
    insight_job_id:
      db.ai_jobs.find(
        (j) => j.application_project_id === ap.id && j.job_type === "insight" && (j.status === "queued" || j.status === "running"),
      )?.id ?? null,
    insight_status: insightFeatureStatus(db, ap.id),
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
 * RPC create_application_project — JD 필수·교체 불가 (U-6). R17: the JD is stored as raw text only
 * (no AI-01, no requirement preview) and creation has no AI gate ([가정 R17-9]).
 */
export interface CreateApplicationInput {
  raw_text: string
  name?: string | null
  deadline?: string | null
  /**
   * S-14 회사명·포지션명 입력란. Stored on the JD with source 'user'.
   * Name rule (R17 [가정 R17-8]): `name` → "{회사명} 자기소개서" → default "새 자기소개서 (YYYY-MM-DD)".
   */
  company_name?: string | null
  position_title?: string | null
  /** R15 (CF-10·CF-A16): ①에서 붙여넣은 공고 URL (JD에 저장). R17: the requirement preview is gone. */
  source_url?: string | null
}

/** R17: `create_application_project` returns no preview fields any more. */
export type CreateApplicationResult = ApplicationProject

async function mockCreateApplicationProject(input: CreateApplicationInput): Promise<CreateApplicationResult> {
  const company = input.company_name?.trim() || null
  const position = input.position_title?.trim() || null
  // (v5.20, CF-A7) 이름 = "{기업 명} 자기소개서" — ②에서 사용자가 확인한 값이라 `name_source = 'user'`
  const name = input.name?.trim() || composeCoverLetterName(company)
  const db = await mockRequest()
  // R17 [가정 R17-9]: registering a JD uses no AI — no key / consent gate
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
  // R17 [가정 R17-8]: no name and no company → the default "새 자기소개서 (날짜)", key or not
  if (!ap.name) {
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
    // R17: legacy column, always the default `pending`
    extraction_status: "pending",
    extraction: null,
    extraction_job_id: null,
    extraction_provider: null,
    extraction_model: null,
    tech_keywords: [],
    requirements_hash: null,
    raw_text_edited_at: null,
    // R15: 생성 RPC가 `p_source_url`을 받는다 (CF-10·CF-A16)
    source_url: input.source_url?.trim() || null,
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
      if (ap.stage === toStage) return clone({ application_project: ap })
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
      return clone({ application_project: ap })
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

/**
 * Conditions 1~5 of update_failed_jd_raw_text (04 §2.6.1), in order. null = the text may be edited.
 * R17-6: the RPC is unchanged and still reads the legacy extraction columns, so a JD created after R17
 * (`pending`) is `jd_raw_text_locked`. Mirrors the RPC only.
 */
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
  const draftIds = db.drafts.filter((d) => d.application_project_id === apId).map((d) => d.id)
  const hasResults =
    db.insights.some((i) => i.application_project_id === apId && i.status === "ready") ||
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
  // validate first (key). R17: no requirement extraction first — AI-02 reads the JD raw text (one stage-1 call)
  assertAiRunnable(db)
  const now = new Date().toISOString()
  const jd = db.job_descriptions.find((j) => j.application_project_id === applicationProjectId)
  const units = 1
  const insightId = newId()
  const job = createMockJob(db, {
    job_type: "insight",
    application_project_id: applicationProjectId,
    // OD-D9: same target as the real AI-02 job (the insight row links back via ai_job_id)
    target_type: "application_project",
    target_id: applicationProjectId,
    units,
    fail: opts?.fail,
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
    requirements_hash: null,
    // R17: the JD part of the input is its raw-text hash
    jd_text_hash: jd?.raw_text_hash ?? null,
    completed_at: null,
  })
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

export function createApplicationProject(input: CreateApplicationInput): Promise<CreateApplicationResult> {
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

/**
 * R15: 서류 reads are **연결 대기** again (mock only). The `drafts` tables are dropped
 * (CF-1·CF-M1) and the 자기소개서 정본 reads come with S-46 in a later slice; the retired
 * S-17 / S-19 screens keep working under `?state=` previews only
 * (leader decision 2026-11-09). Export names and signatures are unchanged.
 */
export function listDrafts(applicationProjectId: string): Promise<Draft[]> {
  return previewOr(() => mockListDrafts(applicationProjectId), async () => [])
}

/** 연결 대기 — see `listDrafts`. */
export function getDraft(applicationProjectId: string, draftId: string): Promise<DraftWithSections | null> {
  return previewOr(() => mockGetDraft(applicationProjectId, draftId), async () => null)
}

/** 연결 대기 — see `listDrafts`. */
export function saveDraftSection(sectionId: string, patch: DraftSectionPatch, opts?: { fail?: boolean }): Promise<DraftSection | null> {
  return previewOr(() => mockSaveDraftSection(sectionId, patch, opts), async () => null)
}
