/**
 * S-39 카드 서류 표시 판정 (v5.20 CF-3·CF-A14, decisions 4.23 UI 5).
 * 배지 하나뿐이고 숫자는 보이지 않는다 — 여기서는 어떤 배지가 나오는지만 못 박는다.
 */
import { describe, expect, it } from "vitest"
import { coverLetterProgressLabel } from "@/lib/data/cover-letters"

describe("coverLetterProgressLabel (S-39 카드)", () => {
  it("정본 행이 없으면 표시 없음", () => {
    expect(coverLetterProgressLabel(undefined)).toBeNull()
  })

  it("문항이 0개면 표시 없음", () => {
    expect(coverLetterProgressLabel({ slot_count: 0, filled_slot_count: 0 })).toBeNull()
  })

  it("답변이 하나도 없으면 표시 없음", () => {
    expect(coverLetterProgressLabel({ slot_count: 3, filled_slot_count: 0 })).toBeNull()
  })

  it("일부만 채우면 작성 중", () => {
    expect(coverLetterProgressLabel({ slot_count: 3, filled_slot_count: 2 })).toBe("자소서 작성 중")
  })

  it("모두 채우면 작성됨", () => {
    expect(coverLetterProgressLabel({ slot_count: 3, filled_slot_count: 3 })).toBe("자소서 작성됨")
    expect(coverLetterProgressLabel({ slot_count: 1, filled_slot_count: 1 })).toBe("자소서 작성됨")
  })
})
