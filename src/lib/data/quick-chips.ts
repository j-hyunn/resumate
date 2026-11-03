/**
 * 빠른 버튼 칩 3개 — the shared constant + pure function the screens call (AI v4.6 AI-12 / AI-13
 * "빠른 버튼 칩 3개" tables and "빠른 버튼 칩 계산 규칙", R-PA-5; UX v5.6 S-10 / S-44).
 *
 * The AI spec tables are the source: change the copy here (one place), never per screen. The server does
 * not send chips (`turn_done` has none) and re-checks whatever a chip sends like any other request.
 *
 * Recompute: page open (also with no row), opening a chat, after `draft_patch` / `facts_patch` /
 * `draft_done` / `turn_done`, and on form edits. Client-safe, no I/O.
 */
import type { DeliverableSlot, DraftReview, ProjectStarField, WritingKind } from "@/types/db"
import { DELIVERABLE_SLOTS_BY_KIND } from "./labels"
import { PAGE_LIMITS, STAR_FIELDS_ORDER, isBlank } from "./career-v45-shared"

/** What a chip does when pressed. `message` sends `label` as the user message (counted, A5). */
export type QuickChip =
  | {
      kind: "message"
      label: string
      requested_slot: string | null
      requested_action: "compose_draft" | null
      style: "shorter" | "more_detail_on_contribution" | null
    }
  /** AI-13 "새 대화 시작" (draft limit): opens a new chat, sends nothing */
  | { kind: "new_chat"; label: string }

const msg = (
  label: string,
  requested_slot: string | null,
  extra?: { requested_action?: "compose_draft"; style?: "shorter" | "more_detail_on_contribution" },
): QuickChip => ({ kind: "message", label, requested_slot, requested_action: extra?.requested_action ?? null, style: extra?.style ?? null })

// ---------------------------------------------------------------------------
// AI-12 (S-10) — table rows
// ---------------------------------------------------------------------------

/** AI-12 "빠른 버튼 칩 3개" copy. `null` slot = computed (첫 빈 필수 슬롯 / 첫 빈 슬롯). */
export const PROJECT_CHIP_TABLE = {
  required_missing: [
    { label: "비어 있는 항목부터 물어봐 줘", slot: null },
    { label: "결과/성과도 정리하고 싶어요", slot: "result" },
    { label: "배운 점도 정리하고 싶어요", slot: "learnings" },
  ],
  optional_missing: [
    { label: "남은 항목 채우기", slot: null },
    { label: "본인이 한 일을 더 구체적으로", slot: "action" },
    { label: "결과/성과에 수치 더하기", slot: "result" },
  ],
  all_filled: [
    { label: "행동 보강하기", slot: "action" },
    { label: "결과/성과 보강하기", slot: "result" },
    { label: "배운 점 보강하기", slot: "learnings" },
  ],
} as const satisfies Record<string, ReadonlyArray<{ label: string; slot: ProjectStarField | null }>>

export type ProjectChipRow = keyof typeof PROJECT_CHIP_TABLE

const REQUIRED_STAR: readonly ProjectStarField[] = ["situation", "action"]

export interface ProjectChipState {
  /** the form's current STAR values (unsaved edits included) */
  star: Partial<Record<ProjectStarField, string | null | undefined>>
}

export function projectChipRow(state: ProjectChipState): ProjectChipRow {
  if (REQUIRED_STAR.some((f) => isBlank(state.star[f]))) return "required_missing"
  if (STAR_FIELDS_ORDER.some((f) => isBlank(state.star[f]))) return "optional_missing"
  return "all_filled"
}

export function projectQuickChips(state: ProjectChipState): QuickChip[] {
  const row = projectChipRow(state)
  const firstEmpty = (fields: readonly ProjectStarField[]) => fields.find((f) => isBlank(state.star[f])) ?? null
  return PROJECT_CHIP_TABLE[row].map((c) => {
    if (c.slot) return msg(c.label, c.slot)
    // required_missing → 첫 빈 필수 슬롯, optional_missing → 첫 빈 슬롯 (STAR order)
    return msg(c.label, row === "required_missing" ? firstEmpty(REQUIRED_STAR) : firstEmpty(STAR_FIELDS_ORDER))
  })
}

// ---------------------------------------------------------------------------
// AI-13 (S-44) — table rows
// ---------------------------------------------------------------------------

export const DELIVERABLE_CHIP_COPY = {
  whatToWrite: "무엇을 쓰면 좋을지 알려 줘",
  myPartFirst: "제가 맡은 부분부터 말할게요",
  fromProject: "프로젝트 내용을 바탕으로 물어봐 줘",
  composeDraft: "지금까지 내용으로 초안 만들기",
  askMissing: "빠진 부분 물어봐 줘",
  moreDetail: "제가 한 일을 더 구체적으로",
  recompose: "새 내용으로 초안 다시 만들기",
  shorter: "더 짧게 정리해 줘",
  newChat: "새 대화 시작",
} as const

export type DeliverableChipRow = "draft_unavailable" | "draft_available" | "draft_exists"

