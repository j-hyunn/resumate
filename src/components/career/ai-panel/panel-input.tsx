"use client"

/**
 * 패널 아래쪽 (design-system v4 5.10 "칩 줄" · "입력 영역" · "잠금 · 끝난 대화"): before-send blocks →
 * chip row (start area only) → the input pill (Enter 보내기, Shift+Enter 줄바꿈, no send while composing Hangul)
 * (block-end row: "{n}/40" · send). Replaced by C-18 inline (no key) or the closed-chat box (40 / `closed`).
 */
import * as React from "react"
import { ArrowUp, Loader2, Lock, Plus, Square } from "lucide-react"
import { cn } from "@/lib/utils"
import { Alert, AlertDescription } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { InputGroup, InputGroupAddon, InputGroupButton, InputGroupTextarea } from "@/components/ui/input-group"
import { AiErrorNotice } from "@/components/common/ai-error-notice"
import { AiLock, type AiLockEntry } from "@/components/common/ai-lock"
import { ProviderBadge } from "@/components/common/provider-badge"
import { PAGE_LIMITS, PANEL_COPY } from "@/lib/data/career-v45-shared"
import type { AiPanelController, PanelBlock } from "./use-ai-panel"

export function PanelInputArea({
  panel,
  renderClosedActions,
  onDirectInput,
  lockCopy,
  lockEntry = "writing_chat",
}: {
  panel: AiPanelController
  renderClosedActions?: (panel: AiPanelController) => React.ReactNode
  onDirectInput?: () => void
  /** C-18 description; default = the S-10 / S-44 copy for `panel.target` */
  lockCopy?: string
  lockEntry?: AiLockEntry
}) {
  const lockDescription = lockCopy ?? PANEL_COPY.lock[panel.target]
  if (panel.locked) {
    return (
      <div className="shrink-0 px-3 pt-3 pb-3">
        <AiLock entry={lockEntry} size="inline" description={lockDescription} alternativeLabel="직접 입력" onAlternative={onDirectInput} actionName="Resumate AI에게 보내기" />
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
          <BlockNotice panel={panel} block={panel.block} lockDescription={lockDescription} lockEntry={lockEntry} />
        </div>
      ) : null}
      <ChipRow panel={panel} />
      <div className="px-3 pt-2 pb-3">
        <InputPill panel={panel} />
      </div>
    </div>
  )
}

function BlockNotice({ panel, block, lockDescription, lockEntry }: { panel: AiPanelController; block: PanelBlock; lockDescription: string; lockEntry: AiLockEntry }) {
  const newChat = (
    <Button variant="outline" size="sm" onClick={() => void panel.newChat()}>
      새 대화
    </Button>
  )
  switch (block.kind) {
    case "key_invalid":
      return <AiErrorNotice code="key_invalid" size="inline" lockEntry={lockEntry} />
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
      return <AiLock entry={lockEntry} size="inline" description={lockDescription} actionName="Resumate AI에게 보내기" />
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
  }
}

function ChipRow({ panel }: { panel: AiPanelController }) {
  if (!panel.chipsVisible) return null
  return (
    <div className="flex flex-wrap gap-1.5 px-3 pt-3" role="group" aria-label="빠른 버튼">
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
      onSubmit={(e) => {
        e.preventDefault()
        panel.send()
      }}
    >
      {/* shadcn AI Elements Prompt Input: Input Group with the textarea on top and a block-end row —
          [+] 첨부 (disabled) on the left · "{n}/40" · C-19 model badge · send / stop on the right */}
      <InputGroup className="rounded-3xl bg-white has-disabled:bg-white has-disabled:opacity-100 dark:bg-card">
        <InputGroupTextarea
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
          className="field-sizing-content max-h-40 min-h-12 px-4 pt-3 pb-1 text-base leading-6"
        />
        <InputGroupAddon align="block-end" className="gap-2 px-3 pb-2.5">
          {/* 파일 첨부: not built yet — shown disabled (the tooltip says so); a hidden file input comes with it */}
          <Tooltip>
            <TooltipTrigger asChild>
              {/* span: a disabled button gets no pointer events, the wrapper keeps the tooltip */}
              <span tabIndex={0} className="rounded-full outline-none focus-visible:ring-2 focus-visible:ring-ring">
                <InputGroupButton variant="outline" size="icon-sm" className="rounded-full" aria-label="파일 첨부 (준비 중)" disabled>
                  <Plus aria-hidden />
                </InputGroupButton>
              </span>
            </TooltipTrigger>
            <TooltipContent>파일 첨부는 준비 중이에요</TooltipContent>
          </Tooltip>
          {/* 대화 수 · C-19 연결 배지 (moved from the panel header) · send */}
          <MessageCount panel={panel} className="ml-auto" />
          <ProviderBadge className="max-w-[10rem] min-w-0 truncate" />
          {starting ? (
            <span className="grid size-8 shrink-0 place-items-center" role="status">
              <Loader2 className="size-4 animate-spin text-muted-foreground" aria-hidden />
              <span className="sr-only">대화를 시작하는 중</span>
            </span>
          ) : streaming ? (
            <InputGroupButton variant="outline" size="icon-sm" className="rounded-full" aria-label="중단" onClick={panel.stop}>
              <Square className="size-3.5" aria-hidden />
            </InputGroupButton>
          ) : (
            <InputGroupButton type="submit" variant="default" size="icon-sm" className="rounded-full" aria-label="보내기" disabled={!canSend}>
              <ArrowUp aria-hidden />
            </InputGroupButton>
          )}
        </InputGroupAddon>
      </InputGroup>
    </form>
  )
}

/** 현재 대화 수 "{n}/40" — next to the send button; warning colour from 36 */
function MessageCount({ panel, className }: { panel: AiPanelController; className?: string }) {
  const count = panel.messageCount
  return (
    <span
      aria-label={`대화 ${count} / ${PAGE_LIMITS.messageLimit}`}
      className={cn("shrink-0 text-xs text-muted-foreground tabular-nums", count >= PAGE_LIMITS.chipsHideFrom && "text-warning-subtle-foreground", className)}
    >
      {count}/{PAGE_LIMITS.messageLimit}
    </span>
  )
}

/** closed chat: the count alone under the closed box */
function Footer({ panel }: { panel: AiPanelController }) {
  return (
    <div className="flex justify-end px-2">
      <MessageCount panel={panel} />
    </div>
  )
}
