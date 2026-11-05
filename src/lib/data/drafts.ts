/**
 * 서류 초안 data layer (server only): C-11 source tree, AI-11 ranking, draft / cover-letter
 * question CRUD, AI-03 / AI-04 generation (prepare → stream → finalize), source changes,
 * first copy, JD extraction retry. Moved from app/(dashboard)/applications/_lib/data.ts
 * (Phase 3); names and shapes kept.
 *
 * Server-side guards (A3 UQ-84 (a)): prepare* re-checks data readiness (D-01, readiness key
 * `draft`) and the monthly `draft` limit, because generation can also start from a URL
 * (`?generate=`). Refused → returns null (the screen stops; nothing is reserved).
 * Identical-input reuse (input_hash) is not simulated — see the A0 report.
 */
import type { GenerationNotesPayload, StreamSource } from "@/lib/mock/ai-stream"
import type {
  AiErrorCode,
  AiProviderName,
  Draft,
  DraftBlock,
  DraftBlockFlag,
  DraftOptions,
  DraftSection,
  DraftSectionSource,
  EvidenceLink,
  PlaceholderToken,
} from "@/types/db"
import { clone, mockRequest } from "@/lib/mock/store"
import type { MockDb } from "@/lib/mock/fixtures"
import { newId, USER_ID } from "@/lib/mock/ids"
import { activeKey, assertAiRunnable, createMockJob, MockAiError, mockSyncCall, recordMockUsage } from "@/lib/mock/ai"
import { consentRequired } from "@/lib/mock/consent"
import { errorCategoryOf, failureCauseOf, failureTimestamps, type AiRejected } from "./ai-errors"
import { mockAiMeta } from "@/lib/mock/ai-meta"
import { formatPeriod } from "./labels"
import { educationDisplayName } from "@/server/services/career/education-name"
import { computeReadiness } from "./readiness"
import { realRetryJdExtraction } from "./applications-real"
import {
  realAddCoverLetterQuestion,
  realCareerDescriptionStreamPlan,
  realCoverLetterStreamPlan,
  realCreateCareerDescriptionDraft,
  realCreateCoverLetterDraft,
  realDeleteDraftSection,
  realFinalizeCareerDescription,
  realFinalizeCoverLetterSection,
  realGetCareerSourceTree,
  realMarkDraftCopied,
  realRankDraftSources,
  realSetSectionSources,
  type RealStreamPlan,
} from "./drafts-real"
import { previewOr } from "./source"

const now = () => new Date().toISOString()

/** AI output meta of the active runner (v4: provider / model / tiers on drafts and sections) */
const AI_META = mockAiMeta(null)

/** provider / model / tiers of the key that ran a generation (A3 request 3: per-question result badge) */
function runnerMeta(db: MockDb) {
  const key = activeKey(db)
  if (!key) return {}
  const m = mockAiMeta(null, { provider: key.provider, connection_tier: key.connection_tier })
  return { provider: m.provider, model: m.model, model_tier: m.model_tier, connection_tier: m.connection_tier }
}

// ---------------------------------------------------------------------------
// C-11 source tree: complete experiences / educations / projects / details only
// (pack inclusion rule 04 §2.2: drafts and children of draft parents are excluded)
// ---------------------------------------------------------------------------

export interface SourceTreeDetail {
  id: string
  title: string
}

export interface SourceTreeProject {
  id: string
  name: string
  role: string | null
  period: string
  start_month: string | null
  experience_id: string | null
  education_id: string | null
  details: SourceTreeDetail[]
}

export interface SourceTreeAffiliation {
  kind: "experience" | "education"
  id: string
  /** 회사명 또는 기관명 */
  name: string
  meta: string
  start_month: string | null
  projects: SourceTreeProject[]
}

export interface SourceTree {
  affiliations: SourceTreeAffiliation[]
  /** 독립 프로젝트 (소속 없음) */
  standalone: SourceTreeProject[]
  /** id → "회사명 또는 기관명 › 프로젝트명" */
  project_labels: Record<string, string>
  detail_labels: Record<string, string>
}

export function buildSourceTree(db: Pick<MockDb, "experiences" | "educations" | "projects" | "project_details">): SourceTree {
  const exps = db.experiences.filter((e) => e.status === "complete")
  const edus = db.educations.filter((e) => e.status === "complete")
  const toProject = (p: MockDb["projects"][number]): SourceTreeProject => ({
    id: p.id,
    name: p.name ?? "이름 없는 프로젝트",
    role: p.role,
    period: formatPeriod(p.start_month, p.end_month, "진행 중"),
    start_month: p.start_month,
    experience_id: p.experience_id,
    education_id: p.education_id,
    details: db.project_details
      .filter((d) => d.project_id === p.id && d.status === "complete")
      .sort((a, b) => a.sort_order - b.sort_order)
      .map((d) => ({ id: d.id, title: d.title ?? "제목 없는 상세 내용" })),
  })
  const byStart = <T extends { start_month: string | null }>(a: T, b: T) => (b.start_month ?? "").localeCompare(a.start_month ?? "")
  const complete = db.projects.filter((p) => p.status === "complete")
  const affiliations: SourceTreeAffiliation[] = [
    ...exps.map((e) => ({
      kind: "experience" as const,
      id: e.id,
      name: e.company_name ?? "",
      meta: [e.job_position, formatPeriod(e.start_month, e.end_month, e.is_current ? "재직 중" : "")].filter(Boolean).join(" · "),
      start_month: e.start_month,
      projects: complete.filter((p) => p.experience_id === e.id).map(toProject).sort(byStart),
    })),
    ...edus.map((e) => ({
      kind: "education" as const,
      id: e.id,
      // UI32-2: name = trimmed program_name, else institution_name; meta then shows the institution when the name is the program
      name: educationDisplayName(e.program_name, e.institution_name) ?? "",
      meta: [e.program_name?.trim() ? e.institution_name?.trim() : null, formatPeriod(e.start_month, e.end_month, "재학 중")].filter(Boolean).join(" · "),
      start_month: e.start_month,
      projects: complete.filter((p) => p.education_id === e.id).map(toProject).sort(byStart),
    })),
  ]
  // 경력(최신순) → 교육(최신순) (AI-03 섹션 순서 [가정])
  affiliations.sort((a, b) => (a.kind === b.kind ? byStart(a, b) : a.kind === "experience" ? -1 : 1))
  const standalone = complete.filter((p) => !p.experience_id && !p.education_id).map(toProject).sort(byStart)
  const project_labels: Record<string, string> = {}
  const detail_labels: Record<string, string> = {}
  for (const a of affiliations)
    for (const p of a.projects) {
      project_labels[p.id] = `${a.name} › ${p.name}`
      for (const d of p.details) detail_labels[d.id] = d.title
    }
  for (const p of standalone) {
    project_labels[p.id] = p.name
    for (const d of p.details) detail_labels[d.id] = d.title
  }
  return { affiliations, standalone, project_labels, detail_labels }
}

