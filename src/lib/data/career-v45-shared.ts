/**
 * 프로젝트 상세(S-10) · 산출물 상세(S-44) data contracts v4.5 — client-safe (types, pure helpers, copy).
 * DM v4.5 2.5 / 2.5.0 / 2.5.1 / 3.3 / 7, UX v5.6 L-02 · S-10 · S-44, AI v4.6 AI-12 · AI-13.
 *
 * Function names on the server side (`career-v45.ts`) follow the DM RPC names: saveProjectPage
 * (`save_project_page`), saveProjectDeliverable (`save_project_deliverable`), startWritingChat
 * (`start_writing_chat`), startDeliverableWritingChat (`start_deliverable_writing_chat`).
 * Field names are the DM column / jsonb keys verbatim (snake_case), like `src/types/db.ts`.
 *
 * Months: the form keeps the DB column shape ('YYYY-MM-DD', 1st of month, like MonthField and
 * `CareerProject.start_month`); `p_values` and `form_snapshot` carry 'YYYY-MM' (DM 2.5.1) —
 * `toProjectPValues` / `toProjectFormSnapshot` convert.
 */
import type {
  DeliverableDraftBlock,
  AiErrorCode,
  AiProviderName,
  CareerItemStatus,
  Competency,
  DeliverableAppliedMode,
  DeliverableStructuredDraft,
  ExperienceType,
  PageSaveErrorCode,
  PageSaveSkipReason,
  ProjectStarField,
  ProjectStructuredDraft,
  ProjectType,
  ReturnTarget,
  WritingChatErrorCode,
  WritingChatMessageRole,
  WritingChatMessageStatus,
  WritingKind,
} from "@/types/db"
import { directionParticle, objectParticle } from "./labels"

// ---------------------------------------------------------------------------
// limits (DM 2.3 / 2.5 / 2.5.0, mirror CAREER_LIMITS in contracts/career.ts)
// ---------------------------------------------------------------------------

export const PAGE_LIMITS = {
  projectName: 100,
  star: 2000,
  deliverableTitle: 100,
  deliverableBody: 20000,
  /** DM 2.3 [가정]: deliverables per standalone project */
  maxDeliverables: 50,
  /** DM 2.5 A5: user + assistant messages per chat, greeting excluded */
  messageLimit: 40,
  /** user messages only while message_count ≤ 38 (the reply is the 40th) */
  lastSendableCount: 38,
  /** UX S-10 [가정]: chips hide from this message_count on */
  chipsHideFrom: 36,
  /** DM 2.5.0: drafts per deliverable chat */
  maxDrafts: 6,
  /** DM 2.5 [가정]: writing_chat_messages.content */
  messageMaxChars: 4000,
  /** AI-13 C-14: replace drafts are not made above this body length */
  replaceBodyMax: 6000,
} as const

export const STAR_FIELDS_ORDER: readonly ProjectStarField[] = ["situation", "task", "action", "result", "learnings"]

// ---------------------------------------------------------------------------
// S-10 form values (= save_project_page p_values keys, DM 2.5.1)
// ---------------------------------------------------------------------------

export interface ProjectPageValues {
  name: string
  experience_id: string | null
  education_id: string | null
  /** 'YYYY-MM-DD' (1st) in the form */
  start_month: string | null
  end_month: string | null
  is_current: boolean
  project_type: ProjectType | null
  experience_type: ExperienceType | null
  competencies: Competency[]
  situation: string | null
  task: string | null
  action: string | null
  result: string | null
  learnings: string | null
}

/** DM 2.5.1 form_snapshot (S-10) — not stored, not logged */
export interface ProjectFormSnapshot {
  name: string
  start_month: string | null
  end_month: string | null
  is_current: boolean
  project_type: ProjectType | null
  experience_type: ExperienceType | null
  competencies: Competency[]
  star: Record<ProjectStarField, string | null>
}

/** DM 2.5.1 form_snapshot (S-44) */
export interface DeliverableFormSnapshot {
  title: string
  body: string
}

export type FormSnapshot = ProjectFormSnapshot | DeliverableFormSnapshot

export function blankProjectValues(affiliation: { experience_id?: string | null; education_id?: string | null }): ProjectPageValues {
  return {
    name: "",
    experience_id: affiliation.experience_id ?? null,
    education_id: affiliation.education_id ?? null,
    start_month: null,
    end_month: null,
    is_current: false,
    project_type: null,
    experience_type: null,
    competencies: [],
    situation: null,
    task: null,
    action: null,
    result: null,
    learnings: null,
  }
}

