/**
 * 지원 프로젝트 data layer: application_projects, job_descriptions, application_stage_events,
 * insights, drafts (+ sections/sources). Server only. R17 (4.24 #1): `jd_requirements` is dropped —
 * the JD is used as raw text (JR-1), and the mock store no longer keeps requirement rows.
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
  JdRawTextRefusalCode,
  JobDescription,
  InsightSkipReason,
  MoveApplicationStageResult,
  StageOutcome,
} from "@/types/db"
import { AppError } from "@/lib/contracts/errors"
import { clone, mockRequest } from "@/lib/mock/store"
import type { MockDb } from "@/lib/mock/fixtures"
import { newId, USER_ID } from "@/lib/mock/ids"
import { activeKey, assertAiRunnable, createMockJob } from "@/lib/mock/ai"
import { consentRequired } from "@/lib/mock/consent"
import { mockAiMeta } from "@/lib/mock/ai-meta"
import { STAGE_ORDER, composeCoverLetterName, countsAsDraft, defaultApplicationName } from "./labels"
import { resolveAiFeatureStatus, type AiFeatureStatusView } from "./ai-feature-status"
import { refreshApplicationJobs } from "./ai-jobs"
import { JD_RAW_TEXT_MAX } from "./jd-raw-text"
import { computeReadiness } from "./readiness"
import { previewOr } from "./source"
import { realMoveApplicationStage, realSetApplicationOutcome, realUpdateApplicationProject } from "./board-real"
import {
  realCreateApplicationProject,
  realGetApplicationProject,
  realGetInsightState,
  realGetJobDescription,
  realListApplicationProjects,
  realStartInsight,
  realUpdateJdRawText,
} from "./applications-real"

/** List/board/hub summary of one application project (S-13 행, S-39 카드, S-31 헤더) */
export interface ApplicationSummary extends ApplicationProject {
  job_description: Pick<JobDescription, "id" | "company_name" | "position_title"> | null
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

/**
 * [{ sid, text, start, end }] per line with readable text (mock of the server's sentence split for create and
 * update_jd_raw_text). Offsets are UTF-16 positions in `rawText`; a line of symbols only is no sentence, so a
 * text without any → `jd_no_sentences` (DM v4.16).
 */
function splitJdSentences(rawText: string) {
  const out: Array<{ sid: string; text: string; start: number; end: number }> = []
  let pos = 0
  for (const line of rawText.split("\n")) {
    const start = pos
    pos += line.length + 1
    if (!/[\p{L}\p{N}]/u.test(line)) continue
    out.push({ sid: `S${out.length + 1}`, text: line, start, end: start + line.length })
  }
  return out
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

/**
 * The created row + JR-6 (4.24 #10): the insight job the create action started right after the new row
 * (null when it did not — `insight_skip_reason` says why; both null on a same-id replay).
 */
export type CreateApplicationResult = ApplicationProject & {
  insight_job_id: string | null
  insight_skip_reason: InsightSkipReason | null
}

async function mockCreateApplicationProject(input: CreateApplicationInput): Promise<CreateApplicationResult> {
  const company = input.company_name?.trim() || null
  const position = input.position_title?.trim() || null
  // (v5.20, CF-A7) 이름 = "{기업 명} 자기소개서" — ②에서 사용자가 확인한 값이라 `name_source = 'user'`
  const name = input.name?.trim() || composeCoverLetterName(company)
  const sentences = splitJdSentences(input.raw_text)
  // DM v4.16 2.6: a raw text without any sentence is refused before any row is written (400)
  if (sentences.length === 0) throw new AppError("jd_no_sentences", undefined, { status: 400 })
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
    sentences,
    company_name: company,
    company_name_source: company ? "user" : null,
    position_title: position,
    position_title_source: position ? "user" : null,
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
  // JR-6 (4.24 #10): a new row may start the insight right away — same order as services/insight/auto-start.ts
  const auto = mockAutoStartInsight(db, ap.id)
  return clone({ ...ap, ...auto })
}

/**
 * Mock of the create action's insight auto-start (JR-6, DM 2.6.2): connection (no key → `ai_not_connected`,
 * invalid → `key_invalid`, consent → `consent_required`) → D-01 (`insufficient_data`) → sentences ≥ 1
 * (`no_sentences`) → no insight job in progress (`in_progress`) → the same start as the manual button.
 * Any failure of the start itself is swallowed (`start_failed`) — the creation stays a success.
 */
function mockAutoStartInsight(db: MockDb, applicationProjectId: string): { insight_job_id: string | null; insight_skip_reason: InsightSkipReason | null } {
  const skip = (reason: InsightSkipReason) => ({ insight_job_id: null, insight_skip_reason: reason })
  const key = activeKey(db)
  if (!key) return skip("ai_not_connected")
  if (key.status === "invalid") return skip("key_invalid")
  if (consentRequired(db, key.provider, key.connection_tier)) return skip("consent_required")
  if (!computeReadiness(db).features.insight.ready) return skip("insufficient_data")
  const jd = db.job_descriptions.find((j) => j.application_project_id === applicationProjectId)
  if (!jd || jd.sentences.length === 0) return skip("no_sentences")
  if (db.ai_jobs.some((j) => j.application_project_id === applicationProjectId && j.job_type === "insight" && (j.status === "queued" || j.status === "running")))
    return skip("in_progress")
  try {
    return { insight_job_id: startMockInsight(db, applicationProjectId).job_id, insight_skip_reason: null }
  } catch {
    return skip("start_failed")
  }
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
// 채용 공고 (S-15) — 공고 원문 그대로 (JR-1)
// ---------------------------------------------------------------------------

export interface JobDescriptionView extends JobDescription {
  /**
   * getJdView.rawTextEditable (04 §2.6.1, JR-7): [공고 내용 수정] is always shown, disabled while an insight
   * job is queued / running
   */
  raw_text_editable: boolean
  /** `job_in_progress` when not editable, else null */
  raw_text_locked_reason: "job_in_progress" | null
}

async function mockGetJobDescription(applicationProjectId: string): Promise<JobDescriptionView | null> {
  const db = await mockRequest()
  const jd = db.job_descriptions.find((j) => j.application_project_id === applicationProjectId)
  if (!jd) return null
  const locked = jdRawTextLockedReason(db, jd)
  return clone({
    ...jd,
    raw_text_edited_at: jd.raw_text_edited_at ?? null,
    raw_text_editable: locked === null,
    raw_text_locked_reason: locked,
  })
}

/** update_jd_raw_text condition 3 (04 §2.6.1): an insight job queued / running on this project. Mirrors the RPC only. */
function jdRawTextLockedReason(db: MockDb, jd: JobDescription): "job_in_progress" | null {
  const apId = jd.application_project_id
  refreshApplicationJobs(db, apId)
  return db.ai_jobs.some((j) => j.application_project_id === apId && j.job_type === "insight" && (j.status === "queued" || j.status === "running")) ? "job_in_progress" : null
}

export type UpdateJdRawTextResult =
  | { application_project_id: string; job_description_id: string; raw_text_edited_at: string }
  | { refused: JdRawTextRefusalCode }

/**
 * RPC update_jd_raw_text (JR-7, 04 §2.6.1): the raw text can be edited any time except while an insight
 * runs. Replaces the text and sentences; insights stay (they read "공고가 바뀌었어요"). No AI call, no tokens;
 * works without a key. name / name_source / stage / deadline don't change.
 */
async function mockUpdateJdRawText(applicationProjectId: string, rawText: string): Promise<UpdateJdRawTextResult> {
  const db = await mockRequest()
  const text = rawText.trim()
  if (!text || text.length > JD_RAW_TEXT_MAX) return { refused: "invalid_raw_text" }
  const sentences = splitJdSentences(text)
  if (sentences.length === 0) return { refused: "jd_no_sentences" }
  const jd = db.job_descriptions.find((j) => j.application_project_id === applicationProjectId)
  if (!jd) return { refused: "job_description_not_found" }
  if (jdRawTextLockedReason(db, jd)) return { refused: "jd_job_in_progress" }
  if (text === jd.raw_text.trim()) return { refused: "jd_raw_text_unchanged" }
  const now = new Date().toISOString()
  Object.assign(jd, {
    raw_text: text,
    raw_text_hash: `hash-${jd.id}-${now}`,
    sentences,
    raw_text_edited_at: now,
    updated_at: now,
  })
  const ap = db.application_projects.find((a) => a.id === applicationProjectId)
  if (ap) ap.last_activity_at = now
  return { application_project_id: applicationProjectId, job_description_id: jd.id, raw_text_edited_at: now }
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
  return startMockInsight(db, applicationProjectId, opts)
}

/** The manual start and the create auto-start share this (JR-6: "수동 시작과 같은 서비스") */
function startMockInsight(
  db: MockDb,
  applicationProjectId: string,
  opts?: { fail?: AiErrorCode | null; rate_wait?: boolean },
): { insight_id: string; job_id: string } {
  // validate first (key). R17: no requirement extraction first — AI-02 reads the JD raw text (one stage-1 call)
  assertAiRunnable(db)
  const now = new Date().toISOString()
  const jd = db.job_descriptions.find((j) => j.application_project_id === applicationProjectId)
  // DM 2.7.0 begin_insight: a JD without sentences is refused before a job is made (409)
  if (!jd || jd.sentences.length === 0) throw new AppError("jd_no_sentences", undefined, { status: 409 })
  // (v5.21, JR-Q2 보류) stage 1 is one call — no batch units
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
    // DM 2.7.0: the JD raw-text hash the run reads (prepare)
    raw_text_hash: jd?.raw_text_hash ?? null,
    schema_version: null,
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

export function getJobDescription(applicationProjectId: string): Promise<JobDescriptionView | null> {
  return previewOr(() => mockGetJobDescription(applicationProjectId), () => realGetJobDescription(applicationProjectId))
}

/** RPC update_jd_raw_text (JR-7) — the same contract as before (R17b-api-8 kept the old name; renamed in the UI run 60) */
export function updateJdRawText(applicationProjectId: string, rawText: string): Promise<UpdateJdRawTextResult> {
  return previewOr(() => mockUpdateJdRawText(applicationProjectId, rawText), () => realUpdateJdRawText(applicationProjectId, rawText))
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
