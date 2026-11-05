"use client"

/**
 * Resumate AI 패널 (S-10 · S-44 shared core — design-system v4 5.10, UX v5.6 S-10 / S-44 패널).
 *
 *   <AiPanel panel={panel}                                   // useAiPanel(…)
 *            renderProposal={(p) => <StarProposalCard panel={p} … />}   // A2: the card in the 제안 독 slot
 *            renderClosedActions={(p) => <Button …>모두 반영</Button>}   // S-10 [모두 반영] on a closed chat
 *            renderAboveInput={(p) => …}                                  // e.g. "{기능}으로 돌아가기" (ready_to_return)
 *            onUserMessageClick={(m) => …}                                // flash the card section citing it
 *            onDirectInput={() => focusFirstField()} />                   // C-18 대안 "직접 입력"
 *
 * Thread: shadcn Chat (Message Scroller · Message · Bubble); input: Input Group.
 * Frame: header (Sparkles · "Resumate AI" · 기록 · 새 대화 · ⋯ · ×) → chat view (messages → 제안 독 →
 * chip row → input) or the history view. States: C-18 area / inline lock, closed (40 / `closed`), before-send
 * blocks, failed turn (C-20 + 다시 보내기), streaming (C-04 caret), first-message processing.
 */
import * as React from "react"
import { ArrowDown, ArrowLeft, History, Info, Loader2, Lock, MoreHorizontal, Plus, Sparkles, Trash2, X } from "lucide-react"
import { cn } from "@/lib/utils"
import { Alert, AlertDescription } from "@/components/ui/alert"
import { Badge } from "@/components/ui/badge"
import { Bubble, BubbleContent } from "@/components/ui/bubble"
import { Item } from "@/components/ui/item"
import { Button } from "@/components/ui/button"
import { Message, MessageAvatar, MessageContent, MessageHeader } from "@/components/ui/message"
import {
  MessageScroller,
  MessageScrollerButton,
  MessageScrollerContent,
  MessageScrollerItem,
  MessageScrollerProvider,
  MessageScrollerViewport,
  useMessageScroller,
} from "@/components/ui/message-scroller"
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu"
import { Skeleton } from "@/components/ui/skeleton"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { AiErrorNotice } from "@/components/common/ai-error-notice"
import { AiLock } from "@/components/common/ai-lock"
import { DeleteConfirmDialog } from "@/components/common/delete-confirm-dialog"
import { StreamingCaret } from "@/components/common/streaming"
import { useDocBodyMode } from "@/components/common/shell/doc-body"
import { PAGE_LIMITS, PANEL_COPY, PANEL_NOTICE, freeTierGreetingLine, type WritingChatMessageView } from "@/lib/data/career-v45-shared"
import { formatRelative } from "@/lib/data/labels"
import { AI_PROVIDER_LABELS } from "@/lib/mock/ai-providers"
import type { AiPanelController, TurnFailure } from "./use-ai-panel"
import { PanelInputArea } from "./panel-input"
import { UNANSWERED_COPY, isHiddenAssistantRow } from "./unanswered"

export interface AiPanelProps {
  panel: AiPanelController
  /** 제안 독 slot (STAR 제안 카드 / 본문 초안 제안 카드) — area-owned */
  renderProposal?: (panel: AiPanelController) => React.ReactNode
  /**
   * `true`: the proposal renders inside the thread, right under the latest AI turn (S-10 STAR 제안 — the
   * confirmation line), instead of the 제안 독 above the input.
   */
  proposalInline?: boolean
  /** extra buttons in the closed-chat box (S-10 [모두 반영]) */
  renderClosedActions?: (panel: AiPanelController) => React.ReactNode
  /** a line right above the input (e.g. ready_to_return "돌아가기") */
  renderAboveInput?: (panel: AiPanelController) => React.ReactNode
  onUserMessageClick?: (message: WritingChatMessageView) => void
  /** C-18 대안 "직접 입력" → focus the left column */
  onDirectInput?: () => void
  /**
   * S-44: a failed **draft** turn shows its C-20 + 다시 시도 on the draft card only ("이전 초안은 그대로예요"),
   * not again in the message list. `true` = hide when `panel.failure.draft_turn` (draft_started arrived or
   * compose_draft was requested); a function = the page decides (e.g. its own `draftFailed`). The card reads
   * `panel.failure` and calls `panel.retry`.
   */
  hideDraftTurnFailure?: boolean | ((failure: TurnFailure) => boolean)
  className?: string
}

