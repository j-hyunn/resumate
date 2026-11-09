"use client"

/**
 * S-46 Resumate AI 패널 컨트롤러 (UX v5.20 S-46 "Resumate AI 패널" · design-system 5.10/5.12).
 *
 * S-10·S-44의 `useAiPanel`을 넓히지 않고 **서류 대화 전용 컨트롤러**를 따로 두었다 — 그 훅은
 * `AiPanelTarget = "project" | "deliverable"`과 두 DTO 모양에 맞물려 있고(`WritingChatView.project_id`가
 * 필수), 서류 대화를 읽는 계약(`AnyWritingChatDto`에 서류 분기)이 아직 없다. 패널 **모양**은 5.10과
 * 같고, 다른 점(제안 카드 = 3.26, 복귀 대상 없음, 초안 턴 상한 6회)만 여기서 다룬다.
 *
 * 상한 규칙: **초안 "턴" 6회**(문항당 아님 — DM 2.9.4). 한 턴이 문항 3개를 써도 1회이므로 5문항은
 * 한 바퀴에 2회를 쓰고 세 바퀴가 가능하다. 남은 횟수 = `6 − draft_count`.
 */
import * as React from "react"
import { toast } from "sonner"
import type { AiErrorCode } from "@/types/db"
import type { AiErrorInfo } from "@/components/common/ai-error-notice"
import { useAiConnection } from "@/components/common/ai-connection-context"
import { useAiConsentGate } from "@/components/common/consent-gate"
import { mockCoverLetterTurn } from "@/lib/mock/cover-letter-turn"
import { realCoverLetterTurn } from "@/lib/data/ai-stream-client"
import {
  COVER_LETTER_DRAFT_LIMIT,
  COVER_LETTER_MESSAGE_LIMIT,
  coverLetterChips,
  coverLetterGreeting,
  firstTurnOffer,
  type CoverLetterChatSummary,
  type CoverLetterChatView,
  type CoverLetterProposalBlock,
  type CoverLetterSourceCard,
  type CoverLetterStructuredDraft,
  type CoverLetterTurnEvent,
} from "@/lib/data/cover-letter-chat-types"
import { deleteCoverLetterChatAction, startCoverLetterChatAction } from "@/app/(dashboard)/(gated)/applications/_lib/actions"

/** 한 턴이 끝나기 전의 임시 블록 (`draft_block`) — `draft_done`이 확정하면 버린다 */
export interface ProvisionalBlocks {
  slot: string
  questionNo: number
  blocks: CoverLetterProposalBlock[]
}

export interface CoverLetterPanelMessage {
  id: string
  role: "user" | "assistant"
  content: string
  status: "ok" | "failed" | "pending"
}

export interface CoverLetterPanelController {
  open: boolean
  show: () => void
  hide: () => void
  focusInput: () => void
  bindInput: React.RefCallback<HTMLTextAreaElement>
  /** 키 상태 — 잠겼으면 패널만 잠긴다 (왼쪽 본문·저장·복사는 그대로, CL-8) */
  locked: boolean
  lockReason: "ai_not_connected" | "key_invalid" | "ai_consent_required" | null
  chats: CoverLetterChatSummary[]
  chat: CoverLetterChatView | null
  messages: CoverLetterPanelMessage[]
  greeting: string
  offer: string
  chips: string[]
  /** 스트리밍 중인 AI 답 (reply_delta) */
  reply: string
  phase: "idle" | "replying" | "drafting" | "adjusting"
  /** 첫 블록 전 15초가 지났다 → "긴 글이라 조금 더 걸려요" */
  slow: boolean
  failure: AiErrorInfo | null
  /** 초안 턴이 실패했다 (지금 본문·이전 제안 유지, 횟수 줄지 않음) */
  draftFailed: boolean
  draftCount: number
  draftRemaining: number
  draftLimitReached: boolean
  messageLimitReached: boolean
  /** 문항별 근거 카드 (`sources_selected` — 표시용. 저장 근거는 서버가 만든다, CF-S1) */
  sources: Record<string, CoverLetterSourceCard[]>
  provisional: ProvisionalBlocks | null
  send: (content: string, opts?: { draftTurn?: boolean; requestedSlot?: string; style?: "fit_length" | "shorter" }) => void
  stop: () => void
  retry: () => void
  newChat: () => void
  openChat: (chat: CoverLetterChatSummary) => void
  deleteChat: (chatId: string) => void
}

