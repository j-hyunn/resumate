import { beforeEach, describe, expect, it, vi } from "vitest"
import { createFixtures, type MockDb } from "@/lib/mock/fixtures"
import { applicationDeletedToast, applicationObjectPhrase } from "./labels"

/**
 * R14 (RM-1): the mock 자기소개서 delete removes every evidence link of the project (the real FK
 * cascade) and leaves other projects' links alone.
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

describe("mock deleteApplicationProject removes the project's evidence (R14)", () => {
  it("drops every link of the deleted project and keeps the others", async () => {
    const db = store.db!
    const apId = db.application_projects[0]!.id
    const template = db.evidence_links[0]!
    db.evidence_links.push({ ...template, id: "00000000-0000-4000-8000-00000000e384", owner_type: "insight", application_project_id: apId })
    const others = db.evidence_links.filter((e) => e.application_project_id !== apId).length

    await deleteApplicationProject(apId)

    expect(db.evidence_links.some((e) => e.application_project_id === apId)).toBe(false)
    expect(db.evidence_links.filter((e) => e.application_project_id !== apId)).toHaveLength(others)
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
