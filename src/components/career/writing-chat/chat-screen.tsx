"use client"

/**
 * S-36 AI 작성 대화 (진행 / 이어 하기 / 저장 완료 / 폼 전환 완료).
 * Layout design-system 5.4: ≥1280 two columns (대화 | 정리 결과), below → tabs.
 * AI turn = streaming (C-04, useChatTurnStream) backed by the mock planner; failures by
 * error_code show C-20 inline in the failed turn's place + "다시 보내기" (v4: no count / charge copy).
 */
import * as React from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { ArrowUp, Check, ChevronRight, Loader2, LogOut, MoreHorizontal, PauseCircle, Sparkles, Square, TriangleAlert } from "lucide-react"
import { cn } from "@/lib/utils"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card } from "@/components/ui/card"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu"
import { Textarea } from "@/components/ui/textarea"
import { AiErrorNotice } from "@/components/common/ai-error-notice"
import { isAiRejected } from "@/lib/data/ai-errors"
import { ProviderBadge, ProviderResultTag } from "@/components/common/provider-badge"
import { AiLock } from "@/components/common/ai-lock"
import { AiRunButton } from "@/components/common/ai-run-button"
import { notifyAiConnectionChanged, useAiConnection } from "@/components/common/ai-connection-context"
import { useAiConsentGate } from "@/components/common/consent-gate"
import { getAiConnectionStateAction } from "@/lib/data/actions"
import { AI_PROVIDER_LABELS } from "@/lib/mock/ai-providers"
import { AiProgressInline } from "@/components/common/ai-progress"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { InputGuide } from "@/components/common/input-guide"
import { StreamingCaret } from "@/components/common/streaming"
import { useChatTurnStream } from "@/components/common/streaming"
import { DeleteConfirmDialog } from "@/components/common/delete-confirm-dialog"
import { usePreviewState } from "@/components/common/preview-state-client"
import { markCareerReturn, readCareerReturn } from "@/components/common/return-target"
import { notifyCareerSaved, RETURN_FEATURE_LABELS, RETURN_FEATURE_READINESS, useGateContinuation } from "@/components/common/return-banner"
import type { AiErrorCode, WritingChatMessage } from "@/types/db"
import { directionParticle, WRITING_CHAT_MODE_LABELS, submitFailedMessage, actionFailedMessage } from "@/lib/data/labels"
import { previewErrorCode } from "@/lib/preview-state"
import { routes } from "@/lib/routes"
import type { WritingChatSaveSummary } from "@/lib/data/writing-chats"
import {
  applyDraftPatchAction,
  clearReturnTargetAction,
  completeWritingChatTurnAction,
  deleteCareerItemAction,
  getWritingChatSaveSummaryAction,
  handOffWritingChatAction,
  loadChatView,
  retryWritingChatTurnAction,
  saveWritingChatAction,
  sendWritingChatMessageAction,
  setWritingChatAffiliationAction,
} from "../actions"
import type { ChatView } from "@/lib/data/writing-chat-view"
import { countNeedsReview, DraftPreview, type DraftPatch } from "./draft-preview"
import { featureHref, GateBanner } from "./gate"
import { AbandonChatDialog, useResumeChat } from "./abandon"
import { chatLock, GateNextStep } from "../gate-next-step"
import { isSlotFilled, QUICK_REPLIES, requestSlotMessage, stepDefs, type ChatSlot } from "@/lib/data/writing-chat-slots"
import { canSendWritingChatMessage, WRITING_CHAT_MESSAGE_LIMIT } from "@/lib/data/writing-chat-limits"

const MESSAGE_LIMIT = WRITING_CHAT_MESSAGE_LIMIT

type TurnSpec = { reply: string; patchPaths: string[]; needsReview: string[]; actorAmbiguous: string[]; sensitive: number }

