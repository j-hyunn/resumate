import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { createPreservationStore, isRestorable, type StorageLike } from "./input-preservation"

function memory(initial: Record<string, string> = {}): StorageLike & { data: Record<string, string> } {
  const data = { ...initial }
  return {
    data,
    getItem: (k) => (k in data ? data[k] : null),
    setItem: (k, v) => void (data[k] = v),
    removeItem: (k) => void delete data[k],
  }
}

const KEY = "resumate:l02:project:p1"

beforeEach(() => vi.useFakeTimers())
afterEach(() => vi.useRealTimers())

describe("createPreservationStore (UQ-PA-1)", () => {
  it("the first clean render after reopening never deletes the previous visit's copy", () => {
    const s = memory({ [KEY]: JSON.stringify({ name: "이전 수정" }) })
    const store = createPreservationStore(() => s, KEY)
    expect(store.load()).toEqual({ name: "이전 수정" })
    store.write(null)
    vi.advanceTimersByTime(1000)
    expect(s.data[KEY]).toBeDefined()
  })

  it("until the page restores the copy, edits don't overwrite it", () => {
    const s = memory({ [KEY]: JSON.stringify({ name: "이전" }) })
    const store = createPreservationStore(() => s, KEY)
    store.load()
    store.write({ name: "새로 친 글자" })
    vi.advanceTimersByTime(1000)
    expect(JSON.parse(s.data[KEY])).toEqual({ name: "이전" })
  })

  it("auto-restore (resolve) → later writes go through; write(null) then removes this visit's copy", () => {
    const s = memory({ [KEY]: JSON.stringify({ name: "이전" }) })
    const store = createPreservationStore(() => s, KEY)
    store.load()
    store.resolve()
    store.write({ name: "이어서" })
    vi.advanceTimersByTime(600)
    expect(JSON.parse(s.data[KEY])).toEqual({ name: "이어서" })
    store.write(null)
    vi.advanceTimersByTime(600)
    expect(s.data[KEY]).toBeUndefined()
  })

  it("save / 저장하지 않고 나가기 (clear) always removes it", () => {
    const s = memory({ [KEY]: "{}" })
    const store = createPreservationStore(() => s, KEY)
    store.load()
    store.clear()
    expect(s.data[KEY]).toBeUndefined()
    expect(store.pending()).toBeNull()
  })

  it("dispose / flush writes the last debounced value at once (no lost keystrokes)", () => {
    const s = memory()
    const store = createPreservationStore(() => s, KEY, 500)
    store.load()
    store.write({ name: "마지막" })
    store.dispose()
    expect(JSON.parse(s.data[KEY])).toEqual({ name: "마지막" })
  })

  it("storage errors are swallowed (private mode / quota)", () => {
    const broken: StorageLike = {
      getItem: () => {
        throw new Error("denied")
      },
      setItem: () => {
        throw new Error("quota")
      },
      removeItem: () => {
        throw new Error("denied")
      },
    }
    const store = createPreservationStore(() => broken, KEY)
    expect(store.load()).toBeNull()
    store.write({ a: 1 })
    expect(() => store.flush()).not.toThrow()
    expect(() => store.clear()).not.toThrow()
  })
})

describe("isRestorable (U40-2)", () => {
  const T = "2026-11-05T01:02:03.456789+00:00"
  it("restores a copy edited on the current row version", () => {
    expect(isRestorable({ base_updated_at: T, values: {} }, T)).toBe(true)
    // the same instant in another text form
    expect(isRestorable({ base_updated_at: "2026-11-05T01:02:03.456Z" }, "2026-11-05T01:02:03.456+00:00")).toBe(true)
  })
  it("a new page's copy (base null) restores while the row still doesn't exist", () => {
    expect(isRestorable({ base_updated_at: null }, null)).toBe(true)
  })
  it("drops a copy when the row was saved elsewhere since", () => {
    expect(isRestorable({ base_updated_at: T }, "2026-11-05T09:00:00+00:00")).toBe(false)
    expect(isRestorable({ base_updated_at: null }, T)).toBe(false)
  })
  it("drops copies written without a base (older code) or malformed", () => {
    expect(isRestorable({ values: {} }, T)).toBe(false)
    expect(isRestorable({ values: {} }, null)).toBe(false)
    expect(isRestorable({ base_updated_at: 5 }, T)).toBe(false)
    expect(isRestorable(null, T)).toBe(false)
  })
})
