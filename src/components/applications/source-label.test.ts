import { describe, expect, it } from "vitest"
import { sourceRowLabel } from "./source-label"

describe("sourceRowLabel (A3 UQ-84 (e))", () => {
  const labels = { "p-1": "그린페이먼츠 › 결제 API 개선(새 이름)" }

  it("names a live source as it is now", () => {
    expect(sourceRowLabel({ project_id: "p-1", source_label: "그린페이먼츠 › 결제 API 개선", source_deleted_at: null }, labels)).toBe("그린페이먼츠 › 결제 API 개선(새 이름)")
  })

  it("keeps the stored snapshot for a deleted source", () => {
    expect(sourceRowLabel({ project_id: "p-1", source_label: "그린페이먼츠 › 결제 API 개선", source_deleted_at: "2026-11-01T00:00:00Z" }, labels)).toBe("그린페이먼츠 › 결제 API 개선")
  })

  it("falls back to the snapshot when the source isn't in the tree", () => {
    expect(sourceRowLabel({ project_id: "p-9", source_label: "옛 라벨", source_deleted_at: null }, labels)).toBe("옛 라벨")
    expect(sourceRowLabel({ project_id: null, source_label: "옛 라벨", source_deleted_at: null }, labels)).toBe("옛 라벨")
  })
})
