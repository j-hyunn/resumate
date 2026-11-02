import { describe, expect, it } from "vitest"
import { safeNextPath as contractSafeNextPath } from "@/lib/contracts/routes"
import { safeNextPath } from "./routes"

describe("safeNextPath (screens, QA-W5-08)", () => {
  it("keeps same-origin paths with their query and hash", () => {
    expect(safeNextPath("/career/skills?x=1#a")).toBe("/career/skills?x=1#a")
    expect(safeNextPath(["/board", "/career"])).toBe("/board")
  })
  it.each([
    ["//evil"],
    ["https://evil"],
    ["/\\evil"],
    ["/career\u0000"],
    ["/auth/callback?x=1"],
    ["/auth/callback"],
    ["/sign-in"],
    ["/sign-in?next=/career"],
    ["/consent?next=/career"],
    ["/consent/x"],
    ["/career/../sign-in"],
    [`/${"a".repeat(600)}`],
    [""],
  ])("refuses %j", (input) => {
    expect(safeNextPath(input)).toBeNull()
  })
  it("refuses non-strings", () => {
    expect(safeNextPath(undefined)).toBeNull()
    expect(safeNextPath(3)).toBeNull()
  })
  it("never lets through what the server's check refuses", () => {
    for (const input of ["/auth/callback?x=1", "//evil", "/\\evil", "/sign-in", `/${"a".repeat(600)}`]) {
      expect(contractSafeNextPath(input, "REFUSED")).toBe("REFUSED")
      expect(safeNextPath(input)).toBeNull()
    }
  })
})