export function ChatScreen({
  initialView,
  applicationName,
}: {
  initialView: ChatView
  applicationName: string | null
}) {
  const router = useRouter()
  const preview = usePreviewState()
  // v5.3 A14 (UQ-408): `?state=ai-waiting` no longer waits before the first token — it is an alias of
  // `request-wait` (the turn fails at once with rate_limited + "{N}초 뒤 다시 보낼 수 있어요")
  const failCategory: AiErrorCode | null = previewErrorCode(preview === "ai-waiting" ? "request-wait" : preview)
  const [view, setView] = React.useState(initialView)
  const [input, setInputState] = React.useState("")
  // UQ-293: the drafted answer survives the C-18 → AI 연결 → 복귀 round trip (per chat, session only)
  const draftKey = `resumate.chat-draft.${initialView.chat.id}`
  const setInput = React.useCallback(
    (value: string) => {
      setInputState(value)
      try {
        if (value) window.sessionStorage.setItem(draftKey, value)
        else window.sessionStorage.removeItem(draftKey)
      } catch {
        // storage unavailable — draft only lives in this screen
      }
    },
    [draftKey],
  )
  React.useEffect(() => {
    try {
      const saved = window.sessionStorage.getItem(draftKey)
      // eslint-disable-next-line react-hooks/set-state-in-effect
      if (saved) setInputState(saved)
    } catch {
      // ignore
    }
  }, [draftKey])
  const [sending, setSending] = React.useState(false)
  const [patching, setPatching] = React.useState(false)
  const [flashPaths, setFlashPaths] = React.useState<string[]>([])
  const [highlight, setHighlight] = React.useState<{ messageId: string; quote?: string; source: "chip" | "message" } | null>(null)
  const [tab, setTab] = React.useState<"chat" | "preview">("chat")
  const [previewDot, setPreviewDot] = React.useState(false)
  const [dialog, setDialog] = React.useState<"save" | "handoff" | "delete" | "abandon" | null>(null)
  const [saveIntent, setSaveIntent] = React.useState<"save" | "return">("save")
  const [summary, setSummary] = React.useState<WritingChatSaveSummary | null>(null)
  const [saving, setSaving] = React.useState(false)
  const [saveError, setSaveError] = React.useState(false)
  const [handoffError, setHandoffError] = React.useState(false)
  // UQ-60/64: error_code of the last failed turn (canceled = 사용자가 중단)
  // UQ-296: null = cause unknown (e.g. a failed turn persisted before reload) → neutral copy
  const [failKind, setFailKind] = React.useState<AiErrorCode | null>(null)
  const turn = useChatTurnStream()
  const connection = useAiConnection()
  // v5.3 R-67: consent_required → C-21 (active provider × tier) before a turn is sent
  const consent = useAiConsentGate()
  const { resume, pendingId: resumingId } = useResumeChat()
  // C-18: no active key → existing chat stays readable/editable/savable; new messages need a key (D-36)
  const locked = connection !== null && !connection.active_provider
  const keyInvalid = connection?.key_status === "invalid"
  const freeTier = connection?.connection_tier === "free"
  // 전송이 막힐 때 (key_missing / key_invalid): the message is not stored, the text stays in the box,
  // C-20 above the textarea until the next send [UI-가정 G-37]
  const [blockedCode, setBlockedCode] = React.useState<AiErrorCode | null>(null)
  const [sendError, setSendError] = React.useState(false)
  const inputRef = React.useRef<HTMLTextAreaElement>(null)
  const lockRef = React.useRef<HTMLDivElement>(null)
  /** UQ-294: with no key, message-sending buttons lead to the C-18 path instead of doing nothing */
  const showLock = () => {
    setTab("chat")
    window.setTimeout(() => {
      lockRef.current?.scrollIntoView({ block: "center", behavior: "smooth" })
      lockRef.current?.querySelector<HTMLElement>("a,button")?.focus()
    }, 50)
  }
  const gate = useGateContinuation()
  const { recheck } = gate
  const listEnd = React.useRef<HTMLDivElement>(null)

  const { chat } = view
  const target = chat.return_target
  const active = chat.status === "active"
  const messageCount = preview === "message-limit" ? MESSAGE_LIMIT : chat.message_count
  // A5: a user message only while message_count ≤ 38 (the reply needs the 40th slot); 40 = 상한 도달
  const atLimit = !canSendWritingChatMessage(messageCount)
  const reachedLimit = messageCount >= MESSAGE_LIMIT
  const busy = sending || saving
  const review = countNeedsReview(view)

  // keep the browser-session return target in sync with writing_chats.return_target
  // (다른 기기에서 이어 해도 복귀 배너가 나오게, FL-13)
  React.useEffect(() => {
    // UQ-65: finished chats (saved / handed_off) never re-create the return target
    if (!target || !applicationName || chat.status !== "active") return
    const stored = readCareerReturn()
    if (!stored || stored.application_project_id !== target.application_project_id) {
      markCareerReturn({
        application_project_id: target.application_project_id,
        feature: target.feature,
        params: target.params,
        application_name: applicationName,
        href: featureHref(target.feature, target.application_project_id, target.params),
      })
      void recheck()
    }
  }, [target, applicationName, recheck, chat.status])

  React.useEffect(() => {
    listEnd.current?.scrollIntoView({ block: "end" })
  }, [chat.messages.length, turn.reply])

  const flash = (paths: string[]) => {
    if (!paths.length) return
    setFlashPaths(paths)
    if (tab === "chat") setPreviewDot(true)
    window.setTimeout(() => setFlashPaths([]), 1400)
  }

  /**
   * UQ-480: a request that ends in an error other than an AI refusal (chat no longer active — e.g.
   * abandoned in S-08 / another tab —, cap reached elsewhere, network) never leaves "sending" stuck:
   * re-read the chat (the abandoned bar / cap state then shows) and show a plain error line.
   */
  const recoverFromError = async () => {
    setSending(false)
    setPatching(false)
    setSendError(true)
    try {
      const next = await loadChatView(chat.id)
      if (next) setView(next)
    } catch {
      // keep the current view
    }
  }

  const finishTurn = async (
    failed: boolean,
    paths: string[],
    kind: AiErrorCode = "provider_unavailable",
    timing?: { retry_after?: string | null; quota_resets_at?: string | null },
  ) => {
    if (failed) setFailKind(kind)
    setPatching(!failed)
    try {
      const next = await completeWritingChatTurnAction(chat.id, failed, failed ? kind : null, timing)
      if (next) setView(next)
    } catch {
      return recoverFromError()
    }
    setPatching(false)
    setSending(false)
    if (!failed) flash(paths)
  }

  const runTurn = (spec: TurnSpec) => {
    // W2-⑧: a real turn only knows what it changed from its `draft_patch` event (spec.patchPaths is empty)
    let patched = spec.patchPaths
    turn.start({ ...spec, fail: failCategory ?? undefined }, (ev) => {
      if (ev.type === "draft_patch") patched = ev.paths
      if (ev.type === "turn_done") void finishTurn(false, patched)
      if (ev.type === "error")
        void finishTurn(true, [], ev.error_code, { retry_after: ev.retry_after, quota_resets_at: ev.quota_resets_at })
    })
  }

  /**
   * Server refused the turn (path ④, 04 §2.11.7): nothing stored, the text stays in the box.
   * key_missing → re-read the connection: consent cause → C-21 for the active provider × tier, and
   * agreeing sends the same text again; otherwise C-20 key_missing ("AI 연결하기"). key_invalid → C-20.
   */
  const onRefused = async (code: AiErrorCode, again: () => void) => {
    notifyAiConnectionChanged()
    if (code === "key_missing") {
      try {
        const { connection: fresh } = await getAiConnectionStateAction()
        if (fresh?.active_provider && fresh.key_status !== "invalid" && fresh.consent_required) {
          setBlockedCode(null)
          consent.open(again)
          return
        }
      } catch {
        // fall through to the C-20 key_missing row
      }
    }
    setBlockedCode(code)
  }

  const send = (text: string, requestedSlot?: ChatSlot) => {
    const content = text.trim()
    if (!content || busy || !active || atLimit) return
    // ST-AI-LOCKED / key_invalid: nothing is sent, the typed text stays in the box
    if (locked) return showLock()
    if (keyInvalid) {
      setBlockedCode("key_invalid")
      return
    }
    // R-67: consent_required → C-21 first; agreeing continues this very send
    consent.guard(() => void doSend(text, content, requestedSlot))
  }

  const doSend = async (text: string, content: string, requestedSlot?: ChatSlot) => {
    setBlockedCode(null)
    setSendError(false)
    setSending(true)
    const typed = text === input
    if (typed) setInput("")
    let res: Awaited<ReturnType<typeof sendWritingChatMessageAction>>
    try {
      res = await sendWritingChatMessageAction(chat.id, content, requestedSlot ?? null)
    } catch {
      // nothing was stored → the typed text (and its session draft) comes back
      if (typed) setInput(text)
      return recoverFromError()
    }
    // server refusal (no key / consent / invalid key): nothing appended, keep the typed text
    if (isAiRejected(res)) {
      setSending(false)
      if (text === input) setInput(text)
      await onRefused(res.rejected, () => void doSend(text, content, requestedSlot))
      return
    }
    setView((v) => {
      const n = Object.keys(v.chat.user_message_numbers).length + 1
      return {
        ...v,
        chat: {
          ...v.chat,
          messages: [...v.chat.messages, res.message],
          message_count: v.chat.message_count + 1,
          user_message_numbers: { ...v.chat.user_message_numbers, [res.message.id]: n },
        },
      }
    })
    runTurn(res)
  }

  /** 실패한 턴 다시 보내기 (consent-gated by AiErrorNotice, or by the caller below) */
  const retry = async () => {
    // UQ-481: AI turns only after "다시 이어 하기" (read-only chats have no retry)
    if (busy || !active) return
    if (locked) return showLock()
    if (keyInvalid) {
      setBlockedCode("key_invalid")
      return
    }
    setBlockedCode(null)
    setSendError(false)
    setSending(true)
    let spec: Awaited<ReturnType<typeof retryWritingChatTurnAction>>
    try {
      spec = await retryWritingChatTurnAction(chat.id)
    } catch {
      return recoverFromError()
    }
    if (isAiRejected(spec)) {
      setSending(false)
      await onRefused(spec.rejected, () => void retry())
      return
    }
    if (!spec) return setSending(false)
    runTurn(spec)
  }

  const resumeChat = async () => {
    // no AI call, no key needed (A6) — stay on this screen and bring the input back
    if (!(await resume(chat.id, { open: false }))) return
    const next = await loadChatView(chat.id)
    if (next?.chat.status === "active") {
      setView(next)
      window.setTimeout(() => inputRef.current?.focus(), 50)
    }
  }

  const stop = () => {
    turn.cancel()
    // [UI-가정] 중단한 턴은 실패한 턴과 같이 "다시 보내기"로 이어 간다 (메시지 수 늘지 않음, 공급자 토큰은 다시 씀)
    void finishTurn(true, [], "canceled")
  }

  const patch = async (p: DraftPatch) => {
    const next = await applyDraftPatchAction(chat.id, p)
    if (next) setView(next)
  }
  const setAffiliation = async (aff: Parameters<typeof setWritingChatAffiliationAction>[1]) => {
    const next = await setWritingChatAffiliationAction(chat.id, aff)
    if (next) setView(next)
  }

  const jump = (messageId: string, quote?: string) => {
    setTab("chat")
    setHighlight({ messageId, quote, source: "chip" })
    window.setTimeout(() => document.getElementById(`msg-${messageId}`)?.scrollIntoView({ block: "center", behavior: "smooth" }), 50)
    window.setTimeout(() => setHighlight(null), 2000)
  }
  const jumpToQuestion = () => {
    const lastAi = [...chat.messages].reverse().find((m) => m.role === "assistant" && m.status === "done")
    if (lastAi) jump(lastAi.id)
  }
  const selectMessage = (m: WritingChatMessage) => {
    setHighlight({ messageId: m.id, source: "message" })
    setTab("preview")
    window.setTimeout(() => {
      document.querySelector<HTMLElement>(`[data-source-ids~="${m.id}"]`)?.scrollIntoView({ block: "center", behavior: "smooth" })
    }, 50)
    window.setTimeout(() => setHighlight(null), 2000)
  }

  const openSave = async (intent: "save" | "return") => {
    setSaveIntent(intent)
    setSaveError(false)
    setSummary(await getWritingChatSaveSummaryAction(chat.id))
    setDialog("save")
  }
  const openHandoff = async () => {
    setHandoffError(false)
    setSummary(await getWritingChatSaveSummaryAction(chat.id))
    setDialog("handoff")
  }

  const confirmSave = async () => {
    setSaving(true)
    setSaveError(false)
    try {
      const result = await saveWritingChatAction(chat.id, { fail: preview === "save-failed" })
      notifyCareerSaved()
      await recheck()
      const next = await loadChatView(chat.id)
      if (next) setView(next)
      setDialog(null)
      const ready = target ? result.readiness.features[RETURN_FEATURE_READINESS[target.feature]].ready : false
      if (target && ready && saveIntent === "return") {
        await clearReturnTargetAction(chat.id)
        router.push(gate.returnHref ?? featureHref(target.feature, target.application_project_id, target.params))
      }
    } catch {
      setSaveError(true) // ST-SAVE-FAILED: 정리 결과 유지, 다시 저장
    } finally {
      setSaving(false)
    }
  }

  const confirmHandoff = async () => {
    setSaving(true)
    setHandoffError(false)
    try {
      const { project_id } = await handOffWritingChatAction(chat.id)
      notifyCareerSaved()
      router.push(routes.project(project_id))
    } catch {
      setHandoffError(true) // UQ-75: 정리 결과 유지, 다시 시도
    } finally {
      setSaving(false)
    }
  }

  // progress steps
  const steps = stepDefs(chat.mode).map((s) => ({
    ...s,
    filled: s.slots.every((slot) => isSlotFilled(chat.structured_draft, slot, view.existingDetail)),
    current: view.currentSlot ? s.slots.includes(view.currentSlot) : false,
  }))

  const lastMessage = chat.messages[chat.messages.length - 1]
  // [UI-가정] 실패한 AI 메시지는 마지막 메시지일 때만 "다시 보내기"로 표시(다시 보내 성공하면 숨김)
  const showFailed = !sending && lastMessage?.role === "assistant" && lastMessage.status === "failed"
  // UQ-481: read-only chats (abandoned / saved / handed_off) show the failed turn without actions
  // UQ-295: per-turn provider (writing_chat_messages.provider) — shown where it changes after the first AI turn
  const providerChangeAt: Record<string, { provider: NonNullable<WritingChatMessage["provider"]>; model_tier: WritingChatMessage["model_tier"]; model: string | null }> = {}
  {
    let prev: string | null = null
    let seen = false
    for (const m of chat.messages) {
      if (m.role !== "assistant" || m.status !== "done" || !m.provider) continue
      if (seen && m.provider !== prev) providerChangeAt[m.id] = { provider: m.provider, model_tier: m.model_tier, model: m.model }
      prev = m.provider
      seen = true
    }
  }
  const lastDoneAi = [...chat.messages].reverse().find((m) => m.role === "assistant" && m.status === "done")
  const sensitiveCount = chat.structured_draft.sensitive_flags_count ?? 0
  const featureLabel = target ? RETURN_FEATURE_LABELS[target.feature] : null
  const returnLabel = featureLabel ? `${featureLabel}${directionParticle(featureLabel)} 돌아가기` : null

  const header = (
    <div className="flex flex-wrap items-center gap-2">
      <div className="min-w-0 flex-1">
        <h1 className="text-2xl leading-8 font-bold">AI 작성 대화</h1>
        <p className="text-sm text-muted-foreground">
          {chat.mode === "augment_project" ? `'${view.project?.name ?? "프로젝트"}' 보강` : WRITING_CHAT_MODE_LABELS.new_project}
          {!active ? " · 읽기 전용" : null}
        </p>
      </div>
      {active ? (
        <Button asChild variant="outline" size="sm">
          <Link href={routes.career()}>
            <LogOut aria-hidden />
            나가기
          </Link>
        </Button>
      ) : null}
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="icon-sm" className="size-11 lg:size-8" aria-label="대화 메뉴">
            <MoreHorizontal aria-hidden />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          {/* v5.3 A6 (design-system 5.4): 대화 그만두기 (active only) · 구분선 · 대화 삭제 */}
          {active ? (
            <>
              <DropdownMenuItem disabled={busy} onSelect={() => setDialog("abandon")}>
                <PauseCircle aria-hidden />
                대화 그만두기
              </DropdownMenuItem>
              <DropdownMenuSeparator />
            </>
          ) : null}
          <DropdownMenuItem variant="destructive" onSelect={() => setDialog("delete")}>
            대화 삭제
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  )

  // A2 UQ-83: at ≥1280px both columns show and the tab list is hidden → plain regions, not tabpanels
  const wide = React.useSyncExternalStore(subscribeWide, () => window.matchMedia(WIDE_QUERY).matches, () => false)
  const panelRole = (label: string) => (wide ? { role: "region", "aria-label": label, "aria-labelledby": undefined } : {})

  const chatColumn = (
    <TabsContent value="chat" forceMount {...panelRole("대화")} className="flex min-h-0 flex-col text-base data-[state=inactive]:hidden xl:data-[state=inactive]:flex">
      <div className="space-y-3 border-b px-4 py-3 lg:px-6">
        {target && applicationName ? (
          <GateBanner feature={target.feature} applicationName={applicationName} readiness={view.readiness} readyToReturn={view.readyToReturn} />
        ) : null}
        {active ? (
          <ol className="flex items-center gap-1 overflow-x-auto text-sm" aria-label="진행 단계">
            {steps.map((s, i) => (
              <li key={s.key} className="flex shrink-0 items-center gap-1">
                {i > 0 ? <ChevronRight className="size-3.5 text-muted-foreground" aria-hidden /> : null}
                <Button
                  variant="ghost"
                  size="sm"
                  disabled={busy || atLimit || locked}
                  aria-current={s.current ? "step" : undefined}
                  title="이 부분부터 다시 물어봐 줘"
                  data-pending={!s.current && !s.filled ? "" : undefined}
                  onClick={() => send(requestSlotMessage(s.slots[0], true), s.slots[0])}
                >
                  {s.filled ? <Check className="size-3.5 text-success" aria-hidden /> : null}
                  {s.label}
                  <span className="sr-only">{s.filled ? " (채움)" : s.current ? " (현재)" : ""} — 이 부분부터 다시 물어봐 줘</span>
                </Button>
              </li>
            ))}
          </ol>
        ) : null}
        {/* v2 3.19: C-19 연결 배지 at the top of the conversation */}
        {active ? <ProviderBadge className="ml-auto" /> : null}
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-4 py-6 lg:px-6" aria-label="대화 기록">
        <div className="mx-auto max-w-[42rem] space-y-6">
          {chat.status === "saved" || chat.status === "handed_off" ? <CompletionCard view={view} gate={gate} returnLabel={returnLabel} onReturn={() => clearReturnTargetAction(chat.id)} /> : null}
          {chat.messages.map((m, i) => {
            if (m.role === "assistant" && m.status === "failed") {
              if (!active)
                // UQ-481 [UI-가정]: read-only chat — the failed turn is a plain note, no "다시 보내기"
                return showFailed && i === chat.messages.length - 1 ? (
                  <p key={m.id} className="pl-10 text-sm text-muted-foreground">
                    답을 받지 못한 턴이에요
                  </p>
                ) : null
              return showFailed && i === chat.messages.length - 1 ? (
                <div key={m.id} className="space-y-2">
                  <FailedTurn
                    kind={failKind ?? view.turnFailures[m.id]?.error_code ?? null}
                    // live failure: the stream's own retry_after; after a reload: the turn's ai_jobs row
                    failure={
                      failKind && turn.errorInfo
                        ? { provider: turn.errorInfo.provider ?? null, retry_after: turn.errorInfo.retryAfter ?? null, quota_resets_at: turn.errorInfo.quotaResetsAt ?? null }
                        : view.turnFailures[m.id]
                    }
                    onRetry={() => void retry()}
                    onGuardedRetry={() => void consent.guard(() => void retry())}
                    onFocusInput={() => inputRef.current?.focus()}
                  />
                  {/* C-09 v5: 게이트 대화의 첫 턴이 공급자 오류로 실패 → 폼 경로 */}
                  {target && failKind !== "canceled" && Object.keys(chat.user_message_numbers).length <= 1 ? (
                    <p className="flex flex-wrap items-center gap-x-2 pl-10 text-sm text-muted-foreground">
                      AI 대화 대신 직접 입력으로 채울 수도 있어요
                      <Button asChild variant="link" size="sm" className="h-auto px-0">
                        <Link href={chat.project_id ? routes.projectDetailNew(chat.project_id) : routes.projectNew(chat.experience_id ? { experience_id: chat.experience_id } : undefined)}>
                          직접 입력하기
                        </Link>
                      </Button>
                    </p>
                  ) : null}
                </div>
              ) : null
            }
            // v5.3 A5: the fixed greeting (first message, inserted at start, no AI job) — no number,
            // no source chip, not counted in n / 40
            if (i === 0 && m.role === "assistant" && m.ai_job_id === null) {
              return (
                <div key={m.id} id={`msg-${m.id}`}>
                  <AiMessage content={m.content} />
                  {freeTier && connection?.active_provider ? (
                    // [UI-가정] the free-tier line follows the tier active now (the greeting row has no tier);
                    // 문구 확정은 D-10 (C-21과 함께)
                    <p className="mt-3 ml-10 flex gap-2 rounded-md bg-warning-subtle px-3 py-2 text-sm text-warning-subtle-foreground">
                      <TriangleAlert className="mt-0.5 size-4 shrink-0 text-warning" aria-hidden />
                      무료 등급에서는 입력한 내용이 {AI_PROVIDER_LABELS[connection.active_provider]} 제품 개선에 쓰이고 사람이 검토할 수 있어요. 민감정보·회사 기밀은 쓰지 마세요
                    </p>
                  ) : null}
                </div>
              )
            }
            const flashMe = highlight?.messageId === m.id && highlight.source === "chip"
            return (
              <div key={m.id} id={`msg-${m.id}`} className={cn("rounded-lg", flashMe && "animate-field-flash")}>
                {m.role === "assistant" ? (
                  <AiMessage content={m.content} providerTag={providerChangeAt[m.id] ?? null} />
                ) : (
                  <UserMessage
                    number={chat.user_message_numbers[m.id]}
                    content={m.content}
                    quote={flashMe ? highlight?.quote : undefined}
                    onClick={() => selectMessage(m)}
                  />
                )}
                {/* [UI-가정] 민감정보 안내는 sensitive_flags_count > 0 이면 마지막 AI 메시지 아래 한 번 */}
                {m.id === lastDoneAi?.id && sensitiveCount > 0 ? (
                  <Alert variant="info" className="mt-3 ml-10 w-auto py-2 text-sm">
                    <AlertTitle className="font-normal">
                      이 부분은 민감한 정보로 보여 정리 결과에 옮기지 않았어요. 대화 기록에는 남아 있어요. 필요하면 대화를 삭제하세요
                    </AlertTitle>
                    <AlertDescription>
                      <Button variant="link" size="sm" className="h-auto px-0" onClick={() => setDialog("delete")}>
                        대화 삭제
                      </Button>
                    </AlertDescription>
                  </Alert>
                ) : null}
              </div>
            )
          })}
          {turn.status === "streaming" || (sending && turn.status !== "error") ? (
            <div aria-busy="true" className="space-y-1">
              {/* v5.3 A14: no wait before the first token — rate limits / outages fail the turn at once */}
              <AiMessage content={turn.reply} streaming={turn.status === "streaming" || !turn.reply} />
            </div>
          ) : null}
          {/* A5 상한 도달 (design-system 5.4 v3): info Alert under the last AI message */}
          {active && reachedLimit && !sending ? (
            <Alert variant="info" className="ml-10 w-auto">
              <AlertTitle className="font-normal">
                대화가 길어져 정리 정확도가 떨어질 수 있어요. 지금까지 내용을 저장하거나 새 대화로 이어 가세요
              </AlertTitle>
              <AlertDescription>
                <div className="mt-2 flex flex-wrap gap-2">
                  <Button size="sm" disabled={busy} onClick={() => void openSave(target && view.readyToReturn ? "return" : "save")}>
                    저장
                  </Button>
                  <Button size="sm" variant="outline" disabled={busy} onClick={() => void openHandoff()}>
                    폼으로 전환
                  </Button>
                  {chat.project_id ? (
                    // [UI-가정] 새 보강 대화는 프로젝트가 정해진 대화(보강 모드)에서만
                    <Button size="sm" variant="outline" asChild>
                      <Link href={routes.writingChatNew({ mode: "augment_project", project_id: chat.project_id })}>새 보강 대화</Link>
                    </Button>
                  ) : null}
                </div>
              </AlertDescription>
            </Alert>
          ) : null}
          <div ref={listEnd} />
          <p className="sr-only" aria-live="polite">
            {turn.status === "done" ? "AI 응답이 도착했어요" : turn.status === "error" ? "답을 받지 못했어요" : ""}
          </p>
        </div>
      </div>

      {active ? (
        <div className="sticky bottom-0 border-t bg-background p-4">
          <div className="mx-auto max-w-[42rem] space-y-2">
            {locked ? (
              <div ref={lockRef}>
              <AiLock
                entry="writing_chat"
                size="inline"
                actionName="보내기"
                // [UI-가정] 진행 중 대화의 잠금 설명 문구 (명세: 새 메시지는 키 필요, 기록·저장·폼 전환은 가능)
                description="새 메시지를 보내려면 AI 연결이 필요해요. 대화 기록과 정리 결과는 그대로 보고 저장할 수 있어요"
                alternativeLabel="폼으로 전환"
                onAlternative={() => void openHandoff()}
                featureLabel="AI 작성 대화"
              />
              </div>
            ) : null}
            <div className="flex flex-wrap gap-2">
              {QUICK_REPLIES.map((q) => (
                <Button key={q} variant="outline" size="sm" disabled={busy || locked || atLimit} onClick={() => send(q)}>
                  {q}
                </Button>
              ))}
            </div>
            {sendError && !blockedCode ? (
              // UQ-480 [UI-가정] copy: non-refusal failure of send / 다시 보내기 / turn completion
              <p className="text-sm text-destructive" role="alert">
                보내지 못했어요. 입력한 내용은 그대로 있어요. 잠시 후 다시 시도해 주세요
              </p>
            ) : null}
            {/* 전송이 막힐 때 (design-system 5.4 v3): C-20 inline right above the textarea */}
            {blockedCode && !locked ? (
              <AiErrorNotice
                code={blockedCode}
                size="inline"
                lockEntry="writing_chat"
                inputLabel="답변으로 돌아가기"
                onFocusInput={() => inputRef.current?.focus()}
              />
            ) : null}
            <form
              className="flex items-end gap-2"
              onSubmit={(e) => {
                e.preventDefault()
                send(input)
              }}
            >
              <Textarea
                ref={inputRef}
                aria-label="답변 입력"
                aria-describedby="chat-guide chat-count"
                className="max-h-48 min-h-12 text-base"
                value={input}
                disabled={busy || atLimit}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
                    e.preventDefault()
                    send(input)
                  }
                }}
              />
              {turn.status === "streaming" ? (
                <Button type="button" variant="outline" onClick={stop}>
                  <Square className="size-3.5" aria-hidden />
                  중단
                </Button>
              ) : (
                <Button type="submit" size="icon" aria-label="보내기" disabled={busy || atLimit || locked || !input.trim()}>
                  {sending ? <Loader2 className="animate-spin" aria-hidden /> : <ArrowUp aria-hidden />}
                </Button>
              )}
            </form>
            <div className="flex items-start justify-between gap-3">
              {atLimit ? (
                <p id="chat-guide" className="text-sm text-muted-foreground">
                  저장하거나 폼으로 옮겨 이어서 써 주세요
                </p>
              ) : (
                <InputGuide id="chat-guide" guide="G-2" />
              )}
              <span
                id="chat-count"
                className={cn("shrink-0 text-xs font-medium tabular-nums", messageCount >= 36 ? "text-warning-subtle-foreground" : "text-muted-foreground")}
              >
                {messageCount} / {MESSAGE_LIMIT}
              </span>
            </div>
          </div>
        </div>
      ) : chat.status === "abandoned" ? (
        // v5.3 A6 (design-system 5.4 v3): 그만둔 대화 — read-only, "다시 이어 하기" in the input's place
        // (no AI call → no C-19 badge, enabled without a key)
        <div className="sticky bottom-0 border-t bg-background p-4">
          <div className="mx-auto flex max-w-[42rem] flex-wrap items-center gap-3">
            <p className="flex min-w-0 flex-1 items-center gap-2 text-sm text-muted-foreground" role="status">
              <PauseCircle className="size-4 shrink-0" aria-hidden />
              {/* [UI-가정] P-12 / G-37 문구 */}
              그만둔 대화예요
            </p>
            <Button size="sm" disabled={resumingId !== null} onClick={() => void resumeChat()}>
              {resumingId !== null ? <Loader2 className="animate-spin" aria-hidden /> : null}
              다시 이어 하기
            </Button>
          </div>
        </div>
      ) : null}
    </TabsContent>
  )

  const previewColumn = (
    <TabsContent
      value="preview"
      forceMount
      {...panelRole("정리 결과")}
      className="flex min-h-0 flex-col border-l bg-card text-base data-[state=inactive]:hidden xl:data-[state=inactive]:flex"
    >
      <div className="min-h-0 flex-1 overflow-y-auto p-4 lg:p-6">
        {patching ? (
          // D-37: 무료 등급은 응답과 정리 갱신을 순차로 처리 → 정리 중이 조금 길어질 수 있음
          <AiProgressInline label={freeTier ? "정리 중 · 무료 등급이라 하나씩 처리해요" : "정리 중"} className="mb-3" />
        ) : null}
        <DraftPreview
          view={view}
          readOnly={!active}
          busy={busy}
          flashPaths={flashPaths}
          highlightMessageId={highlight?.source === "message" ? highlight.messageId : null}
          handlers={{
            onPatch: patch,
            onAffiliation: setAffiliation,
            onAsk: (slot) => {
              if (locked) return showLock()
              setTab("chat")
              send(requestSlotMessage(slot, false), slot)
            },
            onJump: jump,
            onJumpToQuestion: jumpToQuestion,
            askDisabled: busy || atLimit || turn.status === "streaming",
          }}
        />
      </div>
      {active ? (
        <div className="sticky bottom-0 flex flex-wrap justify-end gap-2 border-t bg-card p-4">
          {target && !view.readyToReturn ? (
            <p className="mr-auto self-center text-sm text-muted-foreground">아직 필요: {missingText(view)}</p>
          ) : null}
          <Button variant="outline" disabled={busy} onClick={() => void openHandoff()}>
            폼으로 전환
          </Button>
          <Button disabled={busy} onClick={() => void openSave(target && view.readyToReturn ? "return" : "save")}>
            {target && view.readyToReturn ? "저장하고 돌아가기" : "저장"}
          </Button>
        </div>
      ) : null}
    </TabsContent>
  )

  return (
    <div className="-mx-4 -mb-4 flex h-[calc(100dvh-4rem)] flex-col lg:h-[calc(100dvh-5rem)]">
      <div className="border-b px-4 py-3 lg:px-6">{header}</div>
      <Tabs
        value={tab}
        onValueChange={(v) => {
          setTab(v as "chat" | "preview")
          if (v === "preview") setPreviewDot(false)
        }}
        className="min-h-0 flex-1 gap-0"
      >
        {/* UQ-70: shadcn Tabs below 1280px; sticky above the progress steps */}
        <TabsList variant="line" aria-label="보기 전환" className="sticky top-0 z-10 h-11 w-full rounded-none border-b bg-background xl:hidden">
          <TabsTrigger value="chat" className="min-h-10 text-base">
            대화
          </TabsTrigger>
          <TabsTrigger value="preview" className="min-h-10 text-base">
            정리 결과{review > 0 ? ` (검토 ${review})` : ""}
            {previewDot ? (
              <>
                <span className="inline-block size-2 rounded-full bg-ai" aria-hidden />
                <span className="sr-only">새 내용 있음</span>
              </>
            ) : null}
          </TabsTrigger>
        </TabsList>
      <div className="grid min-h-0 flex-1 xl:grid-cols-[minmax(0,1fr)_minmax(24rem,32rem)]">
        {chatColumn}
        {previewColumn}
      </div>
      </Tabs>

      <Dialog open={dialog === "save" || dialog === "handoff"} onOpenChange={(o) => !o && !saving && setDialog(null)}>
        <DialogContent className="max-h-[85dvh] overflow-y-auto sm:max-w-lg">
          <DialogHeader className="text-left">
            <DialogTitle className="text-lg leading-7 font-semibold">{dialog === "handoff" ? "폼으로 전환" : "저장 확인"}</DialogTitle>
            <DialogDescription className="text-base text-foreground">
              {dialog === "handoff"
                ? `정리된 내용을 작성 중 항목으로 옮겨 폼에서 이어 쓸까요? (검토하지 않은 항목 ${summary?.unreviewed ?? 0}개는 옮기지 않아요)`
                : summary
                  ? saveSummaryText(summary)
                  : "저장할 내용을 확인하는 중이에요"}
            </DialogDescription>
          </DialogHeader>
          {dialog === "handoff" && handoffError ? (
            <p className="text-sm text-destructive" role="alert">
              {actionFailedMessage("폼으로 전환")}
            </p>
          ) : null}
          {dialog === "save" && summary ? (
            <div className="space-y-2 text-sm">
              {summary.draft_items.length ? <p>작성 중으로 저장되는 항목: {summary.draft_items.join(", ")}</p> : null}
              {summary.unreviewed > 0 ? (
                <p className="font-medium text-warning-subtle-foreground">검토하지 않은 항목 {summary.unreviewed}개는 저장되지 않아요</p>
              ) : null}
              {saveError ? (
                <p className="text-destructive" role="alert">
                  {submitFailedMessage("정리 결과")}
                </p>
              ) : null}
            </div>
          ) : null}
          <DialogFooter className="flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <Button variant="outline" disabled={saving} onClick={() => setDialog(null)}>
              취소
            </Button>
            <Button disabled={saving || !summary} onClick={() => void (dialog === "handoff" ? confirmHandoff() : confirmSave())}>
              {saving ? <Loader2 className="animate-spin" aria-hidden /> : null}
              {dialog === "handoff" ? (handoffError ? "다시 시도" : "옮기기") : saveError ? "다시 저장" : saveIntent === "return" ? "저장하고 돌아가기" : "저장"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AbandonChatDialog
        chat={dialog === "abandon" ? chat : null}
        onOpenChange={(o) => !o && setDialog(null)}
        onAbandoned={() => router.push(routes.career())}
      />
      {consent.dialog}

      <DeleteConfirmDialog
        target={{ kind: "writing_chat", entity_id: chat.id }}
        open={dialog === "delete"}
        onOpenChange={(o) => !o && setDialog(null)}
        onConfirm={async () => {
          await deleteCareerItemAction("writing_chat", chat.id)
          router.push(routes.career())
        }}
      />
    </div>
  )
}

