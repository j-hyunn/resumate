import { readFileSync } from "node:fs"
import { join } from "node:path"
import { beforeEach, describe, expect, it, vi } from "vitest"

/**
 * R15 후속 반드시 지킬 것 ① — **`getApplicationDocument`의 `{error}`를 `null`로 접지 않는다.**
 * `null`은 "행 없음"만 뜻한다. 오류를 `null`로 받으면 문항 설정 상태로 열려 [자기소개서 작성 시작]이
 * 빈 기본 문항으로 기존 정본을 덮는다. 실제 분기를 직접 돌려 확인한다.
 */
const actions = vi.hoisted(() => ({
  getApplicationDocument: vi.fn(),
  listDocumentSlotCounts: vi.fn(),
  markApplicationDocumentCopied: vi.fn(),
  saveApplicationDocument: vi.fn(),
}))
vi.mock("./source", async () => {
  const real = await vi.importActual<typeof import("./source")>("./source")
  // real 분기를 탄다 (미리 보기 아님)
  return { ...real, previewOr: <T,>(_preview: () => Promise<T>, realFn: () => Promise<T>) => realFn() }
})
vi.mock("@/server/actions/application-document", () => actions)

const { getCoverLetterDocument, listCoverLetterSlotCounts, markCoverLetterCopied } = await import("./cover-letters")

const AP = "00000000-0000-4000-8000-0000000000a1"

beforeEach(() => {
  vi.clearAllMocks()
})

describe("정본 읽기: 오류는 오류, null은 행 없음 (R15 후속 ①)", () => {
  it("{error}면 던진다 — null로 접지 않는다", async () => {
    actions.getApplicationDocument.mockResolvedValue({ error: { code: "internal_error", message: "x" } })
    await expect(getCoverLetterDocument(AP)).rejects.toMatchObject({ code: "internal_error" })
  })

  it("권한·인증 오류도 던진다", async () => {
    actions.getApplicationDocument.mockResolvedValue({ error: { code: "unauthenticated", message: "x" } })
    await expect(getCoverLetterDocument(AP)).rejects.toMatchObject({ code: "unauthenticated" })
  })

  it("{data: null}만 null(행 없음 → 문항 설정 상태)", async () => {
    actions.getApplicationDocument.mockResolvedValue({ data: null })
    await expect(getCoverLetterDocument(AP)).resolves.toBeNull()
    expect(actions.getApplicationDocument).toHaveBeenCalledWith({ applicationProjectId: AP, documentKind: "cover_letter" })
  })

  it("행이 있으면 그대로 돌려준다 — updated_at이 다음 저장의 기대 버전이 된다", async () => {
    const row = { id: "d1", application_project_id: AP, updated_at: "2026-11-09T01:00:00.000Z", body: { questions: [] } }
    actions.getApplicationDocument.mockResolvedValue({ data: row })
    await expect(getCoverLetterDocument(AP)).resolves.toEqual(row)
  })
})

describe("S-39 문항 수 · 첫 복사", () => {
  it("listDocumentSlotCounts — 행 없는 프로젝트는 키가 없다", async () => {
    actions.listDocumentSlotCounts.mockResolvedValue({ data: { [AP]: { slot_count: 3, filled_slot_count: 2 } } })
    await expect(listCoverLetterSlotCounts()).resolves.toEqual({ [AP]: { slot_count: 3, filled_slot_count: 2 } })
  })

  it("markApplicationDocumentCopied — firstCopiedAt을 돌려준다", async () => {
    actions.markApplicationDocumentCopied.mockResolvedValue({ data: { firstCopiedAt: "2026-11-09T04:00:00.000Z" } })
    await expect(markCoverLetterCopied(AP)).resolves.toBe("2026-11-09T04:00:00.000Z")
  })
})

describe("S-46 페이지는 정본 읽기 실패를 null로 접지 않는다 (소스 가드)", () => {
  it("page.tsx의 getCoverLetterDocument 호출에 catch가 없다", () => {
    const src = readFileSync(join(process.cwd(), "src/app/(page)/(gated)/applications/[id]/cover-letter/page.tsx"), "utf8")
    const call = src.slice(src.indexOf("getCoverLetterDocument(id)"), src.indexOf("getCoverLetterDocument(id)") + 80)
    expect(src).toContain("getCoverLetterDocument(id)")
    expect(call).not.toMatch(/\.catch\(/)
    expect(src).not.toMatch(/try\s*\{[\s\S]*getCoverLetterDocument/)
  })
})
