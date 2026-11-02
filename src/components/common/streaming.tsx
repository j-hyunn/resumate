"use client"

/**
 * C-04 스트리밍 출력 (design-system 3.4 v3) + hooks backed by the mock stream.
 *
 *   const stream = useAiStream()
 *   stream.start({ blocks: [...] })            // block streams (AI-03 / AI-04)
 *   <StreamingHeader onStop={stream.cancel} phase={stream.phase} adjusting={stream.adjusting} />
 *   {stream.blocks.map(b => <StreamingBlock key={b.block_id} block={b} finalizing={stream.phase === "finalizing"} />)}
 *
 * v5.3 (02 C-04): streamed blocks are provisional — no edit / copy / hover. After the last
 * `block_completed` (or `adjusting_length`) the phase is "finalizing" ("마무리 중…", edit / copy
 * disabled). `validated` replaces the whole section (career description: the whole draft) with the
 * confirmed blocks; only then chips, badges and `notes` (S-19 생성 직후 안내) attach.
 *
 *   const turn = useChatTurnStream()           // AI-12 writing chat turn
 *
 * `start({ endpoint, body })` reads the real SSE route (lib/data/ai-stream-client); a mock request runs the generator.
 */
import * as React from "react"
import { Loader2, Sparkles, Square } from "lucide-react"
import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"
import type { AiErrorCode, DraftBlockFlag } from "@/types/db"
import type { AiErrorInfo } from "./ai-error-notice"
import {
  mockBlockStream,
  mockChatTurn,
  type ChatTurnEvent,
  type GenerationNotesPayload,
  type MockBlockStreamOptions,
  type MockChatTurnOptions,
  type StreamErrorEvent,
  type StreamSource,
} from "@/lib/mock/ai-stream"

import { isRealStreamRequest, realBlockStream, realChatTurn, replaceSectionBlocks, type RealStreamRequest } from "@/lib/data/ai-stream-client"

export type { GenerationNotesPayload }

export type StreamBlockState = "streaming" | "completed" | "validated"

export interface StreamBlock {
  block_id: string
  text: string
  state: StreamBlockState
  flags: DraftBlockFlag[]
  evidence_count: number
  /** cover letter 문항 (draft_sections.id) the block belongs to */
  section_id?: string
}

/**
 * C-04 phase: sources → streaming (provisional blocks) → adjusting (글자 수 맞추는 중) →
 * finalizing (마무리 중, validated pending) → done. "idle" before start.
 */
export type StreamPhase = "idle" | "sources" | "streaming" | "adjusting" | "finalizing" | "done"

function errorInfoOf(ev: StreamErrorEvent): AiErrorInfo {
  return { code: ev.error_code, provider: ev.provider, retryAfter: ev.retry_after, quotaResetsAt: ev.quota_resets_at }
}

export type StreamStatus = "idle" | "streaming" | "done" | "error" | "canceled"

export interface UseAiStreamResult {
  blocks: StreamBlock[]
  sources: StreamSource[] | null
  status: StreamStatus
  /** v5.3 C-04 phase (마무리 중 = "finalizing": edit / copy stay disabled) */
  phase: StreamPhase
  /** `adjusting_length` payload while the length is being adjusted */
  adjusting: { current_chars: number; char_limit: number; section_id?: string } | null
  /** S-19 생성 직후 안내 per section ("" = career description), from `validated` (not stored, A21) */
  notes: Record<string, GenerationNotesPayload>
  /** sections already confirmed by `validated` ("" = career description) */
  validatedSections: string[]
  error: AiErrorCode | null
  /** v4: full C-20 info of the failure → <AiErrorNotice {...stream.errorInfo} /> */
  errorInfo: AiErrorInfo | null
  /**
   * `discardOnError` (v5.3 A4, career description): a failure drops every provisional block (no
   * block is kept; the retry makes a new draft).
   */
  start: (request: (Omit<MockBlockStreamOptions, "signal"> | RealStreamRequest) & { discardOnError?: boolean }) => void
  /** sets cancel_requested_at in the real backend */
  cancel: () => void
  reset: () => void
}

