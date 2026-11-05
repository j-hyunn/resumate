"use client"

/**
 * S-10 STAR 제안 카드 (`StarProposalCard`, design-system v4 3.24 · C-15 3.14 v4). UX v5.6 S-10 "STAR 제안 카드"
 * ·"반영 규칙"·"분류 추천", AI v4.6 AI-12 "카드 상태 3단계". Plugged into `<AiPanel renderProposal>`.
 *
 * One card per chat. Sections: (기간) → 상황 / 역할 / 행동 / 결과·성과 / 배운 점 → 분류 추천. Per section:
 * 빈 칸 = 새 값 / 내용 있는 칸: op "set" = "기존 내용과 합친 제안"([반영] = 교체, [기존 내용과 비교] — RQ-5; V-9j = "기존 내용 일부가 빠졌을 수 있어요"),
 * op "append"(과거 초안) = "현재 내용 뒤에 붙어요", C-15 칩, 검토 필요 [수락]/[거절(비우기)],
 * ④ "폼에 채움 · 저장 전" / ⑤ "반영됨" / "새 제안이 있어요". [반영] / [모두 반영] ask the page to fill the form
 * Shown as a confirmation line in the thread (혼합형): "N개 섹션을 폼에 반영할까요? [반영]", answered →
 * "상황·행동 반영함"; [자세히] opens the per-section list below (edit / review / single 반영 stay there).
 * (`onFill` → planFill; no AI / DB call); the page remembers `{writing_chat_id, field, rev}`.
 */
import * as React from "react"
import {
  ArrowLeftToLine,
  Check,
  CheckCheck,
  ChevronDown,
  ChevronRight,
  CornerDownRight,
  Info,
  Loader2,
  MessageCircleQuestion,
  Sparkles,
  TriangleAlert,
} from "lucide-react"
import { cn } from "@/lib/utils"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { flashElement } from "@/components/common/doc-inputs"
import { useDocBodyMode } from "@/components/common/shell/doc-body"
import { SourceChip, SourceChips } from "@/components/common/source-chip"
import { markdownToReadable } from "@/components/common/markdown-plain"
import type { AiPanelController } from "@/components/career/ai-panel"
import {
  PAGE_SAVE_SKIP_COPY,
  PANEL_COPY,
  STAR_FIELDS_ORDER,
  dismissedClassifications,
  isBlank,
  type AppliedProjectProposal,
  type ProjectPageValues,
  type ProjectProposalField,
} from "@/lib/data/career-v45-shared"
import { COMPETENCY_LABELS, EXPERIENCE_TYPE_LABELS, PROJECT_TYPE_LABELS, STAR_FIELD_LABELS } from "@/lib/data/labels"
import type { Competency, PageSaveSkipReason, ProjectStructuredDraft } from "@/types/db"
import {
  CLASSIFICATION_FIELDS,
  PERIOD_FIELDS,
  PROPOSAL_FIELDS_ORDER,
  isFillable,
  isFilledNow,
  planFill,
  proposalObject,
  revOf,
  type FillPlan,
  type FillSkipReason,
} from "./star-proposal-fill"

/** 섹션 이름 (토스트·안내 문구) */
export const PROPOSAL_FIELD_LABELS: Record<ProjectProposalField, string> = {
  situation: STAR_FIELD_LABELS.situation.ko,
  task: STAR_FIELD_LABELS.task.ko,
  action: STAR_FIELD_LABELS.action.ko,
  result: STAR_FIELD_LABELS.result.ko,
  learnings: STAR_FIELD_LABELS.learnings.ko,
  // [UI-가정] 기간 제안 섹션 이름 (명세는 "기간"만)
  start_month: "시작월",
  end_month: "종료월",
  project_type: "프로젝트 종류",
  experience_type: "경험 유형",
  competencies: "역량",
}

/**
 * 채우기 단계 건너뜀 문구 (UX S-10 반영 규칙). `classification_already_set` has no line any more (UP-6): the row
 * [반영] overwrites, and [반영 (n)] leaves already-chosen classifications out of n before filling.
 */
export const FILL_SKIP_COPY: Record<Exclude<FillSkipReason, "too_long" | "classification_already_set">, string> = {
  needs_review: "검토하지 않은 섹션은 반영하지 않았어요",
  already_applied: "이미 반영한 섹션이에요",
  empty: "반영할 내용이 없는 섹션은 건너뛰었어요",
  period_already_set: "기간은 이미 입력돼 있어 바꾸지 않았어요",
}