async function mockGetCareerSourceTree(): Promise<SourceTree> {
  const db = await mockRequest()
  return clone(buildSourceTree(db))
}

function allProjects(tree: SourceTree): SourceTreeProject[] {
  return [...tree.affiliations.flatMap((a) => a.projects), ...tree.standalone]
}

/** included_experience_ids / included_education_ids derive from the included projects (AI-11) */
export function deriveAffiliations(tree: SourceTree, projectIds: string[]): Pick<DraftOptions, "included_experience_ids" | "included_education_ids"> {
  const picked = allProjects(tree).filter((p) => projectIds.includes(p.id))
  return {
    included_experience_ids: [...new Set(picked.map((p) => p.experience_id).filter((x): x is string => !!x))],
    included_education_ids: [...new Set(picked.map((p) => p.education_id).filter((x): x is string => !!x))],
  }
}

// ---------------------------------------------------------------------------
// AI-11 경력기술서 기본 선택 (sync, 무차감). Fails silently → latest-first (handled by caller).
// ---------------------------------------------------------------------------

async function mockRankDraftSources(
  applicationProjectId: string,
  opts?: { fail?: boolean },
): Promise<{ project_ids: string[]; ranking: Array<{ project_id: string; relevance: "high" | "medium" | "low"; include: boolean }> }> {
  const db = await mockRequest()
  assertAiRunnable(db, "request") // AI-11 (path ⑤): key first (MockAiError key_missing / key_invalid)
  const tree = buildSourceTree(db)
  const projects = allProjects(tree).sort((a, b) => (b.start_month ?? "").localeCompare(a.start_month ?? ""))
  void applicationProjectId
  const ranking = projects.map((p, i) => ({
    project_id: p.id,
    relevance: (i < 2 ? "high" : i < 4 ? "medium" : "low") as "high" | "medium" | "low",
    include: i < 8 && i < 4,
  }))
  const result = { project_ids: ranking.filter((r) => r.include).map((r) => r.project_id), ranking }
  return mockSyncCall(result, { ms: 1_800, fail: opts?.fail ? "provider_unavailable" : undefined })
}

export { MockAiError }

// ---------------------------------------------------------------------------
// drafts: create
// ---------------------------------------------------------------------------

function touchApplication(db: MockDb, applicationProjectId: string) {
  const ap = db.application_projects.find((a) => a.id === applicationProjectId)
  if (ap) ap.last_activity_at = now()
}

function newSection(draftId: string, sort: number, patch: Partial<DraftSection> & Pick<DraftSection, "section_kind">): DraftSection {
  const t = now()
  return {
    id: newId(),
    user_id: USER_ID,
    created_at: t,
    updated_at: t,
    draft_id: draftId,
    sort_order: sort,
    experience_id: null,
    education_id: null,
    heading: null,
    question_text: null,
    template_key: null,
    char_limit: null,
    count_basis: null,
    user_note: null,
    source_selection_mode: "ai",
    sources_modified_at: null,
    generation_no: 0,
    question_class: null,
    status: "pending",
    ai_content: null,
    edited_content: null,
    ai_char_count: null,
    correction_applied: false,
    ...AI_META,
    ...patch,
  }
}

function newDraft(applicationProjectId: string, patch: Pick<Draft, "draft_type" | "title" | "status" | "options"> & Partial<Draft>): Draft {
  const t = now()
  return {
    id: newId(),
    user_id: USER_ID,
    created_at: t,
    updated_at: t,
    ...AI_META,
    application_project_id: applicationProjectId,
    insight_id: null,
    edited_at: null,
    first_copied_at: null,
    regenerated_from_id: null,
    completed_at: null,
    ...patch,
  }
}

/**
 * S-17 → S-19. Sections are written when generation starts (prepareCareerDescription).
 * begin_career_description (Q53-7, 04 §2.7.1): the application's `composing` career description (첫 생성
 * 중단) goes away in the same step — one per application.
 */
async function mockCreateCareerDescriptionDraft(
  applicationProjectId: string,
  options: DraftOptions,
  regeneratedFromId: string | null = null,
): Promise<Draft> {
  const db = await mockRequest()
  db.drafts = db.drafts.filter(
    (d) => !(d.application_project_id === applicationProjectId && d.draft_type === "career_description" && d.status === "composing"),
  )
  const insight = db.insights.find((i) => i.application_project_id === applicationProjectId && i.is_latest && i.status === "ready")
  const draft = newDraft(applicationProjectId, {
    draft_type: "career_description",
    title: "경력기술서",
    status: "generating",
    options,
    insight_id: options.selection_origin === "insight" ? (insight?.id ?? null) : null,
    regenerated_from_id: regeneratedFromId,
  })
  db.drafts.push(draft)
  touchApplication(db, applicationProjectId)
  return clone(draft)
}

/** 기본 3문항 시드 (AI 없이, AI-04 트리거). // [UI-가정] 기본 글자 수 800 / 1000 / 600, 공백 포함 */
const COVER_LETTER_SEED: Array<Pick<DraftSection, "template_key" | "question_class" | "question_text" | "char_limit" | "count_basis">> = [
  { template_key: "motivation", question_class: "motivation", question_text: "지원 동기를 작성해 주세요.", char_limit: 800, count_basis: "with_spaces" },
  { template_key: "job_competency", question_class: "job_competency", question_text: "직무 역량을 보여 줄 수 있는 경험을 작성해 주세요.", char_limit: 1000, count_basis: "with_spaces" },
  { template_key: "future_plan", question_class: "future_plan", question_text: "입사 후 포부 및 성장 계획을 작성해 주세요.", char_limit: 600, count_basis: "with_spaces" },
]

async function mockCreateCoverLetterDraft(applicationProjectId: string): Promise<Draft> {
  const db = await mockRequest()
  const draft = newDraft(applicationProjectId, { draft_type: "cover_letter", title: "자소서 문항 답변", status: "composing", options: {} })
  db.drafts.push(draft)
  COVER_LETTER_SEED.forEach((seed, i) => {
    db.draft_sections.push(newSection(draft.id, i + 1, { section_kind: "cover_letter_question", ...seed }))
  })
  touchApplication(db, applicationProjectId)
  return clone(draft)
}

