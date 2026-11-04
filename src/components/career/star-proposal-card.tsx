"use client"

/**
 * S-10 STAR 제안 카드 (`StarProposalCard`, design-system v4 3.24 · C-15 3.14 v4). UX v5.6 S-10 "STAR 제안 카드"
 * ·"반영 규칙"·"분류 추천", AI v4.6 AI-12 "카드 상태 3단계". Plugged into `<AiPanel renderProposal>`.
 *
 * One card per chat. Sections: (기간) → 상황 / 역할 / 행동 / 결과·성과 / 배운 점 → 분류 추천. Per section:
 * 빈 칸 = 새 값 / 내용 있는 칸: op "set" = "기존 내용과 합친 제안"([반영] = 교체, [기존 내용과 비교] — RQ-5; V-9j = "기존 내용 일부가 빠졌을 수 있어요"),
 * op "append"(과거 초안) = "현재 내용 뒤에 붙어요", C-15 칩, 검토 필요 [수락]/[거절(비우기)], 직접 고치기,
 * ④ "폼에 채움 · 저장 전" / ⑤ "반영됨" / "새 제안이 있어요". [반영] / [모두 반영] ask the page to fill the form
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
  ListChecks,
  Loader2,
  MessageCircleQuestion,
  PenLine,
  Pencil,
  Sparkles,
  TriangleAlert,
} from "lucide-react"
import { cn } from "@/lib/utils"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible"
import { Textarea } from "@/components/ui/textarea"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { flashElement } from "@/components/common/doc-inputs"
import { useDocBodyMode } from "@/components/common/shell/doc-body"
import { SourceChip, SourceChips } from "@/components/common/source-chip"
import type { AiPanelController } from "@/components/career/ai-panel"
import {
  PAGE_LIMITS,
  PAGE_SAVE_SKIP_COPY,
  PANEL_COPY,
  STAR_FIELDS_ORDER,
  isBlank,
  type AppliedProjectProposal,
  type ProjectPageValues,
  type ProjectProposalField,
} from "@/lib/data/career-v45-shared"
import { COMPETENCY_LABELS, EXPERIENCE_TYPE_LABELS, PROJECT_TYPE_LABELS, STAR_FIELD_LABELS } from "@/lib/data/labels"
import type { Competency, PageSaveSkipReason, ProjectStarField, ProjectStructuredDraft } from "@/types/db"
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

/** 채우기 단계 건너뜀 문구 (UX S-10 반영 규칙) */
export const FILL_SKIP_COPY: Record<Exclude<FillSkipReason, "too_long">, string> = {
  needs_review: "검토하지 않은 섹션은 반영하지 않았어요",
  already_applied: "이미 반영한 섹션이에요",
  empty: "반영할 내용이 없는 섹션은 건너뛰었어요",
  period_already_set: "기간은 이미 입력돼 있어 바꾸지 않았어요",
  classification_already_set: "이미 직접 고른 분류는 바꾸지 않았어요",
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

export interface StarProposalCardProps {
  panel: AiPanelController
  values: ProjectPageValues
  /** this visit's p_applied_proposals */
  applied: AppliedProjectProposal[]
  /** fill these fields now; resolves the plan the page applied (skips → the bottom lines) */
  onFill: (chatId: string, fields: readonly ProjectProposalField[]) => FillPlan
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
  const candidates = PROPOSAL_FIELDS_ORDER.filter((f) => isFillable(draft, chatId, f, applied))
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
  const [open, setOpen] = React.useState(true)
  const [fillSkips, setFillSkips] = React.useState<FillPlan["skips"]>([])
  const [editing, setEditing] = React.useState<ProjectStarField | null>(null)
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

  const fill = (fields: readonly ProjectProposalField[]) => {
    const plan = onFill(chat.id, fields)
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
  const starRows = STAR_FIELDS_ORDER.filter((f) => !isBlank(draft.star[f]?.value ?? null))
  const periodRows = PERIOD_FIELDS.filter((f) => draft.project[f]?.value)
  const classRows = CLASSIFICATION_FIELDS.filter((f) => {
    const v = draft.classification[f]?.value
    return Array.isArray(v) ? v.length > 0 : Boolean(v)
  })

  return (
    <div ref={rootRef} className="mb-3 rounded-xl border bg-card text-card-foreground">
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center gap-2 rounded-xl px-4 py-3 text-left focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
      >
        <ListChecks className="size-4 text-muted-foreground" aria-hidden />
        <span className="text-sm font-semibold">STAR 제안</span>
        {summary === null ? (
          <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
            <Loader2 className="size-3.5 animate-spin" aria-hidden />
            정리 중
          </span>
        ) : (
          <span className="text-xs text-muted-foreground tabular-nums">{summary}</span>
        )}
        <ChevronDown className={cn("ml-auto size-4 transition-transform", open && "rotate-180")} aria-hidden />
      </button>
      {open ? (
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
                      ) : st === "proposal" && editing !== f ? (
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
                          <Button variant="outline" size="sm" disabled={busyAll} onClick={() => fill([f])}>
                            반영
                          </Button>
                          <Button variant="ghost" size="icon-sm" aria-label={`${PROPOSAL_FIELD_LABELS[f]} 직접 고치기`} disabled={busyAll} onClick={() => setEditing(f)}>
                            <Pencil aria-hidden />
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
                  {editing === f ? (
                    <StarEdit
                      initial={o.value ?? ""}
                      label={PROPOSAL_FIELD_LABELS[f]}
                      busy={busyAll}
                      onCancel={() => setEditing(null)}
                      onSave={async (value) => {
                        const ok = await patch({ kind: "edit", section: "star", field: f, value: value.trim() ? value : null })
                        if (ok) setEditing(null)
                      }}
                    />
                  ) : st === "applied" ? (
                    <AppliedValue value={o.value ?? ""} />
                  ) : appendMode && st !== "filled" ? (
                    <div className="space-y-1">
                      <p className="flex items-center gap-1 text-xs text-muted-foreground">
                        <CornerDownRight className="size-3.5" aria-hidden />
                        현재 내용 뒤에 붙어요
                      </p>
                      <p className="line-clamp-2 text-sm text-muted-foreground">{(formValue ?? "").trim().split("\n").pop()}</p>
                      <p className="rounded-md bg-ai-subtle px-2 py-1.5 text-sm leading-6 whitespace-pre-wrap text-ai-subtle-foreground">{o.value}</p>
                    </div>
                  ) : mergedMode && st !== "filled" ? (
                    <div className="space-y-1">
                      <p className="text-sm leading-6 whitespace-pre-wrap">{o.value}</p>
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
                              <p className="rounded-md bg-muted px-2 py-1.5 text-sm leading-6 whitespace-pre-wrap text-muted-foreground">{formValue}</p>
                            </div>
                            <div className="space-y-1">
                              <p className="text-xs font-medium text-muted-foreground">제안</p>
                              <p className="rounded-md bg-ai-subtle px-2 py-1.5 text-sm leading-6 whitespace-pre-wrap text-ai-subtle-foreground">{o.value}</p>
                            </div>
                          </div>
                        </CollapsibleContent>
                      </Collapsible>
                    </div>
                  ) : (
                    <p className="text-sm leading-6 whitespace-pre-wrap">{o.value}</p>
                  )}
                  {st === "filled" ? <FilledNote onShow={() => props.onShowInForm(f)} /> : null}
                  {o.origin === "user_edit" ? (
                    <p className="flex items-center gap-1 text-xs text-muted-foreground">
                      <PenLine className="size-3" aria-hidden />
                      직접 수정
                    </p>
                  ) : (
                    chips(o.source_message_ids, o.source_quotes)
                  )}
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
                values={values}
                state={sectionState}
                busy={busyAll}
                onFill={fill}
                chips={chips}
                pick={props.competencyPick}
                onPickChange={props.onCompetencyPickChange}
                alreadySet={fillSkips.filter((s) => s.reason === "classification_already_set").map((s) => s.field)}
                onShowInForm={props.onShowInForm}
              />
            ) : null}
          </div>
          <div className="sticky bottom-0 space-y-2 rounded-b-xl border-t bg-card px-4 py-3">
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
            {/* a closed chat shows [모두 반영] in the closed box (renderClosedActions) — one button only (QA UQ-S10-3) */}
            {panel.closed ? null : (
              <div className="flex justify-end">
                <Button variant="outline" size="sm" disabled={busyAll || fillable.length === 0} onClick={() => fill(fillable)}>
                  <CheckCheck aria-hidden />
                  모두 반영 <span className="tabular-nums">({fillable.length})</span>
                </Button>
              </div>
            )}
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

function StarEdit({ initial, label, busy, onSave, onCancel }: { initial: string; label: string; busy: boolean; onSave: (v: string) => void; onCancel: () => void }) {
  const [value, setValue] = React.useState(initial)
  return (
    <div className="space-y-2">
      <Textarea
        aria-label={`${label} 제안 고치기`}
        autoFocus
        value={value}
        maxLength={PAGE_LIMITS.star}
        onChange={(e) => setValue(e.target.value)}
        className="field-sizing-content min-h-20 text-sm"
      />
      <div className="flex gap-2">
        {/* [UI-가정] 버튼 글자 "저장" = 제안 고치기(apply_structured_draft_patch), 커리어 저장 아님 */}
        <Button variant="outline" size="sm" disabled={busy} onClick={() => onSave(value)}>
          저장
        </Button>
        <Button variant="ghost" size="sm" disabled={busy} onClick={onCancel}>
          취소
        </Button>
      </div>
    </div>
  )
}

type ChipsFn = (ids: string[], quotes?: string[]) => React.ReactNode
type StateFn = (f: ProjectProposalField) => "applied" | "filled" | "review" | "proposal"

function RowState({ st, busy, onFill, onShow, label }: { st: ReturnType<StateFn>; busy: boolean; onFill: () => void; onShow: () => void; label: string }) {
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
  return (
    <Button variant="outline" size="sm" disabled={busy} onClick={onFill} aria-label={`${label} 반영`}>
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
  values,
  state,
  busy,
  onFill,
  chips,
  pick,
  onPickChange,
  alreadySet,
  onShowInForm,
}: {
  draft: ProjectStructuredDraft
  fields: Array<(typeof CLASSIFICATION_FIELDS)[number]>
  values: ProjectPageValues
  state: StateFn
  busy: boolean
  onFill: (f: readonly ProjectProposalField[]) => void
  chips: ChipsFn
  pick: Competency[] | null
  onPickChange: (p: Competency[]) => void
  alreadySet: ProjectProposalField[]
  onShowInForm: (f: ProjectProposalField) => void
}) {
  const sources = [...new Set(fields.flatMap((f) => draft.classification[f]?.source_message_ids ?? []))]
  // leader K1: UX v5.6 copy only — the row repeats the bottom line "이미 직접 고른 분류는 바꾸지 않았어요"
  const note = (f: ProjectProposalField) =>
    alreadySet.includes(f) ? <p className="text-sm text-muted-foreground">{FILL_SKIP_COPY.classification_already_set}</p> : null
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
          const disabled = st !== "proposal" || values.competencies.length > 0
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
                <RowState st={st} busy={busy || (st === "proposal" && checked.length === 0)} onFill={() => onFill([f])} onShow={() => onShowInForm(f)} label="역량" />
              </div>
              {o.reason ? <p className="text-xs text-muted-foreground">{o.reason}</p> : null}
              {note(f)}
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
              <RowState st={st} busy={busy} onFill={() => onFill([f])} onShow={() => onShowInForm(f)} label={PROPOSAL_FIELD_LABELS[f]} />
            </div>
            {o.reason ? <p className="text-xs text-muted-foreground">{o.reason}</p> : null}
            {note(f)}
          </div>
        )
      })}
    </section>
  )
}