/** UX v5.11 S-10 "2,000자 초과" (교체 = 제안 값, 과거 append = 덧붙인 결과) */
export function tooLongCopy(field: ProjectProposalField): string {
  return `'${PROPOSAL_FIELD_LABELS[field]}'에 채우면 2,000자를 넘어 채우지 못했어요. 칸을 줄인 뒤 다시 [반영]해 주세요`
}

const NEEDS_REVIEW_COPY = "AI가 정리한 표현이 원래 말과 달라요. 확인해 주세요"
/** UX v5.11 S-10 — V-9j (`review_reason = 'existing_missing'`) */
const EXISTING_MISSING_COPY = "기존 내용 일부가 빠졌을 수 있어요"
const ACTOR_COPY = "본인 역할 확인 중 — 팀이 한 일과 본인이 한 일을 AI가 묻고 있어요"
const FILLED_NOTE = "저장하기를 눌러야 저장돼요"

/** Requests from the page: "AI 제안 있음" (field) or a user message click (messageId). */
export interface ProposalFocusRequest {
  field?: ProjectProposalField
  messageId?: string
  nonce: number
}

export interface FillOptions {
  /** 분류 추천 row [반영]: replace what the user already chose */
  overwriteClassification?: boolean
}

export interface StarProposalCardProps {
  panel: AiPanelController
  values: ProjectPageValues
  /** this visit's p_applied_proposals */
  applied: AppliedProjectProposal[]
  /** fill these fields now; resolves the plan the page applied (skips → the bottom lines) */
  onFill: (chatId: string, fields: readonly ProjectProposalField[], opts?: FillOptions) => FillPlan
  /** competency recommendation chips (checked) — owned by the page so [모두 반영] outside the card uses them */
  competencyPick: Competency[] | null
  onCompetencyPickChange: (pick: Competency[]) => void
  /** last save response `skipped` (for the open chat) */
  saveSkips: Array<{ writing_chat_id: string; field: ProjectProposalField; reason: PageSaveSkipReason }>
  focusRequest: ProposalFocusRequest | null
  /** narrow sheet: "STAR에서 보기" */
  onShowInForm: (field: ProjectProposalField) => void
}

const monthLabel = (ym: string) => {
  const [y, m] = ym.split("-")
  return `${y}년 ${Number(m)}월`
}

/** Fields [모두 반영] would act on now (for the count and the closed-chat button). */
export function fillableFields(
  draft: ProjectStructuredDraft,
  chatId: string,
  applied: AppliedProjectProposal[],
  competencyPick: Competency[] | null,
  values: ProjectPageValues,
): ProjectProposalField[] {
  // [무시]한 분류 = the server judgment on the draft (value null, rev ≥ 2), not a browser memory
  const dismissed: ReadonlySet<string> = dismissedClassifications(draft)
  const candidates = PROPOSAL_FIELDS_ORDER.filter((f) => !dismissed.has(f) && isFillable(draft, chatId, f, applied))
  // the count = what [모두 반영] really fills now (form-value checks included, QA UQ-S10-4)
  return planFill({ draft, chatId, values, applied, fields: candidates, competencyPick }).fills.map((x) => x.field)
}

/** Any proposal at all (the dock stays empty without one). */
export function hasProposals(draft: ProjectStructuredDraft | undefined): boolean {
  if (!draft) return false
  return PROPOSAL_FIELDS_ORDER.some((f) => {
    const v = proposalObject(draft, f)?.value
    return Array.isArray(v) ? v.length > 0 : typeof v === "string" ? !isBlank(v) : v != null
  })
}