function missingText(view: ChatView): string {
  const t = view.chat.return_target
  if (!t) return ""
  const f = view.readiness.features[RETURN_FEATURE_READINESS[t.feature]]
  const parts = (f.missing ?? []).map((m) => (m === "complete_experience" ? "완료된 경력 1건" : "완료된 프로젝트 1건"))
  return parts.join(", ") || "없음"
}

function saveSummaryText(s: WritingChatSaveSummary): string {
  const parts = [
    `프로젝트 1건(${s.project.kind === "new" ? "새로" : `기존 '${s.project.name ?? "프로젝트"}'에 추가`})`,
    `새 상세 내용 ${s.new_details}건`,
    ...s.filled_existing.map((f) => `기존 상세 내용 '${f.title ?? "제목 없음"}'의 빈 칸 ${f.filled}개 채움`),
    `정량 성과 ${s.achievements}건`,
    `스킬 ${s.skills}개(새 스킬 ${s.new_skills}개)`,
  ]
  return `${parts.join(", ")}가 저장돼요.`
}

/** UQ-60 / UQ-64: failed turn → C-20 inline by error_code; canceled = 중단 (not a failure) */
const WIDE_QUERY = "(min-width: 1280px)"
function subscribeWide(onChange: () => void) {
  const mql = window.matchMedia(WIDE_QUERY)
  mql.addEventListener("change", onChange)
  return () => mql.removeEventListener("change", onChange)
}

