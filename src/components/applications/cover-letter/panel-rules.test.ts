import { describe, expect, it } from "vitest"
import { shouldAdoptReread } from "./panel-rules"

/** UQ-760 — 늦게 도착한 턴 뒤 다시 읽기가 그 사이 연 다른 대화를 덮지 않는다 */
describe("턴 뒤 다시 읽기 반영 조건 (UQ-760)", () => {
  it("지금 열린 대화가 그 턴의 대화일 때만 반영한다", () => {
    expect(shouldAdoptReread("chat-a", "chat-a", "chat-a")).toBe(true)
  })

  it("그 사이 기록에서 다른 대화를 열었으면 버린다", () => {
    expect(shouldAdoptReread("chat-b", "chat-a", "chat-a")).toBe(false)
  })

  it("'+ 새 대화'로 비웠으면 버린다", () => {
    expect(shouldAdoptReread(null, "chat-a", "chat-a")).toBe(false)
  })

  it("응답이 다른 대화면 버린다", () => {
    expect(shouldAdoptReread("chat-a", "chat-a", "chat-b")).toBe(false)
  })
})
