import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import {
  ENTRY_INDEX_KEY,
  createBypass,
  createClickGuard,
  createPopStateGuard,
  guardableHref,
  popDirection,
  stampEntry,
  type ClickLike,
} from "./leave-guard"

function pop(state: unknown = null) {
  return { state, stopImmediatePropagation: vi.fn() }
}

function setup(opts: { blocked?: boolean; nav?: () => number | undefined; initial?: number } = {}) {
  let blocked = opts.blocked ?? true
  const history = { back: vi.fn(), forward: vi.fn() }
  const ask = vi.fn<(leave: () => void) => void>()
  const handler = createPopStateGuard(
    { isBlocked: () => blocked, navigationIndex: opts.nav ?? (() => undefined), history, ask },
    opts.initial ?? 5,
  )
  return { handler, history, ask, setBlocked: (b: boolean) => (blocked = b) }
}

describe("createPopStateGuard (UQ-423, UP-11 뒤로·앞으로)", () => {
  it("with unsaved edits, 뒤로 stops the router, steps forward back to this entry and asks; 나가기 = back", () => {
    let navIndex = 4
    const { handler, history, ask } = setup({ nav: () => navIndex })
    const e = pop()
    handler(e)
    expect(e.stopImmediatePropagation).toHaveBeenCalled()
    expect(history.forward).toHaveBeenCalledTimes(1)
    expect(ask).toHaveBeenCalledTimes(1)
    // our own restoring pop is swallowed too
    navIndex = 5
    const restoring = pop()
    handler(restoring)
    expect(restoring.stopImmediatePropagation).toHaveBeenCalled()
    expect(ask).toHaveBeenCalledTimes(1)
    // 나가기
    ask.mock.calls[0][0]()
    expect(history.back).toHaveBeenCalledTimes(1)
  })

  it("앞으로 (Navigation API) restores with back and 나가기 goes forward", () => {
    const { handler, history, ask } = setup({ nav: () => 6 })
    handler(pop())
    expect(history.back).toHaveBeenCalledTimes(1)
    ask.mock.calls[0][0]()
    expect(history.forward).toHaveBeenCalledTimes(1)
  })

  it("without the Navigation API, the direction comes from the entry stamp (UQ-422)", () => {
    const { handler, history, ask } = setup({ initial: 1000 })
    const e = pop({ [ENTRY_INDEX_KEY]: 2000 })
    handler(e)
    expect(e.stopImmediatePropagation).toHaveBeenCalled()
    expect(history.back).toHaveBeenCalledTimes(1)
    ask.mock.calls[0][0]()
    expect(history.forward).toHaveBeenCalledTimes(1)
  })

  it("direction unknown (unstamped destination, no Navigation API): not blocked", () => {
    const { handler, history, ask } = setup({ initial: 1000 })
    const e = pop({ __NA: true })
    handler(e)
    expect(e.stopImmediatePropagation).not.toHaveBeenCalled()
    expect(history.back).not.toHaveBeenCalled()
    expect(history.forward).not.toHaveBeenCalled()
    expect(ask).not.toHaveBeenCalled()
  })

  it("no unsaved edits (or bypassed): the router gets the popstate", () => {
    const { handler, ask } = setup({ blocked: false, nav: () => 4 })
    const e = pop()
    handler(e)
    expect(e.stopImmediatePropagation).not.toHaveBeenCalled()
    expect(ask).not.toHaveBeenCalled()
  })
})

describe("popDirection / stampEntry", () => {
  it("compares indexes", () => {
    expect(popDirection(3, 2)).toBe("back")
    expect(popDirection(3, 4)).toBe("forward")
    expect(popDirection(3, 3)).toBeNull()
    expect(popDirection(undefined, 2)).toBeNull()
    expect(popDirection(3, undefined)).toBeNull()
  })

  it("stamps the entry once, keeping the router's state", () => {
    const h = { state: { __NA: true } as unknown, replaceState: vi.fn((d: unknown) => void (h.state = d)) }
    expect(stampEntry(h, () => 42)).toBe(42)
    expect(h.state).toEqual({ __NA: true, [ENTRY_INDEX_KEY]: 42 })
    expect(stampEntry(h, () => 99)).toBe(42)
    expect(h.replaceState).toHaveBeenCalledTimes(1)
  })
})

const HERE = { href: "http://localhost/career/projects/p1?chat=c1", origin: "http://localhost", pathname: "/career/projects/p1", search: "?chat=c1" }

function click(href: string | null, extra: Partial<ClickLike> & { attrs?: Record<string, string>; target?: string } = {}) {
  const anchor =
    href === null
      ? null
      : {
          href: new URL(href, HERE.href).href,
          target: extra.target ?? "",
          hasAttribute: (n: string) => Boolean(extra.attrs && n in extra.attrs),
          dataset: { leaveGuard: extra.attrs?.["data-leave-guard"] },
        }
  return {
    defaultPrevented: false,
    button: 0,
    metaKey: false,
    ctrlKey: false,
    shiftKey: false,
    altKey: false,
    ...extra,
    target: { closest: () => anchor },
    preventDefault: vi.fn(),
    stopPropagation: vi.fn(),
  }
}

describe("guardableHref / createClickGuard (UQ-423)", () => {
  it("in-app link to another path is a leave", () => {
    expect(guardableHref(click("/career?item=experience:e1"), HERE)).toBe("/career?item=experience:e1")
  })

  it("same path + same query (hash only) is not a leave; same path with another query is", () => {
    expect(guardableHref(click("/career/projects/p1?chat=c1#x"), HERE)).toBeNull()
    expect(guardableHref(click("/career/projects/p1?chat=c2"), HERE)).toBe("/career/projects/p1?chat=c2")
  })

  it("ignores modified clicks, new tabs, downloads, external links and opted-out links", () => {
    expect(guardableHref(click("/career", { metaKey: true }), HERE)).toBeNull()
    expect(guardableHref(click("/career", { button: 1 }), HERE)).toBeNull()
    expect(guardableHref(click("/career", { target: "_blank" }), HERE)).toBeNull()
    expect(guardableHref(click("/file", { attrs: { download: "" } }), HERE)).toBeNull()
    expect(guardableHref(click("https://example.com/x"), HERE)).toBeNull()
    expect(guardableHref(click("/career", { attrs: { "data-leave-guard": "skip" } }), HERE)).toBeNull()
    expect(guardableHref(click(null), HERE)).toBeNull()
  })

  it("dirty → prevents the click and asks; clean → does nothing", () => {
    let blocked = true
    const ask = vi.fn()
    const handler = createClickGuard({ isBlocked: () => blocked, here: () => HERE, ask })
    const e = click("/career")
    handler(e)
    expect(e.preventDefault).toHaveBeenCalled()
    expect(e.stopPropagation).toHaveBeenCalled()
    expect(ask).toHaveBeenCalledWith("/career")
    blocked = false
    const e2 = click("/career")
    handler(e2)
    expect(e2.preventDefault).not.toHaveBeenCalled()
    expect(ask).toHaveBeenCalledTimes(1)
  })
})

describe("createBypass", () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  it("open() lets navigation through, then re-arms", () => {
    const b = createBypass(1500)
    expect(b.active).toBe(false)
    b.open()
    expect(b.active).toBe(true)
    vi.advanceTimersByTime(1499)
    expect(b.active).toBe(true)
    vi.advanceTimersByTime(1)
    expect(b.active).toBe(false)
  })

  it("hold() stays open (reload follows)", () => {
    const b = createBypass(1500)
    b.open()
    b.hold()
    vi.advanceTimersByTime(5000)
    expect(b.active).toBe(true)
  })
})