const ym = (date: string | null): string | null => (date ? date.slice(0, 7) : null)

/** C-14 공백 정규화: trim + collapse; '' → null. Used for "비어 있음" (chips, greetings, fill rules). */
export function normalizedText(value: string | null | undefined): string | null {
  if (value == null) return null
  const v = value.replace(/\s+/g, " ").trim()
  return v === "" ? null : v
}

export function isBlank(value: string | null | undefined): boolean {
  return normalizedText(value) === null
}

/** p_values for save_project_page — the whole page (DM 2.5.1: "화면은 페이지 전체를 보낸다"). */
export function toProjectPValues(v: ProjectPageValues): Record<string, unknown> {
  const text = (s: string | null) => (s == null || s.trim() === "" ? null : s)
  return {
    name: v.name.trim(),
    experience_id: v.experience_id,
    education_id: v.education_id,
    start_month: ym(v.start_month),
    end_month: v.is_current ? null : ym(v.end_month),
    is_current: v.is_current,
    project_type: v.project_type,
    experience_type: v.experience_type,
    competencies: v.competencies,
    situation: text(v.situation),
    task: text(v.task),
    action: text(v.action),
    result: text(v.result),
    learnings: text(v.learnings),
  }
}

export function toProjectFormSnapshot(v: ProjectPageValues): ProjectFormSnapshot {
  return {
    name: v.name,
    start_month: ym(v.start_month),
    end_month: v.is_current ? null : ym(v.end_month),
    is_current: v.is_current,
    project_type: v.project_type,
    experience_type: v.experience_type,
    competencies: v.competencies,
    star: { situation: v.situation, task: v.task, action: v.action, result: v.result, learnings: v.learnings },
  }
}

export function isProjectSnapshot(s: FormSnapshot): s is ProjectFormSnapshot {
  return "star" in s
}

// ---------------------------------------------------------------------------
// p_applied_proposals (DM 2.5.1)
// ---------------------------------------------------------------------------

/** STAR chat fields a fill can record (DM 2.5.1, no is_current — AI DA-5) */
export type ProjectProposalField =
  | ProjectStarField
  | "start_month"
  | "end_month"
  | "project_type"
  | "experience_type"
  | "competencies"

export interface AppliedProjectProposal {
  writing_chat_id: string
  field: ProjectProposalField
  rev: number
}

export interface AppliedDeliverableProposal {
  writing_chat_id: string
  rev: number
  mode: DeliverableAppliedMode
}

// ---------------------------------------------------------------------------
// save results (DM 2.5.1 반환 + 거부 코드)
// ---------------------------------------------------------------------------

/** A refused save writes nothing. `field` = details.field, `current_updated_at` = stale_write details. */
export interface PageSaveError {
  /** `save_failed` = anything else (network, 5xx, unknown code) → ST-SAVE-FAILED */
  code: PageSaveErrorCode | "save_failed"
  field?: string | null
  current_updated_at?: string | null
  /**
   * The row was created but the rest of the save failed: keep this id (and `updated_at` as the expected
   * version) so the retry updates it. Not produced since R5 wiring (`save_project_page` is one transaction);
   * kept for the screen's existing handling.
   */
  created?: { project_id: string; updated_at: string }
}

export type SaveProjectPageResult =
  | {
      ok: true
      project_id: string
      status: CareerItemStatus
      updated_at: string
      applied: Array<{ writing_chat_id: string; field: ProjectProposalField }>
      skipped: Array<{ writing_chat_id: string; field: ProjectProposalField; reason: PageSaveSkipReason }>
    }
  | { ok: false; error: PageSaveError }

export type SaveProjectDeliverableResult =
  | {
      ok: true
      project_deliverable_id: string
      project_id: string
      sort_order: number
      updated_at: string
      applied: Array<{ writing_chat_id: string }>
      skipped: Array<{ writing_chat_id: string; reason: PageSaveSkipReason }>
    }
  | { ok: false; error: PageSaveError }

export interface SaveProjectPageInput {
  /** null = 만들기 */
  project_id: string | null
  /** 만들기: one id per new page (mock previews only — the RPC assigns the id, spec-gaps R5-W-1) */
  client_id?: string | null
  values: ProjectPageValues
  /** null = overwrite ("내 내용으로 저장") */
  expected_updated_at: string | null
  applied_proposals: AppliedProjectProposal[]
}