async function mockAddCoverLetterQuestion(draftId: string): Promise<DraftSection | null> {
  const db = await mockRequest()
  const draft = db.drafts.find((d) => d.id === draftId)
  if (!draft) return null
  const sort = db.draft_sections.filter((s) => s.draft_id === draftId).reduce((m, s) => Math.max(m, s.sort_order), 0) + 1
  // 사용자 추가 문항: template_key = null
  const section = newSection(draftId, sort, { section_kind: "cover_letter_question", question_text: "", char_limit: 1000, count_basis: "with_spaces" })
  db.draft_sections.push(section)
  return clone(section)
}

/** 최소 1문항 (F-DOC-02) */
async function mockDeleteDraftSection(draftId: string, sectionId: string): Promise<boolean> {
  const db = await mockRequest()
  const sections = db.draft_sections.filter((s) => s.draft_id === draftId)
  if (sections.length <= 1 || !sections.some((s) => s.id === sectionId)) return false
  db.draft_sections = db.draft_sections.filter((s) => s.id !== sectionId)
  db.draft_section_sources = db.draft_section_sources.filter((s) => s.draft_section_id !== sectionId)
  db.evidence_links = db.evidence_links.filter((e) => !(e.owner_type === "draft_section" && e.owner_id === sectionId))
  return true
}

/**
 * A3 UQ-84 (a) server-side check before any generation (v4): data readiness (D-01) and an
 * active key that is not invalid (C-18 / C-20 key_invalid). No service limit (D-34).
 */
function generationAllowed(db: MockDb): boolean {
  if (!computeReadiness(db).features.draft.ready) return false
  const key = activeKey(db)
  // v4.2 path ⑤: consent needed folds into key_missing (the screen re-reads readiness → C-21)
  return Boolean(key && key.status !== "invalid" && !consentRequired(db, key.provider, key.connection_tier))
}

/** Usage meter rows for a finished generation (C-13: recorded on success and failure) */
function recordDraftUsage(db: MockDb, kind: "career_description" | "cover_letter", applicationProjectId: string, ok: boolean) {
  const key = activeKey(db)
  if (!key) return
  recordMockUsage(db, {
    job_type: kind,
    ai_job_id: null,
    application_project_id: applicationProjectId,
    provider: key.provider,
    connection_tier: key.connection_tier,
    outcome: ok ? "succeeded" : "failed",
    error_code: ok ? null : "provider_unavailable",
  })
}

// ---------------------------------------------------------------------------
// Generation plans (AI-03 / AI-04 mock).
//
// Contract (kept when this file moves to lib/data, A3 UQ-61/62):
//   prepare*(id)  → reserves usage, marks the target `generating`, computes the output and keeps
//                   it as a server-side plan. It does NOT touch the stored content yet.
//   client streams plan.blocks (later: the SSE Route Handler streams model output)
//   finalize*(id, generation_id, { ok, completed_block_ids })
//                 → ok: overwrite with the new output, charge usage
//                 → not ok (error / 중단): keep the previous content; on a first generation keep only
//                   the blocks the user already received (AI-03 "완료된 블록은 보존"); release usage
//   settleAbandonedGeneration(draftId) → plans older than 20s are finished by the "server"
//                   (C-04 "이탈 시 서버가 끝까지 생성·저장" [가정])
// ---------------------------------------------------------------------------

interface PlannedEvidence {
  owner_id: string
  item_key: string
  source: Pick<EvidenceLink, "source_type" | "source_id" | "source_field" | "quote" | "source_label">
}

interface GenerationPlan {
  generation_id: string
  kind: "career_description" | "cover_letter"
  /** draft id (경력기술서) or draft section id (자소서 문항) */
  target_id: string
  draft_id: string
  application_project_id: string
  started_at: number
  /** 경력기술서: planned sections with full ai_content */
  sections: DraftSection[]
  /** 자소서: planned paragraphs */
  blocks: DraftBlock[]
  /** 자소서 AI 선택 모드: new source rows (null = keep the user's list) */
  sources: DraftSectionSource[] | null
  evidence: PlannedEvidence[]
  /** status before prepare (restored when a regenerate fails) */
  previous_status: DraftSection["status"] | Draft["status"]
  /** v5.3 (A3 request 4): S-19 생성 직후 안내 sent with `validated` (not stored, A21) */
  notes?: GenerationNotesPayload
  /** v5.3: cover letter `adjusting_length` payload + whether the answer stays outside 90–110 % */
  adjust_length?: { current_chars: number; char_limit: number }
  char_adjust_needed?: boolean
}

/** Result the client reports when its stream ends */
export interface GenerationResult {
  ok: boolean
  /** block ids that reached `block_completed` (kept on failure / 중단) */
  completed_block_ids: string[]
  /** v5.3 (A3 request 7): the user stopped it — not a failure (no "생성 실패" row) */
  canceled?: boolean
  /** v5.3: the stream error (stored on a career_description ai_jobs row so a reload shows C-20) */
  error_code?: AiErrorCode | null
  retry_after?: string | null
  quota_resets_at?: string | null
}

const PLANS_KEY = "__resumateA3GenerationPlans" as const
function plans(): Map<string, GenerationPlan> {
  const g = globalThis as typeof globalThis & { [PLANS_KEY]?: Map<string, GenerationPlan> }
  if (!g[PLANS_KEY]) g[PLANS_KEY] = new Map()
  return g[PLANS_KEY]
}

function writeEvidence(db: MockDb, applicationProjectId: string, list: PlannedEvidence[]) {
  const t = now()
  for (const e of list)
    db.evidence_links.push({
      id: newId(),
      user_id: USER_ID,
      created_at: t,
      updated_at: t,
      application_project_id: applicationProjectId,
      owner_type: "draft_section",
      owner_id: e.owner_id,
      item_key: e.item_key,
      sort_order: db.evidence_links.filter((x) => x.owner_id === e.owner_id).length + 1,
      source_locator: null,
      quote_adjusted: false,
      source_snapshot_at: t,
      source_deleted_at: null,
      ...e.source,
    })
}

function clearEvidence(db: MockDb, ownerIds: string[]) {
  db.evidence_links = db.evidence_links.filter((e) => !(e.owner_type === "draft_section" && ownerIds.includes(e.owner_id)))
}

function clip(text: string | null | undefined, max = 60): string {
  if (!text) return ""
  const first = text.split(/(?<=[.다요])\s/)[0] ?? text
  return first.length > max ? `${first.slice(0, max)}…` : first
}

function block(
  block_id: string,
  block_kind: DraftBlock["block_kind"],
  text: string,
  extra: { project_id?: string | null; flags?: DraftBlockFlag[]; placeholders?: Array<{ token: PlaceholderToken; hint: string }> } = {},
): DraftBlock {
  return {
    block_id,
    block_kind,
    project_id: extra.project_id ?? null,
    text,
    requirement_ids: [],
    placeholders: extra.placeholders ?? [],
    flags: extra.flags ?? [],
    generated_by: "ai",
    user_modified: false,
  }
}

