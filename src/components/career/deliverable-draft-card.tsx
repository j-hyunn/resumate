"use client"

/**
 * S-44 본문 초안 제안 카드 (`DraftProposalCard`, design-system v4 3.25; UX v5.6 S-44 "본문 초안 제안 카드 구성" ·
 * "반영 규칙" · "AI 응답 방식"; AI v4.6 AI-13; DM v4.5 2.5.0 · 3.3). Rendered in `<AiPanel renderProposal>`.
 *
 * Block level: renders `deliverable.body.blocks[]`, `basis = new` 표식, needs_review [수락]/[빼기], 3 source chips,
 * "확인이 필요한 내용"(facts), `missing_slots`, `dropped_block_count`, 초안 남은 횟수 (6 − draft_count), and the fill
 * buttons ([본문에 넣기] / [본문 교체] / [뒤에 덧붙이기]) — fills only the form (the page does it), "저장하기" records.
 * States: 초안 없음(사실만) / 초안 작성 중(draft_block 임시) / 제안 / 폼에 채움 · 저장 전 / 반영됨 / 초안 실패 / 초안 상한.
 */
import * as React from "react"
import {
  ArrowLeftToLine,
  Check,
  ChevronDown,
  ChevronRight,
  ChevronsUpDown,
  EyeOff,
  FileText,
  Info,
  ListPlus,
  Loader2,
  MessageCircleQuestion,
  Minus,
  Replace,
  TriangleAlert,
} from "lucide-react"
import { cn } from "@/lib/utils"
import { Alert, AlertDescription } from "@/components/ui/alert"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible"
import { Skeleton } from "@/components/ui/skeleton"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { AiErrorNotice } from "@/components/common/ai-error-notice"
import { freeTierLine } from "@/components/common/ai-progress"
import { SourceChip, SourceChips } from "@/components/common/source-chip"
import { StreamingCaret } from "@/components/common/streaming"
import type { AiErrorCode, DeliverableDraftBlock, DeliverableFact, DeliverableStructuredDraft } from "@/types/db"
import { DRAFT_SLOW_AFTER_MS, DRAFT_STAGE_COPY, PAGE_LIMITS, PANEL_COPY, bodyHash, type AppliedDeliverableProposal, type WritingChatMessageView } from "@/lib/data/career-v45-shared"
import { DELIVERABLE_CHIP_COPY } from "@/lib/data/quick-chips"
import { deliverableSlotLabel } from "@/lib/data/labels"
import type { AiPanelController } from "@/components/career/ai-panel"
import { appendPreviewIds, appendableCount, fillBody, fillButtons, hasFillableContent, unreviewedCount } from "./deliverable/draft-fill"

export const DRAFT_CARD_ID = "deliverable-draft-card"

export interface DeliverableFill {
  chatId: string
  rev: number
  mode: "replace" | "append"
  body: string
}

export interface DeliverableDraftCardProps {
  panel: AiPanelController
  /** the form body now (unsaved input included) */
  formBody: string
  /** this visit's "폼에 채움" entry for the open chat (p_applied_proposals) */
  filled: AppliedDeliverableProposal | null
  /** the last save's `skipped` line for this chat (S-10 "저장 응답의 건너뜀" 문구) */
  skipLine: string | null
  /** the last draft turn of the open chat failed (the previous draft stays); shown only while `panel.failure` is set */
  draftFailed: boolean
  onFill: (fill: DeliverableFill) => void
  /** "지금 본문에서" → select that range in the body field */
  onBodyQuote: (quote: string) => void
}

function deliverableDraftOf(panel: AiPanelController): DeliverableStructuredDraft | null {
  const d = panel.chat?.structured_draft
  return d && "target" in d ? d : null
}

