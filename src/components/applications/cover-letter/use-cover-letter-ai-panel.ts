"use client"

/**
 * S-46 서류 대화 → 공통 Resumate AI 패널 **어댑터** (58 런, 사용자 피드백 "공통 컴포넌트 미사용").
 *
 * S-46 패널은 이제 S-10·S-44와 **같은 `<AiPanel>`**(머리 · 기록 보기 · 메시지 스크롤러 · 말풍선 · 칩 줄 ·
 * 입력 알약 · 잠금 · 끝난 대화 · 삭제 확인)으로 그린다. 그 컴포넌트가 읽는 것은 `AiPanelController` 모양이고,
 * 서류 대화의 동작(턴 스트림 · CF-S8 턴 전 자동 저장 · 초안 턴 6회 · 기록 열기 경합 UQ-760 · 문항 제안)은
 * 지금까지처럼 `useCoverLetterPanel`이 맡는다. 이 훅은 **둘 사이의 모양만 맞춘다** — 로직을 새로 두지 않는다.
 *
 * `useAiPanel`(S-10·S-44)은 건드리지 않는다: 그 훅은 `project` / `deliverable` 대화 계약에 묶여 있다.
 *
 * 매핑 요점
 * - 입력창 글자는 여기 둔다. 보내기는 `cl.send(text, { onSent })` — 입력창은 턴이 **실제로 나갈 때만** 비운다
 *   (CF-S8: 턴 전 저장이 실패하면 글자가 남는다).
 * - CF-S8 저장 중(`preparing`)은 공통 패널의 `starting`(입력 잠금 + 도는 표시)으로 보인다.
 * - 칩은 서류 대화 칩 문자열 그대로. 초안 턴 상한(6회)에 닿으면 "빠진 부분 물어봐 줘" · "새 대화 시작"(AI-04 표, UQ-770).
 * - 메시지 상한(서류 대화는 39에서 막는다)·끝난 대화 → 공통 "끝난 대화" 상자. 문구는 화면이 `copy.closed`로 이전 S-46
 *   문구를 넘긴다(공통 상자는 40 이상만 상한 문구를 고르므로, UQ-764).
 * - 실패한 턴 → 공통 C-20(다시 보내기). 초안 턴 실패는 제안 카드(3.26)가 그리므로 목록에서 숨긴다.
 */
import * as React from "react"
import type { AiPanelController, TurnFailure, TurnPhase } from "@/components/career/ai-panel"
import { useAiConnection } from "@/components/common/ai-connection-context"
import type { DocPanelPlacement } from "@/components/common/shell/doc-body"
import type { DeliverableStructuredDraft } from "@/types/db"
import type { WritingChatMessageView, WritingChatSummary, WritingChatView } from "@/lib/data/career-v45-shared"
import type { QuickChip } from "@/lib/data/quick-chips"
import type { CoverLetterPanelController } from "./use-cover-letter-panel"
import { chipTurnOptions, coverLetterPanelChips } from "./panel-rules"

const NO_IDS: ReadonlySet<string> = new Set()
const NOOP = () => {}

/** 서류 대화 메시지 → 공통 스레드 행. 빈 AI 행은 그리지 않는다(기존 동작). 시작 인사는 대화가 비었을 때만 맨 위에 */
export function toThreadMessages(cl: Pick<CoverLetterPanelController, "messages" | "chat">, greeting: string): WritingChatMessageView[] {
  let userNo = 0
  const rows: WritingChatMessageView[] = []
  cl.messages.forEach((m, i) => {
    if (m.role === "assistant" && !m.content) return
    rows.push({
      id: m.id,
      sequence: i + 1,
      role: m.role,
      content: m.content,
      status: m.status === "failed" ? "failed" : m.status === "pending" ? "streaming" : "done",
      provider: null,
      created_at: "",
      user_number: m.role === "user" ? ++userNo : null,
      is_greeting: false,
    })
  })
  if (cl.messages.length === 0 && cl.chat) {
    // 대화 행은 있는데 메시지가 아직 없다 — 공통 패널은 `chat`이 있으면 `greeting`을 그리지 않으므로 인사 행을 둔다
    rows.unshift({ id: "greeting", sequence: 0, role: "assistant", content: greeting, status: "done", provider: null, created_at: "", user_number: null, is_greeting: true })
  }
  return rows
}