/** Block spec the client streams */
export interface StreamPlanBlock {
  block_id: string
  text: string
  flags: DraftBlockFlag[]
  evidence_count: number
}

function toStream(blocks: DraftBlock[], evidence: PlannedEvidence[]): StreamPlanBlock[] {
  return blocks.map((b) => ({
    block_id: b.block_id,
    text: b.text,
    flags: b.flags,
    evidence_count: evidence.filter((e) => e.item_key === b.block_id).length,
  }))
}

function recomputeDraftStatus(db: MockDb, draft: Draft) {
  const sections = db.draft_sections.filter((s) => s.draft_id === draft.id)
  draft.status = sections.some((s) => s.status === "generating")
    ? "generating"
    : sections.some((s) => s.status === "failed")
      ? sections.some((s) => s.status === "ready")
        ? "partially_failed"
        : "failed"
      : sections.length > 0 && sections.every((s) => s.status === "ready")
        ? "ready"
        : "composing"
  draft.updated_at = now()
}

// ---------------------------------------------------------------------------
// AI-03 경력기술서
// ---------------------------------------------------------------------------

/** Plan a career description for the draft's options. Returns null if the draft is missing. */
export interface CareerDescriptionPlan {
  generation_id: string
  blocks: StreamPlanBlock[]
  provider: AiProviderName | null
  /** v5.3: pass to `stream.start({ notes })` → arrives with `validated` */
  notes?: GenerationNotesPayload
}

async function mockPrepareCareerDescription(draftId: string): Promise<CareerDescriptionPlan | null> {
  const db = await mockRequest()
  const draft = db.drafts.find((d) => d.id === draftId && d.draft_type === "career_description")
  if (!draft) return null
  if (!generationAllowed(db)) return null
  // v5.3 A13: no requirement extraction inside the generation request — the screen runs it first
  const tree = buildSourceTree(db)
  const includedSet = new Set(draft.options.included_project_ids ?? draft.options.project_order ?? [])
  const evidence: PlannedEvidence[] = []
  const sections: DraftSection[] = []
  let sort = 1
  let n = 0

  const projectBlocks = (sectionId: string, p: SourceTreeProject, k: number): DraftBlock[] => {
    const row = db.projects.find((x) => x.id === p.id)
    const out: DraftBlock[] = [
      block(`p${k}-r`, "role_line", [p.name, row?.role, row?.team_size ? `${row.team_size}인 팀` : null].filter(Boolean).join(" · "), { project_id: p.id }),
    ]
    evidence.push({ owner_id: sectionId, item_key: `p${k}-r`, source: { source_type: "project", source_id: p.id, source_field: "role", quote: null, source_label: p.name } })
    const details = db.project_details.filter((d) => d.project_id === p.id && d.status === "complete").slice(0, 2)
    details.forEach((d, j) => {
      const hasNumber = /\d/.test(d.result ?? "")
      const text = hasNumber ? `${clip(d.action, 40)} → ${clip(d.result, 40)}` : `${clip(d.action, 50)}으로 처리 시간 [수치 입력 필요] 단축`
      const id = `p${k}-b${j + 1}`
      out.push(
        block(id, "bullet", text, {
          project_id: p.id,
          flags: hasNumber ? [] : ["number_check_needed"],
          placeholders: hasNumber ? [] : [{ token: "[수치 입력 필요]", hint: `${d.title ?? "이 상세 내용"}의 개선 전후 값` }],
        }),
      )
      evidence.push({ owner_id: sectionId, item_key: id, source: { source_type: "project_detail", source_id: d.id, source_field: "action", quote: clip(d.action, 80) || null, source_label: d.title } })
    })
    return out
  }

  for (const a of tree.affiliations) {
    const projects = a.projects.filter((p) => includedSet.has(p.id))
    if (projects.length === 0) continue
    const id = newId()
    const blocks: DraftBlock[] = []
    if (a.kind === "experience") {
      const exp = db.experiences.find((e) => e.id === a.id)
      blocks.push(block(`e${++n}-s`, "summary", clip(exp?.summary, 70) || `${a.name} 업무 담당`))
      evidence.push({ owner_id: id, item_key: `e${n}-s`, source: { source_type: "experience", source_id: a.id, source_field: "summary", quote: clip(exp?.summary, 80) || null, source_label: a.name } })
    }
    for (const p of projects) blocks.push(...projectBlocks(id, p, ++n))
    sections.push(
      newSection(draftId, sort++, {
        id,
        section_kind: a.kind,
        experience_id: a.kind === "experience" ? a.id : null,
        education_id: a.kind === "education" ? a.id : null,
        // 머리글은 서버가 데이터로 채운다 (AI-03)
        heading: [a.name, a.meta].filter(Boolean).join(" · "),
        status: "ready",
        generation_no: 1,
        ai_content: { blocks },
      }),
    )
  }
  const standalone = tree.standalone.filter((p) => includedSet.has(p.id))
  if (standalone.length) {
    const id = newId()
    const blocks = standalone.flatMap((p) => projectBlocks(id, p, ++n))
    sections.push(newSection(draftId, sort++, { id, section_kind: "standalone_projects", heading: "개인·사이드 프로젝트", status: "ready", generation_no: 1, ai_content: { blocks } }))
  }

  // v5.3 S-19 생성 직후 안내 (A21, mock): items left out + placeholder count. [UI-가정] "항목 — 이유"
  const omitted = allProjects(tree)
    .filter((p) => !includedSet.has(p.id))
    .slice(0, 3)
    .map((p) => `${p.name} — 포함할 항목에서 빠져 이번 초안에 넣지 않았어요`)
  const placeholderCount = sections.flatMap((s) => s.ai_content?.blocks ?? []).filter((b) => b.placeholders.length > 0).length
  const notes: GenerationNotesPayload = {
    ...(omitted.length ? { omitted } : {}),
    ...(placeholderCount ? { notes_for_user: [`근거에 없는 숫자는 [수치 입력 필요]로 남겼어요. ${placeholderCount}곳을 확인해 주세요`] } : {}),
  }
  const plan: GenerationPlan = {
    generation_id: newId(),
    kind: "career_description",
    target_id: draftId,
    draft_id: draftId,
    application_project_id: draft.application_project_id,
    started_at: Date.now(),
    sections,
    blocks: [],
    sources: null,
    evidence,
    // UQ-512: a brand-new draft is "generating" before prepare → cancel returns it to composing
    previous_status: draft.status === "generating" || draft.status === "failed" ? "composing" : draft.status,
    notes: Object.keys(notes).length ? notes : undefined,
  }
  plans().set(plan.generation_id, plan)
  draft.status = "generating"
  draft.updated_at = now()
  return clone({
    generation_id: plan.generation_id,
    blocks: sections.flatMap((s) => toStream(s.ai_content?.blocks ?? [], evidence)),
    // the provider this generation runs on → copied into stream error events (UQ-239)
    provider: activeKey(db)?.provider ?? null,
    notes: plan.notes,
  })
}