export function AiPanel({ panel, renderProposal, proposalInline, renderClosedActions, renderAboveInput, onUserMessageClick, onDirectInput, hideDraftTurnFailure, className }: AiPanelProps) {
  const [deleting, setDeleting] = React.useState<string | null>(null)
  const areaLock = panel.locked && !panel.chat && panel.chats.length === 0
  return (
    <aside aria-label="Resumate AI" className={cn("relative flex min-h-0 w-full flex-1 flex-col overflow-hidden rounded-xl bg-panel text-panel-foreground", className)}>
      <PanelHeader panel={panel} onDelete={() => panel.chat && setDeleting(panel.chat.id)} />
      {areaLock ? (
        <div className="min-h-0 flex-1 overflow-y-auto">
          <div className="m-4 space-y-3 rounded-lg border bg-card p-5">
            <AiLock
              entry="writing_chat"
              size="area"
              description={PANEL_COPY.lock[panel.target]}
              alternativeLabel="직접 입력"
              onAlternative={onDirectInput}
              className="max-w-none border-0 p-0 shadow-none"
            />
          </div>
        </div>
      ) : panel.view === "history" ? (
        <HistoryView panel={panel} />
      ) : (
        <>
          <MessageList
            panel={panel}
            onUserMessageClick={onUserMessageClick}
            onDeleteChat={() => panel.chat && setDeleting(panel.chat.id)}
            proposal={proposalInline && renderProposal ? renderProposal(panel) : null}
            hideFailure={Boolean(
              panel.failure &&
                (typeof hideDraftTurnFailure === "function" ? hideDraftTurnFailure(panel.failure) : hideDraftTurnFailure && panel.failure.draft_turn),
            )}
          />
          {renderProposal && !proposalInline ? <ProposalDock>{renderProposal(panel)}</ProposalDock> : null}
          {renderAboveInput ? <div className="shrink-0 px-3 pt-2 empty:hidden">{renderAboveInput(panel)}</div> : null}
          <PanelInputArea panel={panel} renderClosedActions={renderClosedActions} onDirectInput={onDirectInput} />
        </>
      )}
      {panel.consentDialog}
      <DeleteConfirmDialog
        target={deleting ? { kind: "writing_chat", entity_id: deleting, label: panel.chats.find((c) => c.id === deleting)?.title ?? undefined } : null}
        open={deleting !== null}
        onOpenChange={(o) => !o && setDeleting(null)}
        onConfirm={async () => {
          if (deleting) await panel.deleteChat(deleting)
        }}
      />
    </aside>
  )
}

// ---------------------------------------------------------------------------
// header
// ---------------------------------------------------------------------------

function IconAction({ label, onClick, children, pressed, disabled }: { label: string; onClick?: () => void; children: React.ReactNode; pressed?: boolean; disabled?: boolean }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        {/* UQ-BR-7 (design-system v5): ghost + aria-pressed — the ghost variant colours the pressed state */}
        <Button variant="ghost" size="icon-sm" aria-label={label} aria-pressed={pressed} disabled={disabled} onClick={onClick}>
          {children}
        </Button>
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  )
}