export interface SaveProjectDeliverableInput {
  /** null = 만들기 */
  project_deliverable_id: string | null
  /** 만들기: one id per new page (mock previews only — the RPC assigns the id, spec-gaps R5-W-1) */
  client_id?: string | null
  project_id: string
  title: string
  body: string
  expected_updated_at: string | null
  applied_proposals: AppliedDeliverableProposal[]
}

/** S-10 "저장 실패" 표 / S-44 페이지 저장 문구 (spec copy; `[가정]` where the spec marks it). */
export const PAGE_SAVE_ERROR_COPY: Record<PageSaveErrorCode | "save_failed", string> = {
  stale_write: "다른 곳에서 바뀌었어요",
  project_name_required: "프로젝트명을 입력해 주세요",
  project_affiliation_required: "소속 경력·교육을 찾을 수 없어요",
  project_not_affiliated: "독립 프로젝트로 바뀌었어요",
  deliverable_title_required: "산출물 제목을 입력해 주세요",
  invalid_period: "종료월은 시작월보다 빠를 수 없어요",
  invalid_classification: "선택할 수 없는 값이에요. 다시 골라 주세요",
  invalid_fields: "저장하지 못했어요",
  // "{n}자까지 쓸 수 있어요" — fieldTooLongCopy(n)
  field_too_long: "글자 수를 넘었어요",
  not_found: "찾을 수 없는 항목이에요",
  project_scope_change_not_allowed: "소속은 경력·교육 사이에서만 바꿀 수 있어요",
  deliverable_limit_reached: "산출물은 프로젝트당 50개까지 쓸 수 있어요",
  deliverable_requires_standalone_project: "이 프로젝트에는 산출물을 추가할 수 없어요",
  save_failed: "저장하지 못했어요",
}

export function fieldTooLongCopy(limit: number): string {
  return `${limit.toLocaleString("ko-KR")}자까지 쓸 수 있어요`
}

/** invalid_period with is_current and an end month */
export const PERIOD_CURRENT_WITH_END_COPY = "진행 중이면 종료월을 비워 주세요"
/** [가정] S-10 머리: an end month without a start month */
export const PERIOD_START_FIRST_COPY = "시작월을 먼저 골라 주세요"

/** S-10 "저장 응답의 건너뜀" 문구 (skipped[].reason) — S-44 uses the same (spec) */
export const PAGE_SAVE_SKIP_COPY: Record<PageSaveSkipReason, string> = {
  not_found: "대화가 삭제돼 반영 기록은 남기지 않았어요",
  already_applied: "이미 반영된 제안이에요",
  proposal_changed: "채운 뒤 제안이 바뀌었어요 · 새 제안이 있어요",
  needs_review: "검토가 필요한 제안이라 반영 기록을 남기지 않았어요",
  invalid_entry: "일부 반영 기록을 남기지 못했어요. 저장한 내용은 그대로예요",
  mark_failed: "일부 반영 기록을 남기지 못했어요. 저장한 내용은 그대로예요",
}

// ---------------------------------------------------------------------------
// page reads (DM §7 v4.4 프로젝트 상세 / v4.5 산출물 상세)
// ---------------------------------------------------------------------------

/** 대화 기록 목록 row (DM §7: id, title, status, message_count, last_activity_at, last_applied_at) */
export interface WritingChatSummary {
  id: string
  title: string | null
  status: "active" | "closed"
  message_count: number
  last_activity_at: string
  last_applied_at: string | null
}

/** writing_chat_messages for the panel. `user_number` = "내 답변 #n" (view model, user messages only). */
export interface WritingChatMessageView {
  id: string
  sequence: number
  role: WritingChatMessageRole
  content: string
  status: WritingChatMessageStatus
  provider: AiProviderName | null
  created_at: string
  user_number: number | null
  /** greeting (ai_job_id null, not counted, no number) */
  is_greeting: boolean
  /**
   * Assistant `failed` rows only: how the turn's job ended (AI v4.11 R-OD-8 — the message status alone can't tell):
   * `canceled` = the user stopped it → "답을 받지 못한 메시지" (OD-P11); `failed` = a real failure → C-20 실패한 턴.
   * Absent / null = unknown.
   * // 연결 대기 (DM v4.11 11.6 #11·#15): the chat detail DTO doesn't carry the job status / cause yet — the real
   * path leaves this unset (the panel then shows the neutral "답을 받지 못한 메시지" line). The mock fills it.
   */
  turn_job?: TurnJobEnd | null
}