/** Where the screen goes after a stopped career description (Q53-7) */
export type CareerDescriptionStopped =
  | { stopped: "regeneration"; back_to_draft_id: string }
  | { stopped: "first_generation" }

/**
 * Apply (ok) or settle (failure / 중단) a career description generation.
 * Q53-7 (04 §2.7.1): 중단 is not a failure and leaves no block. 다시 생성 → the new row is deleted, the
 * previous draft stands as it was. 첫 생성 → `composing`, options kept for the S-17 settings. A
 * `validated` that arrived first counts as complete (the caller then sends ok).
 */
async function mockFinalizeCareerDescription(draftId: string, generationId: string, result: GenerationResult): Promise<CareerDescriptionStopped | null> {
  const db = await mockRequest()
  const plan = plans().get(generationId)
  const draft = db.drafts.find((d) => d.id === draftId)
  if (!plan || plan.target_id !== draftId || !draft) return null
  plans().delete(generationId)
  if (result.canceled && !result.ok) {
    const t = now()
    touchApplication(db, draft.application_project_id)
    // 04 §2.7.1 Q53-7: 쓴 토큰의 사용 기록은 남는다 (the mock's usage model has no third outcome)
    recordDraftUsage(db, plan.kind, plan.application_project_id, false)
    if (draft.regenerated_from_id) {
      db.drafts = db.drafts.filter((d) => d.id !== draft.id)
      return { stopped: "regeneration", back_to_draft_id: draft.regenerated_from_id }
    }
    Object.assign(draft, { status: "composing", ai_job_id: null, provider: null, model: null, model_tier: null, connection_tier: null, prompt_version: null, updated_at: t })
    return { stopped: "first_generation" }
  }
  // v5.3 A4: a failed career description keeps **no** block (blocks are confirmed only by
  // `validated`); retry makes a new draft
  const keep = new Set(result.ok ? plan.sections.flatMap((s) => (s.ai_content?.blocks ?? []).map((b) => b.block_id)) : [])
  const written = plan.sections
    .map((s) => ({ ...s, ai_content: { blocks: (s.ai_content?.blocks ?? []).filter((b) => keep.has(b.block_id)) } }))
    .filter((s) => s.ai_content.blocks.length > 0)
  if (written.length > 0) {
    const oldIds = db.draft_sections.filter((s) => s.draft_id === draftId).map((s) => s.id)
    db.draft_sections = db.draft_sections.filter((s) => s.draft_id !== draftId)
    clearEvidence(db, oldIds)
    db.draft_sections.push(...written)
    writeEvidence(db, draft.application_project_id, plan.evidence.filter((e) => keep.has(e.item_key)))
  }
  const hasSections = db.draft_sections.some((s) => s.draft_id === draftId)
  const previous = plan.previous_status === "generating" ? "composing" : (plan.previous_status as Draft["status"])
  draft.status = result.ok ? "ready" : hasSections ? previous : "failed"
  if (result.ok) Object.assign(draft, runnerMeta(db), { completed_at: now() })
  if (!result.ok) {
    // failed generation → career_description ai_jobs row (target_type 'draft') for C-20 on reload
    const key = activeKey(db)
    const code: AiErrorCode = result.error_code ?? "provider_unavailable"
    const t = now()
    const jobId = newId()
    db.ai_jobs.push({
      id: jobId,
      user_id: USER_ID,
      created_at: t,
      updated_at: t,
      job_type: "career_description",
      application_project_id: draft.application_project_id,
      target_type: "draft",
      target_id: draftId,
      status: "failed",
      progress: { stage: "generate" },
      params: null,
      provider: key?.provider ?? "gemini",
      model_tier: "default",
      connection_tier: key?.connection_tier ?? null,
      retry_count: 0,
      next_run_at: null,
      retry_wait_total_ms: 0,
      error_code: code,
      error_category: errorCategoryOf(code),
      failure_cause: failureCauseOf(code),
      ...failureTimestamps(code),
      ...(result.retry_after !== undefined ? { retry_after: result.retry_after } : {}),
      ...(result.quota_resets_at !== undefined ? { quota_resets_at: result.quota_resets_at } : {}),
      input_hash: null,
      prompt_version: "mock.v1",
      model: runnerMeta(db).model ?? null,
      usage: null,
      output: null,
      step_outputs: {},
      run_generation: 1,
      heartbeat_at: t,
      cancel_requested_at: null,
      started_at: t,
      finished_at: t,
    })
    draft.ai_job_id = jobId
  }
  draft.updated_at = now()
  recordDraftUsage(db, plan.kind, plan.application_project_id, result.ok)
  return null
}

// ---------------------------------------------------------------------------
// AI-04 자소서 문항 (근거 선택 먼저 → 문단)
// ---------------------------------------------------------------------------

export interface CoverLetterSectionPlan {
  generation_id: string
  sources: StreamSource[]
  blocks: StreamPlanBlock[]
  provider: AiProviderName | null
  /** v5.3: pass to `stream.start({ adjustLength, notes })` */
  adjust_length?: { current_chars: number; char_limit: number }
  notes?: GenerationNotesPayload
}