export function useAiStream(): UseAiStreamResult {
  const [blocks, setBlocks] = React.useState<StreamBlock[]>([])
  const [sources, setSources] = React.useState<UseAiStreamResult["sources"]>(null)
  const [status, setStatus] = React.useState<StreamStatus>("idle")
  const [errorInfo, setErrorInfo] = React.useState<AiErrorInfo | null>(null)
  const [phase, setPhase] = React.useState<StreamPhase>("idle")
  const [adjusting, setAdjusting] = React.useState<UseAiStreamResult["adjusting"]>(null)
  const [notes, setNotes] = React.useState<Record<string, GenerationNotesPayload>>({})
  const [validatedSections, setValidatedSections] = React.useState<string[]>([])
  const error = errorInfo?.code ?? null
  const controller = React.useRef<AbortController | null>(null)

  React.useEffect(() => () => controller.current?.abort(), [])

  const start = React.useCallback((request: (Omit<MockBlockStreamOptions, "signal"> | RealStreamRequest) & { discardOnError?: boolean }) => {
    controller.current?.abort()
    const ac = new AbortController()
    controller.current = ac
    const { discardOnError, ...source } = request
    // A real stream doesn't announce its blocks up front: no "마무리 중" before `validated` (spec-gaps W1).
    const specs = isRealStreamRequest(request) ? [] : request.blocks
    const sectionOf = new Map(specs.map((b) => [b.block_id, b.section_id]))
    const lastBlockOfSection = new Map<string | undefined, string>()
    for (const b of specs) lastBlockOfSection.set(b.section_id, b.block_id)
    setBlocks([])
    setSources(null)
    setErrorInfo(null)
    setPhase(!isRealStreamRequest(request) && request.sources ? "sources" : "streaming")
    setAdjusting(null)
    setNotes({})
    setValidatedSections([])
    setStatus("streaming")
    void (async () => {
      try {
        const events = isRealStreamRequest(source)
          ? realBlockStream(source, ac.signal)
          : mockBlockStream({ ...(source as Omit<MockBlockStreamOptions, "signal">), signal: ac.signal })
        for await (const ev of events) {
          switch (ev.type) {
            case "sources_selected":
              setSources(ev.sources)
              break
            case "block_started":
              setPhase("streaming")
              setBlocks((prev) => [
                ...prev,
                { block_id: ev.block_id, text: "", state: "streaming", flags: [], evidence_count: 0, section_id: sectionOf.get(ev.block_id) },
              ])
              break
            case "block_delta":
              setBlocks((prev) => prev.map((b) => (b.block_id === ev.block_id ? { ...b, text: b.text + ev.delta } : b)))
              break
            case "block_completed":
              setBlocks((prev) => prev.map((b) => (b.block_id === ev.block_id ? { ...b, state: "completed" } : b)))
              // the section's last block ended → "마무리 중" until `validated`
              if (lastBlockOfSection.get(sectionOf.get(ev.block_id)) === ev.block_id) setPhase("finalizing")
              break
            case "adjusting_length":
              setPhase("adjusting")
              setAdjusting({ current_chars: ev.current_chars, char_limit: ev.char_limit, section_id: ev.section_id })
              break
            case "validated": {
              const key = ev.section_id ?? ""
              // whole-section replacement: provisional blocks of the section → confirmed set
              setBlocks((prev) => {
                const confirmed: StreamBlock[] = ev.blocks.map((b) => ({ ...b, state: "validated", section_id: ev.section_id }))
                return replaceSectionBlocks(prev, key, confirmed)
              })
              setAdjusting(null)
              setValidatedSections((v) => [...v, key])
              if (ev.notes) setNotes((n) => ({ ...n, [key]: ev.notes! }))
              setPhase("streaming")
              break
            }
            case "done":
              setPhase("done")
              setStatus("done")
              break
            case "error":
              setErrorInfo(errorInfoOf(ev))
              setAdjusting(null)
              setPhase("idle")
              // unconfirmed (provisional) blocks are dropped — the failed 문항 shows only C-20;
              // career description drops everything (A4)
              setBlocks((prev) => (discardOnError ? [] : prev.filter((b) => b.state === "validated")))
              setStatus(ev.error_code === "canceled" ? "canceled" : "error")
              break
          }
        }
      } catch (e) {
        if ((e as Error).name === "AbortError") setStatus("canceled")
        else {
          setErrorInfo({ code: "provider_unavailable" })
          setStatus("error")
        }
      }
    })()
  }, [])

  const cancel = React.useCallback(() => controller.current?.abort(), [])
  const reset = React.useCallback(() => {
    controller.current?.abort()
    setBlocks([])
    setSources(null)
    setErrorInfo(null)
    setPhase("idle")
    setAdjusting(null)
    setNotes({})
    setValidatedSections([])
    setStatus("idle")
  }, [])

  return { blocks, sources, status, phase, adjusting, notes, validatedSections, error, errorInfo, start, cancel, reset }
}

