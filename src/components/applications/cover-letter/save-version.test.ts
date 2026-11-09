import { describe, expect, it } from "vitest"
import { expectedVersion } from "./save-version"

/** R15 후속 반드시 지킬 것 ②·③ — 읽은 행의 `updated_at`을 보낸다 · CF-S7 같은 충돌 다이얼로그 */
describe("S-46 저장 기대 버전", () => {
  it("② 정본 행을 읽었으면 그 updated_at을 다음 저장의 기대 버전으로 보낸다", () => {
    expect(expectedVersion({ rowUpdatedAt: "2026-11-09T01:00:00.000Z", overwrite: false, staleVersion: null })).toBe("2026-11-09T01:00:00.000Z")
  })

  it("행이 없을 때(문항 설정 상태의 첫 저장)만 null이다", () => {
    expect(expectedVersion({ rowUpdatedAt: null, overwrite: false, staleVersion: null })).toBeNull()
  })

  it("③ CF-S7 — [작성 시작]이 stale_write를 받은 뒤 '내 내용으로 저장'은 current_updated_at을 보낸다 (null 아님)", () => {
    // 문항 설정 상태: 행을 못 본 채 열었는데 다른 탭이 행을 만들었다 → 서버가 stale_write + 지금 버전
    expect(expectedVersion({ rowUpdatedAt: null, overwrite: true, staleVersion: "2026-11-09T02:00:00.000Z" })).toBe("2026-11-09T02:00:00.000Z")
  })

  it("작성 상태의 '내 내용으로 저장'도 지금 버전을 보낸다 — 정본이 있는데 null을 보내는 길이 없다", () => {
    expect(expectedVersion({ rowUpdatedAt: "2026-11-09T01:00:00.000Z", overwrite: true, staleVersion: "2026-11-09T03:00:00.000Z" })).toBe("2026-11-09T03:00:00.000Z")
    // 지금 버전을 못 받았으면 아는 버전을 보낸다(null로 덮지 않는다)
    expect(expectedVersion({ rowUpdatedAt: "2026-11-09T01:00:00.000Z", overwrite: true, staleVersion: null })).toBe("2026-11-09T01:00:00.000Z")
  })
})
