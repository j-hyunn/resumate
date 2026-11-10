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
import { shouldAdoptReread } from "./panel-rules"
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
import { deleteCoverLetterChatAction, getCoverLetterChatAction, startCoverLetterChatAction } from "@/app/(dashboard)/(gated)/applications/_lib/actions"

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
  /** 방금 초안 턴이 끝났고 아직 제안이 없는 문항이 남았다 → "다음 문항도 이어서 써 볼까요?" (UQ-748) */
  offerNext: boolean
  /** "AI 제안 있음" → 그 문항의 [자세히] 자리로 (UQ-749) — 카드가 읽어 펼치고 스크롤한다 */
  /** 같은 문항을 다시 눌러도 다시 펼치도록 요청마다 `seq`가 는다 */
  focusRequest: { slot: string; seq: number } | null
  revealSlot: (slot: string) => void
  draftCount: number
  draftRemaining: number
  draftLimitReached: boolean
  messageLimitReached: boolean
  /** 문항별 근거 카드 (`sources_selected` — 표시용. 저장 근거는 서버가 만든다, CF-S1) */
  sources: Record<string, CoverLetterSourceCard[]>
  provisional: ProvisionalBlocks | null
  send: (content: string, opts?: { draftTurn?: boolean; requestedSlot?: string; style?: "fit_length" | "shorter"; onSent?: () => void }) => void
  /** CF-S8 — 턴 전 자동 저장 중 */
  preparing: boolean
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
  /**
   * CF-S8: 턴을 보내기 **직전**에 부른다. 저장하지 않은 문항 구성 변경이 있으면 화면이 저장하고, 성공하면
   * `true`, 실패하면 `false`(턴을 보내지 않는다). 바뀐 것이 없으면 바로 `true`.
   */
  beforeTurn?: () => Promise<boolean>
}

const PANEL_OPEN_KEY = "resumate:l02:cover_letter:panel"
const SLOW_AFTER_MS = 15_000

