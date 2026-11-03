"use client"

/**
 * Resumate AI 패널 controller (S-10 · S-44 shared core, UX v5.6 S-10 / S-44 패널, AI-12 / AI-13, DM v4.5 §7).
 *
 *   const panel = useAiPanel({ target: "project", targetId, initialChats, initialChat, formSnapshot, preview,
 *                              requireName, savePage, onChatChange })
 *   <PageShell aiReopen={panel.reopen} …>  <DocBody panel={panel.placement} left={…} aside={<AiPanel panel={panel} renderProposal={…} />} />
 *
 * Owns: open / width / mode, the chat list, the open chat (messages + structured_draft), the input text,
 * the turn stream, the before-send blocks and the first-message order on a new page:
 *   ① name check (requireName) → ② AI availability (fresh ai_connection) → ③ page save (savePage — creates the row)
 *   → ④ start chat (start_writing_chat / start_deliverable_writing_chat) → ⑤ turn (with form_snapshot)
 * The proposal cards are not here: the page renders them in the panel's slot with `AiPanelProposalContext`.
 */
import * as React from "react"
import { toast } from "sonner"
import type { AiConnection, AiErrorCode, DeliverableDraftBlock, DeliverableStructuredDraft, ReturnTarget } from "@/types/db"
import { applyConnectionPreview, useAiConnection, useAiConnectionLoaded, useAiConnectionRefresh } from "@/components/common/ai-connection-context"
import { useAiConsentGate } from "@/components/common/consent-gate"
import { usePreviewState } from "@/components/common/preview-state-client"
import {
  applyStructuredDraftPatchAction,
  checkAiConnectionAction,
  deleteWritingChatAction,
  getWritingChatAction,
  prepareWritingChatTurnAction,
  recordMockTurnAction,
  startDeliverableWritingChatAction,
  startWritingChatAction,
} from "@/lib/data/career-v45-actions"
import {
  PAGE_LIMITS,
  PANEL_COPY,
  deliverableGreeting,
  guessWritingKind,
  isProjectSnapshot,
  projectGreeting,
  type DeliverableFormSnapshot,
  type FormSnapshot,
  type PagePreviewHints,
  type PanelCallError,
  type ProjectFormSnapshot,
  type StructuredDraftUserPatch,
  type TurnRequest,
  type WritingChatMessageView,
  type WritingChatSummary,
  type WritingChatView,
} from "@/lib/data/career-v45-shared"
import { quickChips, quickChipsVisible, type QuickChip } from "@/lib/data/quick-chips"
import { DELIVERABLE_SLOTS_BY_KIND, WRITING_KIND_LABELS } from "@/lib/data/labels"
import { streamTurn, type PanelTurnErrorCode, type PanelTurnEvent } from "@/lib/data/writing-chat-turn-v45"
import { PANEL_WIDTH } from "@/components/common/doc-inputs"
import type { DocPanelPlacement } from "@/components/common/shell/doc-body"
import type { AiReopenProps } from "@/components/common/shell/page-shell"

export type AiPanelTarget = "project" | "deliverable"

/** What blocks a send (the input keeps its text). Spec "보내기 전 막힘" / "전송이 막힐 때". */
export type PanelBlock =
  | { kind: "key_invalid" }
  | { kind: "invalid_form_snapshot" }
  | { kind: "writing_chat_closed" }
  | { kind: "draft_limit" }
  | { kind: "deliverable_limit" }
  | { kind: "first_save_failed" }
  | { kind: "start_failed"; code: AiErrorCode | null }
  | { kind: "backend_pending" }
  /** ② found no active provider (C-18 inline) */
  | { kind: "ai_not_connected" }
  /** ② couldn't read ai_connection — "연결 상태를 확인하지 못했어요 · 다시 시도" [UI-가정] */
  | { kind: "connection_check_failed" }

export type TurnPhase = "idle" | "starting" | "streaming" | "patching" | "drafting" | "failed"

