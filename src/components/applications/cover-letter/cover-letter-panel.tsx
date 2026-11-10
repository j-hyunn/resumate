"use client"

/**
 * S-46 오른쪽 **Resumate AI 패널** (UX v5.20 S-46 "Resumate AI 패널" · design-system 5.10 / 5.12).
 *
 * 구조·열고 닫기·메시지 상한 40·실패한 턴·좁은 화면은 S-10·S-44 패널과 같은 결이고(CL-A7·CL-A1),
 * 다른 점만 여기서 다룬다: 제안 카드가 **3.26 `QuestionProposalCard`**(S-44의 3.25가 아니다),
 * 서류 대화는 **복귀 대상이 없다**, 초안 상한은 **초안 턴 6회**(문항당 아님).
 *
 * 키 없음·키 무효는 **패널만 잠긴다**(C-18) — 왼쪽 본문 입력·문항 편집·저장하기·복사는 그대로 된다(CL-8).
 * 동의 필요는 보낼 때 C-21을 띄운다.
 */
import * as React from "react"
import { History, Loader2, MoreHorizontal, Plus, Send, Sparkles, Square, X } from "lucide-react"
import { Button } from "@/components/ui/button"
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { Textarea } from "@/components/ui/textarea"
import { AiErrorNotice } from "@/components/common/ai-error-notice"
import { AiLock } from "@/components/common/ai-lock"
import { DeleteConfirmDialog, type DeleteTarget } from "@/components/common/delete-confirm-dialog"
import { InputGuide } from "@/components/common/input-guide"
import { ProviderBadge } from "@/components/common/provider-badge"
import { StreamingCaret } from "@/components/common/streaming"
import { COVER_LETTER_MESSAGE_LIMIT, PANEL_COPY, PANEL_FIXED_NOTE } from "@/lib/data/cover-letter-chat-types"
import { formatRelative } from "@/lib/data/labels"
import { QuestionProposalCard, type QuestionFill } from "./question-proposal-card"
import type { CoverLetterPanelController } from "./use-cover-letter-panel"

