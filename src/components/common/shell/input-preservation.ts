/**
 * 입력 보존 store (UX-7, UX 1.3a "입력 보존") — pure logic behind `useInputPreservation`, unit-tested
 * (input-preservation.test.ts). Browser storage only, never the URL.
 *
 * Contract (QA UQ-PA-1, UP-11 자동 복원, U40-2):
 * - What a previous visit left is `pending` from `load()` until the page restores it (`resolve()`, right after
 *   hydration — there is no restore banner) or drops it (`clear()`). While pending, nothing writes over it or
 *   removes it.
 * - The page restores a copy only when `isRestorable(copy, row.updated_at)`: the copy carries the row version it
 *   was edited on (`base_updated_at`; null for a new page). A row saved elsewhere since then — or a copy without
 *   a base (older code) — is dropped silently and the saved row shows (U40-2, 2026-11-05).
 * - `write(null)` ("no unsaved edits now") removes the stored copy only if this visit wrote one — the first
 *   clean render after opening never deletes a previous visit's copy.
 * - `clear()` (save success / "저장하지 않고 나가기" / "새로 불러오기" / stale copy) always removes it.
 * - `flush()` writes a debounced value now (unmount, `pagehide`) so the last keystrokes aren't lost.
 */

/** Every stored copy carries the row version it was edited on (U40-2). */
export interface VersionedCopy {
  /** the row's `updated_at` the edits started from; null = a new page (no row yet) */
  base_updated_at: string | null
}

function sameVersion(a: string | null, b: string | null): boolean {
  if (a === null || b === null) return a === b
  if (a === b) return true
  // the same instant may come back in another text form (read query vs save RPC)
  const ta = Date.parse(a)
  const tb = Date.parse(b)
  return !Number.isNaN(ta) && ta === tb
}

/**
 * U40-2: restore only a copy edited on the row version that is current now. Copies without `base_updated_at`
 * (written before 2026-11-05) are stale.
 */
export function isRestorable(copy: unknown, currentUpdatedAt: string | null): boolean {
  if (!copy || typeof copy !== "object" || !("base_updated_at" in copy)) return false
  const base = (copy as { base_updated_at: unknown }).base_updated_at
  if (base !== null && typeof base !== "string") return false
  return sameVersion(base, currentUpdatedAt)
}

export interface StorageLike {
  getItem(key: string): string | null
  setItem(key: string, value: string): void
  removeItem(key: string): void
}

export interface PreservationStore<T> {
  /** read the previous visit's copy (call once after hydration) */
  load(): T | null
  /** the previous visit's copy, until the page restores (`resolve`) or drops (`clear`) it */
  pending(): T | null
  write(value: T | null): void
  flush(): void
  clear(): void
  /** the page applied the copy after hydration (auto-restore, UP-11); later writes go through again */
  resolve(): void
  dispose(): void
}

type Timer = ReturnType<typeof setTimeout>

export function createPreservationStore<T>(storage: () => StorageLike | null, key: string, delayMs = 500): PreservationStore<T> {
  let pendingValue: T | null = null
  let wroteThisVisit = false
  let timer: Timer | null = null
  let queued: { value: T | null } | null = null

  const safe = (fn: (s: StorageLike) => void) => {
    try {
      const s = storage()
      if (s) fn(s)
    } catch {
      // quota / private mode: the edits stay on screen
    }
  }
  const commit = () => {
    timer = null
    const q = queued
    queued = null
    if (!q || pendingValue !== null) return
    if (q.value === null) {
      if (wroteThisVisit) safe((s) => s.removeItem(key))
      wroteThisVisit = false
    } else {
      const json = JSON.stringify(q.value)
      safe((s) => s.setItem(key, json))
      wroteThisVisit = true
    }
  }

  return {
    load() {
      let value: T | null = null
      safe((s) => {
        const raw = s.getItem(key)
        value = raw ? (JSON.parse(raw) as T) : null
      })
      pendingValue = value
      return value
    },
    pending: () => pendingValue,
    write(value) {
      if (pendingValue !== null) return
      queued = { value }
      if (timer) clearTimeout(timer)
      timer = setTimeout(commit, delayMs)
    },
    flush() {
      if (timer) clearTimeout(timer)
      commit()
    },
    clear() {
      if (timer) clearTimeout(timer)
      timer = null
      queued = null
      pendingValue = null
      wroteThisVisit = false
      safe((s) => s.removeItem(key))
    },
    resolve() {
      // the restored values are now the page's unsaved edits: the next write keeps them
      pendingValue = null
      wroteThisVisit = true
    },
    dispose() {
      if (timer) clearTimeout(timer)
      commit()
    },
  }
}