export function StarProposalCard(props: StarProposalCardProps) {
  const { panel, values, applied, onFill, saveSkips, focusRequest } = props
  const chat = panel.chat
  const draft = chat?.structured_draft as ProjectStructuredDraft | undefined
  // 혼합형 확인 줄: collapsed by default ("자세히" opens the sections)
  const [open, setOpen] = React.useState(false)
  // [무시] clicked, server patch not back yet: hide the row right away (the patched draft then hides it for good)
  const [dismissing, setDismissing] = React.useState<ReadonlySet<string>>(() => new Set())
  const [fillSkips, setFillSkips] = React.useState<FillPlan["skips"]>([])
  const [busy, setBusy] = React.useState(false)
  const rootRef = React.useRef<HTMLDivElement | null>(null)
  const busyAll = panel.responding || busy

  // clear the fill-stage lines when a new turn starts (design-system 3.24 바닥 [가정])
  const phase = panel.phase
  const [lastPhase, setLastPhase] = React.useState(phase)
  if (phase !== lastPhase) {
    setLastPhase(phase)
    if (phase === "streaming") setFillSkips([])
  }

  // 갱신됨: flash sections whose value changed after a turn / patch
  const prevValues = React.useRef<Record<string, string>>({})
  const prevChat = React.useRef<string | null>(null)
  React.useEffect(() => {
    if (!draft || !chat) return
    const now: Record<string, string> = {}
    for (const f of PROPOSAL_FIELDS_ORDER) now[f] = JSON.stringify(proposalObject(draft, f)?.value ?? null)
    if (prevChat.current === chat.id) {
      for (const f of PROPOSAL_FIELDS_ORDER) {
        if (prevValues.current[f] !== undefined && prevValues.current[f] !== now[f]) flashElement(document.getElementById(`star-proposal-${f}`))
      }
    }
    prevChat.current = chat.id
    prevValues.current = now
  }, [draft, chat])

  // page requests: "AI 제안 있음" → that section / user message click → sections citing it
  const [handledNonce, setHandledNonce] = React.useState<number | null>(null)
  if (focusRequest && focusRequest.nonce !== handledNonce) {
    setHandledNonce(focusRequest.nonce)
    if (!open) setOpen(true)
  }
  React.useEffect(() => {
    if (!focusRequest || !draft) return
    const t = window.setTimeout(() => {
      if (focusRequest.field) {
        const el = document.getElementById(`star-proposal-${focusRequest.field}`) ?? document.getElementById("star-proposal-classification")
        el?.scrollIntoView({ block: "nearest", behavior: "smooth" })
        flashElement(el)
      } else if (focusRequest.messageId) {
        const hits = PROPOSAL_FIELDS_ORDER.filter((f) => {
          const o = proposalObject(draft, f) as { source_message_ids?: string[] } | undefined
          return o?.source_message_ids?.includes(focusRequest.messageId!)
        })
        hits.forEach((f, i) => {
          const el = document.getElementById(`star-proposal-${f}`) ?? (CLASSIFICATION_FIELDS.includes(f as never) ? document.getElementById("star-proposal-classification") : null)
          if (i === 0) el?.scrollIntoView({ block: "nearest", behavior: "smooth" })
          flashElement(el)
        })
      }
    }, 80)
    return () => window.clearTimeout(t)
    // the nonce identifies one request
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focusRequest?.nonce])

  if (!chat || !draft || !hasProposals(draft)) return null

  const userNumber = new Map(chat.messages.filter((m) => m.role === "user").map((m) => [m.id, m.user_number]))
  const chips = (ids: string[], quotes: string[] = []) => {
    const list = ids.flatMap((id) => {
      const n = userNumber.get(id)
      return n ? [[id, n] as const] : []
    })
    if (!list.length) return null
    return (
      <SourceChips>
        {list.map(([id, n]) => (
          <SourceChip key={id} kind="utterance" userNumber={n} onSelect={() => panel.flashMessage(id, quotes)} />
        ))}
      </SourceChips>
    )
  }
  const lastAssistantId = [...chat.messages].reverse().find((m) => m.role === "assistant")?.id ?? null

  const fillable = fillableFields(draft, chat.id, applied, props.competencyPick, values)
  const reviewCount = PROPOSAL_FIELDS_ORDER.filter((f) => {
    const o = proposalObject(draft, f)
    return o && o.review === "needs_review" && !o.applied_at && o.value != null
  }).length

  const fill = (fields: readonly ProjectProposalField[], opts?: FillOptions) => {
    const plan = onFill(chat.id, fields, opts)
    setFillSkips(plan.skips)
  }

  const patch = async (p: Parameters<AiPanelController["patchDraft"]>[0]) => {
    setBusy(true)
    // field_already_applied is drawn under the section, not toasted (UQ-S10-13)
    const ok = await panel.patchDraft(p, { inline: true })
    setBusy(false)
    return ok
  }

  const refusal = panel.patchRefusal
  const refusedHere = (f: ProjectProposalField) =>
    Boolean(refusal && refusal.code === "field_already_applied" && "field" in refusal.patch && refusal.patch.field === f)

  const mySaveSkips = saveSkips.filter((s) => s.writing_chat_id === chat.id)
  const changed = new Set(mySaveSkips.filter((s) => s.reason === "proposal_changed").map((s) => s.field))
  /** filled earlier in this visit with an older rev → the AI replaced the proposal */
  const replaced = (f: ProjectProposalField) => {
    const e = applied.find((a) => a.writing_chat_id === chat.id && a.field === f)
    const o = proposalObject(draft, f)
    return Boolean(e && o && e.rev !== revOf(o))
  }

  const sectionState = (f: ProjectProposalField): "applied" | "filled" | "review" | "proposal" => {
    const o = proposalObject(draft, f)!
    if (o.applied_at) return "applied"
    if (isFilledNow(applied, chat.id, f, o)) return "filled"
    if (o.review === "needs_review") return "review"
    return "proposal"
  }

  const bottomLines: string[] = []
  if (reviewCount > 0) bottomLines.push(`검토하지 않은 섹션 ${reviewCount}개는 반영되지 않아요`)
  for (const s of fillSkips) {
    // shown under their own section / row
    if (s.reason === "too_long" || s.reason === "classification_already_set") continue
    const line = FILL_SKIP_COPY[s.reason]
    if (!bottomLines.includes(line)) bottomLines.push(line)
  }
  for (const s of mySaveSkips) {
    const line = PAGE_SAVE_SKIP_COPY[s.reason]
    if (!bottomLines.includes(line)) bottomLines.push(line)
  }

  const summary = panel.phase === "patching" ? null : `반영할 수 있는 섹션 ${fillable.length}${reviewCount ? ` · 검토 필요 ${reviewCount}` : ""}`
  // already reflected (반영됨 / 폼에 채움) sections leave the list — the head line names them ("… 반영함");
  // a newer proposal for the same field (rev changed) is a proposal again and comes back
  const pendingOnly = (f: ProjectProposalField) => {
    const st = sectionState(f)
    return st !== "applied" && st !== "filled"
  }
  // [무시]한 분류 — the server's judgment on this chat's draft (decisions 4.11 UI #3, DM 11.5 #1, R10): never shown
  // again, and the server refuses a later AI proposal for the slot
  const dismissed: ReadonlySet<string> = dismissedClassifications(draft)
  const ignored = (f: ProjectProposalField) => dismissed.has(f) || dismissing.has(`${chat.id}:${f}`)
  const starRows = STAR_FIELDS_ORDER.filter((f) => !isBlank(draft.star[f]?.value ?? null) && pendingOnly(f))
  const periodRows = PERIOD_FIELDS.filter((f) => draft.project[f]?.value && pendingOnly(f))
  const classRows = CLASSIFICATION_FIELDS.filter((f) => {
    const v = draft.classification[f]?.value
    return (Array.isArray(v) ? v.length > 0 : Boolean(v)) && pendingOnly(f) && !ignored(f)
  })
  const hasRows = starRows.length + periodRows.length + classRows.length > 0
  // nothing left to decide (all reflected, ignored, or no proposal yet): no confirmation line at all
  if (!hasRows) return null

  const doneFields = PROPOSAL_FIELDS_ORDER.filter((f) => {
    const o = proposalObject(draft, f)
    if (!o || o.value == null || (Array.isArray(o.value) && o.value.length === 0)) return false
    const st = sectionState(f)
    return st === "applied" || st === "filled"
  })
  const patching = summary === null
  const asking = !patching && !panel.closed && fillable.length > 0
  const reviewSuffix = reviewCount ? ` · 검토 필요 ${reviewCount}개` : ""
  const description = patching
    ? null
    : fillable.length > 0
      ? `${fillable.length}개 섹션을 폼에 반영할까요?${reviewSuffix}`
      : reviewCount
        ? `검토 필요 ${reviewCount}개 · 자세히에서 확인해 주세요`
        : doneFields.length
          ? `${doneFields.map((f) => PROPOSAL_FIELD_LABELS[f]).join("·")} 반영함`
          : "반영할 섹션이 없어요"

  return (
    <div ref={rootRef} className="rounded-xl border bg-card text-card-foreground">
      {/* Confirmation (shadcn AI Elements 방식): media · title · description · actions. Answered → a result line. */}
      <div className="space-y-2.5 px-3 py-2.5">
        <div className="flex items-center gap-2.5">
          <div className="min-w-0 flex-1">
            <p className="text-sm font-semibold">STAR 제안</p>
            {description === null ? (
              <p className="inline-flex items-center gap-1 text-xs text-muted-foreground">
                <Loader2 className="size-3.5 animate-spin" aria-hidden />
                정리 중
              </p>
            ) : (
              <p className="text-xs text-muted-foreground tabular-nums">{description}</p>
            )}
          </div>
          {hasRows ? (
            <Button variant="ghost" size="sm" aria-expanded={open} onClick={() => setOpen((o) => !o)} className="shrink-0 text-muted-foreground">
              {open ? "접기" : "자세히"}
              <ChevronDown className={cn("transition-transform", open && "rotate-180")} aria-hidden />
            </Button>
          ) : null}
        </div>
        {asking ? (
          <div className="flex justify-end">
            <Button size="sm" disabled={busyAll} onClick={() => fill(fillable)}>
              <CheckCheck aria-hidden />
              반영 <span className="tabular-nums">({fillable.length})</span>
            </Button>
          </div>
        ) : null}
        {bottomLines.length ? (
          <ul className="space-y-0.5" aria-live="polite">
            {bottomLines.map((l) => (
              <li key={l} className="flex items-start gap-1.5 text-xs text-muted-foreground">
                <Info className="mt-px size-3.5 shrink-0" aria-hidden />
                {l}
              </li>
            ))}
          </ul>
        ) : null}
      </div>
      {open && hasRows ? (
        <>
          <div className="divide-y border-t">
            {periodRows.length ? (
              <PeriodSection
                draft={draft}
                fields={periodRows}
                state={sectionState}
                busy={busyAll}
                onFill={fill}
                chips={chips}
                onShowInForm={props.onShowInForm}
              />
            ) : null}
            {starRows.map((f) => {
              const o = draft.star[f]!
              const st = sectionState(f)
              const formValue = values[f]
              const hasFormValue = !isBlank(formValue)
              // RQ-5: "set" on a filled field = 기존 내용과 합친 전체 문장 → [반영]이 교체. "append" = 과거 초안.
              const appendMode = hasFormValue && o.op === "append"
              const mergedMode = hasFormValue && o.op !== "append"
              const actor = draft.clarifications.some((c) => c.kind === "actor_ambiguous" && c.field === f)
              const tooLong = fillSkips.some((s) => s.field === f && s.reason === "too_long")
              const content = (
                <>
                  <div className="flex items-center gap-2">
                    <h3 className="text-sm font-medium">{PROPOSAL_FIELD_LABELS[f]}</h3>
                    {actor ? (
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <button
                            type="button"
                            onClick={() => lastAssistantId && panel.flashMessage(lastAssistantId)}
                            className="rounded-md focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
                          >
                            <Badge variant="info" className="gap-1">
                              <MessageCircleQuestion className="size-3" aria-hidden />
                              본인 역할 확인 중
                            </Badge>
                          </button>
                        </TooltipTrigger>
                        <TooltipContent className="max-w-xs">{ACTOR_COPY}</TooltipContent>
                      </Tooltip>
                    ) : null}
                    <div className="ml-auto flex items-center gap-1">
                      {st === "applied" ? (
                        <Badge variant="success" className="gap-1">
                          <Check className="size-3" aria-hidden />
                          반영됨
                        </Badge>
                      ) : st === "filled" ? (
                        <Badge variant="info" className="gap-1">
                          <ArrowLeftToLine className="size-3" aria-hidden />
                          폼에 채움
                        </Badge>
                      ) : st === "proposal" ? (
                        <>
                          {changed.has(f) || replaced(f) ? (
                            <Badge variant="ai" className="gap-1">
                              <Sparkles className="size-3" aria-hidden />
                              새 제안이 있어요
                            </Badge>
                          ) : !hasFormValue ? (
                            <span className="text-xs text-muted-foreground">새 값</span>
                          ) : mergedMode ? (
                            <span className="text-xs text-muted-foreground">기존 내용과 합친 제안</span>
                          ) : null}
                          <Button size="sm" disabled={busyAll} onClick={() => fill([f])}>
                            반영
                          </Button>
                        </>
                      ) : null}
                    </div>
                  </div>
                  {st === "review" ? (
                    <p className="flex items-start gap-1.5 text-sm text-warning-subtle-foreground">
                      <TriangleAlert className="mt-0.5 size-4 shrink-0 text-warning" aria-hidden />
                      {o.review_reason === "existing_missing" ? EXISTING_MISSING_COPY : NEEDS_REVIEW_COPY}
                    </p>
                  ) : null}
                  {st === "applied" ? (
                    <AppliedValue value={markdownToReadable(o.value ?? "")} />
                  ) : appendMode && st !== "filled" ? (
                    <div className="space-y-1">
                      <p className="flex items-center gap-1 text-xs text-muted-foreground">
                        <CornerDownRight className="size-3.5" aria-hidden />
                        현재 내용 뒤에 붙어요
                      </p>
                      <p className="line-clamp-2 text-sm text-muted-foreground">{markdownToReadable(formValue ?? "").trim().split("\n").pop()}</p>
                      <p className="rounded-md bg-ai-subtle px-2 py-1.5 text-sm leading-6 whitespace-pre-wrap text-ai-subtle-foreground">{markdownToReadable(o.value ?? "")}</p>
                    </div>
                  ) : mergedMode && st !== "filled" ? (
                    <div className="space-y-1">
                      <p className="text-sm leading-6 whitespace-pre-wrap">{markdownToReadable(o.value ?? "")}</p>
                      <Collapsible>
                        <CollapsibleTrigger asChild>
                          <Button variant="ghost" size="xs" className="group/prev -ml-2 text-muted-foreground">
                            <ChevronRight className="size-3.5 transition-transform group-data-[state=open]/prev:rotate-90" aria-hidden />
                            기존 내용과 비교
                          </Button>
                        </CollapsibleTrigger>
                        {/* UX v5.11 S-10: 펼치면 지금 폼 값(저장 전 입력 포함)과 제안을 나란히 */}
                        <CollapsibleContent className="mt-1 space-y-1">
                          <p className="text-xs text-muted-foreground">[반영]하면 지금 폼 값이 제안으로 바뀌어요</p>
                          <div className="grid gap-2 sm:grid-cols-2">
                            <div className="space-y-1">
                              <p className="text-xs font-medium text-muted-foreground">지금 폼 값</p>
                              <p className="rounded-md bg-muted px-2 py-1.5 text-sm leading-6 whitespace-pre-wrap text-muted-foreground">{markdownToReadable(formValue ?? "")}</p>
                            </div>
                            <div className="space-y-1">
                              <p className="text-xs font-medium text-muted-foreground">제안</p>
                              <p className="rounded-md bg-ai-subtle px-2 py-1.5 text-sm leading-6 whitespace-pre-wrap text-ai-subtle-foreground">{markdownToReadable(o.value ?? "")}</p>
                            </div>
                          </div>
                        </CollapsibleContent>
                      </Collapsible>
                    </div>
                  ) : (
                    <p className="text-sm leading-6 whitespace-pre-wrap">{markdownToReadable(o.value ?? "")}</p>
                  )}
                  {st === "filled" ? <FilledNote onShow={() => props.onShowInForm(f)} /> : null}
                  {o.origin === "user_edit" ? null : chips(o.source_message_ids, o.source_quotes)}
                  {o.review === "accepted" && st === "proposal" ? (
                    <p className="flex items-center gap-1 text-xs text-success-subtle-foreground">
                      <Check className="size-3" aria-hidden />
                      수락함
                    </p>
                  ) : null}
                  {st === "review" ? (
                    <div className="flex gap-2 pt-1">
                      <Button variant="outline" size="sm" disabled={busyAll} onClick={() => void patch({ kind: "review", section: "star", field: f, decision: "accept" })}>
                        수락
                      </Button>
                      <Button variant="ghost" size="sm" disabled={busyAll} onClick={() => void patch({ kind: "review", section: "star", field: f, decision: "reject" })}>
                        거절(비우기)
                      </Button>
                    </div>
                  ) : null}
                  {refusedHere(f) ? <p className="text-sm text-muted-foreground">{PANEL_COPY.alreadyApplied}</p> : null}
                  {tooLong ? (
                    <p className="flex items-start gap-1.5 text-sm text-warning-subtle-foreground">
                      <TriangleAlert className="mt-0.5 size-3.5 shrink-0 text-warning" aria-hidden />
                      {tooLongCopy(f)}
                    </p>
                  ) : null}
                </>
              )
              return (
                <section key={f} id={`star-proposal-${f}`} aria-label={`${PROPOSAL_FIELD_LABELS[f]} 제안`} className="space-y-2 px-4 py-3">
                  {st === "review" ? <div className="space-y-2 rounded-md border border-warning bg-warning-subtle p-3">{content}</div> : content}
                </section>
              )
            })}
            {classRows.length ? (
              <ClassificationGroup
                draft={draft}
                fields={classRows}
                state={sectionState}
                busy={busyAll}
                onFill={fill}
                chips={chips}
                pick={props.competencyPick}
                onPickChange={props.onCompetencyPickChange}
                onShowInForm={props.onShowInForm}
                // 무시: user `set` null on the server — the slot becomes {value: null, rev + 1} = dismissed in this chat
                onIgnore={(f) => {
                  const key = `${chat.id}:${f}`
                  setDismissing((prev) => new Set(prev).add(key))
                  void patch({ kind: "edit", section: "classification", field: f, value: null }).then((ok) => {
                    // refused / failed: the proposal comes back (the patch error is shown by the panel)
                    if (!ok)
                      setDismissing((prev) => {
                        const next = new Set(prev)
                        next.delete(key)
                        return next
                      })
                  })
                }}
              />
            ) : null}
          </div>
        </>
      ) : null}
    </div>
  )
}

