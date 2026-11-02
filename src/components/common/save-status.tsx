"use client"

/**
 * C-06 저장 상태 + useAutosave (patterns.md §4, design-system 3.6).
 *
 *   const autosave = useAutosave({ save: (values) => saveExperienceAction(id, values) })
 *   onChange → autosave.schedule(values); onBlur → autosave.flush()
 *   <SaveStatus state={autosave.state} savedAt={autosave.savedAt} onRetry={autosave.retry} />
 *   {row.status === "draft" && <DraftNotice />}
 */
import * as React from "react"
import { Check, CircleAlert, CircleDashed, Loader2, TriangleAlert } from "lucide-react"
import { cn } from "@/lib/utils"
import { Alert, AlertTitle } from "@/components/ui/alert"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { formatTime } from "@/lib/data/labels"

export type SaveState = "idle" | "saving" | "saved" | "failed"

export function SaveStatus({
  state,
  savedAt,
  onRetry,
  className,
}: {
  state: SaveState
  savedAt?: Date | string | null
  onRetry?: () => void
  className?: string
}) {
  return (
    <p className={cn("flex items-center gap-1.5 text-sm leading-5", className)} aria-live="polite">
      {state === "saving" ? (
        <>
          <Loader2 className="size-3.5 animate-spin text-muted-foreground" aria-hidden />
          <span className="text-muted-foreground">저장 중…</span>
        </>
      ) : state === "saved" && savedAt ? (
        <>
          <Check className="size-3.5 text-success" aria-hidden />
          <span className="text-muted-foreground tabular-nums">저장됨 {formatTime(savedAt)}</span>
        </>
      ) : state === "failed" ? (
        <>
          <CircleAlert className="size-3.5 text-destructive" aria-hidden />
          <span className="text-destructive">저장 실패 —</span>
          <Button variant="link" size="sm" className="h-auto px-0 text-destructive" onClick={onRetry}>
            다시 시도
          </Button>
        </>
      ) : null}
    </p>
  )
}

/** 제목 옆 "작성 중" 배지 */
export function DraftBadge({ label = "작성 중", className }: { label?: string; className?: string }) {
  return (
    <Badge variant="draft" className={className}>
      <CircleDashed aria-hidden />
      {label}
    </Badge>
  )
}

/** status = 'draft' 안내 한 줄 */
export function DraftNotice({ className }: { className?: string }) {
  return (
    <Alert variant="warning" className={className}>
      <TriangleAlert aria-hidden />
      <AlertTitle className="font-normal">작성 중 — 필수 항목을 채우면 AI 분석에 반영돼요</AlertTitle>
    </Alert>
  )
}

export interface UseAutosaveOptions<T> {
  save: (values: T) => Promise<unknown>
  /** debounce after the last change (default 800ms) */
  delayMs?: number
}

export interface UseAutosaveResult<T> {
  state: SaveState
  savedAt: Date | null
  /** debounce a save with the latest values */
  schedule: (values: T) => void
  /** save now (blur / before navigation) */
  flush: () => Promise<void>
  retry: () => Promise<void>
}

/**
 * Serialized autosave (UQ-1, UQ-2):
 * - one save in flight at a time; changes made meanwhile are coalesced and sent next,
 *   so the last input is always the final stored value
 * - pending input is flushed on unmount (in-app navigation, Activity hidden),
 *   on `pagehide` and when the tab becomes hidden — never dropped
 * - beforeunload warns only while a save is pending / in flight / failed
 */
export function useAutosave<T>({ save, delayMs = 800 }: UseAutosaveOptions<T>): UseAutosaveResult<T> {
  const [state, setState] = React.useState<SaveState>("idle")
  const [savedAt, setSavedAt] = React.useState<Date | null>(null)
  const pending = React.useRef<T | null>(null)
  const last = React.useRef<T | null>(null)
  const inFlight = React.useRef<Promise<void> | null>(null)
  const failed = React.useRef(false)
  const timer = React.useRef<ReturnType<typeof setTimeout> | null>(null)
  const mounted = React.useRef(true)
  const saveRef = React.useRef(save)
  React.useEffect(() => {
    saveRef.current = save
  })

  const setStateSafe = React.useCallback((s: SaveState) => {
    if (mounted.current) setState(s)
  }, [])

  /** Drain the queue: save the latest pending value, repeat while new input arrived. */
  const drain = React.useCallback((): Promise<void> => {
    if (inFlight.current) return inFlight.current
    const loop = async () => {
      while (pending.current !== null) {
        const values = pending.current
        pending.current = null
        last.current = values
        setStateSafe("saving")
        try {
          await saveRef.current(values)
          failed.current = false
          if (mounted.current) setSavedAt(new Date())
          if (pending.current === null) setStateSafe("saved")
        } catch {
          failed.current = true
          // `last` keeps the failed value for retry(); newer input waits in `pending`
          setStateSafe("failed") // input values stay as they are (ST-SAVE-FAILED)
          return
        }
      }
    }
    const p = loop().finally(() => {
      inFlight.current = null
    })
    inFlight.current = p
    return p
  }, [setStateSafe])

  const flush = React.useCallback(async () => {
    if (timer.current) clearTimeout(timer.current)
    timer.current = null
    await drain()
  }, [drain])

  const schedule = React.useCallback(
    (values: T) => {
      pending.current = values
      if (timer.current) clearTimeout(timer.current)
      timer.current = setTimeout(() => void flush(), delayMs)
    },
    [delayMs, flush],
  )

  const retry = React.useCallback(async () => {
    if (pending.current === null && last.current !== null) pending.current = last.current
    await drain()
  }, [drain])

  React.useEffect(() => {
    mounted.current = true
    const flushNow = () => void flush()
    const onVisibility = () => {
      if (document.visibilityState === "hidden") flushNow()
    }
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      if (inFlight.current || failed.current || pending.current !== null) e.preventDefault()
    }
    window.addEventListener("pagehide", flushNow)
    document.addEventListener("visibilitychange", onVisibility)
    window.addEventListener("beforeunload", onBeforeUnload)
    return () => {
      window.removeEventListener("pagehide", flushNow)
      document.removeEventListener("visibilitychange", onVisibility)
      window.removeEventListener("beforeunload", onBeforeUnload)
      mounted.current = false
      // unmount: save whatever is still pending instead of dropping it
      if (timer.current) clearTimeout(timer.current)
      timer.current = null
      if (pending.current !== null) void drain()
    }
  }, [flush, drain])

  return { state, savedAt, schedule, flush, retry }
}
