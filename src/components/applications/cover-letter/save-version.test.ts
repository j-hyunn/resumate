import { describe, expect, it } from "vitest"
import { expectedVersion, restorableCopy, staleDialogReloadOnly } from "./save-version"

/** R15 후속 반드시 지킬 것 ② — 읽은 행의 `updated_at`을 보낸다 · ③ CF-S7(작성 상태 두 버튼) / CF-S9(문항 설정 상태 한 버튼) */
describe("S-46 저장 기대 버전", () => {
  it("② 정본 행을 읽었으면 그 updated_at을 다음 저장의 기대 버전으로 보낸다", () => {
    expect(expectedVersion({ rowUpdatedAt: "2026-11-09T01:00:00.000Z", overwrite: false, staleVersion: null })).toBe("2026-11-09T01:00:00.000Z")
  })

  it("행이 없을 때(문항 설정 상태의 첫 저장)만 null이다", () => {
    expect(expectedVersion({ rowUpdatedAt: null, overwrite: false, staleVersion: null })).toBeNull()
  })

  it("③ CF-S9 — 문항 설정 상태의 [작성 시작]이 stale_write를 받으면 다이얼로그는 '새로 불러오기'만 둔다", () => {
    // 이 탭의 문항 설정으로 덮지 않는다 — "내 내용으로 저장"이 없으니 재전송 경로도 없다
    expect(staleDialogReloadOnly("questions")).toBe(true)
  })

  it("작성 상태의 stale_write는 CF-S7 그대로 버튼 둘 (CF-S8 자동 저장 실패 포함)", () => {
    expect(staleDialogReloadOnly("writing")).toBe(false)
  })

  it("작성 상태의 '내 내용으로 저장'도 지금 버전을 보낸다 — 정본이 있는데 null을 보내는 길이 없다", () => {
    expect(expectedVersion({ rowUpdatedAt: "2026-11-09T01:00:00.000Z", overwrite: true, staleVersion: "2026-11-09T03:00:00.000Z" })).toBe("2026-11-09T03:00:00.000Z")
    // 지금 버전을 못 받았으면 아는 버전을 보낸다(null로 덮지 않는다)
    expect(expectedVersion({ rowUpdatedAt: "2026-11-09T01:00:00.000Z", overwrite: true, staleVersion: null })).toBe("2026-11-09T01:00:00.000Z")
  })
})

describe("CF-S9 '새로 불러오기' 뒤 문항 설정 초안이 되살아나지 않는다", () => {
  it("문항 설정 상태에서 쓴 복사본(base = null)은 정본이 생긴 뒤에는 되살리지 않는다", () => {
    expect(restorableCopy(null, "2026-11-10T01:00:00.000Z")).toBe(false)
  })

  it("같은 정본 버전에서 쓴 복사본만 되살린다 · 정본이 그 뒤 바뀌었으면 버린다 (U40-2)", () => {
    expect(restorableCopy("2026-11-10T01:00:00.000Z", "2026-11-10T01:00:00.000Z")).toBe(true)
    expect(restorableCopy("2026-11-10T01:00:00.000Z", "2026-11-10T02:00:00.000Z")).toBe(false)
    // 정본이 아직 없는 화면에서 쓴 복사본은 정본이 없을 때만
    expect(restorableCopy(null, null)).toBe(true)
  })
})
