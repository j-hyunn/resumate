import { describe, expect, it } from "vitest"
import { sessionHref } from "./session-status"

describe("sessionHref (S-20 / S-37 row target)", () => {
  it("U36-1: a 자기소개서 삭제됨 session opens S-22 under 모의 면접", () => {
    expect(sessionHref({ id: "ses-1", application_project_id: "", status: "completed", application_deleted: true })).toBe("/interviews/ses-1/result")
  })
  it("live sessions keep their 자기소개서 URLs", () => {
    expect(sessionHref({ id: "ses-1", application_project_id: "ap-1", status: "in_progress" })).toBe("/applications/ap-1/interview/ses-1")
    expect(sessionHref({ id: "ses-1", application_project_id: "ap-1", status: "completed" })).toBe("/applications/ap-1/interview/ses-1/result")
  })
})