function FilledNote({ onShow }: { onShow: () => void }) {
  const { mode } = useDocBodyMode()
  return (
    <p className="flex flex-wrap items-center gap-x-2 text-xs text-info-subtle-foreground">
      {FILLED_NOTE}
      {mode === "narrow" ? (
        <Button variant="link" size="sm" className="h-auto px-0 text-xs" onClick={onShow}>
          STAR에서 보기
        </Button>
      ) : null}
    </p>
  )
}

function AppliedValue({ value }: { value: string }) {
  const [expanded, setExpanded] = React.useState(false)
  return (
    <button
      type="button"
      aria-expanded={expanded}
      onClick={() => setExpanded((e) => !e)}
      className={cn("w-full rounded-sm text-left text-sm leading-6 whitespace-pre-wrap text-muted-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none", !expanded && "line-clamp-2")}
    >
      {value}
    </button>
  )
}

type ChipsFn = (ids: string[], quotes?: string[]) => React.ReactNode
type StateFn = (f: ProjectProposalField) => "applied" | "filled" | "review" | "proposal"

function RowState({
  st,
  busy,
  fillDisabled,
  onFill,
  onIgnore,
  onShow,
  label,
}: {
  st: ReturnType<StateFn>
  busy: boolean
  fillDisabled?: boolean
  onFill: () => void
  /** 분류 추천: [무시] (ghost) next to a primary [반영] */
  onIgnore?: () => void
  onShow: () => void
  label: string
}) {
  if (st === "applied")
    return (
      <Badge variant="success" className="gap-1">
        <Check className="size-3" aria-hidden />
        반영됨
      </Badge>
    )
  if (st === "filled")
    return (
      <span className="flex flex-col items-end gap-0.5">
        <Badge variant="info" className="gap-1">
          <ArrowLeftToLine className="size-3" aria-hidden />
          폼에 채움
        </Badge>
        <FilledNote onShow={onShow} />
      </span>
    )
  if (onIgnore)
    return (
      <span className="flex items-center gap-1">
        <Button variant="ghost" size="sm" disabled={busy} onClick={onIgnore} aria-label={`${label} 추천 무시`}>
          무시
        </Button>
        <Button size="sm" disabled={busy || fillDisabled} onClick={onFill} aria-label={`${label} 반영`}>
          반영
        </Button>
      </span>
    )
  return (
    <Button size="sm" disabled={busy || fillDisabled} onClick={onFill} aria-label={`${label} 반영`}>
      반영
    </Button>
  )
}

