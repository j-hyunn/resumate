"use client"

/**
 * 패널 아래쪽 (design-system v4 5.10 "칩 줄" · "입력 영역" · "잠금 · 끝난 대화"): before-send blocks →
 * quick answers + chip row → the input pill (Enter 보내기, Shift+Enter 줄바꿈, no send while composing Hangul)
 * → G-2 line + "{n} / 40". Replaced by C-18 inline (no key) or the closed-chat box (40 / `closed`).
 */
import * as React from "react"
import { ArrowUp, Loader2, Lock, Plus, ShieldAlert, Square } from "lucide-react"
import { cn } from "@/lib/utils"
import { Alert, AlertDescription } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"
import { Textarea } from "@/components/ui/textarea"
import { AiErrorNotice } from "@/components/common/ai-error-notice"
import { AiLock } from "@/components/common/ai-lock"
import { GUIDE_COPY } from "@/components/common/input-guide"
import { PAGE_LIMITS, PANEL_COPY } from "@/lib/data/career-v45-shared"
import type { AiPanelController, PanelBlock } from "./use-ai-panel"

export function PanelInputArea({
  panel,
  renderClosedActions,
  onDirectInput,
}: {
  panel: AiPanelController
  renderClosedActions?: (panel: AiPanelController) => React.ReactNode
  onDirectInput?: () => void
}) {
  if (panel.locked) {
    return (
      <div className="shrink-0 px-3 pt-3 pb-3">
        <AiLock entry="writing_chat" size="inline" description={PANEL_COPY.lock[panel.target]} alternativeLabel="직접 입력" onAlternative={onDirectInput} actionName="Resumate AI에게 보내기" />
      </div>
    )
  }
  if (panel.closed) {
    const full = (panel.chat?.message_count ?? 0) >= PAGE_LIMITS.messageLimit
    return (
      <div className="shrink-0 space-y-1.5 px-3 pt-3 pb-3">
        <div className="space-y-2 rounded-2xl border border-dashed border-input bg-card p-3">
          <p className="flex items-start gap-2 text-sm">
            <Lock className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden />
            {full ? PANEL_COPY.messageLimit : PANEL_COPY.chatClosed}
          </p>
          <div className="flex flex-wrap gap-2">
            {renderClosedActions?.(panel)}
            <Button variant="outline" size="sm" onClick={() => void panel.newChat()}>
              <Plus aria-hidden />
              새 대화
            </Button>
          </div>
        </div>
        <Footer panel={panel} />
      </div>
    )
  }
  return (
    <div className="shrink-0">
      {panel.block ? (
        <div className="px-3 pt-3">
          <BlockNotice panel={panel} block={panel.block} />
        </div>
      ) : null}
      <ChipRow panel={panel} />
      <div className="space-y-1.5 px-3 pt-2 pb-3">
        <InputPill panel={panel} />
        <Footer panel={panel} />
      </div>
    </div>
  )
}

function BlockNotice({ panel, block }: { panel: AiPanelController; block: PanelBlock }) {
  const newChat = (
    <Button variant="outline" size="sm" onClick={() => void panel.newChat()}>
      새 대화
    </Button>
  )
  switch (block.kind) {
    case "key_invalid":
      return <AiErrorNotice code="key_invalid" size="inline" lockEntry="writing_chat" />
    case "invalid_form_snapshot":
      return (
        <Alert variant="warning">
          <AlertDescription className="text-sm">{PANEL_COPY.invalidFormSnapshot}</AlertDescription>
        </Alert>
      )
    case "writing_chat_closed":
      return (
        <Alert variant="info" className="flex items-center gap-2">
          <AlertDescription className="flex-1 text-sm">{PANEL_COPY.chatClosed}</AlertDescription>
          {newChat}
        </Alert>
      )
    case "draft_limit":
      return (
        <Alert variant="info" className="flex items-center gap-2">
          <AlertDescription className="flex-1 text-sm">{PANEL_COPY.draftLimit}</AlertDescription>
          {newChat}
        </Alert>
      )
    case "deliverable_limit":
      return (
        <Alert variant="info">
          <AlertDescription className="text-sm">{PANEL_COPY.deliverableLimit}</AlertDescription>
        </Alert>
      )
    case "first_save_failed":
      return (
        <Alert variant="destructive" className="flex items-center gap-2">
          <AlertDescription className="flex-1 text-sm">{PANEL_COPY.firstSaveFailed.split(" · ")[0]}</AlertDescription>
          <Button variant="outline" size="sm" onClick={panel.retryBlocked}>
            다시 시도
          </Button>
        </Alert>
      )
    case "start_failed":
      return (
        <Alert variant="destructive" className="flex items-center gap-2">
          {/* [UI-가정] C-20 has no row for a failed start RPC: a generic line + retry */}
          <AlertDescription className="flex-1 text-sm">대화를 시작하지 못했어요</AlertDescription>
          <Button variant="outline" size="sm" onClick={panel.retryBlocked}>
            다시 시도
          </Button>
        </Alert>
      )
    case "ai_not_connected":
      return <AiLock entry="writing_chat" size="inline" description={PANEL_COPY.lock[panel.target]} actionName="Resumate AI에게 보내기" />
    case "connection_check_failed":
      return (
        <Alert variant="destructive" className="flex items-center gap-2">
          {/* [UI-가정] copy */}
          <AlertDescription className="flex-1 text-sm">연결 상태를 확인하지 못했어요</AlertDescription>
          <Button variant="outline" size="sm" onClick={panel.retryBlocked}>
            다시 시도
          </Button>
        </Alert>
      )
    case "backend_pending":
      return (
        <Alert variant="info">
          <AlertDescription className="text-sm">{PANEL_COPY.backendPending}</AlertDescription>
        </Alert>
      )
  }
}

