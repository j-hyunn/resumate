import { describe, expect, it } from "vitest"
import {
  COVER_LETTER_DRAFT_LIMIT,
  COVER_LETTER_DRAFT_SLOTS_PER_TURN,
  coverLetterChips,
  coverLetterGreeting,
  emptyCoverLetterDraft,
  firstTurnOffer,
} from "./cover-letter-chat-types"
import { mockCoverLetterTurn } from "@/lib/mock/cover-letter-turn"

const QUESTIONS = [
  { slot: "q_1", question_text: "지원 동기를 작성해 주세요.", char_limit: 800, body: "" },
  { slot: "q_2", question_text: "직무 역량을 보여 줄 수 있는 경험을 작성해 주세요.", char_limit: 800, body: "" },
  { slot: "q_3", question_text: "입사 후 포부 및 성장 계획을 작성해 주세요.", char_limit: 800, body: "" },
  { slot: "q_4", question_text: "협업 경험을 작성해 주세요.", char_limit: 500, body: "" },
  { slot: "q_5", question_text: "실패 경험을 작성해 주세요.", char_limit: 500, body: "" },
]

async function collect(gen: AsyncGenerator<unknown>) {
  const out: unknown[] = []
  for await (const ev of gen) out.push(ev)
  return out as Array<Record<string, unknown>>
}

describe("S-46 패널 문구·상한", () => {
  it("첫 턴 문구는 문항 수로 갈린다 (R-CF-8)", () => {
    expect(firstTurnOffer(3)).toContain("바로 초안을")
    expect(firstTurnOffer(3)).not.toContain("1~3번")
    expect(firstTurnOffer(5)).toContain("먼저 1~3번 문항을")
  })

  it("시작 인사는 form_snapshot으로 갈린다 (시작 영역 ①~④)", () => {
    expect(coverLetterGreeting({ answered: 0, total: 3, requirementsPending: true })).toContain("공고 요건")
    expect(coverLetterGreeting({ answered: 0, total: 3, requirementsPending: false })).toContain("초안을 제안")
    expect(coverLetterGreeting({ answered: 1, total: 3, requirementsPending: false })).toContain("이어서")
    expect(coverLetterGreeting({ answered: 3, total: 3, requirementsPending: false })).toContain("다듬어")
  })

  it('4~5문항이면 첫 초안 턴 뒤 "남은 문항" 칩이 붙는다', () => {
    expect(coverLetterChips({ total: 3, firstDraftDone: true })[0]).not.toContain("남은")
    expect(coverLetterChips({ total: 5, firstDraftDone: false })[0]).not.toContain("남은")
    expect(coverLetterChips({ total: 5, firstDraftDone: true })[0]).toBe("남은 4~5번 문항 초안 만들기")
    expect(coverLetterChips({ total: 4, firstDraftDone: true })[0]).toBe("남은 4번 문항 초안 만들기")
  })
})

describe("서류 초안 턴 (계약 모양 회귀 단정)", () => {
  it("초안 상한은 **턴** 6회다 — 한 턴이 3문항을 써도 draftCount는 1만 는다 (DM 2.9.4)", async () => {
    const events = await collect(
      mockCoverLetterTurn({ questions: QUESTIONS, draftTurn: true, draftCount: 0, draft: emptyCoverLetterDraft(), stepMs: 0 }),
    )
    const dones = events.filter((e) => e.type === "draft_done")
    // 한 턴 최대 3문항 (CL-10)
    expect(dones).toHaveLength(COVER_LETTER_DRAFT_SLOTS_PER_TURN)
    // 문항이 3개여도 모두 같은 "1회"다
    expect(new Set(dones.map((d) => d.draftCount))).toEqual(new Set([1]))
    expect((events.at(-1) as { type: string; draftCount: number }).draftCount).toBe(1)
    // 5문항은 한 바퀴에 2회 → 세 바퀴가 가능하다
    expect(COVER_LETTER_DRAFT_LIMIT).toBe(6)
  })

  it("새 이벤트 이름을 만들지 않는다 — 기존 이름에 slot·questionNo가 붙은 모양이다", async () => {
    const events = await collect(
      mockCoverLetterTurn({ questions: QUESTIONS.slice(0, 1), draftTurn: true, draftCount: 0, draft: emptyCoverLetterDraft(), stepMs: 0 }),
    )
    expect(new Set(events.map((e) => e.type))).toEqual(
      new Set(["turn_started", "draft_patch", "draft_flags", "sources_selected", "draft_started", "draft_block", "draft_done", "reply_done", "turn_done"]),
    )
    const sources = events.find((e) => e.type === "sources_selected") as { slot: string; questionNo: number }
    expect(sources.slot).toBe("q_1")
    expect(sources.questionNo).toBe(1)
  })

  it("⚠ sources_selected.sources[]만 camelCase이고 draft_block.block은 snake_case다", async () => {
    const events = await collect(
      mockCoverLetterTurn({ questions: QUESTIONS.slice(0, 1), draftTurn: true, draftCount: 0, draft: emptyCoverLetterDraft(), stepMs: 0 }),
    )
    const sources = (events.find((e) => e.type === "sources_selected") as { sources: Array<Record<string, unknown>> }).sources
    expect(Object.keys(sources[0])).toContain("sortOrder")
    expect(Object.keys(sources[0])).toContain("experienceId")
    expect(Object.keys(sources[0])).toContain("reuseReason")
    expect(Object.keys(sources[0])).not.toContain("sort_order")

    const block = (events.find((e) => e.type === "draft_block") as { block: Record<string, unknown> }).block
    expect(Object.keys(block)).toContain("block_id")
    expect(Object.keys(block)).toContain("source_fact_ids")
    expect(Object.keys(block)).not.toContain("blockId")
  })

  it("초안 실패는 끝 이벤트가 error 하나이고 draft_done을 남기지 않는다 (횟수도 줄지 않는다)", async () => {
    const events = await collect(
      mockCoverLetterTurn({ questions: QUESTIONS, draftTurn: true, draftCount: 2, draft: emptyCoverLetterDraft(), fail: "provider_unavailable", stepMs: 0 }),
    )
    expect((events.at(-1) as { type: string }).type).toBe("error")
    expect(events.some((e) => e.type === "draft_done")).toBe(false)
    expect(events.some((e) => e.type === "turn_done")).toBe(false)
  })

  it("질문 턴은 초안을 만들지 않고 draftCount를 유지한다", async () => {
    const events = await collect(
      mockCoverLetterTurn({ questions: QUESTIONS, draftTurn: false, draftCount: 3, draft: emptyCoverLetterDraft(), stepMs: 0 }),
    )
    expect(events.some((e) => e.type === "draft_done")).toBe(false)
    expect((events.at(-1) as { draftCount: number }).draftCount).toBe(3)
  })
})
