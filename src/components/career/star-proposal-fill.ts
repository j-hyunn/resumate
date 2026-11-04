/**
 * S-10 STAR 제안 카드 — 채우기 규칙 (pure, client-safe). UX v5.6 S-10 "반영 규칙"·"분류 추천", AI v4.6 AI-12
 * "채우기 규칙", DM v4.5 2.5.1 `p_applied_proposals`.
 *
 * [반영] / [모두 반영] only fill the left form (no AI / DB call). The page applies the returned `fills`,
 * remembers `{writing_chat_id, field, rev}` and shows the `skips` lines (화면 판정 이름).
 */
import type { Competency, ProjectStarField, ProjectStructuredDraft } from "@/types/db"
import {
  PAGE_LIMITS,
  STAR_FIELDS_ORDER,
  isBlank,
  type AppliedProjectProposal,
  type ProjectPageValues,
  type ProjectProposalField,
} from "@/lib/data/career-v45-shared"

/** 채우기 단계 건너뜀 (화면 판정 이름 — RPC는 돌려주지 않음) + 2,000자 초과 */
export type FillSkipReason = "needs_review" | "already_applied" | "empty" | "period_already_set" | "classification_already_set" | "too_long"

export interface FillEntry {
  field: ProjectProposalField
  /** the form value before the fill (되돌리기) */
  prev: ProjectPageValues[keyof ProjectPageValues]
  /** the form value after the fill */
  next: ProjectPageValues[keyof ProjectPageValues]
  rev: number
}

export interface FillPlan {
  fills: FillEntry[]
  skips: Array<{ field: ProjectProposalField; reason: FillSkipReason }>
}

export const CLASSIFICATION_FIELDS = ["project_type", "experience_type", "competencies"] as const
export const PERIOD_FIELDS = ["start_month", "end_month"] as const

/** Every field a card can propose, in card order (기간 → STAR → 분류). */
export const PROPOSAL_FIELDS_ORDER: readonly ProjectProposalField[] = [...PERIOD_FIELDS, ...STAR_FIELDS_ORDER, ...CLASSIFICATION_FIELDS]

const STAR_SET = new Set<string>(STAR_FIELDS_ORDER)
export const isStarField = (f: ProjectProposalField): f is ProjectStarField => STAR_SET.has(f)
const isPeriodField = (f: ProjectProposalField): f is (typeof PERIOD_FIELDS)[number] => f === "start_month" || f === "end_month"

interface AnyFieldObject {
  value: unknown
  review: string
  applied_at: string | null
  rev?: number
}

/** The draft's field object for a proposal field (undefined = no proposal). */
export function proposalObject(draft: ProjectStructuredDraft, field: ProjectProposalField): AnyFieldObject | undefined {
  if (isPeriodField(field)) return draft.project[field]
  if (isStarField(field)) return draft.star[field]
  return draft.classification[field] as AnyFieldObject | undefined
}

export const revOf = (obj: { rev?: number } | undefined): number => obj?.rev ?? 1

function hasValue(v: unknown): boolean {
  if (v == null) return false
  if (Array.isArray(v)) return v.length > 0
  return typeof v === "string" ? !isBlank(v) : true
}

/** The entry this page visit holds for (chat, field) — any rev. */
export function filledEntry(applied: AppliedProjectProposal[], chatId: string, field: ProjectProposalField): AppliedProjectProposal | undefined {
  return applied.find((a) => a.writing_chat_id === chatId && a.field === field)
}

/** ④ 폼에 채움 · 저장 전: filled with the current rev (a newer rev = a new proposal). */
export function isFilledNow(applied: AppliedProjectProposal[], chatId: string, field: ProjectProposalField, obj: { rev?: number } | undefined): boolean {
  const e = filledEntry(applied, chatId, field)
  return Boolean(e && obj && e.rev === revOf(obj))
}

/** Can [반영] act on this field now (before the form-value checks)? */
export function isFillable(draft: ProjectStructuredDraft, chatId: string, field: ProjectProposalField, applied: AppliedProjectProposal[]): boolean {
  const obj = proposalObject(draft, field)
  if (!obj || !hasValue(obj.value) || obj.applied_at) return false
  if (obj.review === "needs_review") return false
  return !isFilledNow(applied, chatId, field, obj)
}