function FailedTurn({
  kind,
  failure,
  onRetry,
  onGuardedRetry,
  onFocusInput,
}: {
  kind: AiErrorCode | null
  /** the failed turn's job (ChatView.turnFailures) — provider / retry_after / quota_resets_at */
  failure?: { provider?: ChatView["turnFailures"][string]["provider"] | null; retry_after: string | null; quota_resets_at: string | null }
  /** raw retry — AiErrorNotice consent-gates it itself */
  onRetry: () => void
  /** retry behind the consent gate (R-67) for the branches without AiErrorNotice */
  onGuardedRetry: () => void
  onFocusInput: () => void
}) {
  if (kind === null || kind === "canceled")
    // UQ-296: cause unknown (turn stored before v4 job rows) → don't assert a provider outage.
    // canceled = 중단 (not a failure). UQ-482: the resend runs on the active provider → C-19 badge
    return (
      <div className="flex flex-wrap items-center gap-2 pl-10 text-sm text-muted-foreground" role="status">
        <span>{kind === null ? "답을 받지 못했어요. 잠시 후 다시 시도해 주세요" : "중단했어요."}</span>
        <Button variant="link" size="sm" className="h-auto px-0" onClick={onGuardedRetry}>
          다시 보내기
        </Button>
        <ProviderBadge />
      </div>
    )
  return (
    <AiErrorNotice
      code={kind}
      provider={failure?.provider}
      retryAfter={failure?.retry_after}
      quotaResetsAt={failure?.quota_resets_at}
      size="inline"
      // v5.3 A14: request path — "{N}초 뒤 다시 보낼 수 있어요" + "다시 보내기" countdown to retry_after
      requestPath
      retryLabel="다시 보내기"
      rerunLabel="보내기"
      lockEntry="writing_chat"
      onRetry={onRetry}
      reduceTarget="답변"
      onFocusInput={onFocusInput}
      className="pl-10"
    />
  )
}