export interface UseChatTurnResult {
  reply: string
  status: "idle" | "streaming" | "patching" | "done" | "error" | "canceled"
  error: AiErrorCode | null
  /** v4: full C-20 info of a failed turn (provider / retry_after / quota_resets_at) */
  errorInfo: AiErrorInfo | null
  lastEvent: ChatTurnEvent | null
  start: (request: Omit<MockChatTurnOptions, "signal"> | RealStreamRequest, onEvent?: (ev: ChatTurnEvent) => void) => void
  cancel: () => void
}

/** AI-12 turn: reply_delta → reply_done → draft_patch → draft_flags → turn_done */
export function useChatTurnStream(): UseChatTurnResult {
  const [reply, setReply] = React.useState("")
  const [status, setStatus] = React.useState<UseChatTurnResult["status"]>("idle")
  const [errorInfo, setErrorInfo] = React.useState<AiErrorInfo | null>(null)
  const [lastEvent, setLastEvent] = React.useState<ChatTurnEvent | null>(null)
  const controller = React.useRef<AbortController | null>(null)
  React.useEffect(() => () => controller.current?.abort(), [])

  const start = React.useCallback((request: Omit<MockChatTurnOptions, "signal"> | RealStreamRequest, onEvent?: (ev: ChatTurnEvent) => void) => {
    controller.current?.abort()
    const ac = new AbortController()
    controller.current = ac
    setReply("")
    setErrorInfo(null)
    setStatus("streaming")
    void (async () => {
      try {
        const events = isRealStreamRequest(request) ? realChatTurn(request, ac.signal) : mockChatTurn({ ...request, signal: ac.signal })
        for await (const ev of events) {
          setLastEvent(ev)
          onEvent?.(ev)
          if (ev.type === "reply_delta") setReply((r) => r + ev.delta)
          if (ev.type === "reply_done") setStatus("patching")
          if (ev.type === "turn_done") setStatus("done")
          if (ev.type === "error") {
            setErrorInfo(errorInfoOf(ev))
            setStatus("error")
          }
        }
      } catch (e) {
        setStatus((e as Error).name === "AbortError" ? "canceled" : "error")
      }
    })()
  }, [])

  const cancel = React.useCallback(() => controller.current?.abort(), [])
  return { reply, status, error: errorInfo?.code ?? null, errorInfo, lastEvent, start, cancel }
}

// ---------------------------------------------------------------------------
// visuals
// ---------------------------------------------------------------------------

/**
 * 생성 중 영역 머리: Sparkles + "작성 중…" + 중단. v5.3: phase "adjusting" → "글자 수 맞추는 중 (현재
 * {n}자 / 제한 {limit}자)", "finalizing" → Loader2 + "마무리 중…". 중단 stays until `done` [UI-가정 G-31].
 * `stopping` → "중단하는 중…" with the button disabled.
 */
