import { describe, expect, it } from "vitest"
import { safeNextPath as contractSafeNextPath } from "@/lib/contracts/routes"
import { MENU_ITEMS, menuKeyForPath, routes, safeNextPath } from "./routes"

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

describe("U36-1 자기소개서 삭제됨 S-22 (모의 면접 메뉴 아래)", () => {
  it("builds /interviews/{sessionId}/result", () => {
    expect(routes.interviewDeletedResult("ses-1")).toBe("/interviews/ses-1/result")
  })
  it("keeps live sessions under the application", () => {
    expect(routes.interviewResult("ap-1", "ses-1")).toBe("/applications/ap-1/interview/ses-1/result")
    expect(routes.interviewSession("ap-1", "ses-1")).toBe("/applications/ap-1/interview/ses-1")
  })
  it("is under the 모의 면접 menu", () => {
    expect(menuKeyForPath(routes.interviewDeletedResult("ses-1"))).toBe("interviews")
  })
})

describe("CR-23 menu label", () => {
  it("names the applications menu 자기소개서 관리", () => {
    expect(MENU_ITEMS.find((m) => m.key === "applications")?.label).toBe("자기소개서 관리")
  })
})
