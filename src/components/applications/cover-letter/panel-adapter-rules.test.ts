/**
 * S-46 → 공통 AiPanel 어댑터 규칙 (59 QA UQ-764 · UQ-770).
 * - 서류 대화는 메시지 39개에서 막고, 그때 "끝난 대화" 상자는 이전 S-46 문구를 쓴다(공통 기본은 40 이상에서만 상한 문구).
 * - 초안 6회에 닿으면 칩은 "빠진 부분 물어봐 줘"(메시지) · "새 대화 시작"(`new_chat`) — AI-04 표.
 */
import { describe, expect, it } from "vitest"
import { COVER_LETTER_MESSAGE_LIMIT, PANEL_COPY } from "@/lib/data/cover-letter-chat-types"
import { PANEL_COPY as COMMON_COPY } from "@/lib/data/career-v45-shared"
import { chipTurnOptions, coverLetterClosedCopy, coverLetterMessageLimitReached, coverLetterPanelChips } from "./panel-rules"

describe("서류 대화 메시지 상한 (UQ-764)", () => {
  it("39개부터 막는다 — 38은 열려 있다", () => {
    expect(COVER_LETTER_MESSAGE_LIMIT).toBe(40)
    expect(coverLetterMessageLimitReached(38)).toBe(false)
    expect(coverLetterMessageLimitReached(39)).toBe(true)
    expect(coverLetterMessageLimitReached(40)).toBe(true)
  })
  it("39·40에서 상자 문구는 이전 S-46 문구다 (공통 '끝난 대화' 문구가 아니다)", () => {
    for (const n of [39, 40]) {
      expect(coverLetterClosedCopy(n)).toBe(PANEL_COPY.messageLimitReached)
      expect(coverLetterClosedCopy(n)).not.toBe(COMMON_COPY.chatClosed)
    }
  })
  it("상한 전(대화가 closed인 경우)은 공통 기본 문구에 맡긴다", () => {
    expect(coverLetterClosedCopy(0)).toBeUndefined()
    expect(coverLetterClosedCopy(38)).toBeUndefined()
  })
})

describe("초안 6회 칩 (UQ-770)", () => {
  const chips = ["지금까지 내용으로 초안 만들기", "더 간결하게", "글자 수 맞춰 줘"]
  it("상한 전에는 서류 대화 칩 그대로", () => {
    expect(coverLetterPanelChips(chips, false).map((c) => c.label)).toEqual(chips)
    expect(coverLetterPanelChips(chips, false).every((c) => c.kind === "message")).toBe(true)
  })
  it("상한이면 '빠진 부분 물어봐 줘'(초안 아님) · '새 대화 시작'(new_chat)", () => {
    const at = coverLetterPanelChips(chips, true)
    expect(at.map((c) => [c.kind, c.label])).toEqual([
      ["message", "빠진 부분 물어봐 줘"],
      ["new_chat", "새 대화 시작"],
    ])
    expect(chipTurnOptions("빠진 부분 물어봐 줘").draftTurn).toBe(false)
  })
  it("칩 턴 옵션은 옛 규칙 그대로", () => {
    expect(chipTurnOptions("지금까지 내용으로 초안 만들기")).toEqual({ draftTurn: true, style: undefined })
    expect(chipTurnOptions("더 간결하게")).toEqual({ draftTurn: true, style: "shorter" })
    expect(chipTurnOptions("글자 수 맞춰 줘")).toEqual({ draftTurn: true, style: "fit_length" })
  })
})