export function StreamingHeader({
  onStop,
  label = "작성 중…",
  phase,
  adjusting,
  stopping = false,
  className,
}: {
  onStop?: () => void
  label?: string
  phase?: StreamPhase
  adjusting?: { current_chars: number; char_limit: number } | null
  /**
   * W3-4: the stop was asked and the run hasn't closed yet. The run sees it at its next heartbeat (10 s); the stop waits
   * up to 3 s for the job row and 12 s for it to close (`drafts-real.ts` stopRun), so ~15 s plus round trips (UQ-707).
   */
  stopping?: boolean
  className?: string
}) {
  const finalizing = phase === "finalizing"
  // [UI-가정] 중단 대기 문구
  const text = stopping
    ? "중단하는 중… 최대 20초쯤 걸릴 수 있어요"
    : phase === "adjusting" && adjusting
      ? `글자 수 맞추는 중 (현재 ${adjusting.current_chars.toLocaleString("ko-KR")}자 / 제한 ${adjusting.char_limit.toLocaleString("ko-KR")}자)`
      : finalizing
        ? "마무리 중…"
        : label
  return (
    <div className={cn("flex items-center gap-2", className)}>
      {finalizing || stopping ? <Loader2 className="size-4 animate-spin text-ai" aria-hidden /> : <Sparkles className="size-4 text-ai" aria-hidden />}
      <span role={stopping ? "status" : undefined} className={cn("text-sm font-medium text-ai-subtle-foreground", phase === "adjusting" && !stopping && "tabular-nums")}>
        {text}
      </span>
      {onStop ? (
        <Button variant="outline" size="sm" className="ml-auto" onClick={onStop} disabled={stopping}>
          <Square className="size-3.5" aria-hidden />
          중단
        </Button>
      ) : null}
    </div>
  )
}

/** Blinking caret "▍" (static under reduced motion via base CSS) */
export function StreamingCaret() {
  return (
    <span aria-hidden className="inline-block w-[0.5ch] animate-caret-blink text-ai">
      ▍
    </span>
  )
}

/**
 * One block: streaming → left ai border + caret; completed → chip skeleton;
 * validated → `children` (chips, C-08 badges) rendered by the caller. Provisional blocks
 * (streaming / completed) have no hover, edit or copy — callers render edit / copy controls only
 * for `state === "validated"` (v5.3 C-04).
 */
export function StreamingBlock({
  block,
  children,
  className,
}: {
  block: Pick<StreamBlock, "text" | "state">
  children?: React.ReactNode
  className?: string
}) {
  return (
    <div
      data-provisional={block.state === "validated" ? undefined : ""}
      className={cn("border-l-2 pl-3 transition-colors", block.state === "streaming" ? "border-ai" : "border-transparent", className)}
    >
      <p className="text-base leading-[1.75] whitespace-pre-wrap">
        {block.text}
        {block.state === "streaming" ? <StreamingCaret /> : null}
      </p>
      {block.state === "completed" ? <Skeleton className="mt-2 h-6 w-24" /> : null}
      {block.state === "validated" ? children : null}
    </div>
  )
}

/** Not-yet-started block placeholder (자소서 문항 등): 3-line skeleton */
export function PendingBlock({ className }: { className?: string }) {
  return (
    <div className={cn("space-y-2", className)} aria-hidden>
      <Skeleton className="h-4 w-full" />
      <Skeleton className="h-4 w-full" />
      <Skeleton className="h-4 w-2/3" />
    </div>
  )
}

/** Wrapper that sets aria-busy while streaming and announces completion once (A-6). */
export function StreamRegion({ status, children, className }: { status: StreamStatus; children: React.ReactNode; className?: string }) {
  return (
    <div className={className} aria-busy={status === "streaming"}>
      {children}
      <p className="sr-only" aria-live="polite">
        {status === "done" ? "작성이 끝났어요" : ""}
      </p>
    </div>
  )
}