/** The end state of a failed assistant row's job (view model, R-OD-8). */
export interface TurnJobEnd {
  status: "failed" | "canceled"
  error_code: AiErrorCode | null
  provider: AiProviderName | null
  retry_after: string | null
  quota_resets_at: string | null
}

/** One opened chat (writing_chats v4.5 row fields the panel reads + its messages). */
export interface WritingChatView<D = ProjectStructuredDraft | DeliverableStructuredDraft> {
  id: string
  project_id: string
  project_deliverable_id: string | null
  title: string | null
  status: "active" | "closed"
  message_count: number
  last_activity_at: string
  last_applied_at: string | null
  return_target: ReturnTarget | null
  structured_draft: D
  messages: WritingChatMessageView[]
}

export type ProjectChatView = WritingChatView<ProjectStructuredDraft>
export type DeliverableChatView = WritingChatView<DeliverableStructuredDraft>

/**
 * `?state=` preview hints the page / panel act on (development only, null on the real path).
 * The data layer computes them so every screen reads the same switch.
 */
export interface PagePreviewHints {
  state: string
  /** start with unsaved edits (`dirty`) */
  dirty: boolean
  /** the next save: `saving` (stays pending ~20s), `save-failed`, `stale`, `first-save-failed` (only the create fails) */
  save: "slow" | "fail" | "stale" | "first-fail" | null
  /** `skipped`: the save succeeds but its 반영 기록 comes back in `skipped` (proposal_changed) */
  skip: boolean
  /** `start-failed`: the start RPC (④) fails */
  startFail: boolean
  /** the panel plays a mock turn on mount: `ai-stream` (question turn) / `draft-streaming` · `draft-failed` (AI-13 draft turn) */
  autoplay: "question" | "draft" | null
  /** `ai-failed*` / `invalid-form-snapshot` / `chat-closed-other-tab` → every mock turn ends with this code */
  turnError: AiErrorCode | WritingChatErrorCode | null
}

export interface ProjectPageData {
  kind: "project"
  /** null = 새 프로젝트 (no row, `/career/projects/new?experience=|education=`) */
  project_id: string | null
  status: CareerItemStatus | null
  updated_at: string | null
  /** this row's form values (saved values) */
  values: ProjectPageValues
  /** 이동 경로 첫 마디 + "←" 대상 (회사명 / 기관명) */
  parent: { type: "experience" | "education"; id: string; name: string | null }
  /** 소속 변경 dialog list (this user's experiences / educations) */
  affiliations: Array<{ type: "experience" | "education"; id: string; name: string | null }>
  chats: WritingChatSummary[]
  /** `?chat=` or the most recent chat [UI-가정], opened with messages */
  open_chat: ProjectChatView | null
  preview: PagePreviewHints | null
}

export interface DeliverablePageData {
  kind: "deliverable"
  /** null = 새 산출물 (`/career/projects/{project_id}/deliverables/new`) */
  project_deliverable_id: string | null
  updated_at: string | null
  title: string
  body: string
  /** 부모 독립 프로젝트 (이동 경로, AI 입력) */
  project: { id: string; name: string }
  /** the parent already has 50 deliverables (new page only) */
  limit_reached: boolean
  chats: WritingChatSummary[]
  open_chat: DeliverableChatView | null
  preview: PagePreviewHints | null
}

export type PageLoad<T> =
  | { kind: "ok"; data: T }
  | { kind: "not_found" }
  /** S-10 opened with a standalone project id → S-08 `?item=project:{id}` (S-43) */
  | { kind: "standalone"; project_id: string }
  /** S-44 parent is an affiliated project → S-10 + toast "산출물은 독립 프로젝트에만 쓸 수 있어요" */
  | { kind: "affiliated"; project_id: string }

// ---------------------------------------------------------------------------
// panel: start / patch / turn results
// ---------------------------------------------------------------------------

/** Refusals of the panel's server calls. */
export type PanelCallError = {
  code: WritingChatErrorCode | "ai_not_connected" | "ai_consent_required" | "key_invalid" | "failed"
}

export type StartChatResult<V extends WritingChatView = WritingChatView> = { ok: true; chat: V } | { ok: false; error: PanelCallError }