/** 'YYYY-MM' (draft) → 'YYYY-MM-01' (form). */
const toFormMonth = (ym: string): string => (ym.length === 7 ? `${ym}-01` : ym)

/**
 * Plan the fill of `fields` against the current form values. `competencyPick` = the checked recommendation
 * chips (partial pick → only those; empty → competencies are not filled and no entry is made).
 */
export function planFill(input: {
  draft: ProjectStructuredDraft
  chatId: string
  values: ProjectPageValues
  applied: AppliedProjectProposal[]
  fields: readonly ProjectProposalField[]
  competencyPick?: Competency[] | null
  /** 분류 추천 row [반영]: replace a classification the user already chose (no classification_already_set skip) */
  overwriteClassification?: boolean
}): FillPlan {
  const { draft, chatId, values, applied, fields } = input
  const plan: FillPlan = { fills: [], skips: [] }
  for (const field of fields) {
    const obj = proposalObject(draft, field)
    if (!obj) continue
    if (!hasValue(obj.value)) {
      plan.skips.push({ field, reason: "empty" })
      continue
    }
    if (obj.applied_at || isFilledNow(applied, chatId, field, obj)) {
      plan.skips.push({ field, reason: "already_applied" })
      continue
    }
    if (obj.review === "needs_review") {
      plan.skips.push({ field, reason: "needs_review" })
      continue
    }
    const rev = revOf(obj)
    if (isStarField(field)) {
      const current = values[field]
      const proposed = String(obj.value)
      // RQ-5 (2026-11-04): "set" = 기존 내용과 합친 전체 문장 → 폼 항목 교체(prev 보관 → 되돌리기).
      // "append" = 과거 초안 호환 → 기존 값 뒤에 이어 붙임.
      const op = (obj as { op?: "set" | "append" }).op ?? "set"
      const next = op === "append" && !isBlank(current) ? `${current}\n${proposed}` : proposed
      if (next.length > PAGE_LIMITS.star) plan.skips.push({ field, reason: "too_long" })
      else plan.fills.push({ field, prev: current, next, rev })
      continue
    }
    if (isPeriodField(field)) {
      if (values[field] || (field === "end_month" && values.is_current)) {
        plan.skips.push({ field, reason: "period_already_set" })
        continue
      }
      plan.fills.push({ field, prev: values[field], next: toFormMonth(String(obj.value)), rev })
      continue
    }
    if (field === "competencies") {
      if (values.competencies.length > 0 && !input.overwriteClassification) {
        plan.skips.push({ field, reason: "classification_already_set" })
        continue
      }
      const offered = (obj.value as Competency[]).slice(0, 3)
      const pick = input.competencyPick ? offered.filter((c) => input.competencyPick!.includes(c)) : offered
      // nothing checked: no fill, no entry (UX S-10 분류 추천)
      if (!pick.length) continue
      plan.fills.push({ field, prev: values.competencies, next: pick, rev })
      continue
    }
    if (values[field] && !input.overwriteClassification) {
      plan.skips.push({ field, reason: "classification_already_set" })
      continue
    }
    plan.fills.push({ field, prev: values[field], next: obj.value as ProjectPageValues[typeof field], rev })
  }
  return plan
}

/** Apply a plan to the form values. */
export function applyFills(values: ProjectPageValues, fills: FillEntry[]): ProjectPageValues {
  const next = { ...values } as Record<string, unknown>
  for (const f of fills) next[f.field] = f.next
  return next as unknown as ProjectPageValues
}

/** p_applied_proposals after a plan: one entry per (chat, field), the latest rev wins. */
export function mergeApplied(applied: AppliedProjectProposal[], chatId: string, fills: FillEntry[]): AppliedProjectProposal[] {
  const fields = new Set(fills.map((f) => f.field))
  return [...applied.filter((a) => !(a.writing_chat_id === chatId && fields.has(a.field))), ...fills.map((f) => ({ writing_chat_id: chatId, field: f.field, rev: f.rev }))]
}

/** After a successful save: mark the open chat's applied fields (`applied_at`) on a draft copy. */
export function markDraftApplied(draft: ProjectStructuredDraft, fields: ProjectProposalField[], at: string): ProjectStructuredDraft {
  const d = structuredClone(draft)
  for (const field of fields) {
    const obj = proposalObject(d, field)
    if (obj) obj.applied_at = at
  }
  return d
}
