import { describe, expect, it } from "vitest"
import { jdRawEditReducer, jdRawEditView, jdRawFocusTarget } from "./jd-raw-edit-state"

/** UQ-608 (Q53 남은 것): focus never falls to <body> when the S-15 공고 원문 textarea closes */
describe("jdRawFocusTarget", () => {
  /** `serverEditable`: the read-back after the actions (false once the condition was taken away) */
  const after = (serverEditable: boolean, ...actions: Parameters<typeof jdRawEditReducer>[1][]) => {
    const s = actions.reduce(jdRawEditReducer, { editing: true, refused: false, saved: false })
    const v = jdRawEditView(s, serverEditable)
    return jdRawFocusTarget({ editing: v.editorOpen, editable: v.editable, saved: s.saved })
  }

  it("저장 → the saved note", () => expect(after(true, "saved")).toBe("note"))
  it("취소 → 공고 원문 고치기", () => expect(after(true, "stop")).toBe("button"))
  it("취소 after a refused save (no button) → the panel title", () => expect(after(false, "refused", "stop")).toBe("title"))
  it("nothing while the textarea is open", () => expect(after(true)).toBeNull())
})