function PanelHeader({ panel, onDelete }: { panel: AiPanelController; onDelete: () => void }) {
  const { mode, closeSheet } = useDocBodyMode()
  const history = panel.view === "history"
  return (
    <div className="flex h-12 shrink-0 items-center gap-1 px-3">
      <Sparkles className="size-4 shrink-0 text-ai" aria-hidden />
      <h2 className="text-base font-semibold whitespace-nowrap">Resumate AI</h2>
      <div className="ml-auto flex items-center gap-0.5">
        <IconAction label="대화 기록" pressed={history} onClick={() => panel.setView(history ? "chat" : "history")}>
          <History aria-hidden />
        </IconAction>
        {/* without a key this still opens: the start area shows C-18 inline [가정] */}
        <IconAction label="새 대화" onClick={() => void panel.newChat()} disabled={panel.responding}>
          <Plus aria-hidden />
        </IconAction>
        <DropdownMenu>
          <Tooltip>
            <TooltipTrigger asChild>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="icon-sm" aria-label="대화 메뉴" disabled={!panel.chat || panel.responding}>
                  <MoreHorizontal aria-hidden />
                </Button>
              </DropdownMenuTrigger>
            </TooltipTrigger>
            <TooltipContent>대화 메뉴</TooltipContent>
          </Tooltip>
          <DropdownMenuContent align="end">
            <DropdownMenuItem variant="destructive" onSelect={onDelete}>
              <Trash2 aria-hidden />
              이 대화 삭제
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
        {mode === "narrow" ? (
          <Button variant="ghost" size="sm" onClick={closeSheet}>
            {/* [가정 G-59] */}
            {panel.target === "project" ? "STAR 보기" : "본문 보기"}
          </Button>
        ) : null}
        <IconAction label="패널 닫기" onClick={mode === "narrow" ? closeSheet : panel.hide}>
          <X aria-hidden />
        </IconAction>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// history view
// ---------------------------------------------------------------------------

function HistoryView({ panel }: { panel: AiPanelController }) {
  return (
    <div className="min-h-0 flex-1 overflow-y-auto pb-3">
      {panel.chat ? (
        <div className="px-3 pt-1 pb-2">
          <Button variant="ghost" size="sm" onClick={() => panel.setView("chat")}>
            <ArrowLeft aria-hidden />
            {PANEL_COPY.backToChat}
          </Button>
        </div>
      ) : null}
      {panel.chats.length === 0 ? (
        <p className="py-10 text-center text-sm text-muted-foreground">{PANEL_COPY.emptyHistory}</p>
      ) : (
        <ul className="space-y-0.5 px-2">
          {panel.chats.map((c) => {
            const current = panel.chat?.id === c.id
            const ended = c.status === "closed" || c.message_count >= PAGE_LIMITS.messageLimit
            return (
              <li key={c.id}>
                {/* UQ-BR-4: Item row — hover / current = bg-primary/10, aria-current from `active` */}
                <Item asChild active={current} className="flex-col items-start gap-0.5">
                  <button type="button" onClick={() => void panel.openChat(c.id)}>
                  <span className={cn("block w-full truncate text-sm font-medium", !c.title && "text-muted-foreground")}>{c.title ?? PANEL_COPY.newChatTitle}</span>
                  <span className="flex items-center gap-1.5 text-xs text-muted-foreground tabular-nums">
                    {formatRelative(c.last_activity_at)} · {c.message_count}/{PAGE_LIMITS.messageLimit}
                    {ended ? (
                      // UQ-BR-8: 잠금 상태 배지 = muted
                      <Badge variant="muted" className="h-5">
                        <Lock className="size-3" aria-hidden />
                        {PANEL_COPY.closedChatBadge}
                      </Badge>
                    ) : null}
                  </span>
                  </button>
                </Item>
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// messages
// ---------------------------------------------------------------------------

function highlightQuotes(text: string, quotes: string[]): React.ReactNode {
  const q = quotes.find((x) => x && text.includes(x))
  if (!q) return text
  const i = text.indexOf(q)
  return (
    <>
      {text.slice(0, i)}
      <mark className="rounded-sm bg-ai-subtle px-0.5 text-foreground">{q}</mark>
      {text.slice(i + q.length)}
    </>
  )
}

function AiAvatar() {
  return (
    <MessageAvatar aria-hidden className="size-6 min-w-6 self-start bg-ai-subtle">
      <Sparkles className="size-3.5 text-ai" />
    </MessageAvatar>
  )
}

/** AI turn: avatar + ghost bubble (full width, no fill) — design-system v4 5.10 AI 메시지 */
function AiMessage({ children, className, ...props }: React.ComponentProps<typeof Message>) {
  return (
    <Message className={cn("gap-2.5", className)} {...props}>
      <AiAvatar />
      <MessageContent>
        <Bubble variant="ghost">
          <BubbleContent className="text-base leading-[1.75] whitespace-pre-wrap">{children}</BubbleContent>
        </Bubble>
      </MessageContent>
    </Message>
  )
}

/**
 * Follow the conversation: a send (a new user message, or a turn starting) jumps to the end and puts the scroller
 * back in "following-bottom", so the reply, the inline proposal and anything after stay in view as they grow.
 * (No `scrollAnchor` on user messages — anchoring pinned the user's turn to the top and stopped following.)
 */
function FollowOnSend({ panel }: { panel: AiPanelController }) {
  const { scrollToEnd } = useMessageScroller()
  const userCount = panel.chat?.messages.filter((m) => m.role === "user").length ?? 0
  const turnRunning = panel.phase === "starting" || panel.phase === "streaming"
  const prev = React.useRef({ userCount, turnRunning })
  React.useEffect(() => {
    const before = prev.current
    prev.current = { userCount, turnRunning }
    // a turn starting / a user message added — not a turn ending (the user may be reading further up by then)
    if ((turnRunning && !before.turnRunning) || userCount > before.userCount) scrollToEnd({ behavior: "smooth" })
  }, [userCount, turnRunning, scrollToEnd])
  return null
}

/** a flashed user message (onUserMessageClick from a card's 근거) is brought into view inside the scroller */
function FlashScroll({ messageId }: { messageId: string | undefined }) {
  const { scrollToMessage } = useMessageScroller()
  React.useEffect(() => {
    if (messageId) scrollToMessage(messageId, { align: "center", behavior: "smooth" })
  }, [messageId, scrollToMessage])
  return null
}

// 내 메시지: primary fill, no stroke (BubbleContent keeps a transparent border)
const USER_BUBBLE = "rounded-2xl rounded-br-md px-3.5 py-2.5 text-base leading-[1.75] whitespace-pre-wrap"
// a flashed bubble (card 근거 click) gets an AI ring — the field-flash fill would fight the primary fill
const USER_BUBBLE_FLASH = "ring-2 ring-ai ring-offset-2 ring-offset-panel"

function MessageList({
  panel,
  onUserMessageClick,
  onDeleteChat,
  proposal,
  hideFailure,
}: {
  panel: AiPanelController
  onUserMessageClick?: (m: WritingChatMessageView) => void
  onDeleteChat: () => void
  /** inline proposal (proposalInline): after the latest AI turn, streaming reply included */
  proposal?: React.ReactNode
  hideFailure?: boolean
}) {
  const messages = panel.chat?.messages ?? []
  const startArea = !panel.chat || panel.chat.message_count === 0
  const providerLabel = panel.connection?.active_provider ? AI_PROVIDER_LABELS[panel.connection.active_provider] : null
  // R-OD-15 (AI C-7.1): the free-tier data-use greeting line is Gemini free only — OpenAI · Anthropic free keys get none
  const freeTier = panel.connection?.connection_tier === "free" && panel.connection?.active_provider === "gemini" && providerLabel

  if (panel.loadingChat) {
    return (
      <div className="min-h-0 flex-1 space-y-5 overflow-hidden px-4 py-4" aria-busy="true">
        <span className="sr-only">대화를 불러오는 중</span>
        <Skeleton className="h-16 w-4/5" />
        <Skeleton className="ml-auto h-12 w-3/5" />
        <Skeleton className="h-16 w-4/5" />
      </div>
    )
  }

  // shadcn Chat: Message Scroller follows the bottom (autoScroll) while the user stays at the live edge; a send
  // brings it back there (FollowOnSend). Remounted per chat so a switched chat opens at its end.
  return (
    <MessageScrollerProvider key={panel.chat?.id ?? "start"} autoScroll defaultScrollPosition="end">
      <MessageScroller className="h-auto flex-1">
        <FlashScroll messageId={panel.flashedMessage?.id} />
        <FollowOnSend panel={panel} />
        {/* Content is role="log": an added message is announced; the streaming item is aria-hidden (A-6) */}
        <MessageScrollerViewport aria-label="대화 메시지">
          <MessageScrollerContent className="gap-5 px-4 py-4">
            {/* 시작 영역: no chat row yet → the local greeting (same copy the start RPC stores) */}
            {!panel.chat ? (
              <MessageScrollerItem messageId="greeting">
                <AiMessage>
                  {panel.greeting}
                  {freeTier ? `\n${freeTierGreetingLine(providerLabel)}` : ""}
                </AiMessage>
              </MessageScrollerItem>
            ) : null}
            {messages.map((m) => {
              // a failed / stopped reply isn't an answer: the line or C-20 below the user message stands for it (OD-P11, R-OD-8)
              if (isHiddenAssistantRow(m)) return null
              const flashed = panel.flashedMessage?.id === m.id
              if (m.role === "user") {
                const text = flashed ? highlightQuotes(m.content, panel.flashedMessage?.quotes ?? []) : m.content
                return (
                  <MessageScrollerItem key={m.id} messageId={m.id}>
                    <Message align="end">
                      <MessageContent className="gap-1">
                        <MessageHeader className="justify-end px-0 tabular-nums">내 답변 #{m.user_number ?? "?"}</MessageHeader>
                        <Bubble align="end" variant="default" className="max-w-[85%]">
                          {/* a button only when the page wires the click (no inert tab stops, UQ-PA-16) */}
                          {onUserMessageClick ? (
                            <BubbleContent asChild className={cn(USER_BUBBLE, "cursor-pointer", flashed && USER_BUBBLE_FLASH)}>
                              <button type="button" onClick={() => onUserMessageClick(m)}>
                                {text}
                              </button>
                            </BubbleContent>
                          ) : (
                            <BubbleContent className={cn(USER_BUBBLE, flashed && USER_BUBBLE_FLASH)}>{text}</BubbleContent>
                          )}
                        </Bubble>
                        {panel.unanswered?.id === m.id ? <UnansweredLine panel={panel} /> : null}
                      </MessageContent>
                    </Message>
                  </MessageScrollerItem>
                )
              }
              return (
                <MessageScrollerItem key={m.id} messageId={m.id} className="space-y-2">
                  <AiMessage>
                    {m.content}
                    {m.is_greeting && freeTier && !m.content.includes("무료 등급") ? `\n${freeTierGreetingLine(providerLabel)}` : ""}
                  </AiMessage>
                  {panel.sensitiveMessageIds.has(m.id) ? (
                    <Alert variant="info" className="ml-8 w-auto">
                      <AlertDescription className="text-sm">
                        {PANEL_COPY.sensitive}{" "}
                        <Button variant="link" size="sm" className="h-auto px-0" onClick={onDeleteChat}>
                          대화 삭제
                        </Button>
                      </AlertDescription>
                    </Alert>
                  ) : null}
                </MessageScrollerItem>
              )
            })}
            {startArea ? (
              <MessageScrollerItem messageId="notice" className="flex items-start gap-1.5 pl-8 text-sm text-muted-foreground">
                <Info className="mt-0.5 size-4 shrink-0" aria-hidden />
                {PANEL_NOTICE[panel.target]}
              </MessageScrollerItem>
            ) : null}
            {/* streaming reply (C-04): announced on completion only (A-6) */}
            {panel.phase === "streaming" ? (
              <MessageScrollerItem messageId="streaming" aria-hidden>
                {panel.reply ? (
                  <AiMessage>
                    {panel.reply}
                    <StreamingCaret />
                  </AiMessage>
                ) : (
                  <Message className="items-center gap-2.5 text-muted-foreground">
                    <AiAvatar />
                    <Loader2 className="size-4 animate-spin" aria-hidden />
                    <span>답을 쓰는 중…</span>
                  </Message>
                )}
              </MessageScrollerItem>
            ) : null}
            {/* empty:hidden — the card may render nothing (no proposal yet): no stray gap */}
            {proposal ? (
              <MessageScrollerItem messageId="proposal" className="pl-8 empty:hidden">
                {proposal}
              </MessageScrollerItem>
            ) : null}
            {panel.failure && !hideFailure ? (
              <MessageScrollerItem messageId="failure" className="pl-8">
                <AiErrorNotice
                  code={panel.failure.code as Parameters<typeof AiErrorNotice>[0]["code"]}
                  provider={panel.failure.provider}
                  retryAfter={panel.failure.retry_after}
                  quotaResetsAt={panel.failure.quota_resets_at}
                  size="inline"
                  requestPath
                  retryLabel="다시 보내기"
                  onRetry={panel.retry}
                  lockEntry="writing_chat"
                />
              </MessageScrollerItem>
            ) : null}
          </MessageScrollerContent>
        </MessageScrollerViewport>
        <MessageScrollerButton>
          <ArrowDown aria-hidden />
          <span className="sr-only">최근 메시지로 이동</span>
        </MessageScrollerButton>
      </MessageScroller>
    </MessageScrollerProvider>
  )
}

/**
 * OD-P11 (UX v5.13 S-10 패널 행 "답을 받지 못한 메시지"): under the last user message when it has no answer and no
 * turn runs. Not a failure (no C-20, no destructive tone). [UI-가정] muted caption + link button, right-aligned
 * under the bubble.
 */
function UnansweredLine({ panel }: { panel: AiPanelController }) {
  return (
    <p className="flex items-center justify-end gap-1 text-sm text-muted-foreground">
      <span>{UNANSWERED_COPY.line}</span>
      <span aria-hidden>·</span>
      <Button variant="link" size="sm" className="h-auto px-0" disabled={panel.responding} onClick={panel.resendUnanswered}>
        {UNANSWERED_COPY.resend}
      </Button>
    </p>
  )
}

/** 제안 독 (5.10): a card right above the chip row; the card handles fold / max height (≤ 55%). */
function ProposalDock({ children }: { children: React.ReactNode }) {
  if (children === null || children === undefined || children === false) return null
  // empty:hidden — the card component may render nothing (no proposal yet): no stray divider / gap above the chips
  return <div className="relative max-h-[55%] shrink-0 overflow-y-auto border-t border-border/60 px-3 pt-3 empty:hidden">{children}</div>
}