/** [UI-가정] 기간 제안(빈 기간만, AI-12 슬롯 0) — 명세에 카드 모양이 없어 STAR 섹션과 같은 줄 모양으로 둔다 */
function PeriodSection({
  draft,
  fields,
  state,
  busy,
  onFill,
  chips,
  onShowInForm,
}: {
  draft: ProjectStructuredDraft
  fields: Array<(typeof PERIOD_FIELDS)[number]>
  state: StateFn
  busy: boolean
  onFill: (f: readonly ProjectProposalField[]) => void
  chips: ChipsFn
  onShowInForm: (f: ProjectProposalField) => void
}) {
  return (
    <section id="star-proposal-start_month" aria-label="진행 기간 제안" className="space-y-2 px-4 py-3">
      <h3 className="text-sm font-medium">진행 기간</h3>
      {fields.map((f) => {
        const o = draft.project[f]!
        return (
          <div key={f} id={f === "end_month" ? "star-proposal-end_month" : undefined} className="space-y-1">
            <div className="flex items-center gap-2">
              <span className="text-sm text-muted-foreground">{PROPOSAL_FIELD_LABELS[f]}</span>
              <span className="text-sm">{monthLabel(o.value ?? "")}</span>
              <span className="ml-auto">
                <RowState st={state(f)} busy={busy} onFill={() => onFill([f])} onShow={() => onShowInForm(f)} label={PROPOSAL_FIELD_LABELS[f]} />
              </span>
            </div>
            {chips(o.source_message_ids, o.source_quotes)}
          </div>
        )
      })}
    </section>
  )
}