function AiMessage({
  content,
  streaming,
  providerTag,
}: {
  content: string
  streaming?: boolean
  providerTag?: { provider: NonNullable<WritingChatMessage["provider"]>; model_tier: WritingChatMessage["model_tier"]; model: string | null } | null
}) {
  return (
    <div className="space-y-1">
    {providerTag ? (
      <div className="flex items-center gap-2 pl-10 text-xs text-muted-foreground">
        <span>이 답변부터 공급자가 바뀌었어요</span>
        <ProviderResultTag provider={providerTag.provider} model_tier={providerTag.model_tier} model={providerTag.model ?? undefined} />
      </div>
    ) : null}
    <div className="flex gap-3">
      <span className="grid size-7 shrink-0 place-items-center rounded-full bg-ai-subtle" aria-hidden>
        <Sparkles className="size-4 text-ai" />
      </span>
      <p className="min-w-0 flex-1 text-base leading-[1.75] whitespace-pre-wrap">
        <span className="sr-only">AI: </span>
        {content}
        {streaming ? <StreamingCaret /> : null}
      </p>
    </div>
    </div>
  )
}

function UserMessage({ number, content, quote, onClick }: { number?: number; content: string; quote?: string; onClick: () => void }) {
  const idx = quote ? content.indexOf(quote) : -1
  return (
    <div className="flex flex-col items-end gap-1">
      <span className="text-xs font-medium text-muted-foreground">내 답변 #{number}</span>
      <button
        type="button"
        onClick={onClick}
        aria-label={`내 답변 #${number}: 이 답변이 출처인 정리 결과 보기`}
        className="ml-auto max-w-[85%] cursor-pointer rounded-lg rounded-br-sm bg-secondary px-4 py-3 text-left text-base leading-[1.75] whitespace-pre-wrap hover:ring-1 hover:ring-border focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
      >
        {idx >= 0 && quote ? (
          <>
            {content.slice(0, idx)}
            <mark className="rounded-sm bg-ai-subtle text-foreground">{quote}</mark>
            {content.slice(idx + quote.length)}
          </>
        ) : (
          content
        )}
      </button>
    </div>
  )
}