export interface TurnFailure {
  code: PanelTurnErrorCode
  provider: AiConnection["active_provider"]
  retry_after: string | null
  quota_resets_at: string | null
  /** the user message the failed turn answers ("다시 보내기") */
  content: string
  requested_slot: string | null
  requested_action: "compose_draft" | null
  style: "shorter" | "more_detail_on_contribution" | null
  /**
   * AI-13 draft turn (`draft_started` arrived, or the request was compose_draft) — S-44 shows this failure on
   * the draft card only (`<AiPanel hideDraftTurnFailure>`, UQ-S44-4). Free-text "초안 써 줘" counts once
   * `draft_started` came; a failure before it can't be told apart and stays in the list.
   */
  draft_turn?: boolean
}

export interface SendOptions {
  requested_slot?: string | null
  requested_action?: "compose_draft" | null
  style?: "shorter" | "more_detail_on_contribution" | null
}

export interface AiPanelOptions {
  target: AiPanelTarget
  /** row id (`projects.id` / `project_deliverables.id`); null = new page (no row) */
  targetId: string | null
  initialChats: WritingChatSummary[]
  initialChat: WritingChatView | null
  /** the form's current values (unsaved included) — chips, greetings, turn `form_snapshot` */
  formSnapshot: FormSnapshot
  preview: PagePreviewHints | null
  /** S-10 C-09 gate entry: stored on the first new chat (`p_return_target`) */
  returnTarget?: { application_project_id: string; feature: ReturnTarget["feature"]; params?: Record<string, unknown> } | null
  /** gate entry greeting line ("{원래 기능}을 쓰려면 …") */
  gateFeatureLabel?: string | null
  /** S-44 new page: the parent already has 50 deliverables */
  deliverableLimitReached?: boolean
  /** ① false → the page focused its title and showed "대화를 시작하려면 … 먼저 입력해 주세요" */
  requireName: () => boolean
  /** ③ first save on a new page; resolve the new row id, or null (the page shows the field errors) */
  savePage: () => Promise<string | null>
  /** the open chat changed (URL `?chat=`, replace) */
  onChatChange?: (chatId: string | null) => void
  /** every turn event (after the panel applied it) — e.g. flash a field, refresh "AI 제안 있음" */
  onTurnEvent?: (event: PanelTurnEvent, chat: WritingChatView) => void
  /** the open chat's draft changed (turn, card patch, open another chat) */
  onDraftChange?: (draft: WritingChatView["structured_draft"] | null, chat: WritingChatView | null) => void
}

const OPEN_KEY = "resumate:ai-panel:open"
const WIDTH_KEY = "resumate:ai-panel:width"

function readStorage(key: string): string | null {
  try {
    return window.localStorage.getItem(key)
  } catch {
    return null
  }
}
function writeStorage(key: string, value: string): void {
  try {
    window.localStorage.setItem(key, value)
  } catch {
    // ignore
  }
}

function localGreeting(target: AiPanelTarget, snapshot: FormSnapshot, gate: string | null | undefined): string {
  if (target === "project" && isProjectSnapshot(snapshot)) return projectGreeting(snapshot, { gateFeatureLabel: gate })
  const s = snapshot as DeliverableFormSnapshot
  const kind = guessWritingKind(s.title)
  const first = kind ? DELIVERABLE_SLOTS_BY_KIND[kind][0].label : undefined
  return deliverableGreeting(s, kind, kind ? WRITING_KIND_LABELS[kind] : undefined, first ? `${first}부터 알려 주세요.` : undefined)
}

function summaryOf(c: WritingChatView): WritingChatSummary {
  return { id: c.id, title: c.title, status: c.status, message_count: c.message_count, last_activity_at: c.last_activity_at, last_applied_at: c.last_applied_at }
}

function blockOf(error: PanelCallError["code"] | PanelTurnErrorCode): PanelBlock | null {
  switch (error) {
    case "key_invalid":
      return { kind: "key_invalid" }
    case "invalid_form_snapshot":
      return { kind: "invalid_form_snapshot" }
    case "writing_chat_closed":
      return { kind: "writing_chat_closed" }
    case "writing_chat_draft_limit_reached":
      return { kind: "draft_limit" }
    case "backend_pending":
      return { kind: "backend_pending" }
    case "ai_not_connected":
    case "key_missing":
      return { kind: "ai_not_connected" }
    default:
      return null
  }
}