/**
 * apply_structured_draft_patch (사용자 세션) — the card actions. STAR: field edit / review accept · reject;
 * deliverable: fact accept · reject, block accept · drop (DM 2.5.0: no whole-draft reject, no block edit).
 */
export type StructuredDraftUserPatch =
  | { kind: "edit"; section: "project" | "star" | "classification"; field: string; value: string | string[] | null }
  | { kind: "review"; section: "project" | "star" | "classification"; field: string; decision: "accept" | "reject" }
  | { kind: "fact_review"; fact_id: string; decision: "accept" | "reject" }
  | { kind: "block_review"; block_id: string; decision: "accept" | "drop" }

export type PatchDraftResult<D> = { ok: true; structured_draft: D } | { ok: false; error: PanelCallError }

/** Turn request body (DM §7 대화 턴, v4.5): `{content, requested_slot?, requested_action?, style?, form_snapshot}` */
export interface TurnRequestBody {
  content: string
  requested_slot: string | null
  requested_action: "compose_draft" | "ask_from_project" | null
  style: "shorter" | "more_detail_on_contribution" | null
  form_snapshot: FormSnapshot
}

/**
 * What the client streams: the real SSE route, or the client-side mock generator (previews).
 * `retry` = "다시 보내기" of the last failed turn.
 */
export type TurnRequest =
  | { kind: "real"; endpoint: string; body: unknown; target: "project" | "deliverable" }
  | {
      kind: "mock"
      target: "project" | "deliverable"
      chat_id: string
      body: TurnRequestBody
      retry: boolean
      structured_draft: ProjectStructuredDraft | DeliverableStructuredDraft
      message_count: number
      next_sequence: number
      turn_error: AiErrorCode | WritingChatErrorCode | null
      /** `?state=` of the page (mock variants: needs-review blocks, slow drafts) */
      preview_state: string | null
    }
  | { kind: "refused"; error: PanelCallError }

// ---------------------------------------------------------------------------
// greetings (AI-12 / AI-13 fixed copy [가정], shown before a row exists; the start RPC stores the same)
// ---------------------------------------------------------------------------

export const SENSITIVE_LINE_PROJECT = "회사 기밀이나 민감정보는 쓰지 말아 주세요."
export const SENSITIVE_LINE_DELIVERABLE = "회사 기밀, 민감정보, 다른 사람의 개인정보는 쓰지 말아 주세요."

/** S-10 / S-44 시작 영역 고정 안내 */
export const PANEL_NOTICE = {
  project: "AI는 내가 말한 내용만으로 제안하고, 반영은 내가 정해요",
  deliverable: "AI는 내가 말한 내용과 이 프로젝트 정보로 초안을 제안하고, 반영은 내가 정해요",
} as const

/** S-10 무료 등급 시작 인사 한 줄 (C-19 · C-21과 같은 문장) [가정] */
export function freeTierGreetingLine(providerLabel: string): string {
  return `무료 등급에서는 입력한 내용이 ${providerLabel} 제품 개선에 쓰이고 사람이 검토할 수 있어요. 민감정보·회사 기밀은 쓰지 마세요`
}

const STAR_KO: Record<ProjectStarField, string> = {
  situation: "상황",
  task: "역할",
  action: "행동",
  result: "결과/성과",
  learnings: "배운 점",
}
const STAR_QUESTION: Record<ProjectStarField, string> = {
  situation: "그때 어떤 상황이었나요? 팀이나 서비스 배경을 알려 주세요",
  task: "그 상황에서 맡은 역할이나 해결해야 했던 목표는 무엇이었나요?",
  action: "그 안에서 본인이 직접 한 일은 무엇인가요?",
  result: "결과는 어땠나요? 수치로 알고 있는 게 있다면 함께 말해 주세요",
  learnings: "이 경험에서 배운 점이나 다음에 다르게 할 점이 있나요?",
}

/** "'{이름}'을/를" — the particle follows the name's last syllable (UQ-S10-11). */
function quotedObject(word: string): string {
  return `'${word}'${objectParticle(word)}`
}

/**
 * AI-12 시작 인사 4종 (STAR 비어 있음 / 일부 / 다 채워짐 / 게이트 진입) — branch by the form snapshot.
 * // [UI-가정] (UQ-S10-11) an empty name (new page, the first message is blocked until a name is typed, but the
 * start area shows the greeting before) says "이 프로젝트" instead of quoting a placeholder.
 */