export function useCoverLetterPanel(opts: CoverLetterPanelOptions): CoverLetterPanelController {
  const connection = useAiConnection()
  const consent = useAiConsentGate()
  const [open, setOpen] = React.useState(true)
  const [chats, setChats] = React.useState(opts.initialChats)
  const [chat, setChat] = React.useState(opts.initialChat)
  /** CF-S8 — 턴 전 자동 저장 중 (보내기·칩을 막는다) */
  const [preparing, setPreparing] = React.useState(false)
  const preparingRef = React.useRef(false)
  /**
   * 마지막으로 **열기를 요청한** 대화 id (UQ-760). R15 후속 3에서 턴 뒤 다시 읽기는 걷었고, 다시 읽기가 남은
   * 길은 "기록에서 열기"다. 그 응답이 늦게 오면 그 사이 다른 대화를 또 열었거나 "+ 새 대화"로 비웠을 수
   * 있으므로, 반영하기 전에 이 값과 대조한다(`shouldAdoptReread`). 빠르게 두 번 열면 마지막 것만 반영된다.
   */
  const openRequestRef = React.useRef<string | null>(null)
  const [messages, setMessages] = React.useState<CoverLetterPanelMessage[]>(
    () => opts.initialChat?.messages.map((m) => ({ id: m.id, role: m.role, content: m.content, status: m.status })) ?? [],
  )
  const [reply, setReply] = React.useState("")
  const [phase, setPhase] = React.useState<CoverLetterPanelController["phase"]>("idle")
  const [slow, setSlow] = React.useState(false)
  const [failure, setFailure] = React.useState<AiErrorInfo | null>(null)
  const [draftFailed, setDraftFailed] = React.useState(opts.preview.state === "draft-failed")
  const [lastDraftOk, setLastDraftOk] = React.useState(false)
  const [focusRequest, setFocusRequest] = React.useState<{ slot: string; seq: number } | null>(null)
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

  /**
   * 문항별 임시 블록 — `draft_block`을 **시도(attempt)별로** 모아 **스트리밍 보기에만** 쓴다. attempt 2(스키마
   * 재시도)는 attempt 1의 블록을 버린다. `draft_block`은 글자 수 보정 **전** 문장이라 제안으로 올리지 않는다 —
   * 제안은 `draft_done.draft`(저장본)다 (R15 후속 3).
   */
  const pendingBlocks = React.useRef<Record<string, { attempt: number; blocks: CoverLetterProposalBlock[] }>>({})
  const replyRef = React.useRef("")

  const applyEvent = React.useCallback((ev: CoverLetterTurnEvent) => {
    switch (ev.type) {
      case "reply_delta":
        replyRef.current += ev.text
        setReply(replyRef.current)
        break
      case "reply_done":
        replyRef.current = ev.text
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
        // 새 시도가 시작된 문항은 앞 시도의 블록을 버린다
        for (const slot of ev.slots) pendingBlocks.current[slot] = { attempt: ev.attempt, blocks: [] }
        break
      case "draft_block": {
        setSlow(false)
        const prev = pendingBlocks.current[ev.slot]
        const blocks = prev && prev.attempt === ev.attempt ? [...prev.blocks, ev.block] : [ev.block]
        pendingBlocks.current[ev.slot] = { attempt: ev.attempt, blocks }
        setProvisional({ slot: ev.slot, questionNo: ev.questionNo, blocks })
        break
      }
      case "adjusting_length":
        setPhase("adjusting")
        break
      case "draft_done": {
        // 확정 — 임시 보기를 지우고 **서버가 저장한 제안**(`draft_done.draft`)을 그 문항의 제안으로 둔다(통째로 교체).
        // 보정 뒤 `blocks`·`value`, 서버의 `base_body_hash`, `answer_title`, `sources`(CF-S1), `rev`가 모두 저장본과 같다
        setProvisional(null)
        setDraftCount(ev.draftCount)
        delete pendingBlocks.current[ev.slot]
        setChat((c) => {
          if (!c) return c
          const existing = c.structured_draft.document.questions.find((q) => q.slot === ev.slot)
          const entry = { slot: ev.slot, question_id: existing?.question_id ?? `qid-${ev.slot}`, draft: ev.draft }
          return {
            ...c,
            draft_count: ev.draftCount,
            structured_draft: {
              ...c.structured_draft,
              draft_count: ev.draftCount,
              document: { ...c.structured_draft.document, questions: [...c.structured_draft.document.questions.filter((q) => q.slot !== ev.slot), entry] },
            },
          }
        })
        break
      }
      case "turn_done": {
        setPhase("idle")
        setDraftCount(ev.draftCount)
        // 이 턴의 AI 답을 대화에 남기고 스트리밍 줄은 비운다
        const text = replyRef.current
        replyRef.current = ""
        setReply("")
        if (text) setMessages((list) => [...list, { id: `a-${Date.now()}`, role: "assistant", content: text, status: "ok" }])
        break
      }
      case "error":
        setPhase("idle")
        setProvisional(null)
        pendingBlocks.current = {}
        setFailure({ code: ev.errorCode, provider: ev.provider, retryAfter: ev.retryAfter, quotaResetsAt: ev.quotaResetsAt })
        break
      default:
        break
    }
  }, [])

  /** 저장된 대화(DTO)로 패널을 다시 맞춘다 — 제안·메시지·상한의 정본은 DTO다 (R15 후속) */
  const adoptChat = React.useCallback((view: CoverLetterChatView) => {
    setChat(view)
    setMessages(view.messages.map((m) => ({ id: m.id, role: m.role, content: m.content, status: m.status })))
    setDraftCount(view.draft_count)
    setChats((list) =>
      list.map((c) => (c.id === view.id ? { ...c, title: view.title, status: view.status, message_count: view.message_count, last_activity_at: view.last_activity_at } : c)),
    )
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
      setLastDraftOk(false)
      setReply("")
      setSlow(false)
      setPhase(options.draftTurn ? "drafting" : "replying")
      replyRef.current = ""
      pendingBlocks.current = {}
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
        setLastDraftOk(options.draftTurn && !sawError)
      }
      // (R15 후속 3) 턴 뒤 저장 대화를 다시 읽던 보정용 우회는 걷었다 — `draft_done.draft`가 저장본이다
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
    (
      content: string,
      sendOpts: {
        draftTurn?: boolean
        requestedSlot?: string
        style?: "fit_length" | "shorter"
        /** 턴이 실제로 나갈 때(저장이 성공한 뒤) 불린다 — 입력창은 이때만 비운다 (CF-S8) */
        onSent?: () => void
      } = {},
    ) => {
      const draftTurn = Boolean(sendOpts.draftTurn)
      if (locked) return
      if (draftTurn && draftLimitReached) return
      if (messageLimitReached) return
      // 저장 중·턴 중에는 보내지 않는다 — 이중 전송 막기 (CF-S8)
      if (preparingRef.current || phase !== "idle") return
      lastSend.current = { content, draftTurn, requestedSlot: sendOpts.requestedSlot, style: sendOpts.style }
      const run = async () => {
        // CF-S8 (확정 2026-11-10, 사용자): 저장하지 않은 문항 구성 변경이 있으면 **먼저 저장**하고, 성공한 뒤에만
        // 턴을 보낸다. 실패하면 턴을 보내지 않는다(입력창은 `onSent`가 불리지 않아 그대로 남는다).
        // 저장은 화면의 "저장하기"와 같은 경로(`runSave`)다 — 오류도 같은 자리·문구·다이얼로그로 보인다
        if (opts.beforeTurn) {
          preparingRef.current = true
          setPreparing(true)
          const ok = await opts.beforeTurn().catch(() => false)
          preparingRef.current = false
          setPreparing(false)
          if (!ok) return
        }
        const target = await ensureChat()
        if (!target) return
        sendOpts.onSent?.()
        setMessages((list) => [...list, { id: `u-${Date.now()}`, role: "user", content, status: "ok" }])
        await runTurn(target, content, { draftTurn, requestedSlot: sendOpts.requestedSlot, style: sendOpts.style })
      }
      // 동의 필요면 C-21을 먼저 띄우고, 동의 뒤 이 턴을 이어 보낸다
      if (lockReason === "ai_consent_required") return consent.open(() => void run())
      consent.guard(() => void run())
    },
    [consent, draftLimitReached, ensureChat, lockReason, locked, messageLimitReached, opts, phase, runTurn],
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
    // 늦게 오는 "기록에서 열기" 응답이 비운 패널을 다시 채우지 않게
    openRequestRef.current = null
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
      if (chat?.id === summary.id) return
      abort.current?.abort()
      openRequestRef.current = summary.id
      void (async () => {
        const r = await getCoverLetterChatAction(summary.id, opts.applicationProjectId).catch(() => null)
        // 그 사이 다른 대화를 또 열었거나 비웠으면 이 응답은 버린다 (UQ-760)
        if (openRequestRef.current !== summary.id) return
        if (!r || "error" in r) {
          toast("대화를 열지 못했어요. 다시 시도해 주세요")
          return
        }
        setReply("")
        setSources({})
        setProvisional(null)
        setFailure(null)
        setDraftFailed(false)
        setLastDraftOk(false)
        setPhase("idle")
        if (!shouldAdoptReread(openRequestRef.current, summary.id, r.data.id)) return
        adoptChat(r.data)
        opts.onChatChange(r.data.id)
      })()
    },
    [adoptChat, chat?.id, opts],
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
    offerNext:
      lastDraftOk &&
      phase === "idle" &&
      opts.formSnapshot.some((q) => !(chat?.structured_draft.document.questions ?? []).some((p) => p.slot === q.slot)),
    focusRequest,
    revealSlot: (slot: string) => {
      setOpen(true)
      setFocusRequest((r) => ({ slot, seq: (r?.seq ?? 0) + 1 }))
    },
    draftCount,
    draftRemaining,
    draftLimitReached,
    messageLimitReached,
    sources,
    provisional,
    send,
    preparing,
    stop,
    retry,
    newChat,
    openChat,
    deleteChat,
  }
}

export type { CoverLetterStructuredDraft }