export function DeliverableDraftCard({ panel, formBody, filled, skipLine, draftFailed, onFill, onBodyQuote }: DeliverableDraftCardProps) {
  const draft = deliverableDraftOf(panel)
  const body = draft?.deliverable.body
  const reviewFacts = draft?.facts.filter((f) => f.review === "needs_review") ?? []
  const drafting = panel.draftStarted
  // same rule as the page's `hideDraftTurnFailure` (draft_turn || draftFailed): the list hides it, the card draws it
  const failedNow = panel.failure !== null && (draftFailed || Boolean(panel.failure.draft_turn))
  if (!drafting && !body && reviewFacts.length === 0 && !failedNow) return null

  const chat = panel.chat
  const applied = Boolean(body?.applied_at && body.applied_rev === body.rev)
  const isFilled = Boolean(body && filled && filled.writing_chat_id === chat?.id && filled.rev === body.rev)
  const remaining = Math.max(0, PAGE_LIMITS.maxDrafts - (draft?.draft_count ?? 0))
  return (
    <CardFrame
      key={`${chat?.id}:${applied}`}
      applied={applied}
      appliedMode={body?.applied_mode ?? null}
      isFilled={isFilled}
      drafting={drafting}
      remaining={draft ? remaining : null}
      freeTier={panel.connection?.connection_tier === "free"}
    >
      {failedNow ? <DraftFailedLine panel={panel} /> : null}
      {drafting ? (
        <DraftingView provisional={panel.provisionalBlocks} previous={body ?? null} />
      ) : body ? (
        <ProposalView
          panel={panel}
          draft={draft!}
          formBody={formBody}
          locked={isFilled || applied || panel.responding}
          applied={applied}
          isFilled={isFilled}
          onFill={onFill}
          onBodyQuote={onBodyQuote}
          remaining={remaining}
        />
      ) : null}
      {draft && reviewFacts.length ? <ReviewFacts panel={panel} facts={reviewFacts} /> : null}
      {!drafting && !body && draft && draft.draft_count >= PAGE_LIMITS.maxDrafts ? <DraftLimit panel={panel} /> : null}
      {skipLine ? <p className="px-4 pb-3 text-sm text-muted-foreground">{skipLine}</p> : null}
    </CardFrame>
  )
}

// ---------------------------------------------------------------------------
// frame
// ---------------------------------------------------------------------------

function CardFrame({
  applied,
  appliedMode,
  isFilled,
  drafting,
  remaining,
  freeTier,
  children,
}: {
  applied: boolean
  appliedMode: "replace" | "append" | null
  isFilled: boolean
  drafting: boolean
  remaining: number | null
  freeTier: boolean
  children: React.ReactNode
}) {
  // 반영됨: block list folded by default (head only)
  const [open, setOpen] = React.useState(!applied)
  return (
    <section id={DRAFT_CARD_ID} aria-label="본문 초안" className="mb-1 rounded-xl border bg-card text-card-foreground">
      <Collapsible open={open} onOpenChange={setOpen}>
        <CollapsibleTrigger asChild>
          <button type="button" className="flex w-full items-center gap-2 rounded-t-xl px-4 py-3 text-left outline-none focus-visible:ring-2 focus-visible:ring-ring">
            <FileText className="size-4 shrink-0 text-muted-foreground" aria-hidden />
            <span className="text-sm font-semibold">본문 초안</span>
            {drafting ? (
              <span className="flex items-center gap-1 text-xs text-ai-subtle-foreground">
                <Loader2 className="size-3.5 animate-spin text-ai" aria-hidden />
                {DRAFT_STAGE_COPY.compose}
              </span>
            ) : applied ? (
              <Badge variant="success">
                <Check className="size-3" aria-hidden />
                {/* [UI-가정] 방식 글자 (design-system 3.25) */}
                반영됨 · {appliedMode === "append" ? "덧붙임" : "교체"}
              </Badge>
            ) : isFilled ? (
              <Badge variant="info">
                <ArrowLeftToLine className="size-3" aria-hidden />
                폼에 채움
              </Badge>
            ) : null}
            <span className="flex-1" />
            {remaining !== null ? (
              <span className={cn("text-xs tabular-nums", remaining === 0 ? "text-warning-subtle-foreground" : "text-muted-foreground")}>
                초안 남은 횟수 {remaining} / {PAGE_LIMITS.maxDrafts}
              </span>
            ) : null}
            <ChevronDown className={cn("size-4 text-muted-foreground transition-transform", open && "rotate-180")} aria-hidden />
          </button>
        </CollapsibleTrigger>
        {drafting && freeTier ? (
          // C-03 무료 등급 문구 (공유 함수)
          <p className="px-4 pb-2 text-xs text-muted-foreground">{freeTierLine("writing_chat_turn")}</p>
        ) : null}
        <CollapsibleContent>{children}</CollapsibleContent>
      </Collapsible>
    </section>
  )
}

