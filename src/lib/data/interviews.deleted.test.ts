import { beforeEach, describe, expect, it, vi } from "vitest"
import { createFixtures, DELETED_AP_N, type MockDb } from "@/lib/mock/fixtures"
import { IDS } from "@/lib/mock/ids"

/**
 * OD-I6 mock mapping (DM v4.11 11.6 #1~#6): a kept session of a deleted 자기소개서 reads as application_deleted with
 * the snapshot name, is found under the "deleted" route segment only, and the "삭제된 자기소개서" filter.
 * Also OD-I1: submitting with every question blank scores the session 0 / 100 (not not_scored).
 */
const store = vi.hoisted(() => ({ db: null as MockDb | null }))
vi.mock("./source", () => ({
  previewOr: <T,>(preview: () => Promise<T>) => preview(),
  unwrap: <T,>(v: T) => v,
  isPreviewRequest: async () => true,
}))
vi.mock("@/lib/mock/store", () => ({ clone: <T,>(v: T) => structuredClone(v), mockRequest: async () => store.db! }))

const { getInterviewSession, listInterviewSessions, submitInterviewSession } = await import("./interviews")

beforeEach(() => {
  store.db = createFixtures()
})

describe("OD-I6 deleted application sessions (mock)", () => {
  const deletedSession = IDS.ses(15)

  it("the fixture's project is really gone", () => {
    expect(store.db!.application_projects.some((a) => a.id === IDS.ap(DELETED_AP_N))).toBe(false)
  })

  it("lists the session as deleted with the R-OD-12 snapshot name", async () => {
    const rows = await listInterviewSessions()
    const row = rows.find((r) => r.id === deletedSession)
    expect(row).toMatchObject({
      application_deleted: true,
      application_name: "한빛소프트 – 백엔드 개발자",
      company_name_snapshot: "한빛소프트",
      position_title_snapshot: "백엔드 개발자",
      status: "completed",
      score_status: "scored",
      score_value: 46,
    })
    expect(rows.filter((r) => r.id !== deletedSession).every((r) => r.application_deleted === false)).toBe(true)
  })

  it("the deleted filter returns only kept sessions of deleted projects", async () => {
    const rows = await listInterviewSessions({ application_project_id: "deleted" })
    expect(rows.map((r) => r.id)).toEqual([deletedSession])
  })

  it("the detail is found under the deleted segment, not under a live project id", async () => {
    const detail = await getInterviewSession("deleted", deletedSession)
    expect(detail?.application_deleted).toBe(true)
    expect(detail?.questions).toHaveLength(3)
    expect(await getInterviewSession(IDS.ap(1), deletedSession)).toBeNull()
    // a live session is not reachable through the deleted segment
    expect(await getInterviewSession("deleted", IDS.ses(2))).toBeNull()
  })

  it("the snapshot name falls back to 삭제된 자기소개서 when both are empty", async () => {
    const s = store.db!.interview_sessions.find((x) => x.id === deletedSession)!
    s.company_name_snapshot = null
    s.position_title_snapshot = null
    const [row] = await listInterviewSessions({ application_project_id: "deleted" })
    expect(row.application_name).toBe("삭제된 자기소개서")
  })
})

describe("OD-I1 all-unanswered submit (mock)", () => {
  it("scores 0 / 100 with d14.v1 and marks each answer unanswered at 0", async () => {
    const db = store.db!
    const s = db.interview_sessions.find((x) => x.id === IDS.ses(1))!
    for (const a of db.interview_answers.filter((a) => a.session_id === s.id)) a.answer_text = ""
    const { job_id } = await submitInterviewSession(s.id)
    expect(job_id).toBeNull()
    expect(s).toMatchObject({ status: "completed", score_status: "scored", score_value: 0, score_max: 100, score_method_version: "d14.v1" })
    for (const a of db.interview_answers.filter((a) => a.session_id === s.id)) expect(a).toMatchObject({ score_status: "unanswered", score_value: 0 })
  })
})
