/**
 * 이탈 확인 (1.3a, UP-11) — the pure pieces behind `useLeaveGuard` (page-shell.tsx), unit-tested in
 * leave-guard.test.ts (UQ-423).
 *
 * - `createPopStateGuard`: browser 뒤로·앞으로. A capture listener on window runs before Next's router popstate
 *   listener. With unsaved edits it stops the router, steps back to this page's entry and asks; 나가기 then
 *   moves one step in the direction the user pressed.
 *   Direction (UQ-422): the Navigation API entry index where available; otherwise this shell's own stamp in
 *   `history.state` (`__l02Index`, set on mount, increasing in creation order = history order). When neither
 *   tells the direction (the destination entry was never stamped), the move is NOT blocked — the input
 *   preservation copy stays, so reopening the page restores it.
 * - `createClickGuard`: any other in-app `<a>` (C-10 돌아가기, C-02, panel links …), document click capture.
 * - `createBypass`: after the user chose to leave, guards stay open while the navigation starts, then re-arm.
 */

export const ENTRY_INDEX_KEY = "__l02Index"

export type PopDirection = "back" | "forward"

export function readEntryIndex(state: unknown): number | undefined {
  if (!state || typeof state !== "object") return undefined
  const v = (state as Record<string, unknown>)[ENTRY_INDEX_KEY]
  return typeof v === "number" && Number.isFinite(v) ? v : undefined
}

export function popDirection(from: number | undefined, to: number | undefined): PopDirection | null {
  if (from === undefined || to === undefined || from === to) return null
  return to > from ? "forward" : "back"
}

export interface PopEventLike {
  state: unknown
  stopImmediatePropagation(): void
}

export interface PopStateGuardDeps {
  /** unsaved edits and not bypassed */
  isBlocked: () => boolean
  /** Navigation API index of the current entry (after a pop: the destination); undefined without the API */
  navigationIndex: () => number | undefined
  history: { back(): void; forward(): void }
  /** open the leave dialog; `leave` = 나가기 (one step in the pressed direction) */
  ask: (leave: () => void) => void
}

/** @param initialIndex this entry's index (Navigation API) or stamp (see `stampEntry`) */
export function createPopStateGuard(deps: PopStateGuardDeps, initialIndex: number | undefined): (e: PopEventLike) => void {
  let index = initialIndex
  let restoring = false
  return (e) => {
    if (restoring) {
      // our own step back to this entry: the router never sees it
      restoring = false
      e.stopImmediatePropagation()
      return
    }
    const now = deps.navigationIndex() ?? readEntryIndex(e.state)
    if (!deps.isBlocked()) {
      index = now
      return
    }
    const dir = popDirection(index, now)
    if (dir === null) {
      // direction unknown: let it go (the preserved copy restores on reopen)
      index = now
      return
    }
    e.stopImmediatePropagation()
    restoring = true
    if (dir === "forward") deps.history.back()
    else deps.history.forward()
    deps.ask(() => (dir === "forward" ? deps.history.forward() : deps.history.back()))
  }
}

export interface HistoryLike {
  state: unknown
  replaceState(data: unknown, unused: string): void
}

/**
 * Without the Navigation API: give this entry an increasing stamp (kept when it already has one, e.g. after a
 * reload) and return it. Entries are created in history order, so a later stamp = a later entry.
 */
export function stampEntry(history: HistoryLike, now: () => number = Date.now): number {
  const existing = readEntryIndex(history.state)
  if (existing !== undefined) return existing
  const stamp = now()
  const base = history.state && typeof history.state === "object" ? (history.state as Record<string, unknown>) : {}
  history.replaceState({ ...base, [ENTRY_INDEX_KEY]: stamp }, "")
  return stamp
}

export interface ClickLike {
  defaultPrevented: boolean
  button: number
  metaKey: boolean
  ctrlKey: boolean
  shiftKey: boolean
  altKey: boolean
  target: unknown
}

interface AnchorLike {
  href: string
  target: string
  hasAttribute(name: string): boolean
  dataset: { leaveGuard?: string }
}

/** The in-app path a plain left click on a link would go to; null = not a leave (or not ours to guard). */
export function guardableHref(e: ClickLike, here: { href: string; origin: string; pathname: string; search: string }): string | null {
  if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return null
  const t = e.target as { closest?: (sel: string) => AnchorLike | null } | null
  const a = typeof t?.closest === "function" ? t.closest("a[href]") : null
  if (!a || a.target === "_blank" || a.hasAttribute("download") || a.dataset.leaveGuard === "skip") return null
  const url = new URL(a.href, here.href)
  if (url.origin !== here.origin) return null
  // same page (hash only to this path + query) isn't a leave
  if (url.pathname === here.pathname && url.search === here.search) return null
  return url.pathname + url.search + url.hash
}

export function createClickGuard(deps: {
  isBlocked: () => boolean
  here: () => { href: string; origin: string; pathname: string; search: string }
  ask: (href: string) => void
}): (e: ClickLike & { preventDefault(): void; stopPropagation(): void }) => void {
  return (e) => {
    if (!deps.isBlocked()) return
    const href = guardableHref(e, deps.here())
    if (!href) return
    e.preventDefault()
    e.stopPropagation()
    deps.ask(href)
  }
}

/** `open()` lets navigation through for `ms`, then guards re-arm (an in-page callback may keep the page). */
export function createBypass(
  ms = 1500,
  timers: { set: (fn: () => void, ms: number) => unknown; clear: (id: unknown) => void } = {
    set: (fn, t) => setTimeout(fn, t),
    clear: (id) => clearTimeout(id as ReturnType<typeof setTimeout>),
  },
) {
  let active = false
  let timer: unknown = null
  return {
    get active() {
      return active
    },
    open() {
      active = true
      if (timer !== null) timers.clear(timer)
      timer = timers.set(() => {
        active = false
        timer = null
      }, ms)
    },
    /** stays open (a full reload follows) */
    hold() {
      active = true
      if (timer !== null) timers.clear(timer)
      timer = null
    },
  }
}