export interface DeliverableChipState {
  /** the form's current body (unsaved edits included) */
  body: string | null | undefined
  /** the open chat's facts (none when no chat row) */
  facts: ReadonlyArray<{ slot: string; review: DraftReview }>
  /** `structured_draft.deliverable.body` exists */
  has_draft: boolean
  /** `structured_draft.draft_count` (0 without a chat) */
  draft_count: number
  writing_kind: WritingKind | null
  /** the current draft's `missing_slots` (first one wins for "빠진 부분") */
  missing_slots?: ReadonlyArray<string>
}

/** AI-13 "검증 통과·수락 사실 수" = facts with review ok / accepted (needs_review facts don't count). */
export function usableFactCount(facts: DeliverableChipState["facts"]): number {
  return facts.filter((f) => f.review === "ok" || f.review === "accepted").length
}

export function deliverableChipRow(state: DeliverableChipState): DeliverableChipRow {
  if (state.has_draft) return "draft_exists"
  // AI-13 초안 제안 시점: 사실 2개 이상 또는 현재 본문이 비어 있지 않음
  if (usableFactCount(state.facts) >= 2 || !isBlank(state.body)) return "draft_available"
  return "draft_unavailable"
}

/** "첫 빈 슬롯": the draft's missing_slots first, else the kind's slot order without a usable fact. */
export function firstEmptyDeliverableSlot(state: DeliverableChipState): DeliverableSlot | string | null {
  if (state.missing_slots?.length) return state.missing_slots[0]
  if (!state.writing_kind) return null
  const covered = new Set(state.facts.filter((f) => f.review === "ok" || f.review === "accepted").map((f) => f.slot))
  return DELIVERABLE_SLOTS_BY_KIND[state.writing_kind].find((s) => !covered.has(s.slot))?.slot ?? null
}

function deliverableRowChips(row: DeliverableChipRow, state: DeliverableChipState): QuickChip[] {
  const C = DELIVERABLE_CHIP_COPY
  const missing = firstEmptyDeliverableSlot(state)
  switch (row) {
    case "draft_unavailable":
      // [UI-가정] "다음 슬롯 안내" carries the first empty slot (null while the kind is unknown → the server picks);
      // "부모 description 기반 질문" has no slot (UQ-PA-13)
      return [msg(C.whatToWrite, missing), msg(C.myPartFirst, "contribution"), msg(C.fromProject, null)]
    case "draft_available":
      return [msg(C.composeDraft, null, { requested_action: "compose_draft" }), msg(C.askMissing, missing), msg(C.moreDetail, "contribution")]
    case "draft_exists":
      return [
        msg(C.recompose, null, { requested_action: "compose_draft" }),
        msg(C.shorter, null, { requested_action: "compose_draft", style: "shorter" }),
        msg(C.askMissing, missing),
      ]
  }
}

/**
 * AI-13 at `draft_count = 6`: "초안 칩 자리를 '빠진 부분 물어봐 줘'·'새 대화 시작'으로 바꾼다".
 * // [UI-가정] positional: the compose chips become those two in order, duplicates drop, and "새 대화 시작"
 * is appended when the row had only one compose chip (max 3).
 */
function withDraftLimit(chips: QuickChip[], state: DeliverableChipState): QuickChip[] {
  const C = DELIVERABLE_CHIP_COPY
  const replacements: QuickChip[] = [msg(C.askMissing, firstEmptyDeliverableSlot(state)), { kind: "new_chat", label: C.newChat }]
  const out: QuickChip[] = []
  let next = 0
  for (const chip of chips) {
    const isCompose = chip.kind === "message" && chip.requested_action === "compose_draft"
    const use = isCompose ? replacements[next++] : chip
    if (!use || out.some((c) => c.label === use.label)) continue
    out.push(use)
  }
  if (!out.some((c) => c.kind === "new_chat")) out.push(replacements[1])
  return out.slice(0, 3)
}

export function deliverableQuickChips(state: DeliverableChipState): QuickChip[] {
  const chips = deliverableRowChips(deliverableChipRow(state), state)
  return state.draft_count >= PAGE_LIMITS.maxDrafts ? withDraftLimit(chips, state) : chips
}

// ---------------------------------------------------------------------------
// one entry point + visibility
// ---------------------------------------------------------------------------

export type QuickChipsState = ({ target: "project" } & ProjectChipState) | ({ target: "deliverable" } & DeliverableChipState)

/** The 3 chips for the current form + open chat (AI-12 / AI-13 tables). */
export function quickChips(state: QuickChipsState): QuickChip[] {
  return state.target === "project" ? projectQuickChips(state) : deliverableQuickChips(state)
}

/**
 * The chip row is hidden (UX S-10 [가정] / AI-12): `message_count` ≥ 36, a `closed` chat, or no key
 * (the input area is C-18). While a reply streams the chips stay but are disabled (no layout jump).
 */
export function quickChipsVisible(opts: { message_count: number; closed: boolean; locked: boolean }): boolean {
  return !opts.locked && !opts.closed && opts.message_count < PAGE_LIMITS.chipsHideFrom
}