function ClassificationGroup({
  draft,
  fields,
  state,
  busy,
  onFill,
  chips,
  pick,
  onPickChange,
  onShowInForm,
  onIgnore,
}: {
  draft: ProjectStructuredDraft
  fields: Array<(typeof CLASSIFICATION_FIELDS)[number]>
  state: StateFn
  busy: boolean
  onFill: (f: readonly ProjectProposalField[], opts?: FillOptions) => void
  chips: ChipsFn
  pick: Competency[] | null
  onPickChange: (p: Competency[]) => void
  onShowInForm: (f: ProjectProposalField) => void
  onIgnore: (f: ProjectProposalField) => void
}) {
  // row [반영] replaces a classification the user already chose (the recommendation wins)
  const overwrite = { overwriteClassification: true }
  const sources = [...new Set(fields.flatMap((f) => draft.classification[f]?.source_message_ids ?? []))]
  return (
    <section id="star-proposal-classification" aria-label="분류 추천" className="space-y-3 bg-muted/40 px-4 py-3">
      <div className="space-y-0.5">
        <h3 className="text-sm font-medium">분류 추천</h3>
        <p className="text-xs text-muted-foreground">이 대화를 보고 추천했어요</p>
        {chips(sources)}
      </div>
      {fields.map((f) => {
        const o = draft.classification[f]!
        const st = state(f)
        if (f === "competencies") {
          const offered = ((o.value as Competency[] | null) ?? []).slice(0, 3)
          const checked = pick ?? offered
          const disabled = st !== "proposal"
          return (
            <div key={f} id="star-proposal-competencies" className="space-y-1">
              <div className="grid grid-cols-[6.25rem_minmax(0,1fr)_auto] items-center gap-2">
                <span className="text-sm text-muted-foreground">역량</span>
                <div className="flex flex-wrap gap-1.5" role="group" aria-label="추천 역량">
                  {offered.map((c) => (
                    <label
                      key={c}
                      className="inline-flex h-7 cursor-pointer items-center gap-1.5 rounded-full border border-input px-2.5 text-sm has-[:checked]:border-primary/50 has-[:checked]:bg-primary-subtle has-[:checked]:text-primary-subtle-foreground has-[[data-state=checked]]:border-primary/50 has-[[data-state=checked]]:bg-primary-subtle has-[[data-state=checked]]:text-primary-subtle-foreground"
                    >
                      <Checkbox
                        className="size-3.5"
                        checked={checked.includes(c)}
                        disabled={disabled}
                        onCheckedChange={(on) => onPickChange(on === true ? offered.filter((x) => x === c || checked.includes(x)) : checked.filter((x) => x !== c))}
                      />
                      {COMPETENCY_LABELS[c]}
                    </label>
                  ))}
                </div>
                <RowState
                  st={st}
                  busy={busy}
                  fillDisabled={st === "proposal" && checked.length === 0}
                  onFill={() => onFill([f], overwrite)}
                  onIgnore={() => onIgnore(f)}
                  onShow={() => onShowInForm(f)}
                  label="역량"
                />
              </div>
              {o.reason ? <p className="text-xs text-muted-foreground">{o.reason}</p> : null}
            </div>
          )
        }
        const label = f === "project_type" ? PROJECT_TYPE_LABELS[o.value as keyof typeof PROJECT_TYPE_LABELS] : EXPERIENCE_TYPE_LABELS[o.value as keyof typeof EXPERIENCE_TYPE_LABELS]
        return (
          <div key={f} id={`star-proposal-${f}`} className="space-y-1">
            <div className="grid grid-cols-[6.25rem_minmax(0,1fr)_auto] items-center gap-2">
              <span className="text-sm text-muted-foreground">{PROPOSAL_FIELD_LABELS[f]}</span>
              <span className="flex min-w-0 items-center gap-1.5 text-sm">
                추천:
                <Badge variant="secondary" className="h-7 rounded-full px-2.5 text-sm">
                  {label}
                </Badge>
              </span>
              <RowState
                st={st}
                busy={busy}
                onFill={() => onFill([f], overwrite)}
                onIgnore={() => onIgnore(f)}
                onShow={() => onShowInForm(f)}
                label={PROPOSAL_FIELD_LABELS[f]}
              />
            </div>
            {o.reason ? <p className="text-xs text-muted-foreground">{o.reason}</p> : null}
          </div>
        )
      })}
    </section>
  )
}
