import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { CAREER_SAVED_EVENT, afterCareerItemSaved, markCareerReturn, readCareerReturn, readNavOrigin, setNavOrigin } from "./return-target"

function fakeWindow() {
  const data: Record<string, string> = {}
  const target = new EventTarget()
  const events: string[] = []
  const w = Object.assign(target, {
    sessionStorage: {
      getItem: (k: string) => (k in data ? data[k] : null),
      setItem: (k: string, v: string) => void (data[k] = v),
      removeItem: (k: string) => void delete data[k],
    },
  })
  const dispatch = target.dispatchEvent.bind(target)
  w.dispatchEvent = (e: Event) => {
    events.push(e.type)
    return dispatch(e)
  }
  return { w, events }
}

let env: ReturnType<typeof fakeWindow>
beforeEach(() => {
  env = fakeWindow()
  vi.stubGlobal("window", env.w)
})
afterEach(() => vi.unstubAllGlobals())

const TARGET = { application_project_id: "a1", feature: "insight" as const, application_name: "회사 – 포지션", href: "/applications/a1" }

describe("afterCareerItemSaved (UQ-420, FL-13 D0 → D1)", () => {
  it("an experience added from the C-09 gate is recorded on the return target, then C-10 re-judges", () => {
    markCareerReturn(TARGET)
    env.events.length = 0
    afterCareerItemSaved({ kind: "experience", id: "e9", created: true })
    expect(readCareerReturn()?.experience_id).toBe("e9")
    expect(env.events).toEqual(["resumate:return-target", CAREER_SAVED_EVENT])
  })

  it("edits and other kinds only re-judge", () => {
    markCareerReturn(TARGET)
    env.events.length = 0
    afterCareerItemSaved({ kind: "experience", id: "e1", created: false })
    afterCareerItemSaved({ kind: "education", id: "d1", created: true })
    expect(readCareerReturn()?.experience_id).toBeUndefined()
    expect(env.events).toEqual([CAREER_SAVED_EVENT, CAREER_SAVED_EVENT])
  })

  it("without a return target nothing is recorded", () => {
    afterCareerItemSaved({ kind: "experience", id: "e9", created: true })
    expect(readCareerReturn()).toBeNull()
    expect(env.events).toEqual([CAREER_SAVED_EVENT])
  })
})

describe("readNavOrigin (UQ-44-1)", () => {
  const KEY = "resumate.nav-origin"
  it("returns board for the same 자기소개서 only", () => {
    setNavOrigin("board", "a1")
    expect(readNavOrigin("a1")).toBe("board")
    expect(readNavOrigin("a2")).toBeNull()
  })
  it("drops a value left by an older build (\"interviews\") and clears it", () => {
    window.sessionStorage.setItem(KEY, JSON.stringify({ origin: "interviews", application_project_id: "a1" }))
    expect(readNavOrigin("a1")).toBeNull()
    expect(window.sessionStorage.getItem(KEY)).toBeNull()
  })
  it("drops broken JSON", () => {
    window.sessionStorage.setItem(KEY, "{")
    expect(readNavOrigin("a1")).toBeNull()
    expect(window.sessionStorage.getItem(KEY)).toBeNull()
  })
})
