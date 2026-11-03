/**
 * 입력 보존 store (UX-7, UX 1.3a "입력 보존") — pure logic behind `useInputPreservation`, unit-tested
 * (input-preservation.test.ts). Browser storage only, never the URL.
 *
 * Contract (QA UQ-PA-1):
 * - What a previous visit left is `pending` until the user answers the restore banner. While pending,
 *   nothing writes over it or removes it (closing the tab before answering keeps it).
 * - `write(null)` ("no unsaved edits now") removes the stored copy only if this visit wrote one — the first
 *   clean render after opening never deletes a previous visit's copy.
 * - `clear()` (save success / "저장하지 않고 나가기" / "버리기") always removes it.
 * - `flush()` writes a debounced value now (unmount, `pagehide`) so the last keystrokes aren't lost.
 */

export interface StorageLike {
  getItem(key: string): string | null
  setItem(key: string, value: string): void
  removeItem(key: string): void
}

export interface PreservationStore<T> {
  /** read the previous visit's copy (call once after hydration) */
  load(): T | null
  /** the copy waiting for the banner answer */
  pending(): T | null
  write(value: T | null): void
  flush(): void
  clear(): void
  /** "이어서 편집": the page applied the copy; later writes go through again */
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
