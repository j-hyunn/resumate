import { beforeEach, describe, expect, it, vi } from "vitest"
import { createFixtures, type MockDb } from "@/lib/mock/fixtures"
import { applicationDeletedToast, applicationObjectPhrase } from "./labels"

/**
 * UQ-384 (run 38): the mock 자기소개서 delete leaves kept-session evidence like the real R11 triggers —
 * application_project_id null, and links to the deleted JD / requirements read as 원본 삭제됨 (quote null).
 */
const store = vi.hoisted(() => ({ db: null as MockDb | null }))
vi.mock("./source", () => ({
  previewOr: <T,>(preview: () => Promise<T>) => preview(),
  unwrap: <T,>(v: T) => v,
  isPreviewRequest: async () => true,
}))
vi.mock("@/lib/mock/store", () => ({ clone: <T,>(v: T) => structuredClone(v), mockRequest: async () => store.db! }))

const { deleteApplicationProject } = await import("./deletion")

beforeEach(() => {
  store.db = createFixtures()
})

describe("mock deleteApplicationProject keeps completed-session evidence detached (UQ-384)", () => {
  it("nulls the project id and marks JD sources deleted", async () => {
    const db = store.db!
    const kept = db.interview_sessions.find((s) => s.status === "completed" && s.application_project_id !== null)!
    const apId = kept.application_project_id!
    const qIds = new Set(db.interview_questions.filter((q) => q.session_id === kept.id).map((q) => q.id))
    const jdIds = db.job_descriptions.filter((j) => j.application_project_id === apId).map((j) => j.id)
    const reqIds = new Set(db.jd_requirements.filter((r) => jdIds.includes(r.job_description_id)).map((r) => r.id))
    // make sure the kept session cites a JD requirement of the deleted project
    const [qId] = [...qIds]
    const [reqId] = [...reqIds]
    expect(qId && reqId).toBeTruthy()
    const template = db.evidence_links[0]
    db.evidence_links.push({
      ...template,
      id: "00000000-0000-4000-8000-00000000e384",
      owner_type: "interview_question",
      owner_id: qId,
      application_project_id: apId,
      source_type: "jd_requirement",
      source_id: reqId,
      quote: "요건 인용",
      source_deleted_at: null,
    })

    await deleteApplicationProject(apId)

    const link = db.evidence_links.find((e) => e.id === "00000000-0000-4000-8000-00000000e384")!
    expect(link).toMatchObject({ application_project_id: null, quote: null })
    expect(link.source_deleted_at).not.toBeNull()
    expect(db.evidence_links.some((e) => e.application_project_id === apId)).toBe(false)
    expect(db.interview_sessions.find((s) => s.id === kept.id)?.application_project_id).toBeNull()
  })
})

describe("U36-7 overlap rule for the C-05 first line and delete toasts (UQ-383)", () => {
  it("adds 자기소개서 only when the name lacks it", () => {
    expect(applicationObjectPhrase("한빛소프트 – 백엔드 개발자", { quoted: true })).toBe("'한빛소프트 – 백엔드 개발자' 자기소개서를")
    expect(applicationObjectPhrase("새 자기소개서 (2026-11-05)", { quoted: true })).toBe("'새 자기소개서 (2026-11-05)'를")
    expect(applicationObjectPhrase("새 자기소개서 (2026-11-03)", { quoted: true })).toBe("'새 자기소개서 (2026-11-03)'을")
    expect(applicationDeletedToast("한빛소프트 – 백엔드 개발자")).toBe("한빛소프트 – 백엔드 개발자 자기소개서를 삭제했어요")
    expect(applicationDeletedToast("새 자기소개서 (2026-11-05)")).toBe("새 자기소개서 (2026-11-05)를 삭제했어요")
  })
})