export interface AiPanelController {
  target: AiPanelTarget
  targetId: string | null
  // placement
  placement: DocPanelPlacement
  reopen: AiReopenProps
  show: () => void
  hide: () => void
  // data
  chats: WritingChatSummary[]
  chat: WritingChatView | null
  view: "chat" | "history"
  setView: (v: "chat" | "history") => void
  loadingChat: boolean
  greeting: string
  // connection
  connection: AiConnection | null
  /** no active provider (C-18) */
  locked: boolean
  consentDialog: React.ReactNode
  // input
  input: string
  setInput: (v: string) => void
  /** callback ref for the panel textarea */
  bindInput: React.RefCallback<HTMLTextAreaElement>
  focusInput: () => void
  // turn
  phase: TurnPhase
  /** reply being streamed */
  reply: string
  /** AI-13 provisional blocks between draft_started and draft_done */
  provisionalBlocks: DeliverableDraftBlock[]
  draftStarted: boolean
  failure: TurnFailure | null
  block: PanelBlock | null
  clearBlock: () => void
  /** "다시 시도" of connection_check_failed / first_save_failed / start_failed: resends the blocked message */
  retryBlocked: () => void
  /** messages whose turn left sensitive content out (민감정보 안내 under that AI message) */
  sensitiveMessageIds: ReadonlySet<string>
  /** chips for the current form + open chat; `chipsVisible` per the hide rule */
  chips: QuickChip[]
  chipsVisible: boolean
  responding: boolean
  closed: boolean
  messageCount: number
  // actions
  send: (content?: string, opts?: SendOptions) => void
  sendChip: (chip: QuickChip) => void
  retry: () => void
  stop: () => void
  newChat: () => Promise<void>
  openChat: (id: string) => Promise<void>
  deleteChat: (id: string) => Promise<void>
  /** card actions → apply_structured_draft_patch; false on refusal (toast shown) */
  /**
   * card actions → apply_structured_draft_patch; false on refusal. `inline: true` = the card draws the refusal
   * itself (design-system 3.24: `field_already_applied` → "이미 반영했어요. 왼쪽 칸에서 고쳐 주세요" under the
   * section) — no toast for that code; read `patchRefusal` (UQ-S10-13). Other failures still toast.
   */
  patchDraft: (patch: StructuredDraftUserPatch, opts?: { inline?: boolean }) => Promise<boolean>
  /** the last refused card patch (which slot / block / fact + code); cleared by the next successful patch */
  patchRefusal: { patch: StructuredDraftUserPatch; code: PanelCallError["code"] } | null
  /** replace the open chat's draft locally (e.g. after a page save marked fields applied) */
  setDraft: (draft: WritingChatView["structured_draft"]) => void
  /** after a page save: mark the chat list's last_applied_at */
  markApplied: (chatIds: string[]) => void
  /** flash + scroll to a message (C-15 "내 답변 #n") */
  flashMessage: (messageId: string, quotes?: string[]) => void
  flashedMessage: { id: string; quotes: string[] } | null
}