/** 저장 완료(saved) / 폼 전환 완료(handed_off): 읽기 전용 + 다음 동작 */
function CompletionCard({
  view,
  gate,
  returnLabel,
  onReturn,
}: {
  view: ChatView
  gate: ReturnType<typeof useGateContinuation>
  returnLabel: string | null
  onReturn: () => Promise<void>
}) {
  const { chat } = view
  const projectId = chat.project_id
  const target = chat.return_target
  const ready = target ? view.readiness.features[RETURN_FEATURE_READINESS[target.feature]].ready : false
  const returnHref = target ? (gate.returnHref ?? featureHref(target.feature, target.application_project_id, target.params)) : null
  return (
    <Card tone="success" className="gap-3 p-5" role="status">
      <p className="flex items-center gap-2 font-semibold">
        <Check className="size-5 text-success" aria-hidden />
        {chat.status === "saved" ? "커리어에 저장했어요" : "폼으로 옮겼어요"}
        {target && ready ? <Badge variant="success">준비됨</Badge> : null}
      </p>
      <p className="text-sm text-muted-foreground">대화는 읽기 전용이에요. 이 프로젝트에 상세 내용을 더 추가하려면 새 보강 대화를 시작해 주세요</p>
      {target && !ready ? <p className="text-sm">아직 필요: {missingText(view)}</p> : null}
      <div className="flex flex-wrap items-start gap-2">
        {target ? (
          // FL-13 v5: 키 없음·무효면 다음 단계는 폼 경로 (gate-next-step)
          <GateNextStep
            featureLabel={RETURN_FEATURE_LABELS[target.feature]}
            ready={ready}
            returnHref={returnLabel ? returnHref : null}
            continueHref={gate.continueHref}
            directHref={projectId ? routes.projectDetailNew(projectId) : routes.projectNew()}
            onReturn={() => void onReturn()}
            loading={gate.target !== null && gate.readiness === null}
          />
        ) : null}
        {projectId ? (
          <Button asChild variant={target && ready ? "outline" : target ? "outline" : "default"}>
            <Link href={routes.project(projectId)}>프로젝트 보기</Link>
          </Button>
        ) : null}
        {projectId ? (
          <AiRunButton
            variant="outline"
            href={routes.writingChatNew({ mode: "augment_project", project_id: projectId })}
            lock={chatLock("이 프로젝트에 상세 내용 더 추가하기", routes.projectDetailNew(projectId))}
          >
            이 프로젝트에 상세 내용 더 추가하기
          </AiRunButton>
        ) : null}
      </div>
    </Card>
  )
}