export function useCoverLetterAiPanel(cl: CoverLetterPanelController, placement: DocPanelPlacement): AiPanelController {
  const connection = useAiConnection()
  const [input, setInput] = React.useState("")
  const [view, setView] = React.useState<"chat" | "history">("chat")

  const greeting = `${cl.greeting}\n${cl.offer}`
  const messages = toThreadMessages(cl, greeting)
  const messageCount = cl.messages.length
  const closed = cl.chat?.status === "closed" || cl.messageLimitReached
  const responding = cl.phase !== "idle" || cl.preparing
  const phase: TurnPhase = cl.preparing
    ? "starting"
    : cl.phase === "idle"
      ? "idle"
      : cl.phase === "replying" || cl.reply
        ? "streaming"
        : "drafting"

  const chats: WritingChatSummary[] = cl.chats.map((c) => ({ ...c, last_applied_at: null }))
  const chat: WritingChatView | null = cl.chat
    ? {
        id: cl.chat.id,
        project_id: "",
        project_deliverable_id: null,
        title: cl.chat.title,
        status: cl.chat.status,
        message_count: messageCount,
        last_activity_at: cl.chat.last_activity_at,
        last_applied_at: null,
        return_target: null,
        // 공통 패널은 초안을 읽지 않는다 — 제안 카드(3.26)는 `cl`을 직접 읽는다
        structured_draft: cl.chat.structured_draft as unknown as DeliverableStructuredDraft,
        messages,
      }
    : null

  // 초안 6회에 닿으면 "빠진 부분 물어봐 줘" · "새 대화 시작"(AI-04 표, UQ-770)
  const chips: QuickChip[] = coverLetterPanelChips(cl.chips, cl.draftLimitReached)

  const failure: TurnFailure | null = cl.failure
    ? {
        code: cl.failure.code,
        provider: cl.failure.provider ?? null,
        retry_after: cl.failure.retryAfter ?? null,
        quota_resets_at: cl.failure.quotaResetsAt ?? null,
        content: "",
        requested_slot: null,
        requested_action: null,
        style: null,
        draft_turn: cl.draftFailed,
      }
    : null

  const show = () => {
    if (placement.mode === "wide") placement.setWideOpen(true)
    else placement.setSheetOpen(true)
    cl.focusInput()
  }
  const hide = () => {
    if (placement.mode === "wide") placement.setWideOpen(false)
    else placement.setSheetOpen(false)
  }

  return {
    target: "deliverable",
    targetId: null,
    placement,
    reopen: { visible: placement.mode === "wide" && !placement.wideOpen, onClick: () => placement.setWideOpen(true) },
    show,
    hide,
    chats,
    chat,
    view,
    setView,
    loadingChat: false,
    greeting,
    connection,
    locked: cl.locked,
    consentDialog: cl.consentDialog,
    input,
    setInput,
    bindInput: cl.bindInput,
    focusInput: cl.focusInput,
    phase,
    reply: cl.reply,
    provisionalBlocks: [],
    draftStarted: cl.phase === "drafting" || cl.phase === "adjusting",
    failure,
    unanswered: null,
    resendUnanswered: NOOP,
    block: null,
    clearBlock: NOOP,
    retryBlocked: NOOP,
    sensitiveMessageIds: NO_IDS,
    chips,
    chipsVisible: chips.length > 0 && !closed && !cl.locked,
    responding,
    closed,
    messageCount,
    send: (content) => {
      const typed = content === undefined
      const text = (content ?? input).trim()
      if (!text) return
      // 입력창은 턴이 실제로 나갈 때만 비운다 (CF-S8)
      cl.send(text, typed ? { onSent: () => setInput("") } : {})
    },
    sendChip: (chip) => {
      if (chip.kind === "new_chat") return cl.newChat()
      cl.send(chip.label, chipTurnOptions(chip.label))
    },
    retry: cl.retry,
    stop: cl.stop,
    newChat: async () => {
      setView("chat")
      cl.newChat()
    },
    openChat: async (id) => {
      const summary = cl.chats.find((c) => c.id === id)
      setView("chat")
      if (summary) cl.openChat(summary)
    },
    deleteChat: async (id) => cl.deleteChat(id),
    patchDraft: async () => false,
    patchRefusal: null,
    setDraft: NOOP,
    markApplied: NOOP,
    flashMessage: NOOP,
    flashedMessage: null,
  }
}
