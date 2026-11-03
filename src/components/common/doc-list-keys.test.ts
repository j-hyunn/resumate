import { describe, expect, it } from "vitest"
import { MAX_INDENT, continueList, indentList } from "./doc-list-keys"

describe("continueList (Enter on a list line)", () => {
  it("continues a bullet with the same marker and indent", () => {
    const v = "  - 첫 항목"
    expect(continueList(v, v.length)).toEqual({ value: "  - 첫 항목\n  - ", caret: v.length + 5 })
  })
  it("numbers the next ordered item", () => {
    const v = "1. 하나"
    expect(continueList(v, v.length)?.value).toBe("1. 하나\n2. ")
  })
  it("Enter on an empty item removes the marker", () => {
    const v = "- 하나\n- "
    expect(continueList(v, v.length)).toEqual({ value: "- 하나\n", caret: 5 })
  })
  it("leaves non-list lines and selections to the default", () => {
    expect(continueList("문장", 2)).toBeNull()
    expect(continueList("- 하나", 2, 4)).toBeNull()
  })
})

describe("indentList (Tab / Shift+Tab) — never a keyboard trap (UQ-PA-5)", () => {
  it("indents a list line by 2", () => {
    expect(indentList("- 하나", 3, false)).toEqual({ value: "  - 하나", caret: 5 })
  })
  it("outdents by 2 (or 1)", () => {
    expect(indentList("  - 하나", 5, true)).toEqual({ value: "- 하나", caret: 3 })
    expect(indentList(" - 하나", 4, true)).toEqual({ value: "- 하나", caret: 3 })
  })
  it("Shift+Tab at column 0 does nothing → null (focus moves back)", () => {
    expect(indentList("- 하나", 3, true)).toBeNull()
  })
  it("Tab past the depth limit → null (focus moves on)", () => {
    const deep = `${" ".repeat(MAX_INDENT)}- 깊음`
    expect(indentList(deep, deep.length, false)).toBeNull()
  })
  it("non-list lines → null", () => {
    expect(indentList("문장", 1, false)).toBeNull()
    expect(indentList("문장", 1, true)).toBeNull()
  })
  it("works on the caret's line inside a multi-line value", () => {
    const v = "문장\n- 둘\n끝"
    expect(indentList(v, 5, false)?.value).toBe("문장\n  - 둘\n끝")
  })
})
