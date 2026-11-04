import { describe, expect, it } from "vitest"
import {
  DELIVERABLE_CHIP_COPY as C,
  deliverableChipRow,
  deliverableQuickChips,
  firstEmptyDeliverableSlot,
  projectChipRow,
  projectQuickChips,
  quickChips,
  quickChipsVisible,
  type QuickChip,
} from "./quick-chips"

const labels = (chips: QuickChip[]) => chips.map((c) => c.label)
const slots = (chips: QuickChip[]) => chips.map((c) => (c.kind === "message" ? c.requested_slot : "new_chat"))

describe("AI-12 projectQuickChips (S-10)", () => {
  it("new page (no row, empty STAR) → 필수 중 빈 것 있음, first empty required = situation", () => {
    const chips = projectQuickChips({ star: {} })
    expect(projectChipRow({ star: {} })).toBe("required_missing")
    expect(labels(chips)).toEqual(["비어 있는 항목부터 물어봐 줘", "결과/성과도 정리하고 싶어요", "배운 점도 정리하고 싶어요"])
    expect(slots(chips)).toEqual(["situation", "result", "learnings"])
  })

  it("situation filled, action empty → the first empty required slot is action", () => {
    expect(slots(projectQuickChips({ star: { situation: "결제 장애가 잦았다" } }))[0]).toBe("action")
  })

  it("whitespace-only counts as empty (C-14 공백 정규화)", () => {
    expect(projectChipRow({ star: { situation: "  \n ", action: "인덱스 재설계" } })).toBe("required_missing")
  })

  it("required filled, optional empty → 남은 항목 채우기 with the first empty slot in STAR order", () => {
    const state = { star: { situation: "s", action: "a", result: "r" } }
    expect(projectChipRow(state)).toBe("optional_missing")
    const chips = projectQuickChips(state)
    expect(labels(chips)).toEqual(["남은 항목 채우기", "본인이 한 일을 더 구체적으로", "결과/성과에 수치 더하기"])
    expect(slots(chips)).toEqual(["task", "action", "result"])
  })

  it("all filled → 보강 chips", () => {
    const chips = projectQuickChips({ star: { situation: "s", task: "t", action: "a", result: "r", learnings: "l" } })
    expect(labels(chips)).toEqual(["행동 보강하기", "결과/성과 보강하기", "배운 점 보강하기"])
    expect(slots(chips)).toEqual(["action", "result", "learnings"])
  })

  it("every S-10 chip carries a slot and no draft action", () => {
    for (const star of [{}, { situation: "s", action: "a" }, { situation: "s", task: "t", action: "a", result: "r", learnings: "l" }]) {
      for (const chip of projectQuickChips({ star })) {
        expect(chip.kind).toBe("message")
        if (chip.kind === "message") {
          expect(chip.requested_slot).not.toBeNull()
          expect(chip.requested_action).toBeNull()
        }
      }
    }
  })
})

describe("AI-13 deliverableQuickChips (S-44)", () => {
  const base = { body: "", facts: [], has_draft: false, draft_count: 0, writing_kind: null } as const

  it("no chat row, empty body → 초안 불가", () => {
    expect(deliverableChipRow(base)).toBe("draft_unavailable")
    const chips = deliverableQuickChips(base)
    expect(labels(chips)).toEqual([C.whatToWrite, C.myPartFirst, C.fromProject])
    expect(slots(chips)[1]).toBe("contribution")
  })

  it("no chat row, body present → 초안 가능, 초안 없음 (R-PA-14)", () => {
    const chips = deliverableQuickChips({ ...base, body: "## 회고\n결제 모듈" })
    expect(labels(chips)).toEqual([C.composeDraft, C.askMissing, C.moreDetail])
    expect(chips[0]).toMatchObject({ kind: "message", requested_action: "compose_draft", style: null })
  })

  it("two usable facts make a draft available; needs_review facts don't count", () => {
    const facts = [
      { slot: "contribution", review: "ok" as const },
      { slot: "went_well", review: "needs_review" as const },
    ]
    expect(deliverableChipRow({ ...base, facts })).toBe("draft_unavailable")
    expect(deliverableChipRow({ ...base, facts: [...facts, { slot: "scope", review: "accepted" as const }] })).toBe("draft_available")
  })

  it("draft exists → 다시 만들기 / 더 짧게 (style shorter) / 빠진 부분 (missing_slots first)", () => {
    const chips = deliverableQuickChips({ ...base, has_draft: true, draft_count: 2, missing_slots: ["went_wrong"] })
    expect(labels(chips)).toEqual([C.recompose, C.shorter, C.askMissing])
    expect(chips[1]).toMatchObject({ requested_action: "compose_draft", style: "shorter" })
    expect(slots(chips)[2]).toBe("went_wrong")
  })

  it("first empty slot follows the kind's slot table when there is no draft", () => {
    const state = { ...base, writing_kind: "retrospective" as const, facts: [{ slot: "scope", review: "ok" as const }] }
    expect(firstEmptyDeliverableSlot(state)).toBe("went_well")
  })

  it("draft_count 6 replaces the draft chips with 빠진 부분 / 새 대화 시작 (no duplicates)", () => {
    const chips = deliverableQuickChips({ ...base, has_draft: true, draft_count: 6 })
    expect(labels(chips)).toEqual([C.askMissing, C.newChat])
    expect(chips[1]).toEqual({ kind: "new_chat", label: C.newChat })
    expect(chips.some((c) => c.kind === "message" && c.requested_action === "compose_draft")).toBe(false)
  })

  it("draft_count 6 without a draft keeps the non-draft chips and adds 새 대화 시작", () => {
    const chips = deliverableQuickChips({ ...base, body: "본문", draft_count: 6 })
    expect(labels(chips)).toEqual([C.askMissing, C.moreDetail, C.newChat])
  })
})

describe("quickChips / quickChipsVisible", () => {
  it("dispatches by target", () => {
    expect(labels(quickChips({ target: "project", star: {} }))[0]).toBe("비어 있는 항목부터 물어봐 줘")
    expect(labels(quickChips({ target: "deliverable", body: "", facts: [], has_draft: false, draft_count: 0, writing_kind: null }))[0]).toBe(C.whatToWrite)
  })

  it("hidden from message_count 36, on closed chats and without a key", () => {
    expect(quickChipsVisible({ message_count: 35, closed: false, locked: false })).toBe(true)
    expect(quickChipsVisible({ message_count: 36, closed: false, locked: false })).toBe(false)
    expect(quickChipsVisible({ message_count: 2, closed: true, locked: false })).toBe(false)
    expect(quickChipsVisible({ message_count: 2, closed: false, locked: true })).toBe(false)
    expect(quickChipsVisible({ message_count: 1, closed: false, locked: false, sent: true })).toBe(false)
  })
})