/** "AI가 질문 중일 때" = the last message is the AI's and asks something [UI-가정: a "?" in it]. */
function asking(panel: AiPanelController): boolean {
  const last = panel.chat?.messages[panel.chat.messages.length - 1]
  return Boolean(last && last.role === "assistant" && !last.is_greeting && /\?/.test(last.content))
}

function ChipRow({ panel }: { panel: AiPanelController }) {
  if (!panel.chipsVisible) return null
  const quick = asking(panel) && panel.phase === "idle"
  return (
    <div className="flex flex-wrap gap-1.5 px-3 pt-3" role="group" aria-label="빠른 버튼">
      {quick
        ? PANEL_COPY.quickAnswers.map((q) => (
            <Button key={q} variant="ghost" size="sm" disabled={panel.responding} onClick={() => panel.send(q)}>
              {q}
            </Button>
          ))
        : null}
      {panel.chips.map((chip) => (
        <Button key={chip.label} variant="chip" className="max-w-full" title={chip.label} disabled={panel.responding} onClick={() => panel.sendChip(chip)}>
          <span className="truncate">{chip.label}</span>
        </Button>
      ))}
    </div>
  )
}

function InputPill({ panel }: { panel: AiPanelController }) {
  // the callback ref travels alone (react-hooks/refs treats the object that feeds `ref` as a ref)
  const { bindInput } = panel
  const starting = panel.phase === "starting"
  const streaming = panel.responding && !starting
  const canSend = panel.input.trim().length > 0 && !panel.responding
  return (
    <form
      className="flex items-end gap-2 rounded-3xl border border-input bg-card py-1.5 pr-1.5 pl-4 focus-within:ring-2 focus-within:ring-ring"
      onSubmit={(e) => {
        e.preventDefault()
        panel.send()
      }}
    >
      <Textarea
        ref={bindInput}
        value={panel.input}
        onChange={(e) => {
          panel.setInput(e.target.value)
          if (panel.block && panel.block.kind !== "draft_limit" && panel.block.kind !== "writing_chat_closed") panel.clearBlock()
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
            e.preventDefault()
            panel.send()
          }
        }}
        disabled={starting}
        maxLength={PAGE_LIMITS.messageMaxChars}
        placeholder={PANEL_COPY.inputPlaceholder}
        aria-label={PANEL_COPY.inputPlaceholder}
        rows={1}
        className="field-sizing-content max-h-40 min-h-9 flex-1 resize-none border-0 bg-transparent p-0 py-1.5 text-base leading-6 shadow-none focus-visible:ring-0 focus-visible:ring-offset-0 dark:bg-transparent"
      />
      {starting ? (
        <span className="grid size-8 shrink-0 place-items-center" role="status">
          <Loader2 className="size-4 animate-spin text-muted-foreground" aria-hidden />
          <span className="sr-only">대화를 시작하는 중</span>
        </span>
      ) : streaming ? (
        <Button type="button" variant="outline" size="icon-sm" className="size-8 shrink-0 rounded-full" aria-label="중단" onClick={panel.stop}>
          <Square className="size-3.5" aria-hidden />
        </Button>
      ) : (
        <Button type="submit" size="icon-sm" className="size-8 shrink-0 rounded-full" aria-label="보내기" disabled={!canSend}>
          <ArrowUp aria-hidden />
        </Button>
      )}
    </form>
  )
}

function Footer({ panel }: { panel: AiPanelController }) {
  const count = panel.messageCount
  return (
    <div className="flex items-start justify-between gap-3 px-2">
      {/* G-2 (C-07 shape), 12px in the narrow panel [가정 G-55] */}
      <p className="flex items-start gap-1 text-xs leading-4 text-muted-foreground">
        <ShieldAlert className="mt-px size-3.5 shrink-0" aria-hidden />
        {GUIDE_COPY["G-2"]}
      </p>
      <span className={cn("shrink-0 text-xs text-muted-foreground tabular-nums", count >= PAGE_LIMITS.chipsHideFrom && "text-warning-subtle-foreground")}>
        {count} / {PAGE_LIMITS.messageLimit}
      </span>
    </div>
  )
}