async function mockPrepareCoverLetterSection(sectionId: string): Promise<CoverLetterSectionPlan | null> {
  const db = await mockRequest()
  const section = db.draft_sections.find((s) => s.id === sectionId && s.section_kind === "cover_letter_question")
  if (!section) return null
  const draft = db.drafts.find((d) => d.id === section.draft_id)
  if (!draft) return null
  if (!generationAllowed(db)) return null
  // v5.3 A13: requirements are extracted by the screen beforehand (not in this request)
  const tree = buildSourceTree(db)
  const projects = allProjects(tree)

  let rows = db.draft_section_sources.filter((s) => s.draft_section_id === sectionId)
  let plannedSources: DraftSectionSource[] | null = null
  if (section.source_selection_mode === "ai") {
    // AI picks: avoid primary projects used by other questions (F-DOC-08 (3))
    const otherSections = db.draft_sections.filter((s) => s.draft_id === draft.id && s.id !== sectionId).map((s) => s.id)
    const usedElsewhere = new Set(db.draft_section_sources.filter((s) => otherSections.includes(s.draft_section_id) && s.role === "primary").map((s) => s.project_id))
    // [UI-가정] mock picks one primary project per question (AI-04 allows 0~2)
    const candidates = projects.filter((p) => !usedElsewhere.has(p.id))
    const picks = (candidates.length ? candidates : projects).slice(0, 1)
    const reused = candidates.length === 0
    plannedSources = picks.map((p, i) => ({
      id: newId(),
      user_id: USER_ID,
      created_at: now(),
      updated_at: now(),
      draft_section_id: sectionId,
      application_project_id: draft.application_project_id,
      experience_id: p.experience_id,
      education_id: p.education_id,
      project_id: p.id,
      project_detail_ids: p.details.slice(0, 1).map((d) => d.id),
      role: i === 0 ? "primary" : "supporting",
      origin: "ai",
      rationale: "문항 의도와 가장 직접 연결되고 본인 행동·결과가 정리돼 있어요.",
      reuse_reason: reused ? "다른 문항과 겹치지 않는 더 맞는 프로젝트가 없어요." : null,
      requirement_ids: [],
      sort_order: i + 1,
      source_label: `${tree.project_labels[p.id] ?? p.name}${p.details[0] ? ` › ${p.details[0].title}` : ""}`,
      source_deleted_at: null,
    }))
    rows = plannedSources
  }

  const primary = rows.find((r) => !r.source_deleted_at) ?? null
  const detailId = primary?.project_detail_ids[0] ?? null
  const detail = detailId ? db.project_details.find((d) => d.id === detailId) : null
  const project = primary?.project_id ? db.projects.find((p) => p.id === primary.project_id) : null

  const paragraphs: DraftBlock[] = []
  const evidence: PlannedEvidence[] = []
  const pid = `s${section.sort_order}`
  const lead =
    section.template_key === "motivation"
      ? `${section.user_note ? clip(section.user_note, 60) : "[지원 동기 입력 필요]"} 이 마음이 이번 지원의 출발점입니다.`
      : section.template_key === "future_plan"
        ? "입사 후에는 지금까지 쌓은 경험을 바탕으로 팀의 핵심 업무에 빠르게 기여하겠습니다. [계획 입력 필요]"
        : "저는 문제를 측정하고 구조를 바꿔 결과를 만드는 데 강점이 있습니다."
  paragraphs.push(
    block(`${pid}-p1`, "paragraph", lead, {
      placeholders: lead.includes("[지원 동기 입력 필요]")
        ? [{ token: "[지원 동기 입력 필요]", hint: "이 회사·직무를 고른 개인적인 이유" }]
        : lead.includes("[계획 입력 필요]")
          ? [{ token: "[계획 입력 필요]", hint: "입사 후 1년 안의 구체 목표나 학습 계획" }]
          : [],
    }),
  )
  if (detail && project) {
    const hasNumber = /\d/.test(detail.result ?? "")
    const text = `${project.name}에서 ${clip(detail.situation, 50)} 상황이었습니다. 저는 ${clip(detail.action, 70)} ${hasNumber ? clip(detail.result, 60) : "그 결과 처리 시간이 [수치 입력 필요] 줄었습니다."}`
    paragraphs.push(
      block(`${pid}-p2`, "paragraph", text, {
        project_id: project.id,
        flags: hasNumber ? [] : ["number_check_needed"],
        placeholders: hasNumber ? [] : [{ token: "[수치 입력 필요]", hint: "개선 전후 값" }],
      }),
    )
    evidence.push({ owner_id: sectionId, item_key: `${pid}-p2`, source: { source_type: "project_detail", source_id: detail.id, source_field: "action", quote: clip(detail.action, 80) || null, source_label: detail.title } })
    if (detail.result)
      evidence.push({ owner_id: sectionId, item_key: `${pid}-p2`, source: { source_type: "project_detail", source_id: detail.id, source_field: "result", quote: clip(detail.result, 80) || null, source_label: detail.title } })
    // 선택 이유의 근거 (item_key = sources.{n})
    evidence.push({ owner_id: sectionId, item_key: "sources.0", source: { source_type: "project_detail", source_id: detail.id, source_field: "action", quote: clip(detail.action, 80) || null, source_label: detail.title } })
  }
  if (section.user_note && section.template_key !== "motivation") {
    paragraphs.push(block(`${pid}-p3`, "paragraph", `${clip(section.user_note, 80)} 이 점을 앞으로도 이어 가겠습니다.`))
  }
  if (section.user_note) {
    evidence.push({
      owner_id: sectionId,
      item_key: `${pid}-p${section.template_key === "motivation" ? 1 : 3}`,
      source: { source_type: "user_note", source_id: null, source_field: null, quote: clip(section.user_note, 80), source_label: "문항 메모" },
    })
  }

  // v5.3 C-04 `adjusting_length` (mock): outside 90–110 % of the limit → adjust, and if it still
  // can't fit, char_adjust_needed (A12, kept in validation_report)
  const planned = paragraphs.map((b) => b.text).join("\n")
  const plannedChars = section.count_basis === "without_spaces" ? planned.replace(/\s/g, "").length : planned.length
  const limit = section.char_limit
  const outOfRange = !!limit && (plannedChars < limit * 0.9 || plannedChars > limit * 1.1)
  const plan: GenerationPlan = {
    adjust_length: outOfRange && limit ? { current_chars: plannedChars, char_limit: limit } : undefined,
    char_adjust_needed: outOfRange,
    notes: outOfRange || paragraphs.some((b) => b.placeholders.length)
      ? {
          ...(outOfRange ? { char_adjust_needed: true } : {}),
          ...(paragraphs.some((b) => b.placeholders.length)
            ? { notes_for_user: ["확인이 필요한 자리 표시를 남겼어요. 제출 전에 채워 주세요"] }
            : {}),
        }
      : undefined,
    generation_id: newId(),
    kind: "cover_letter",
    target_id: sectionId,
    draft_id: draft.id,
    application_project_id: draft.application_project_id,
    started_at: Date.now(),
    sections: [],
    blocks: paragraphs,
    sources: plannedSources,
    evidence,
    previous_status: section.status,
  }
  plans().set(plan.generation_id, plan)
  section.status = "generating"
  section.updated_at = now()
  draft.status = "generating"
  draft.updated_at = now()
  return clone({
    generation_id: plan.generation_id,
    provider: activeKey(db)?.provider ?? null,
    // AI-04 sources_selected carries role / origin / requirement_ids (A3 UQ-83)
    sources: (plannedSources ?? rows).map((r) => ({
      label: r.source_label ?? "",
      rationale: r.rationale ?? "",
      role: r.role,
      origin: r.origin,
      requirement_ids: r.requirement_ids,
    })),
    blocks: toStream(paragraphs, evidence),
    adjust_length: plan.adjust_length,
    notes: plan.notes,
  })
}

/**
 * ok → overwrite the section (ai_content, edited_content = null, generation_no + 1,
 * sources_modified_at = null, AI sources, evidence) and charge.
 * not ok → previous body·편집본·"근거를 바꿨어요" stay; a first generation keeps only the received
 * paragraphs (status = failed); usage released.
 */