export function CoverLetterPanel({
  panel,
  questions,
  filled,
  onFill,
}: {
  panel: CoverLetterPanelController
  questions: Array<{ slot: string; question_text: string; answer_title: string; body: string }>
  filled: Array<{ slot: string; rev: number }>
  onFill: (fills: QuestionFill[]) => void
}) {
  // 구조 분해로 받는다: `panel.bindInput`을 JSX에서 바로 쓰면 react-hooks/refs가 객체 전체를 ref로 본다
  const { bindInput } = panel
  const [input, setInput] = React.useState("")
  const [deleting, setDeleting] = React.useState<DeleteTarget | null>(null)
  const listRef = React.useRef<HTMLDivElement | null>(null)
  // CF-S8: 턴 전 자동 저장 중에도 보내기·칩을 막는다 (이중 전송 방지)
  const busy = panel.phase !== "idle" || panel.preparing

  // UP-3 자동 스크롤: 새 조각이 올 때 바닥에 붙어 있으면 따라간다
  React.useEffect(() => {
    const el = listRef.current
    if (!el) return
    const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 80
    if (atBottom) el.scrollTop = el.scrollHeight
  }, [panel.messages.length, panel.reply, panel.provisional])

  const submit = () => {
    const content = input.trim()
    if (!content || busy) return
    // 입력창은 턴이 **실제로 나갈 때만** 비운다 — 턴 전 저장이 실패하면 그대로 남는다 (CF-S8)
    panel.send(content, { onSent: () => setInput("") })
  }

  return (
    <aside className="flex min-h-0 w-full flex-col overflow-hidden rounded-xl bg-panel" aria-label="Resumate AI">
      {/* 머리 — 기록 목록 · + 새 대화 · ⋯ · × (시안 4) */}
      <div className="flex h-12 shrink-0 items-center gap-1 border-b px-3">
        <Sparkles className="size-4 text-ai" aria-hidden />
        <span className="text-sm font-medium">Resumate AI</span>
        <span className="flex-1" />
        <Popover>
          <PopoverTrigger asChild>
            <Button variant="ghost" size="icon-sm" aria-label="대화 기록">
              <History aria-hidden />
            </Button>
          </PopoverTrigger>
          <PopoverContent align="end" className="w-72 p-1">
            {panel.chats.length === 0 ? (
              <p className="p-3 text-sm text-muted-foreground">아직 대화가 없어요</p>
            ) : (
              <ul>
                {panel.chats.map((c) => (
                  <li key={c.id}>
                    <button
                      type="button"
                      className="w-full rounded-md px-2 py-1.5 text-left text-sm hover:bg-accent/50"
                      onClick={() => panel.openChat(c)}
                    >
                      <span className="block truncate">{c.title ?? "새 대화"}</span>
                      <span className="block text-xs text-muted-foreground tabular-nums">
                        {formatRelative(c.last_activity_at)} · {c.message_count} / {COVER_LETTER_MESSAGE_LIMIT}
                        {c.status === "closed" ? " · 끝난 대화" : ""}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </PopoverContent>
        </Popover>
        <Button variant="ghost" size="sm" onClick={panel.newChat}>
          <Plus aria-hidden />새 대화
        </Button>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="icon-sm" aria-label="대화 메뉴">
              <MoreHorizontal aria-hidden />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem
              variant="destructive"
              disabled={!panel.chat}
              onSelect={() => panel.chat && setDeleting({ kind: "writing_chat", entity_id: panel.chat.id })}
            >
              이 대화 삭제
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
        <Button variant="ghost" size="icon-sm" aria-label="패널 닫기" onClick={panel.hide}>
          <X aria-hidden />
        </Button>
      </div>

      {/* 본문 */}
      <div ref={listRef} className="min-h-0 flex-1 space-y-3 overflow-y-auto p-4">
        {panel.locked ? (
          // 키 없음·키 무효 → 패널만 잠긴다 (C-18 영역형). 왼쪽은 그대로 된다 (CL-8)
          <AiLock entry="draft" size="area" />
        ) : (
          <>
            {/* 시작 영역 — 시작 인사는 메시지 수에 세지 않는다 (A5) */}
            {panel.messages.length === 0 ? (
              <div className="space-y-2">
                <p className="text-sm leading-[1.7]">{panel.greeting}</p>
                <p className="text-sm text-muted-foreground">{panel.offer}</p>
                <p className="text-xs text-muted-foreground">{PANEL_FIXED_NOTE}</p>
              </div>
            ) : null}

            {panel.messages.map((m) => (
              <div key={m.id} className={m.role === "user" ? "flex justify-end" : undefined}>
                {m.role === "user" ? (
                  // UP-13 사용자 말풍선
                  <p className="max-w-[85%] rounded-xl bg-primary-subtle px-3 py-2 text-sm leading-[1.7] text-primary-subtle-foreground">{m.content}</p>
                ) : m.content ? (
                  <p className="text-sm leading-[1.7]">{m.content}</p>
                ) : null}
              </div>
            ))}

            {panel.reply ? (
              <p className="text-sm leading-[1.7]">
                {panel.reply}
                {panel.phase === "replying" ? <StreamingCaret /> : null}
              </p>
            ) : null}

            {/* 제안 카드 (3.26) — 마지막 AI 턴 바로 아래 확인 줄 (UP-4) */}
            <QuestionProposalCard panel={panel} questions={questions} filled={filled} onFill={onFill} />

            {/* 초안 턴이 끝났는데 남은 문항이 있으면 (UX v5.20 S-46 "첫 턴 제안" — UQ-748) */}
            {panel.offerNext && !panel.draftLimitReached ? <p className="text-sm leading-[1.7]">{PANEL_COPY.continueNext}</p> : null}

            {/* 실패한 턴 (초안 실패는 카드가 그린다) */}
            {panel.failure && !panel.draftFailed ? <AiErrorNotice {...panel.failure} size="inline" onRetry={panel.retry} /> : null}

            {/* 빠른 버튼 칩 — 대화 중에도 유지한다 (S-44 방식) */}
            {panel.chips.length > 0 ? (
              <div className="flex flex-wrap gap-1.5">
                {panel.chips.map((chip) => (
                  <Button
                    key={chip}
                    variant="outline"
                    size="sm"
                    disabled={busy || panel.messageLimitReached || (isDraftChip(chip) && panel.draftLimitReached)}
                    onClick={() => panel.send(chip, { draftTurn: isDraftChip(chip), style: chip === "더 간결하게" ? "shorter" : chip === "글자 수 맞춰 줘" ? "fit_length" : undefined })}
                  >
                    {chip}
                  </Button>
                ))}
              </div>
            ) : null}

            {panel.draftLimitReached ? <p className="text-sm text-muted-foreground">{PANEL_COPY.draftLimitReached}</p> : null}
            {panel.messageLimitReached ? <p className="text-sm text-muted-foreground">{PANEL_COPY.messageLimitReached}</p> : null}
            <InputGuide guide="G-2" />
          </>
        )}
      </div>

      {/* 입력창 (UP-2) */}
      {panel.locked ? null : (
        <div className="shrink-0 space-y-1.5 border-t p-3">
          <Textarea
            ref={bindInput}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
                e.preventDefault()
                submit()
              }
            }}
            className="min-h-16 resize-none text-base"
            placeholder="문항에 쓰고 싶은 경험이나 요청을 적어 주세요"
            aria-label="Resumate AI에게 보낼 메시지"
            disabled={panel.messageLimitReached}
          />
          <div className="flex items-center gap-2">
            <span className="text-xs text-muted-foreground tabular-nums">
              {panel.messages.length} / {COVER_LETTER_MESSAGE_LIMIT}
            </span>
            <ProviderBadge />
            <span className="flex-1" />
            {panel.phase !== "idle" ? (
              <Button variant="outline" size="sm" onClick={panel.stop}>
                <Square aria-hidden />
                중단
              </Button>
            ) : (
              // 턴 전 자동 저장 중(CF-S8)에는 막고 도는 표시만 — 저장은 중단할 수 없다
              <Button size="sm" disabled={!input.trim() || panel.messageLimitReached || panel.preparing} onClick={submit}>
                {panel.preparing ? <Loader2 className="animate-spin" aria-hidden /> : <Send aria-hidden />}
                보내기
              </Button>
            )}
          </div>
        </div>
      )}

      <DeleteConfirmDialog
        target={deleting}
        open={deleting !== null}
        onOpenChange={(o) => !o && setDeleting(null)}
        onConfirm={async () => {
          if (deleting?.kind === "writing_chat") panel.deleteChat(deleting.entity_id)
        }}
      />
    </aside>
  )
}

/** 초안 턴을 돌리는 칩 (상한 6회에 걸린다) */
function isDraftChip(chip: string): boolean {
  return chip.includes("초안 만들기") || chip === "글자 수 맞춰 줘" || chip === "더 간결하게"
}