function DraftFailedLine({ panel }: { panel: AiPanelController }) {
  const f = panel.failure!
  return (
    <div role="alert" className="mx-4 mb-3 space-y-1">
      <p className="text-sm font-medium text-warning-subtle-foreground">{DRAFT_STAGE_COPY.failed}</p>
      {/* C-20 inline (cause + 다시 시도) — the only retry: the message list hides it (`hideDraftTurnFailure`) */}
      <AiErrorNotice
        code={f.code as AiErrorCode}
        provider={f.provider}
        retryAfter={f.retry_after}
        quotaResetsAt={f.quota_resets_at}
        size="inline"
        requestPath
        retryLabel="다시 시도"
        onRetry={panel.retry}
        lockEntry="writing_chat"
      />
    </div>
  )
}

// ---------------------------------------------------------------------------
// 초안 작성 중 (draft_started ~ draft_done)
// ---------------------------------------------------------------------------

function DraftingView({ provisional, previous }: { provisional: DeliverableDraftBlock[]; previous: { blocks: DeliverableDraftBlock[] } | null }) {
  const [slow, setSlow] = React.useState(false)
  const waiting = provisional.length === 0
  React.useEffect(() => {
    if (!waiting) return
    const t = window.setTimeout(() => setSlow(true), DRAFT_SLOW_AFTER_MS)
    return () => window.clearTimeout(t)
  }, [waiting])
  return (
    <div className="space-y-3 px-4 pb-3" aria-live="polite" aria-busy="true">
      {previous ? (
        <Collapsible>
          <CollapsibleTrigger asChild>
            <Button variant="ghost" size="xs" className="-ml-2 group/prev">
              <ChevronRight className="size-3.5 transition-transform group-data-[state=open]/prev:rotate-90" aria-hidden />
              {DRAFT_STAGE_COPY.previous}
            </Button>
          </CollapsibleTrigger>
          <CollapsibleContent className="mt-2 space-y-2 opacity-70">
            {previous.blocks.map((b) => (
              <BlockBody key={b.block_id} block={b} />
            ))}
          </CollapsibleContent>
        </Collapsible>
      ) : null}
      {waiting ? (
        <div className="space-y-2">
          <Skeleton className="h-4 w-3/4" />
          <Skeleton className="h-4 w-full" />
          <Skeleton className="h-4 w-2/3" />
          {waiting && slow ? <p className="text-xs text-muted-foreground">{DRAFT_STAGE_COPY.slow}</p> : null}
        </div>
      ) : (
        <div className="space-y-2">
          {provisional.map((b, i) => (
            <div key={`${b.block_id}-${i}`} className="border-l-2 border-ai pl-3">
              <BlockBody block={b} />
              {i === provisional.length - 1 ? <StreamingCaret /> : null}
            </div>
          ))}
          {/* [UI-가정] P-3 leader ruling: no separate "마무리 중" — the head stays "초안 작성 중" until draft_done */}
        </div>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// 제안 / 폼에 채움 / 반영됨
// ---------------------------------------------------------------------------

function ProposalView({
  panel,
  draft,
  formBody,
  locked,
  applied,
  isFilled,
  remaining,
  onFill,
  onBodyQuote,
}: {
  panel: AiPanelController
  draft: DeliverableStructuredDraft
  formBody: string
  locked: boolean
  applied: boolean
  isFilled: boolean
  remaining: number
  onFill: (fill: DeliverableFill) => void
  onBodyQuote: (quote: string) => void
}) {
  const body = draft.deliverable.body!
  const blocks = body.blocks
  const [expanded, setExpanded] = React.useState(false)
  const [overflowing, setOverflowing] = React.useState(false)
  const listRef = React.useRef<HTMLDivElement | null>(null)
  const [previewAppend, setPreviewAppend] = React.useState(false)
  const [busyBlock, setBusyBlock] = React.useState<string | null>(null)
  const [confirm, setConfirm] = React.useState<null | { changed: boolean }>(null)
  const [tooLong, setTooLong] = React.useState(false)
  const appendIds = React.useMemo(() => appendPreviewIds(blocks), [blocks])
  const describeId = React.useId()

  React.useLayoutEffect(() => {
    const el = listRef.current
    if (el) setOverflowing(el.scrollHeight > el.clientHeight + 1)
  }, [blocks])

  const messages = panel.chat?.messages ?? []
  const factById = new Map(draft.facts.map((f) => [f.id, f]))

  const unreviewed = unreviewedCount(blocks)
  const fillable = hasFillableContent(blocks)
  const buttons = fillButtons(formBody, blocks, body.replace_allowed)
  const disabledAll = locked || !fillable

  const doFill = (action: "insert" | "replace" | "append") => {
    const r = fillBody(formBody, blocks, action)
    if (!r.ok) {
      setTooLong(r.reason === "too_long")
      return
    }
    setTooLong(false)
    onFill({ chatId: panel.chat!.id, rev: body.rev, mode: r.mode, body: r.body })
  }
  const askReplace = async () => {
    const hash = await bodyHash(formBody)
    setConfirm({ changed: Boolean(body.base_body_hash) && hash !== body.base_body_hash })
  }

  const review = async (block: DeliverableDraftBlock, decision: "accept" | "drop") => {
    setBusyBlock(block.block_id)
    await panel.patchDraft({ kind: "block_review", block_id: block.block_id, decision })
    setBusyBlock(null)
  }

  return (
    <>
      <div className="px-4 pb-3">
        <div ref={listRef} className={cn("relative space-y-2", !expanded && "max-h-[28rem] overflow-hidden")}>
          {blocks.map((b) => (
            <DraftBlock
              key={b.block_id}
              block={b}
              messages={messages}
              factById={factById}
              locked={locked}
              busy={busyBlock === b.block_id}
              dimmed={previewAppend && !appendIds.has(b.block_id)}
              highlighted={previewAppend && appendIds.has(b.block_id)}
              onReview={(d) => void review(b, d)}
              onFact={(ids, quotes) => ids[0] && panel.flashMessage(ids[0], quotes)}
              onBodyQuote={onBodyQuote}
            />
          ))}
          {overflowing && !expanded ? <div aria-hidden className="pointer-events-none absolute inset-x-0 bottom-0 h-12 bg-gradient-to-t from-card" /> : null}
        </div>
        {overflowing || expanded ? (
          <Button variant="ghost" size="sm" className="mt-1" onClick={() => setExpanded((x) => !x)} aria-expanded={expanded}>
            <ChevronsUpDown aria-hidden />
            {expanded ? "접기" : "펼치기"}
          </Button>
        ) : null}

        <div className="mt-3 space-y-2">
          {body.missing_slots.length ? (
            <div className="flex flex-wrap items-center gap-1.5">
              <span className="text-xs text-muted-foreground">아직 비어 있는 부분:</span>
              {body.missing_slots.map((slot) => (
                <Button
                  key={slot}
                  variant="chip-dashed"
                  size="sm"
                  className="h-7"
                  disabled={panel.responding || panel.closed || panel.locked}
                  // [UI-가정] same message as the chip "빠진 부분 물어봐 줘", with that slot
                  onClick={() => panel.send(DELIVERABLE_CHIP_COPY.askMissing, { requested_slot: slot })}
                >
                  <MessageCircleQuestion className="size-3.5" aria-hidden />
                  {deliverableSlotLabel(slot, draft.writing_kind)}
                </Button>
              ))}
            </div>
          ) : null}
          {body.dropped_block_count > 0 ? (
            <p className="flex items-center gap-1 text-xs text-muted-foreground">
              <EyeOff className="size-3.5" aria-hidden />
              확인되지 않은 문장 {body.dropped_block_count}개는 뺐어요
            </p>
          ) : null}
          {!body.replace_allowed && buttons.kind === "replace_append" ? (
            <p className="flex items-start gap-1.5 text-sm text-muted-foreground">
              <Info className="mt-0.5 size-4 shrink-0" aria-hidden />
              본문이 길어(6,000자 초과) 교체 초안은 만들지 않았어요. 덧붙이기나 직접 편집을 써 주세요
            </p>
          ) : null}
        </div>
      </div>

      {remaining === 0 ? <DraftLimit panel={panel} /> : null}

      {applied ? null : (
        <div className="sticky bottom-0 space-y-2 rounded-b-xl border-t bg-card px-4 py-3">
          {isFilled ? (
            <p className="text-xs text-info-subtle-foreground">폼에 채움 · 저장하기를 눌러야 저장돼요</p>
          ) : (
            <>
              {tooLong ? (
                <p className="flex items-start gap-1.5 text-sm text-warning-subtle-foreground" role="alert">
                  <TriangleAlert className="mt-0.5 size-4 shrink-0 text-warning" aria-hidden />
                  본문이 20,000자를 넘어 채우지 못했어요. 본문을 줄이거나 [본문 교체]를 써 주세요
                </p>
              ) : !fillable ? (
                <ReasonLine>검토가 필요한 문장을 수락하거나 빼 주세요</ReasonLine>
              ) : (
                <>
                  {unreviewed > 0 ? <ReasonLine>검토하지 않은 문장 {unreviewed}개는 넣지 않아요</ReasonLine> : null}
                  {buttons.kind === "replace_append" && buttons.appendDisabled ? <ReasonLine>덧붙일 새 내용이 없어요(지금 본문을 다시 정리한 초안이에요)</ReasonLine> : null}
                </>
              )}
              <div className="flex flex-wrap justify-end gap-2">
                {buttons.kind === "insert" ? (
                  <Button variant="outline" size="sm" disabled={disabledAll} onClick={() => doFill("insert")}>
                    <ArrowLeftToLine aria-hidden />
                    본문에 넣기
                  </Button>
                ) : (
                  <>
                    {buttons.showReplace ? (
                      <Button variant="outline" size="sm" disabled={disabledAll} onClick={() => void askReplace()}>
                        <Replace aria-hidden />
                        본문 교체
                      </Button>
                    ) : null}
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={disabledAll || buttons.appendDisabled}
                      aria-describedby={describeId}
                      onMouseEnter={() => setPreviewAppend(true)}
                      onMouseLeave={() => setPreviewAppend(false)}
                      onFocus={() => setPreviewAppend(true)}
                      onBlur={() => setPreviewAppend(false)}
                      onClick={() => doFill("append")}
                    >
                      <ListPlus aria-hidden />
                      뒤에 덧붙이기
                    </Button>
                    {/* [UI-가정] screen reader description of the append preview */}
                    <span id={describeId} className="sr-only">
                      새 내용 블록 {appendableCount(blocks)}개를 지금 본문 끝에 붙여요
                    </span>
                  </>
                )}
              </div>
            </>
          )}
        </div>
      )}

      <AlertDialog open={confirm !== null} onOpenChange={(o) => !o && setConfirm(null)}>
        <AlertDialogContent className="sm:max-w-md">
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2">
              {confirm?.changed ? <TriangleAlert className="size-5 shrink-0 text-warning" aria-hidden /> : null}
              {confirm?.changed ? "초안을 만든 뒤 본문이 바뀌었어요" : "지금 본문을 AI 초안으로 바꿀까요?"}
            </AlertDialogTitle>
            <AlertDialogDescription>{confirm?.changed ? "교체하면 바뀐 내용도 사라져요" : "저장하기 전에는 되돌릴 수 있어요"}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>취소</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                setConfirm(null)
                doFill("replace")
              }}
            >
              {confirm?.changed ? "그래도 바꾸기" : "바꾸기"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}

function ReasonLine({ children }: { children: React.ReactNode }) {
  return (
    <p className="flex items-start gap-1 text-xs text-muted-foreground">
      <Info className="mt-0.5 size-3.5 shrink-0" aria-hidden />
      {children}
    </p>
  )
}

function DraftLimit({ panel }: { panel: AiPanelController }) {
  return (
    <div className="px-4 pb-3">
      <Alert variant="info" className="flex flex-wrap items-center gap-2 py-2">
        <AlertDescription className="flex-1 text-sm">{PANEL_COPY.draftLimit}</AlertDescription>
        <Button variant="outline" size="sm" onClick={() => void panel.newChat()} disabled={panel.responding}>
          새 대화
        </Button>
      </Alert>
    </div>
  )
}

// ---------------------------------------------------------------------------
// blocks
// ---------------------------------------------------------------------------

function userNumbersOf(messageIds: string[], messages: WritingChatMessageView[]): number[] {
  return messageIds.flatMap((id) => {
    const n = messages.find((m) => m.id === id)?.user_number
    return n ? [n] : []
  })
}

function DraftBlock({
  block,
  messages,
  factById,
  locked,
  busy,
  dimmed,
  highlighted,
  onReview,
  onFact,
  onBodyQuote,
}: {
  block: DeliverableDraftBlock
  messages: WritingChatMessageView[]
  factById: Map<string, DeliverableFact>
  locked: boolean
  busy: boolean
  dimmed: boolean
  highlighted: boolean
  onReview: (decision: "accept" | "drop") => void
  onFact: (messageIds: string[], quotes: string[]) => void
  onBodyQuote: (quote: string) => void
}) {
  const isHeading = block.type === "heading"
  const needsReview = block.review === "needs_review"
  const facts = block.source_fact_ids.flatMap((id) => (factById.has(id) ? [factById.get(id)!] : []))
  const factMessageIds = [...new Set(facts.flatMap((f) => f.source_message_ids))]
  const factQuotes = facts.flatMap((f) => f.source_quotes)
  const factNumbers = userNumbersOf(factMessageIds, messages)
  const hasChips = !isHeading && (facts.length > 0 || block.source_body_quotes.length > 0 || block.source_project_fields.length > 0 || block.basis === "new")
  return (
    <div
      className={cn(
        "relative -mx-2 rounded-md px-2 py-1.5 transition-[opacity,background-color] duration-150",
        block.basis === "new" && !isHeading && "border-l-2 border-ai/60 pl-3",
        needsReview && "border border-warning bg-warning-subtle p-2.5",
        highlighted && "bg-ai-subtle ring-1 ring-ai/30",
        dimmed && "opacity-40",
      )}
    >
      {needsReview ? (
        <p className="mb-1.5 flex gap-1.5 text-sm text-warning-subtle-foreground">
          <TriangleAlert className="mt-0.5 size-4 shrink-0 text-warning" aria-hidden />
          {/* [UI-가정] spec copy (V-10d·V-10e — no reason stored per block) */}
          본인이 한 일이 맞는지, 원래 말과 같은지 확인해 주세요
        </p>
      ) : null}
      <BlockBody block={block} />
      {block.review === "accepted" ? (
        <p className="mt-1 flex items-center gap-1 text-xs text-success-subtle-foreground">
          <Check className="size-3" aria-hidden />
          수락함
        </p>
      ) : null}
      {hasChips ? (
        <SourceChips>
          {block.basis === "new" ? (
            <Badge variant="ai" className="h-5 px-1.5 text-xs">
              새 내용
            </Badge>
          ) : null}
          {facts.length ? <SourceChip kind="fact" userNumbers={factNumbers} onSelect={() => onFact(factMessageIds, factQuotes)} /> : null}
          {block.source_body_quotes.length ? <SourceChip kind="body" onSelect={() => onBodyQuote(block.source_body_quotes[0])} /> : null}
          {block.source_project_fields.length ? <SourceChip kind="project" fields={block.source_project_fields} /> : null}
        </SourceChips>
      ) : null}
      {needsReview ? (
        <div className="mt-2 flex gap-2">
          <Button variant="outline" size="sm" disabled={locked || busy} aria-label={`‘${excerpt(block)}’ 수락`} onClick={() => onReview("accept")}>
            수락
          </Button>
          <Button variant="ghost" size="sm" disabled={locked || busy} aria-label={`‘${excerpt(block)}’ 빼기`} onClick={() => onReview("drop")}>
            <Minus aria-hidden />
            빼기
          </Button>
        </div>
      ) : null}
    </div>
  )
}

const short = (t: string) => (t.length > 24 ? `${t.slice(0, 24)}…` : t)
/** accessible-name excerpt of a block (UQ-S44-10) */
function excerpt(b: DeliverableDraftBlock): string {
  return short(b.text ?? b.items?.[0] ?? b.rows?.[0]?.join(" ") ?? "블록")
}

/** design-system 3.25 블록 렌더링 (14px 축약 문서) */
function BlockBody({ block: b }: { block: DeliverableDraftBlock }) {
  switch (b.type) {
    case "heading":
      return (b.level ?? 2) >= 3 ? <p className="mt-2 text-sm font-semibold text-muted-foreground">{b.text}</p> : <p className="mt-3 text-sm font-semibold first:mt-0">{b.text}</p>
    case "bullet_list":
    case "numbered_list": {
      const List = b.type === "bullet_list" ? "ul" : "ol"
      return (
        <List className={cn("space-y-1 pl-5 text-sm leading-6", b.type === "bullet_list" ? "list-disc" : "list-decimal")}>
          {(b.items ?? []).map((item, i) => (
            <li key={i}>{item}</li>
          ))}
        </List>
      )
    }
    case "table": {
      const [head, ...rows] = b.rows ?? []
      if (!head) return null
      return (
        <div className="overflow-x-auto">
          <Table className="text-sm">
            <TableHeader>
              <TableRow>
                {head.map((c, i) => (
                  <TableHead key={i} className="h-auto px-2 py-1.5 font-medium">
                    {c}
                  </TableHead>
                ))}
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((r, i) => (
                <TableRow key={i}>
                  {r.map((c, j) => (
                    <TableCell key={j} className="px-2 py-1.5">
                      {c}
                    </TableCell>
                  ))}
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )
    }
    case "quote":
      return <blockquote className="border-l-2 border-border pl-3 text-sm leading-6 whitespace-pre-wrap text-muted-foreground">{b.text}</blockquote>
    case "code":
      return <pre className="overflow-x-auto rounded-md bg-muted px-3 py-2 font-mono text-sm whitespace-pre">{b.text}</pre>
    default:
      return <p className="text-sm leading-6 whitespace-pre-wrap">{b.text}</p>
  }
}

// ---------------------------------------------------------------------------
// 확인이 필요한 내용 (facts needs_review) — usable while filled / applied (next draft)
// ---------------------------------------------------------------------------

function ReviewFacts({ panel, facts }: { panel: AiPanelController; facts: DeliverableFact[] }) {
  const [busy, setBusy] = React.useState<string | null>(null)
  const messages = panel.chat?.messages ?? []
  const act = async (fact: DeliverableFact, decision: "accept" | "reject") => {
    setBusy(fact.id)
    await panel.patchDraft({ kind: "fact_review", fact_id: fact.id, decision })
    setBusy(null)
  }
  return (
    <div className="px-4 pb-3">
      <Collapsible>
        <CollapsibleTrigger asChild>
          <Button variant="warning-ghost" size="sm" className="-ml-2">
            <TriangleAlert className="size-4 text-warning" aria-hidden />
            확인이 필요한 내용 {facts.length.toLocaleString("ko-KR")}개
            <ChevronRight className="size-4 transition-transform [[data-state=open]>&]:rotate-90" aria-hidden />
          </Button>
        </CollapsibleTrigger>
        <CollapsibleContent className="mt-2 space-y-2">
          {facts.map((f) => (
            <div key={f.id} className="space-y-1.5 rounded-md border border-warning/40 p-2.5">
              <p className="text-sm">{f.text}</p>
              <SourceChips>
                <SourceChip kind="fact" userNumbers={userNumbersOf(f.source_message_ids, messages)} onSelect={() => f.source_message_ids[0] && panel.flashMessage(f.source_message_ids[0], f.source_quotes)} />
              </SourceChips>
              <div className="flex gap-2">
                <Button variant="outline" size="sm" disabled={busy === f.id || panel.responding} aria-label={`‘${short(f.text)}’ 수락`} onClick={() => void act(f, "accept")}>
                  수락
                </Button>
                <Button variant="ghost" size="sm" disabled={busy === f.id || panel.responding} aria-label={`‘${short(f.text)}’ 거절`} onClick={() => void act(f, "reject")}>
                  거절
                </Button>
              </div>
            </div>
          ))}
        </CollapsibleContent>
      </Collapsible>
    </div>
  )
}