async function mockFinalizeCoverLetterSection(sectionId: string, generationId: string, result: GenerationResult): Promise<void> {
  const db = await mockRequest()
  const plan = plans().get(generationId)
  const section = db.draft_sections.find((s) => s.id === sectionId)
  if (!plan || plan.target_id !== sectionId || !section) return
  plans().delete(generationId)
  const hadContent = !!section.ai_content?.blocks.length
  const writeAll = (blocks: DraftBlock[], keep: Set<string>) => {
    section.ai_content = { blocks }
    section.edited_content = null
    section.ai_char_count = blocks.map((b) => b.text).join("\n").length
    if (plan.sources) {
      db.draft_section_sources = db.draft_section_sources.filter((s) => s.draft_section_id !== sectionId)
      db.draft_section_sources.push(...plan.sources)
    }
    clearEvidence(db, [sectionId])
    writeEvidence(db, plan.application_project_id, plan.evidence.filter((e) => keep.has(e.item_key) || e.item_key.startsWith("sources.")))
  }
  if (result.ok) {
    writeAll(plan.blocks, new Set(plan.blocks.map((b) => b.block_id)))
    section.generation_no += 1
    section.sources_modified_at = null
    section.status = "ready"
    Object.assign(section, runnerMeta(db))
    // A21: only the length warning is kept (validation_report.char_adjust_needed)
    section.validation_report = { ...(section.validation_report ?? {}), char_adjust_needed: plan.char_adjust_needed === true }
    // A3 request 6: the draft's result meta = the last completed 문항 (04 §2.7 [가정])
    const parent = db.drafts.find((d) => d.id === section.draft_id)
    if (parent) Object.assign(parent, runnerMeta(db), { completed_at: now() })
  } else if (!hadContent && result.completed_block_ids.length > 0) {
    const keep = new Set(result.completed_block_ids)
    writeAll(plan.blocks.filter((b) => keep.has(b.block_id)), keep)
    section.generation_no += 1
    section.status = "failed"
    Object.assign(section, runnerMeta(db))
  } else {
    section.status = plan.previous_status === "generating" ? (hadContent ? "ready" : "pending") : (plan.previous_status as DraftSection["status"])
  }
  section.updated_at = now()
  if (!result.canceled) recordDraftUsage(db, plan.kind, plan.application_project_id, result.ok)
  const draft = db.drafts.find((d) => d.id === section.draft_id)
  if (draft) recomputeDraftStatus(db, draft)
}

// ---------------------------------------------------------------------------
// C-11 변경: replace sources with the user's list (origin = 'user')
// ---------------------------------------------------------------------------

export interface SourceSelection {
  project_id: string
  project_detail_ids: string[]
}

async function mockSetSectionSources(sectionId: string, selections: SourceSelection[]): Promise<DraftSectionSource[] | null> {
  const db = await mockRequest()
  const section = db.draft_sections.find((s) => s.id === sectionId)
  const draft = section && db.drafts.find((d) => d.id === section.draft_id)
  if (!section || !draft) return null
  const tree = buildSourceTree(db)
  const projects = allProjects(tree)
  db.draft_section_sources = db.draft_section_sources.filter((s) => s.draft_section_id !== sectionId)
  const rows: DraftSectionSource[] = selections
    .map((sel, i) => {
      const p = projects.find((x) => x.id === sel.project_id)
      if (!p) return null
      const details = sel.project_detail_ids.map((id) => tree.detail_labels[id]).filter(Boolean)
      const row: DraftSectionSource = {
        id: newId(),
        user_id: USER_ID,
        created_at: now(),
        updated_at: now(),
        draft_section_id: sectionId,
        application_project_id: draft.application_project_id,
        experience_id: p.experience_id,
        education_id: p.education_id,
        project_id: p.id,
        project_detail_ids: sel.project_detail_ids,
        role: i === 0 ? "primary" : "supporting",
        origin: "user",
        rationale: null,
        reuse_reason: null,
        requirement_ids: [],
        sort_order: i + 1,
        source_label: `${tree.project_labels[p.id] ?? p.name}${details.length ? ` › ${details.join(", ")}` : ""}`,
        source_deleted_at: null,
      }
      return row
    })
    .filter((r): r is DraftSectionSource => r !== null)
  db.draft_section_sources.push(...rows)
  Object.assign(section, { source_selection_mode: "user", sources_modified_at: now(), updated_at: now() })
  return clone(rows)
}

/** drafts.first_copied_at (F-DOC-04 복사) */
async function mockMarkDraftCopied(draftId: string): Promise<void> {
  const db = await mockRequest(0)
  const draft = db.drafts.find((d) => d.id === draftId)
  if (draft && !draft.first_copied_at) draft.first_copied_at = now()
}

/** draft edited → drafts.edited_at */
async function mockMarkDraftEdited(draftId: string): Promise<void> {
  const db = await mockRequest(0)
  const draft = db.drafts.find((d) => d.id === draftId)
  if (draft) draft.edited_at = draft.updated_at = now()
}

/**
 * Mock: generations whose stream the user left (no finalize within 20s) are finished by the
 * "server" ("이탈 시 서버가 끝까지 생성·저장" [가정], C-04). Call on S-19 entry.
 */
async function mockSettleAbandonedGeneration(draftId: string): Promise<void> {
  await mockRequest(0)
  const stale = [...plans().values()].filter((p) => p.draft_id === draftId && Date.now() - p.started_at > 20_000)
  for (const p of stale) {
    if (p.kind === "career_description") await mockFinalizeCareerDescription(p.target_id, p.generation_id, { ok: true, completed_block_ids: [] })
    else await mockFinalizeCoverLetterSection(p.target_id, p.generation_id, { ok: true, completed_block_ids: [] })
  }
  // a row left "generating" without a plan (e.g. dev server restart) → settle from what is stored
  const db = await mockRequest(0)
  const draft = db.drafts.find((d) => d.id === draftId)
  if (!draft || [...plans().values()].some((p) => p.draft_id === draftId)) return
  for (const sec of db.draft_sections.filter((x) => x.draft_id === draftId && x.status === "generating")) sec.status = sec.ai_content ? "ready" : "pending"
  // UQ-512: a just-created career description is "generating" before its prepare call — only a
  // row left generating for a while (20 s, same as stale plans) is abandoned
  const abandoned = Date.now() - Date.parse(draft.updated_at) > 20_000
  if (draft.status === "generating" && (draft.draft_type === "cover_letter" || abandoned)) {
    const sections = db.draft_sections.filter((x) => x.draft_id === draftId)
    if (draft.draft_type === "cover_letter") recomputeDraftStatus(db, draft)
    else draft.status = sections.length ? "ready" : "failed"
  }
}