export function projectGreeting(snapshot: ProjectFormSnapshot, opts?: { gateFeatureLabel?: string | null }): string {
  const name = snapshot.name.trim()
  const empty = STAR_FIELDS_ORDER.filter((f) => isBlank(snapshot.star[f]))
  let body: string
  if (empty.length === STAR_FIELDS_ORDER.length) {
    body = `${name ? quotedObject(name) : "이 프로젝트를"} 함께 정리해 볼게요. 하나씩 여쭤보고, 정리한 내용은 왼쪽에 반영하기 전에 먼저 보여 드릴게요. 이 프로젝트는 어떤 상황에서 시작됐나요?`
  } else if (empty.length > 0) {
    body = `${name ? `'${name}'에서` : "이 프로젝트에서"} 비어 있는 ${STAR_KO[empty[0]]}부터 여쭤볼게요. ${STAR_QUESTION[empty[0]]}`
  } else {
    body = "모든 항목이 채워져 있어요. 보강하고 싶은 항목을 골라 주세요."
  }
  const feature = opts?.gateFeatureLabel
  const gate = feature ? `${feature}${objectParticle(feature)} 쓰려면 이 프로젝트의 상황과 행동이 필요해요.\n` : ""
  return `${gate}${body}\n${SENSITIVE_LINE_PROJECT}`
}

/**
 * AI-13 시작 인사 3종 — body empty & kind unknown / body empty & kind guessed from the title / body present.
 * `guessedKind` = the server's title keyword guess (mock: `guessWritingKind`). Empty title → "이 산출물" [UI-가정].
 */
export function deliverableGreeting(snapshot: DeliverableFormSnapshot, guessedKind: WritingKind | null, kindLabel?: string, firstQuestion?: string): string {
  const title = snapshot.title.trim()
  const subject = title ? quotedObject(title) : "이 산출물을"
  let body: string
  if (!isBlank(snapshot.body)) {
    body = "지금 본문을 바탕으로 더 채워 볼게요. 보강하고 싶은 부분을 알려 주시거나, 아래 버튼으로 시작하세요."
  } else if (guessedKind && kindLabel) {
    body = `${subject} ${kindLabel}${directionParticle(kindLabel)} 정리해 볼게요. ${firstQuestion ?? ""}`.trim()
  } else {
    body = `${subject} 함께 써 볼게요. 몇 가지 여쭤보고, 정리한 초안은 본문에 넣기 전에 먼저 보여 드릴게요. 어떤 글인가요? 기획서 요약, 설계 문서, 회고, 발표 내용처럼 알려 주세요.`
  }
  return `${body}\n${SENSITIVE_LINE_DELIVERABLE}`
}

/** [가정] AI-13 "서버 상수 키워드" stand-in for the greeting before a row exists (the server decides for real). */
export function guessWritingKind(title: string): WritingKind | null {
  const t = title.replace(/\s+/g, "")
  if (/회고/.test(t)) return "retrospective"
  if (/설계|아키텍처/.test(t)) return "design_doc"
  if (/기획/.test(t)) return "planning_summary"
  if (/발표/.test(t)) return "presentation"
  return null
}

// ---------------------------------------------------------------------------
// panel copy (spec verbatim; `[가정]` per spec)
// ---------------------------------------------------------------------------

