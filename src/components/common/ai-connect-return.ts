"use client"

/**
 * FL-19 복귀 대상 `ai_return_target` (browser session, separate from the C-10 career return target).
 *
 * - C-18 "AI 연결하기" → markAiConnectReturn({ href, feature_label }) then navigates to S-40 / S-41.
 * - S-41 (A1) on successful connect → completeAiConnectReturn() returns the href to go back to
 *   (null → stay on S-40) and leaves a one-time "connected" marker for that pathname.
 * - The original screen's AiRunButton / AiLock calls useAiConnectedHighlight() → ring 4s + toast
 *   (D-UX-16, no auto-run). Ids / paths only, nothing personal.
 */
import * as React from "react"

const RETURN_KEY = "resumate.ai-return-target"
const CONNECTED_KEY = "resumate.ai-connected"
const PARAMS_KEY = "resumate.ai-return-params"

export interface AiReturnTarget {
  /** pathname + query of the screen to come back to (restores 진행 중 설정 via its own query) */
  href: string
  /** 기능 이름 for the S-41 "{기능}으로 돌아가기" button */
  feature_label?: string
  /**
   * 진행 중 설정 to restore on return (FL-19 "설정 복원", UQ-351/352): ids and choices only,
   * e.g. S-36 start `{ affiliation, experience_id }`.
   */
  params?: Record<string, unknown>
  created_at: string
}

function safeSession(): Storage | null {
  try {
    return typeof window === "undefined" ? null : window.sessionStorage
  } catch {
    return null
  }
}

/** Defaults to the current location. */
export function markAiConnectReturn(target?: { href?: string; feature_label?: string; params?: Record<string, unknown> }): void {
  const href = target?.href ?? `${window.location.pathname}${window.location.search}`
  safeSession()?.setItem(
    RETURN_KEY,
    JSON.stringify({ href, feature_label: target?.feature_label, params: target?.params, created_at: new Date().toISOString() }),
  )
}

export function readAiConnectReturn(): AiReturnTarget | null {
  const raw = safeSession()?.getItem(RETURN_KEY)
  if (!raw) return null
  try {
    return JSON.parse(raw) as AiReturnTarget
  } catch {
    return null
  }
}

/** S-41 취소 / 뒤로: drop the target without the connected marker */
export function clearAiConnectReturn(): void {
  safeSession()?.removeItem(RETURN_KEY)
}

/** S-41 연결 성공: returns where to go (null → S-40) and arms the highlight on that screen */
export function completeAiConnectReturn(): string | null {
  const t = readAiConnectReturn()
  clearAiConnectReturn()
  if (!t) return null
  const path = t.href.split(/[?#]/)[0]
  safeSession()?.setItem(CONNECTED_KEY, path)
  if (t.params) safeSession()?.setItem(PARAMS_KEY, JSON.stringify({ path, params: t.params }))
  return t.href
}

/**
 * True if this pathname was just returned to after connecting, **without** consuming the marker
 * (AiRunButton consumes it for the ring + toast). A3 request: S-17 opens the right step.
 */
export function peekAiConnected(pathname: string = typeof window === "undefined" ? "" : window.location.pathname): boolean {
  const p = safeSession()?.getItem(CONNECTED_KEY)
  return !!p && p === pathname
}

/** One-time: true if this pathname was just returned to after connecting (consumes the marker). */
export function consumeAiConnected(pathname: string): boolean {
  const s = safeSession()
  const p = s?.getItem(CONNECTED_KEY)
  if (!p || p !== pathname) return false
  s?.removeItem(CONNECTED_KEY)
  return true
}

/**
 * Returns true for 4 s after landing back on the screen (ring-2 ring-primary ring-offset-2).
 * The caller shows the toast once via `onArrive`.
 */
export function useAiConnectedHighlight(onArrive?: () => void): boolean {
  const [on, setOn] = React.useState(false)
  const cb = React.useRef(onArrive)
  React.useEffect(() => {
    cb.current = onArrive
  })
  React.useEffect(() => {
    if (!consumeAiConnected(window.location.pathname)) return
    // marker consumed once per landing; state set from a storage read, not derived from props
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setOn(true)
    cb.current?.()
    const t = setTimeout(() => setOn(false), 4000)
    return () => clearTimeout(t)
  }, [])
  return on
}

/**
 * After the FL-19 round trip: the `params` the C-18 click stored for this pathname, once (then
 * cleared). Call in an effect on the original screen and restore its choices (UQ-351 / UQ-352).
 */
export function consumeAiReturnParams(pathname: string = typeof window === "undefined" ? "" : window.location.pathname): Record<string, unknown> | null {
  const s = safeSession()
  const raw = s?.getItem(PARAMS_KEY)
  if (!raw) return null
  try {
    const v = JSON.parse(raw) as { path: string; params: Record<string, unknown> }
    if (v.path !== pathname) return null
    s?.removeItem(PARAMS_KEY)
    return v.params
  } catch {
    return null
  }
}

/** ring classes for the unlocked run button (3.18) */
export const AI_CONNECTED_RING = "ring-2 ring-primary ring-offset-2 ring-offset-background"