export function useAiPanel(opts: AiPanelOptions): AiPanelController {
  const previewState = usePreviewState()
  const connection = useAiConnection()
  const connectionLoaded = useAiConnectionLoaded()
  const consent = useAiConsentGate()
  const { guard: consentGuard, open: consentOpen, required: consentRequired } = consent
  const optsRef = React.useRef(opts)
  React.useEffect(() => {
    optsRef.current = opts
  })

  // ---------- placement ----------
  const [mode, setMode] = React.useState<"wide" | "narrow">("wide")
  const [wideOpen, setWideOpenState] = React.useState(true)
  const [sheetOpen, setSheetOpen] = React.useState(false)
  const [width, setWidthState] = React.useState<number>(PANEL_WIDTH.default)
  React.useEffect(() => {
    const open = readStorage(OPEN_KEY)
    const w = Number(readStorage(WIDTH_KEY))
    // eslint-disable-next-line react-hooks/set-state-in-effect -- restore remembered state after hydration
    if (open === "0") setWideOpenState(false)
    if (w >= PANEL_WIDTH.min && w <= PANEL_WIDTH.max) setWidthState(w)
  }, [])
  // callback refs (the controller is read during render; ref objects inside it would trip react-hooks/refs)
  const reopenEl = React.useRef<HTMLButtonElement | null>(null)
  const inputEl = React.useRef<HTMLTextAreaElement | null>(null)
  const bindReopen = React.useCallback((el: HTMLButtonElement | null) => {
    reopenEl.current = el
  }, [])
  const bindInput = React.useCallback((el: HTMLTextAreaElement | null) => {
    inputEl.current = el
  }, [])
  const focusInput = React.useCallback(() => window.setTimeout(() => inputEl.current?.focus(), 60), [])
  const setWideOpen = React.useCallback(
    (open: boolean) => {
      setWideOpenState(open)
      writeStorage(OPEN_KEY, open ? "1" : "0")
      // A-14: close → focus [Resumate AI]; reopen → the panel input
      if (open) focusInput()
      else window.setTimeout(() => reopenEl.current?.focus(), 60)
    },
    [focusInput],
  )
  const setWidth = React.useCallback((w: number) => {
    setWidthState(w)
    writeStorage(WIDTH_KEY, String(w))
  }, [])
  const show = React.useCallback(() => {
    if (mode === "wide") setWideOpen(true)
    else setSheetOpen(true)
    focusInput()
  }, [mode, setWideOpen, focusInput])
  const hide = React.useCallback(() => {
    if (mode === "wide") setWideOpen(false)
    else setSheetOpen(false)
  }, [mode, setWideOpen])

  // ---------- data ----------
  const [chats, setChats] = React.useState<WritingChatSummary[]>(opts.initialChats)
  const [chat, setChatState] = React.useState<WritingChatView | null>(opts.initialChat)
  const chatRef = React.useRef(chat)
  const setChat = React.useCallback((next: WritingChatView | null | ((c: WritingChatView | null) => WritingChatView | null)) => {
    setChatState((prev) => {
      const value = typeof next === "function" ? next(prev) : next
      chatRef.current = value
      return value
    })
  }, [])
  React.useEffect(() => {
    optsRef.current.onDraftChange?.(chat?.structured_draft ?? null, chat)
  }, [chat])
  const [view, setView] = React.useState<"chat" | "history">("chat")
  const [loadingChat, setLoadingChat] = React.useState(false)

  // ---------- turn ----------
  const [input, setInput] = React.useState("")
  const [phase, setPhase] = React.useState<TurnPhase>("idle")
  const [reply, setReply] = React.useState("")
  const [provisionalBlocks, setProvisional] = React.useState<DeliverableDraftBlock[]>([])
  const [draftStarted, setDraftStarted] = React.useState(false)
  const [failure, setFailure] = React.useState<TurnFailure | null>(null)
  const [block, setBlock] = React.useState<PanelBlock | null>(null)
  const [sensitive, setSensitive] = React.useState<Set<string>>(() => new Set())
  const [flashedMessage, setFlashed] = React.useState<{ id: string; quotes: string[] } | null>(null)
  const abort = React.useRef<AbortController | null>(null)
  const draftStartedRef = React.useRef(false)
  const runTurnRef = React.useRef<(chatView: WritingChatView, content: string, sendOpts: SendOptions, retry: boolean) => Promise<void>>(async () => {})
  React.useEffect(() => () => abort.current?.abort(), [])

  const effectiveConnection = connection
  // C-18 only once the connection is known (no lock flash before the provider loads)
  const locked = connectionLoaded && !effectiveConnection?.active_provider
  const responding = phase === "starting" || phase === "streaming" || phase === "patching" || phase === "drafting"
  const messageCount = chat?.message_count ?? 0
  const closed = chat ? chat.status === "closed" || chat.message_count >= PAGE_LIMITS.messageLimit : false

  const chips = React.useMemo(() => {
    const snap = opts.formSnapshot
    if (opts.target === "project" && isProjectSnapshot(snap)) return quickChips({ target: "project", star: snap.star })
    const d = chat?.structured_draft as DeliverableStructuredDraft | undefined
    return quickChips({
      target: "deliverable",
      body: (snap as DeliverableFormSnapshot).body,
      facts: d?.facts ?? [],
      has_draft: Boolean(d?.deliverable?.body),
      draft_count: d?.draft_count ?? 0,
      writing_kind: d?.writing_kind ?? guessWritingKind((snap as DeliverableFormSnapshot).title),
      missing_slots: d?.deliverable?.body?.missing_slots,
    })
  }, [opts.target, opts.formSnapshot, chat])
  const chipsVisible = quickChipsVisible({ message_count: messageCount, closed, locked })

  const greeting = React.useMemo(() => localGreeting(opts.target, opts.formSnapshot, opts.gateFeatureLabel), [opts.target, opts.formSnapshot, opts.gateFeatureLabel])

  const flashMessage = React.useCallback((id: string, quotes: string[] = []) => {
    setFlashed({ id, quotes })
    window.setTimeout(() => setFlashed((f) => (f?.id === id ? null : f)), 2000)
  }, [])

  const updateSummary = React.useCallback((c: WritingChatView) => {
    setChats((list) => {
      const next = list.filter((x) => x.id !== c.id)
      return [summaryOf(c), ...next]
    })
  }, [])

  // ---------- stream one turn ----------
  const runTurn = React.useCallback(
    async (chatView: WritingChatView, content: string, sendOpts: SendOptions, retry: boolean) => {
      const o = optsRef.current
      setFailure(null)
      setBlock(null)
      setReply("")
      setProvisional([])
      setDraftStarted(false)
      setPhase("streaming")
      const nextSequence = (chatView.messages[chatView.messages.length - 1]?.sequence ?? 0) + 1
      let request: TurnRequest
      try {
        request = await prepareWritingChatTurnAction({
          chat_id: chatView.id,
          target: o.target,
          body: {
            content,
            requested_slot: sendOpts.requested_slot ?? null,
            requested_action: sendOpts.requested_action ?? null,
            style: sendOpts.style ?? null,
            form_snapshot: o.formSnapshot,
          },
          retry,
          structured_draft: chatView.structured_draft,
          message_count: chatView.message_count,
          next_sequence: nextSequence,
          preview_state: previewState,
        })
      } catch {
        setPhase("failed")
        setFailure({ code: "provider_unavailable", provider: null, retry_after: null, quota_resets_at: null, content, requested_slot: sendOpts.requested_slot ?? null, requested_action: sendOpts.requested_action ?? null, style: sendOpts.style ?? null })
        return
      }
      const ac = new AbortController()
      abort.current?.abort()
      abort.current = ac
      let working: WritingChatView = chatView
      let replyText = ""
      const apply = (next: WritingChatView) => {
        working = next
        setChat(next)
      }
      try {
        for await (const ev of streamTurn(request, ac.signal)) {
          switch (ev.type) {
            case "turn_started": {
              // the message is accepted: clear the input (a refusal before this keeps it)
              setInput((v) => (v.trim() === content.trim() ? "" : v))
              const messages = retry ? working.messages : [...working.messages, ev.user_message]
              apply({ ...working, messages, message_count: ev.message_count, title: working.title ?? content.replace(/\s+/g, " ").slice(0, 30) })
              break
            }
            case "reply_delta":
              replyText += ev.text
              setReply(replyText)
              break
            case "reply_done":
              replyText = ""
              setReply("")
              apply({ ...working, messages: [...working.messages, ev.message] })
              if (!draftStartedRef.current) setPhase("patching")
              break
            case "draft_patch":
              apply({ ...working, structured_draft: ev.structured_draft })
              break
            case "facts_patch":
              apply({
                ...working,
                structured_draft: { ...(working.structured_draft as DeliverableStructuredDraft), facts: ev.facts, writing_kind: (ev.writing_kind as DeliverableStructuredDraft["writing_kind"]) ?? (working.structured_draft as DeliverableStructuredDraft).writing_kind },
              })
              break
            case "draft_flags":
              if (ev.sensitive_added > 0) {
                const last = [...working.messages].reverse().find((m) => m.role === "assistant")
                if (last) setSensitive((s) => new Set(s).add(last.id))
              }
              break
            case "draft_started":
              draftStartedRef.current = true
              setDraftStarted(true)
              setPhase("drafting")
              setProvisional([])
              break
            case "draft_block":
              setProvisional((b) => [...b, ev.block])
              break
            case "draft_done":
              draftStartedRef.current = false
              setDraftStarted(false)
              setProvisional([])
              apply({
                ...working,
                structured_draft: { ...(working.structured_draft as DeliverableStructuredDraft), deliverable: { body: ev.body }, draft_count: ev.draft_count },
              })
              setPhase("patching")
              break
            case "turn_done": {
              const d = working.structured_draft as DeliverableStructuredDraft
              const next: WritingChatView = {
                ...working,
                message_count: ev.message_count,
                status: ev.closed ? "closed" : working.status,
                last_activity_at: new Date().toISOString(),
                structured_draft: ev.draft_count != null && "target" in d ? { ...d, draft_count: ev.draft_count } : working.structured_draft,
              }
              apply(next)
              updateSummary(next)
              setPhase("idle")
              if (request.kind === "mock") {
                void recordMockTurnAction(next.id, { messages: next.messages, structured_draft: next.structured_draft, message_count: next.message_count, closed: next.status === "closed", title: next.title })
              }
              break
            }
            case "error": {
              const wasDraftTurn = draftStartedRef.current || sendOpts.requested_action === "compose_draft"
              draftStartedRef.current = false
              setDraftStarted(false)
              setProvisional([])
              setReply("")
              const b = ev.before_stream ? blockOf(ev.error_code) : null
              if (b) {
                setBlock(b)
                setPhase("idle")
                if (b.kind === "writing_chat_closed") apply({ ...working, status: "closed" })
              } else if (ev.before_stream && ev.error_code === "ai_consent_required") {
                // C-21, then the same message again
                setPhase("idle")
                consentOpen(() => void runTurnRef.current(chatView, content, sendOpts, retry))
              } else {
                setPhase("failed")
                setFailure({
                  code: ev.error_code,
                  provider: ev.provider,
                  retry_after: ev.retry_after,
                  quota_resets_at: ev.quota_resets_at,
                  content,
                  requested_slot: sendOpts.requested_slot ?? null,
                  requested_action: sendOpts.requested_action ?? null,
                  style: sendOpts.style ?? null,
                  draft_turn: wasDraftTurn,
                })
              }
              break
            }
          }
          o.onTurnEvent?.(ev, working)
        }
      } catch (e) {
        if ((e as Error).name === "AbortError") {
          setPhase("idle")
          setReply("")
          setProvisional([])
          setDraftStarted(false)
          draftStartedRef.current = false
          return
        }
        setPhase("failed")
        setFailure({ code: "provider_unavailable", provider: null, retry_after: null, quota_resets_at: null, content, requested_slot: sendOpts.requested_slot ?? null, requested_action: sendOpts.requested_action ?? null, style: sendOpts.style ?? null, draft_turn: draftStartedRef.current || sendOpts.requested_action === "compose_draft" })
      }
    },
    [previewState, setChat, updateSummary, consentOpen],
  )
  React.useEffect(() => {
    runTurnRef.current = runTurn
  }, [runTurn])

  // ---------- start a chat row ----------
  const startChat = React.useCallback(
    async (targetId: string): Promise<WritingChatView | PanelCallError> => {
      const o = optsRef.current
      const r =
        o.target === "project"
          ? await startWritingChatAction(targetId, o.returnTarget ?? null, isProjectSnapshot(o.formSnapshot) ? (o.formSnapshot as ProjectFormSnapshot) : null, previewState)
          : await startDeliverableWritingChatAction(targetId, o.formSnapshot as DeliverableFormSnapshot, previewState)
      if (!r.ok) return r.error
      setChat(r.chat)
      setChats((list) => [summaryOf(r.chat), ...list.filter((c) => c.id !== r.chat.id)])
      o.onChatChange?.(r.chat.id)
      return r.chat
    },
    [setChat, previewState],
  )

  // ---------- send (first-message order) ----------
  // (QA UQ-PA-6) ② reads ai_connection fresh; the context refreshes too so the panel's lock / badge follow
  const [, refreshConnection] = useAiConnectionRefresh()
  /** the message a ②/③/④ block stopped — "다시 시도" resends it, not the input box (QA UQ-PA-20) */
  const blockedSend = React.useRef<{ content: string; sendOpts: SendOptions } | null>(null)
  const sendInnerRef = React.useRef<(content: string, sendOpts: SendOptions, consented: boolean) => Promise<void>>(async () => {})

  const sendInner = React.useCallback(
    async (content: string, sendOpts: SendOptions, consented: boolean) => {
      const o = optsRef.current
      if (o.target === "deliverable" && !o.targetId && o.deliverableLimitReached) {
        setBlock({ kind: "deliverable_limit" })
        return
      }
      let targetId = o.targetId
      let current = chatRef.current
      if (!targetId || !current) {
        setPhase("starting")
        // ② AI availability before anything is created (no key / invalid / consent): stop with no row
        if (!targetId) {
          const raw = await checkAiConnectionAction().catch(() => undefined)
          if (raw === undefined) {
            setPhase("idle")
            blockedSend.current = { content, sendOpts }
            setBlock({ kind: "connection_check_failed" })
            return
          }
          refreshConnection()
          const fresh = applyConnectionPreview(raw, previewState)
          if (!fresh?.active_provider) {
            setPhase("idle")
            setBlock({ kind: "ai_not_connected" })
            return
          }
          if (fresh.key_status === "invalid") {
            setPhase("idle")
            setBlock({ kind: "key_invalid" })
            return
          }
          if (fresh.consent_required && !consented) {
            // C-21 first; agreeing continues from ② (still no row)
            setPhase("idle")
            consentOpen(() => void sendInnerRef.current(content, sendOpts, true))
            return
          }
          // ③ page save → row
          const saved = await o.savePage().catch(() => null)
          if (!saved) {
            setPhase("idle")
            blockedSend.current = { content, sendOpts }
            setBlock({ kind: "first_save_failed" })
            return
          }
          targetId = saved
          toast(PANEL_COPY.firstSaveToast[o.target])
        }
        // ④ start chat
        const started = await startChat(targetId)
        if ("code" in started) {
          setPhase("idle")
          const b = blockOf(started.code)
          if (!b) blockedSend.current = { content, sendOpts }
          setBlock(b ?? { kind: "start_failed", code: null })
          return
        }
        current = started
      }
      if (current.status === "closed" || current.message_count > PAGE_LIMITS.lastSendableCount) {
        setPhase("idle")
        setBlock({ kind: "writing_chat_closed" })
        return
      }
      // ⑤ turn
      await runTurn(current, content, sendOpts, false)
    },
    [previewState, runTurn, startChat, refreshConnection, consentOpen],
  )
  React.useEffect(() => {
    sendInnerRef.current = sendInner
  }, [sendInner])

  const send = React.useCallback(
    (contentArg?: string, sendOpts: SendOptions = {}) => {
      const content = (contentArg ?? input).trim()
      if (!content || responding) return
      if (content.length > PAGE_LIMITS.messageMaxChars) return
      // ① name check first (new page only — a saved row always has a name), before C-21 / key checks (UQ-PA-9)
      if (!optsRef.current.targetId && !optsRef.current.requireName()) return
      if (locked || !connectionLoaded) return
      if (connection?.key_status === "invalid") {
        setBlock({ kind: "key_invalid" })
        return
      }
      // C-21 before any AI run; the held send continues after agreeing
      const needed = consentRequired
      consentGuard(() => void sendInner(content, sendOpts, needed))
    },
    [input, responding, locked, connectionLoaded, connection, consentRequired, consentGuard, sendInner],
  )

  const retryBlocked = React.useCallback(() => {
    const blocked = blockedSend.current
    blockedSend.current = null
    setBlock(null)
    if (blocked) send(blocked.content, blocked.sendOpts)
    else send()
  }, [send])

  const newChat = React.useCallback(async () => {
    const o = optsRef.current
    setView("chat")
    setFailure(null)
    setBlock(null)
    // new page / no key: back to the start area only (no row; the lock shows inline)
    if (!o.targetId || locked) {
      setChat(null)
      o.onChatChange?.(null)
      focusInput()
      return
    }
    const r = await startChat(o.targetId)
    if ("code" in r) {
      const b = blockOf(r.code)
      if (b) setBlock(b)
      else toast("새 대화를 시작하지 못했어요")
      return
    }
    focusInput()
  }, [locked, startChat, setChat, focusInput])

  const sendChip = React.useCallback(
    (chip: QuickChip) => {
      if (chip.kind === "new_chat") return void newChat()
      send(chip.label, { requested_slot: chip.requested_slot, requested_action: chip.requested_action, style: chip.style })
    },
    [send, newChat],
  )

  const retry = React.useCallback(() => {
    const f = failure
    const current = chatRef.current
    if (!f || !current) return
    consentGuard(() => void runTurn(current, f.content, { requested_slot: f.requested_slot, requested_action: f.requested_action, style: f.style }, true))
  }, [failure, consentGuard, runTurn])

  const stop = React.useCallback(() => abort.current?.abort(), [])

  const openChat = React.useCallback(
    async (id: string) => {
      setView("chat")
      if (chatRef.current?.id === id) return
      setLoadingChat(true)
      setFailure(null)
      setBlock(null)
      const c = await getWritingChatAction(id).catch(() => null)
      setLoadingChat(false)
      if (!c) {
        toast("대화를 열지 못했어요")
        return
      }
      setChat(c)
      optsRef.current.onChatChange?.(c.id)
    },
    [setChat],
  )

  const deleteChat = React.useCallback(
    async (id: string) => {
      const r = await deleteWritingChatAction(id)
      if (!r.ok) throw new Error("delete failed")
      setChats((list) => list.filter((c) => c.id !== id))
      if (chatRef.current?.id === id) {
        setChat(null)
        optsRef.current.onChatChange?.(null)
      }
    },
    [setChat],
  )

  const [patchRefusal, setPatchRefusal] = React.useState<{ patch: StructuredDraftUserPatch; code: PanelCallError["code"] } | null>(null)
  const patchDraft = React.useCallback(
    async (patch: StructuredDraftUserPatch, patchOpts?: { inline?: boolean }) => {
      const current = chatRef.current
      if (!current) return false
      const r = await applyStructuredDraftPatchAction(current.id, patch)
      if (!r.ok) {
        setPatchRefusal({ patch, code: r.error.code })
        const inlineLine = patchOpts?.inline && r.error.code === "field_already_applied"
        if (!inlineLine) toast(r.error.code === "field_already_applied" ? PANEL_COPY.alreadyApplied : r.error.code === "backend_pending" ? PANEL_COPY.backendPending : "바꾸지 못했어요. 다시 시도해 주세요")
        return false
      }
      setPatchRefusal(null)
      setChat((c) => (c && c.id === current.id ? { ...c, structured_draft: r.structured_draft } : c))
      return true
    },
    [setChat],
  )

  const setDraft = React.useCallback((draft: WritingChatView["structured_draft"]) => setChat((c) => (c ? { ...c, structured_draft: draft } : c)), [setChat])
  const markApplied = React.useCallback((ids: string[]) => {
    const now = new Date().toISOString()
    setChats((list) => list.map((c) => (ids.includes(c.id) ? { ...c, last_applied_at: now } : c)))
  }, [])

  // ---------- preview autoplay (`ai-stream` / `draft-streaming`) ----------
  const autoplayed = React.useRef(false)
  React.useEffect(() => {
    const auto = opts.preview?.autoplay
    if (!auto || autoplayed.current || !chatRef.current || locked) return
    autoplayed.current = true
    const t = window.setTimeout(() => {
      if (auto === "draft") void runTurn(chatRef.current as WritingChatView, "지금까지 내용으로 초안 만들기", { requested_action: "compose_draft" }, false)
      else void runTurn(chatRef.current as WritingChatView, "결과는 p95 응답 시간이 1.2초에서 0.7초로 줄었어요", { requested_slot: "result" }, false)
    }, 600)
    return () => window.clearTimeout(t)
  }, [opts.preview?.autoplay, locked, runTurn])

  const placement: DocPanelPlacement = {
    mode,
    setMode,
    wideOpen,
    setWideOpen,
    sheetOpen,
    setSheetOpen,
    width,
    setWidth,
  }

  return {
    target: opts.target,
    targetId: opts.targetId,
    placement,
    reopen: { visible: mode === "wide" && !wideOpen, onClick: () => setWideOpen(true), bindButton: bindReopen },
    show,
    hide,
    chats,
    chat,
    view,
    setView,
    loadingChat,
    greeting,
    connection: effectiveConnection,
    locked,
    consentDialog: consent.dialog,
    input,
    setInput,
    bindInput,
    focusInput,
    phase,
    reply,
    provisionalBlocks,
    draftStarted,
    failure,
    block,
    clearBlock: () => setBlock(null),
    retryBlocked,
    sensitiveMessageIds: sensitive,
    chips,
    chipsVisible,
    responding,
    closed,
    messageCount,
    send,
    sendChip,
    retry,
    stop,
    newChat,
    openChat,
    deleteChat,
    patchDraft,
    patchRefusal,
    setDraft,
    markApplied,
    flashMessage,
    flashedMessage,
  }
}

export type { WritingChatMessageView }
