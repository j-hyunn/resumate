import { describe, expect, it } from "vitest"
import { keepsFormDraftOnLeave } from "./form-draft"

/** UX S-14 입력 보존 (QA 17 B-6): kept only when leaving for the key swap / AI 연결 back to this screen */
describe("keepsFormDraftOnLeave", () => {
  it("keeps the form when the AI 연결 return target is this screen (query ignored)", () => {
    expect(keepsFormDraftOnLeave("/applications/new", "/applications/new")).toBe(true)
    expect(keepsFormDraftOnLeave("/applications/new?from=board", "/applications/new")).toBe(true)
  })

  it("drops it on any other way out", () => {
    expect(keepsFormDraftOnLeave(null, "/applications/new")).toBe(false)
    expect(keepsFormDraftOnLeave(undefined, "/applications/new")).toBe(false)
    expect(keepsFormDraftOnLeave("/applications/abc/drafts", "/applications/new")).toBe(false)
  })
})