// ---------------------------------------------------------------------------
// S-15: JD extraction retry (AI-01 실패 재시도 — JD 교체는 불가, D-19)
// ---------------------------------------------------------------------------

/**
 * AI-01 (re)run: retry after a failure, or "요건 정리하기" for a JD created without a key
 * (D-30, `extraction_status = 'pending'`). Needs an active key → false otherwise (C-18).
 */
/**
 * "요건 정리하기" / 다시 정리 (S-15, D-30). v5.3 (UQ-402): request-scoped work = 04 §2.11.7 path ⑤ —
 * the gate runs first (no key / consent needed → `{ rejected: "key_missing" }`, invalid →
 * `{ rejected: "key_invalid" }`, nothing changed; the screen re-reads readiness to tell the consent
 * cause apart) and every run is a **new** jd_extraction job on the active provider (DM 2.9.1 (2)).
 * Returns true when started, "already" when an extraction is running, false when there is no JD.
 * mock_controls.next_jd_extraction_failure makes the started run fail with that cause.
 */
async function mockRetryJdExtraction(applicationProjectId: string): Promise<boolean | "already" | AiRejected> {
  const db = await mockRequest()
  const jd = db.job_descriptions.find((j) => j.application_project_id === applicationProjectId)
  if (!jd) return false
  try {
    assertAiRunnable(db, "request")
  } catch (e) {
    if (e instanceof MockAiError) return { rejected: e.error_code, refusal: e.refusal }
    throw e
  }
  const running = db.ai_jobs.find((j) => j.id === jd.extraction_job_id && (j.status === "queued" || j.status === "running"))
  // A3 request 2: "이미 정리하고 있어요" is told apart from a new start
  if (running) return "already"
  const failNext = db.mock_controls.next_jd_extraction_failure
  db.mock_controls.next_jd_extraction_failure = null
  jd.extraction_status = "running"
  jd.extraction_job_id = createMockJob(db, {
    job_type: "jd_extraction",
    application_project_id: applicationProjectId,
    target_type: "job_description",
    target_id: jd.id,
    path: "request",
    fail: failNext,
  }).id
  return true
}

// ---------------------------------------------------------------------------
// W3 wiring: `?state=` previews stay on the store above, everything else is real (drafts-real.ts).
// ---------------------------------------------------------------------------

export function getCareerSourceTree(): Promise<SourceTree> {
  return previewOr(mockGetCareerSourceTree, realGetCareerSourceTree)
}

export function rankDraftSources(applicationProjectId: string, opts?: { fail?: boolean }) {
  return previewOr(() => mockRankDraftSources(applicationProjectId, opts), () => realRankDraftSources(applicationProjectId))
}

export function createCareerDescriptionDraft(applicationProjectId: string, options: DraftOptions, regeneratedFromId: string | null = null): Promise<Draft> {
  return previewOr(
    () => mockCreateCareerDescriptionDraft(applicationProjectId, options, regeneratedFromId),
    () => realCreateCareerDescriptionDraft(applicationProjectId, options, regeneratedFromId),
  )
}

export function createCoverLetterDraft(applicationProjectId: string): Promise<Draft> {
  return previewOr(() => mockCreateCoverLetterDraft(applicationProjectId), () => realCreateCoverLetterDraft(applicationProjectId))
}

export function addCoverLetterQuestion(draftId: string): Promise<DraftSection | null> {
  return previewOr(() => mockAddCoverLetterQuestion(draftId), () => realAddCoverLetterQuestion(draftId))
}

export function deleteDraftSection(draftId: string, sectionId: string): Promise<boolean> {
  return previewOr(() => mockDeleteDraftSection(draftId, sectionId), () => realDeleteDraftSection(sectionId))
}

/**
 * Previews only. A real generation has no plan of blocks: it streams from the route (`prepareCareerDescriptionStream`).
 * Null here refuses the start, so a screen that hasn't moved to the stream plan shows a refusal, never a fake draft.
 */
export function prepareCareerDescription(draftId: string): Promise<CareerDescriptionPlan | null> {
  return previewOr(() => mockPrepareCareerDescription(draftId), async () => null)
}

export function prepareCoverLetterSection(sectionId: string): Promise<CoverLetterSectionPlan | null> {
  return previewOr(() => mockPrepareCoverLetterSection(sectionId), async () => null)
}

/** The real AI-03 start: pass `request` to `stream.start({ ...request, discardOnError: true })`. Null on a preview. */
export function prepareCareerDescriptionStream(draftId: string): Promise<RealStreamPlan | null> {
  return previewOr(async () => null, () => realCareerDescriptionStreamPlan(draftId))
}

/** The real AI-04 start: pass `request` to `stream.start(request)`. Null on a preview. */
export function prepareCoverLetterStream(sectionId: string): Promise<RealStreamPlan | null> {
  return previewOr(async () => null, async () => realCoverLetterStreamPlan(sectionId))
}

export function finalizeCareerDescription(draftId: string, generationId: string, result: GenerationResult): Promise<CareerDescriptionStopped | null> {
  return previewOr(() => mockFinalizeCareerDescription(draftId, generationId, result), () => realFinalizeCareerDescription(draftId, generationId, result))
}

export function finalizeCoverLetterSection(sectionId: string, generationId: string, result: GenerationResult): Promise<void> {
  return previewOr(() => mockFinalizeCoverLetterSection(sectionId, generationId, result), () => realFinalizeCoverLetterSection(sectionId, generationId, result))
}

export function setSectionSources(sectionId: string, selections: SourceSelection[]): Promise<DraftSectionSource[] | null> {
  return previewOr(() => mockSetSectionSources(sectionId, selections), () => realSetSectionSources(sectionId, selections))
}

export function markDraftCopied(draftId: string): Promise<void> {
  return previewOr(() => mockMarkDraftCopied(draftId), () => realMarkDraftCopied(draftId))
}

/** The real save (`saveSectionEdit`) already sets edited_at. */
export function markDraftEdited(draftId: string): Promise<void> {
  return previewOr(() => mockMarkDraftEdited(draftId), async () => {})
}

/** A real run is finished by the route or the job sweep, whether or not the screen stayed. */
export function settleAbandonedGeneration(draftId: string): Promise<void> {
  return previewOr(() => mockSettleAbandonedGeneration(draftId), async () => {})
}

export function retryJdExtraction(applicationProjectId: string): Promise<boolean | "already" | AiRejected> {
  return previewOr(() => mockRetryJdExtraction(applicationProjectId), () => realRetryJdExtraction(applicationProjectId))
}

/** "요건 정리하기" (S-15, D-30) — same as retryJdExtraction */
export const runJdExtraction = retryJdExtraction