export const PANEL_COPY = {
  inputPlaceholder: "Resumate AI에게 물어보세요",
  /** 409 turn_in_progress (another tab is answering) — the server's message (turn.ts) [UI-가정] */
  turnInProgress: "이전 메시지에 대한 응답을 만들고 있어요. 잠시 후 다시 보내 주세요",
  /** 409 nothing_to_retry on "다시 보내기" — [UI-가정] copy (no spec row); the text goes back to the input */
  nothingToRetry: "이 메시지는 다시 보낼 수 없어요. 입력창의 내용을 새로 보내 주세요",
  nameRequired: {
    project: "대화를 시작하려면 프로젝트명을 먼저 입력해 주세요",
    deliverable: "대화를 시작하려면 산출물 제목을 먼저 입력해 주세요",
  },
  firstSaveToast: {
    project: "대화를 시작하려고 프로젝트를 저장했어요",
    deliverable: "대화를 시작하려고 산출물을 저장했어요",
  },
  firstSaveFailed: "저장하지 못해 대화를 시작하지 못했어요 · 다시 시도",
  chatClosed: "이 대화는 끝났어요. 새 대화에서 이어 가세요",
  /** S-10 C-15 ④·⑤ / DM `field_already_applied` (design-system 3.24: under the section) */
  alreadyApplied: "이미 반영했어요. 왼쪽 칸에서 고쳐 주세요",
  messageLimit: "이 대화가 길어졌어요. 반영할 내용을 반영해 저장하고 새 대화에서 이어 가세요",
  draftLimit: "이 대화에서는 초안을 더 만들 수 없어요. 새 대화에서 이어 가세요",
  invalidFormSnapshot: "입력한 내용 중 길이·형식이 맞지 않는 칸이 있어요. 칸을 고친 뒤 다시 보내 주세요",
  sensitive: "이 부분은 민감한 정보로 보여 제안에 넣지 않았어요. 대화 기록에는 남아 있어요. 필요하면 대화를 삭제하세요",
  deliverableLimit: "산출물은 프로젝트당 50개까지 쓸 수 있어요",
  emptyHistory: "아직 대화가 없어요",
  newChatTitle: "새 대화",
  closedChatBadge: "끝난 대화",
  backToChat: "대화로 돌아가기",
  lock: {
    project: "질문에 답하면 AI가 STAR(상황·역할·행동·결과/성과·배운 점)에 넣을 내용을 제안해요",
    deliverable: "질문에 답하면 AI가 산출물 본문 초안을 제안해요",
  },
} as const

/**
 * S-44 본문 초안 카드 진행 문구 (design-system v4 3.25 "초안 작성 중", C-03 `compose` 단계; S-44 초안 실패 줄).
 * `slow` after 15s before the first block [가정]; `failed` + the C-20 cause line.
 */
export const DRAFT_STAGE_COPY = {
  compose: "초안 작성 중",
  slow: "긴 글이라 조금 더 걸려요",
  failed: "초안을 만들지 못했어요. 이전 초안은 그대로예요",
  previous: "이전 초안",
} as const
/** ms before the first `draft_block` after which `DRAFT_STAGE_COPY.slow` shows [가정] */
export const DRAFT_SLOW_AFTER_MS = 15_000

/** "?chat=" helper (ids only, spec [가정]) */
export function withChatParam(href: string, chatId: string | null): string {
  if (!chatId) return href
  return `${href}${href.includes("?") ? "&" : "?"}chat=${encodeURIComponent(chatId)}`
}

// ---------------------------------------------------------------------------
// deliverable draft helpers (DM 2.5.0 value assembly, AI-13 base_body_hash)
// ---------------------------------------------------------------------------

/** DM 2.5.0 `value` = blocks assembled as markdown (blank line between blocks). Server mocks and the client fill use the same assembly. */
export function blocksToMarkdown(blocks: DeliverableDraftBlock[]): string {
  return blocks
    .map((b) => {
      switch (b.type) {
        case "heading":
          return `${"#".repeat(b.level ?? 2)} ${b.text ?? ""}`
        case "bullet_list":
          return (b.items ?? []).map((i) => `- ${i}`).join("\n")
        case "numbered_list":
          return (b.items ?? []).map((i, n) => `${n + 1}. ${i}`).join("\n")
        case "quote":
          return (b.text ?? "").split("\n").map((l) => `> ${l}`).join("\n")
        case "code":
          return "```\n" + (b.text ?? "") + "\n```"
        case "table": {
          const rows = b.rows ?? []
          if (!rows.length) return ""
          const head = `| ${rows[0].join(" | ")} |`
          const sep = `| ${rows[0].map(() => "---").join(" | ")} |`
          return [head, sep, ...rows.slice(1).map((r) => `| ${r.join(" | ")} |`)].join("\n")
        }
        default:
          return b.text ?? ""
      }
    })
    .filter(Boolean)
    .join("\n\n")
}


/**
 * `base_body_hash` comparison (AI-13 "해시 계산 방식은 서버와 같아야 한다"): "sha256:" + hex of the exact UTF-8
 * body, no normalization — same as the server's `bodyHash` (src/server/ai/context-pack/deliverable-chat.ts).
 */
export async function bodyHash(body: string): Promise<string> {
  const bytes = new TextEncoder().encode(body)
  const digest = await crypto.subtle.digest("SHA-256", bytes)
  return `sha256:${Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("")}`
}