export interface CoverLetterPanelOptions {
  applicationProjectId: string
  initialChats: CoverLetterChatSummary[]
  initialChat: CoverLetterChatView | null
  /** 턴마다 보내는 지금 폼 (저장 전 값이 우선, CL-4). 저장·로그에 남지 않는다 */
  formSnapshot: Array<{ slot: string; question_text: string; char_limit: number; count_basis: string; user_note: string | null; answer_title: string | null; body: string }>
  /** `?state=` 미리 보기 */
  preview: { state: string | null; autoplay: "draft" | null; turnError: AiErrorCode | null }
  /** 요건이 아직 없다 → 시작 인사 ④ ("공고 요건 정리 중") */
  requirementsPending: boolean
  onChatChange: (chatId: string | null) => void
}

const PANEL_OPEN_KEY = "resumate:l02:cover_letter:panel"
const SLOW_AFTER_MS = 15_000

export function useCoverLetterPanel(opts: CoverLetterPanelOptions): CoverLetterPanelController {
  const connection = useAiConnection()
  const consent = useAiConsentGate()
  const [open, setOpen] = React.useState(true)
  const [chats, setChats] = React.useState(opts.initialChats)
  const [chat, setChat] = React.useState(opts.initialChat)
  const [messages, setMessages] = React.useState<CoverLetterPanelMessage[]>(
    () => opts.initialChat?.messages.map((m) => ({ id: m.id, role: m.role, content: m.content, status: m.status })) ?? [],
  )
  const [reply, setReply] = React.useState("")
  const [phase, setPhase] = React.useState<CoverLetterPanelController["phase"]>("idle")
  const [slow, setSlow] = React.useState(false)
  const [failure, setFailure] = React.useState<AiErrorInfo | null>(null)
  const [draftFailed, setDraftFailed] = React.useState(opts.preview.state === "draft-failed")
  const [sources, setSources] = React.useState<Record<string, CoverLetterSourceCard[]>>({})
  const [provisional, setProvisional] = React.useState<ProvisionalBlocks | null>(null)
  const [draftCount, setDraftCount] = React.useState(
    // `?state=draft-limit`: 6회를 다 쓴 대화
    opts.preview.state === "draft-limit" ? COVER_LETTER_DRAFT_LIMIT : (opts.initialChat?.draft_count ?? 0),
  )
  const abort = React.useRef<AbortController | null>(null)
  const inputEl = React.useRef<HTMLTextAreaElement | null>(null)
  const lastSend = React.useRef<{ content: string; draftTurn: boolean; requestedSlot?: string; style?: "fit_length" | "shorter" } | null>(null)

  React.useEffect(() => () => abort.current?.abort(), [])
  React.useEffect(() => {
    try {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- hydration 뒤 한 번만 되살린다
      if (window.localStorage.getItem(PANEL_OPEN_KEY) === "0") setOpen(false)
    } catch {
      /* storage unavailable */
    }
  }, [])

  const show = React.useCallback(() => {
    setOpen(true)
    try {
      window.localStorage.setItem(PANEL_OPEN_KEY, "1")
    } catch {
      /* storage unavailable */
    }
  }, [])
  const hide = React.useCallback(() => {
    setOpen(false)
    try {
      window.localStorage.setItem(PANEL_OPEN_KEY, "0")
    } catch {
      /* storage unavailable */
    }
  }, [])
  const bindInput = React.useCallback<React.RefCallback<HTMLTextAreaElement>>((el) => {
    inputEl.current = el
  }, [])
  const focusInput = React.useCallback(() => window.setTimeout(() => inputEl.current?.focus(), 60), [])

  const lockReason: CoverLetterPanelController["lockReason"] =
    connection === null
      ? null
      : !connection.active_provider
        ? "ai_not_connected"
        : connection.key_status === "invalid"
          ? "key_invalid"
          : connection.consent_required
            ? "ai_consent_required"
            : null
  const locked = lockReason === "ai_not_connected" || lockReason === "key_invalid"

  const previewState = opts.preview.state
  const draftRemaining = Math.max(0, COVER_LETTER_DRAFT_LIMIT - draftCount)
  const draftLimitReached = draftRemaining === 0
  const messageCount = messages.filter((m) => m.role === "user" || m.role === "assistant").length
  const messageLimitReached = messageCount >= COVER_LETTER_MESSAGE_LIMIT - 1

  const answered = opts.formSnapshot.filter((q) => q.body.trim()).length
  const greeting = coverLetterGreeting({ answered, total: opts.formSnapshot.length, requirementsPending: opts.requirementsPending })
  const offer = firstTurnOffer(opts.formSnapshot.length)
  const chips = coverLetterChips({ total: opts.formSnapshot.length, firstDraftDone: draftCount > 0 })

  const applyEvent = React.useCallback((ev: CoverLetterTurnEvent) => {
    switch (ev.type) {
      case "reply_delta":
        setReply((r) => r + ev.text)
        break
      case "reply_done":
        setReply(ev.text)
        break
      case "draft_patch":
        setChat((c) => (c ? { ...c, structured_draft: ev.structuredDraft } : c))
        break
      case "sources_selected":
        // 표시용 카드다 — 저장되는 `{slot}.sources.{n}` 행은 저장 RPC가 제안에서 만든다 (CF-S1)
        setSources((s) => ({ ...s, [ev.slot]: ev.sources }))
        break
      case "draft_started":
        setPhase("drafting")
        setProvisional(null)
        break
      case "draft_block":
        setSlow(false)
        setProvisional((p) => (p && p.slot === ev.slot ? { ...p, blocks: [...p.blocks, ev.block] } : { slot: ev.slot, questionNo: ev.questionNo, blocks: [ev.block] }))
        break
      case "adjusting_length":
        setPhase("adjusting")
        break
      case "draft_done":
        // 확정 — 임시 블록을 버린다 (통째로 교체)
        setProvisional(null)
        setDraftCount(ev.draftCount)
        setChat((c) => {
          if (!c) return c
          const entry = {
            slot: ev.slot,
            question_id: `qid-${ev.slot}`,
            draft: {
              answer_title: ev.answerTitle,
              value: "",
              blocks: [],
              char_count: ev.charCount,
              char_limit_at_generation: ev.charLimit,
              char_adjust_needed: ev.charAdjustNeeded,
              correction_applied: ev.correctionApplied,
              rev: ev.rev,
              base_body_hash: null,
              replace_allowed: true,
              missing_slots: [],
              dropped_block_count: ev.droppedBlockCount,
              applied_at: null,
              applied_rev: null,
            },
          }
          const existing = c.structured_draft.document.questions.find((q) => q.slot === ev.slot)
          const merged = existing ? { ...existing, draft: { ...existing.draft, ...entry.draft, blocks: existing.draft.blocks, value: existing.draft.value } } : entry
          return {
            ...c,
            draft_count: ev.draftCount,
            structured_draft: {
              ...c.structured_draft,
              draft_count: ev.draftCount,
              document: { questions: [...c.structured_draft.document.questions.filter((q) => q.slot !== ev.slot), merged] },
            },
          }
        })
        break
      case "turn_done":
        setPhase("idle")
        setDraftCount(ev.draftCount)
        setMessages((list) => [...list, { id: `a-${Date.now()}`, role: "assistant", content: "", status: "ok" }])
        break
      case "error":
        setPhase("idle")
        setProvisional(null)
        setFailure({ code: ev.errorCode, provider: ev.provider, retryAfter: ev.retryAfter, quotaResetsAt: ev.quotaResetsAt })
        break
      default:
        break
    }
  }, [])

  const runTurn = React.useCallback(
    async (
      target: CoverLetterChatView,
      content: string,
      options: { draftTurn: boolean; requestedSlot?: string; style?: "fit_length" | "shorter" },
    ) => {
      abort.current?.abort()
      const ac = new AbortController()
      abort.current = ac
      setFailure(null)
      setDraftFailed(false)
      setReply("")
      setSlow(false)
      setPhase(options.draftTurn ? "drafting" : "replying")
      const slowTimer = window.setTimeout(() => setSlow(true), SLOW_AFTER_MS)
      let sawError = false
      try {
        const events = previewState
          ? mockCoverLetterTurn({
              questions: opts.formSnapshot.map((q) => ({ slot: q.slot, question_text: q.question_text, char_limit: q.char_limit, body: q.body })),
              draftTurn: options.draftTurn,
              draftCount,
              draft: target.structured_draft,
              fail: opts.preview.turnError,
              signal: ac.signal,
            })
          : realCoverLetterTurn(
              {
                endpoint: `/api/writing-chats/${target.id}/turns`,
                body: {
                  content,
                  requestedSlot: options.requestedSlot ? { slot: options.requestedSlot } : null,
                  requestedAction: null,
                  style: options.style ?? null,
                  formSnapshot: { questions: opts.formSnapshot },
                },
              },
              ac.signal,
            )
        for await (const ev of events) {
          if (ev.type === "error") sawError = true
          applyEvent(ev)
        }
      } catch (e) {
        if (!(e instanceof DOMException && e.name === "AbortError")) {
          sawError = true
          setFailure({ code: "schema_invalid", provider: null, retryAfter: null, quotaResetsAt: null })
          setPhase("idle")
        }
      } finally {
        window.clearTimeout(slowTimer)
        if (sawError && options.draftTurn) setDraftFailed(true)
      }
    },
    [applyEvent, draftCount, opts.formSnapshot, opts.preview.turnError, previewState],
  )

  const ensureChat = React.useCallback(async (): Promise<CoverLetterChatView | null> => {
    if (chat) return chat
    const started = await startCoverLetterChatAction(opts.applicationProjectId, { questions: opts.formSnapshot.map((q) => ({ slot: q.slot, question_text: q.question_text, char_limit: q.char_limit, count_basis: q.count_basis, user_note: q.user_note, answer_title: q.answer_title, body: q.body })) }).catch(() => null)
    if (!started) {
      setFailure({ code: "schema_invalid", provider: null, retryAfter: null, quotaResetsAt: null })
      return null
    }
    setChat(started)
    setChats((list) => [{ id: started.id, title: null, status: "active", message_count: 0, last_activity_at: started.last_activity_at }, ...list])
    opts.onChatChange(started.id)
    return started
  }, [chat, opts])

  const send = React.useCallback(
    (content: string, sendOpts: { draftTurn?: boolean; requestedSlot?: string; style?: "fit_length" | "shorter" } = {}) => {
      const draftTurn = Boolean(sendOpts.draftTurn)
      if (locked) return
      if (draftTurn && draftLimitReached) return
      if (messageLimitReached) return
      lastSend.current = { content, draftTurn, requestedSlot: sendOpts.requestedSlot, style: sendOpts.style }
      const run = async () => {
        const target = await ensureChat()
        if (!target) return
        setMessages((list) => [...list, { id: `u-${Date.now()}`, role: "user", content, status: "ok" }])
        await runTurn(target, content, { draftTurn, requestedSlot: sendOpts.requestedSlot, style: sendOpts.style })
      }
      // 동의 필요면 C-21을 먼저 띄우고, 동의 뒤 이 턴을 이어 보낸다
      if (lockReason === "ai_consent_required") return consent.open(() => void run())
      consent.guard(() => void run())
    },
    [consent, draftLimitReached, ensureChat, lockReason, locked, messageLimitReached, runTurn],
  )

  const stop = React.useCallback(() => {
    abort.current?.abort()
    setPhase("idle")
    setProvisional(null)
  }, [])

  const retry = React.useCallback(() => {
    const last = lastSend.current
    if (last) send(last.content, { draftTurn: last.draftTurn, requestedSlot: last.requestedSlot, style: last.style })
  }, [send])

  const newChat = React.useCallback(() => {
    abort.current?.abort()
    setChat(null)
    setMessages([])
    setReply("")
    setSources({})
    setProvisional(null)
    setFailure(null)
    setDraftFailed(false)
    setDraftCount(0)
    setPhase("idle")
    opts.onChatChange(null)
  }, [opts])

  const openChat = React.useCallback(
    (summary: CoverLetterChatSummary) => {
      const found = chats.find((c) => c.id === summary.id)
      if (!found) return
      // 연결 대기: 서류 대화를 읽는 계약이 없어 이번 방문에 시작한 대화만 다시 열 수 있다
      if (chat?.id === summary.id) return
      toast("다른 대화를 여는 기능은 아직 연결되지 않았어요")
    },
    [chat?.id, chats],
  )

  const deleteChat = React.useCallback(
    (chatId: string) => {
      void deleteCoverLetterChatAction(chatId).catch(() => null)
      setChats((list) => list.filter((c) => c.id !== chatId))
      if (chat?.id === chatId) newChat()
    },
    [chat?.id, newChat],
  )

  // `?state=draft-stream` / `draft-failed`: 마운트 직후 초안 턴을 한 번 재생한다
  const autoplayed = React.useRef(false)
  React.useEffect(() => {
    if (autoplayed.current || opts.preview.autoplay !== "draft" || locked) return
    autoplayed.current = true
    const t = window.setTimeout(() => send("지금까지 내용으로 초안 만들기", { draftTurn: true }), 500)
    return () => window.clearTimeout(t)
  }, [opts.preview.autoplay, locked, send])

  return {
    open,
    show,
    hide,
    focusInput,
    bindInput,
    locked,
    lockReason,
    chats,
    chat,
    messages,
    greeting,
    offer,
    chips,
    reply,
    phase,
    slow,
    failure,
    draftFailed,
    draftCount,
    draftRemaining,
    draftLimitReached,
    messageLimitReached,
    sources,
    provisional,
    send,
    stop,
    retry,
    newChat,
    openChat,
    deleteChat,
  }
}

export type { CoverLetterStructuredDraft }
