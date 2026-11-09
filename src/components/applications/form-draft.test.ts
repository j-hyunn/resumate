import { describe, expect, it } from "vitest"
import { keepsFormDraftOnLeave, previewRefusalAction } from "./form-draft"

/** UX S-14 입력 보존 (QA 17 B-6): kept only when leaving for the key swap / AI 연결 back to this screen */
describe("keepsFormDraftOnLeave", () => {
  it("keeps the form when the AI 연결 return target is this screen (query ignored)", () => {
    expect(keepsFormDraftOnLeave("/applications/new", "/applications/new")).toBe(true)
    expect(keepsFormDraftOnLeave("/applications/new?from=board", "/applications/new")).toBe(true)
  })

  it("drops it on any other way out", () => {
    expect(keepsFormDraftOnLeave(null, "/applications/new")).toBe(false)
    expect(keepsFormDraftOnLeave(undefined, "/applications/new")).toBe(false)
    expect(keepsFormDraftOnLeave("/applications/abc/drafts", "/applications/new")).toBe(false)
  })
})

describe("S-14 미리 보기 거부의 처리 (UQ-751)", () => {
  it("원인별로 가른다 — 동의 필요만 C-21이고 키 없음은 막지 않는다", () => {
    expect(previewRefusalAction("key_invalid")).toBe("stay_key_invalid")
    expect(previewRefusalAction("ai_consent_required")).toBe("consent")
    expect(previewRefusalAction("ai_not_connected")).toBe("step2_keyless")
    expect(previewRefusalAction("key_missing")).toBe("step2_keyless")
    expect(previewRefusalAction("ai_connection_changed")).toBe("step2_with_notice")
    expect(previewRefusalAction(null)).toBe("step2_with_notice")
  })
})
