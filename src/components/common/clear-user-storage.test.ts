import { describe, expect, it } from "vitest"
import { clearUserUnsavedInput } from "./clear-user-storage"

function memory(initial: Record<string, string>) {
  const data = { ...initial }
  return {
    data,
    get length() {
      return Object.keys(data).length
    },
    key: (i: number) => Object.keys(data)[i] ?? null,
    removeItem: (k: string) => void delete data[k],
  }
}

describe("clearUserUnsavedInput (U40-1)", () => {
  it("removes L-02 copies, the S-14 draft and return targets; keeps display preferences", () => {
    const local = memory({
      "resumate:l02:project:p1": "{}",
      "resumate:l02:deliverable:pr1:new": "{}",
      "resumate:ai-panel:width": "420",
      "resumate-theme": "dark",
    })
    const session = memory({
      "resumate.a3.new-application.list": "{}",
      "resumate.a3.new-application.board": "{}",
      "resumate.return-target": "{}",
      "resumate.nav-origin": "{}",
      "resumate.ai-return-target": "{}",
      "resumate.ai-return-params": "{}",
      "other.key": "x",
    })
    clearUserUnsavedInput({ local: () => local, session: () => session })
    expect(Object.keys(local.data).sort()).toEqual(["resumate-theme", "resumate:ai-panel:width"])
    expect(Object.keys(session.data)).toEqual(["other.key"])
  })

  it("never throws when storage is blocked", () => {
    const boom = () => {
      throw new Error("SecurityError")
    }
    expect(() => clearUserUnsavedInput({ local: boom, session: boom })).not.toThrow()
    const removeFails = { length: 1, key: () => "resumate:l02:project:p1", removeItem: boom }
    expect(() => clearUserUnsavedInput({ local: () => removeFails })).not.toThrow()
  })
})
