import { describe, expect, it } from "vitest"
import {
  allClipboardText,
  countChars,
  createSlotAllocator,
  isUntouchedSeed,
  newQuestionForm,
  nextSlot,
  slotNumber,
  toQuestionForms,
  questionClipboardText,
  QUESTION_ERROR_COPY,
  seedQuestionForms,
  toCoverLetterBody,
  validateQuestions,
} from "./question-form"
import { COVER_LETTER_DEFAULT_CHAR_LIMIT, COVER_LETTER_DEFAULT_QUESTIONS } from "@/lib/data/cover-letter-defaults"

describe("S-46 문항 폼 규칙", () => {
  it("기본 3문항은 K-28 문구 + 글자 수 제한 800 (CF-U2 — 시안의 600이 아니다)", () => {
    const forms = seedQuestionForms()
    expect(forms).toHaveLength(3)
    expect(forms.map((f) => f.question_text)).toEqual(COVER_LETTER_DEFAULT_QUESTIONS.map((q) => q.question_text))
    expect(new Set(forms.map((f) => f.char_limit))).toEqual(new Set([String(COVER_LETTER_DEFAULT_CHAR_LIMIT)]))
    expect(forms.map((f) => f.template_key)).toEqual(["motivation", "job_competency", "future_plan"])
  })

  it('"+ 문항 추가"로 만든 문항에도 800이 미리 채워진다', () => {
    expect(newQuestionForm("q_4").char_limit).toBe(String(COVER_LETTER_DEFAULT_CHAR_LIMIT))
  })

  it("손대지 않은 기본 3문항만 있으면 변경 없음으로 본다", () => {
    expect(isUntouchedSeed(seedQuestionForms())).toBe(true)
    const touched = seedQuestionForms()
    touched[0] = { ...touched[0], char_limit: "1000" }
    expect(isUntouchedSeed(touched)).toBe(false)
    expect(isUntouchedSeed([...seedQuestionForms(), newQuestionForm("q_4")])).toBe(false)
  })

  it("검증: 빈 문항 · 빈 글자 수 · 범위 밖 (UX S-46 검증)", () => {
    const forms = seedQuestionForms()
    forms[0] = { ...forms[0], question_text: "   " }
    forms[1] = { ...forms[1], char_limit: "" }
    forms[2] = { ...forms[2], char_limit: "20000" }
    const { errors, firstIndex } = validateQuestions(forms)
    expect(firstIndex).toBe(0)
    expect(errors[0].question_text).toBe(QUESTION_ERROR_COPY.question_required)
    expect(errors[1].char_limit).toBe(QUESTION_ERROR_COPY.limit_required)
    expect(errors[2].char_limit).toBe(QUESTION_ERROR_COPY.limit_range)
  })

  it("검증을 통과한 폼은 오류가 없다", () => {
    expect(validateQuestions(seedQuestionForms()).firstIndex).toBeNull()
  })

  it("저장 입력은 slot을 그대로 보내고 sort_order만 화면 순서로 매긴다 · 근거를 싣지 않는다 (UQ-740 · CF-S1)", () => {
    const forms = seedQuestionForms()
    const body = toCoverLetterBody([forms[2], forms[0], forms[1]])
    // 순서를 바꿔도 슬롯은 제 문항을 따라간다 — 다시 매기지 않는다
    expect(body.questions.map((q) => q.slot)).toEqual(["q_3", "q_1", "q_2"])
    expect(body.questions.map((q) => q.sort_order)).toEqual([1, 2, 3])
    expect(body.questions[0].char_limit).toBe(COVER_LETTER_DEFAULT_CHAR_LIMIT)
    // 저장 입력에 `sources` 키가 없다 — 서버가 applied_proposals의 제안에서 evidence_links를 만든다
    for (const q of body.questions) expect("sources" in q).toBe(false)
  })

  it("빈 제목·메모는 null로 보낸다 (CF-6)", () => {
    const f = { ...newQuestionForm("q_1"), question_text: "문항", answer_title: "  ", user_note: "" }
    const q = toCoverLetterBody([f]).questions[0]
    expect(q.answer_title).toBeNull()
    expect(q.user_note).toBeNull()
  })

  it("글자 수는 내용만 센다 — 기준에 따라 공백을 뺀다 (CF-6)", () => {
    expect(countChars("가 나 다", "with_spaces")).toBe(5)
    expect(countChars("가 나 다", "without_spaces")).toBe(3)
  })

  it("복사에는 제목이 들어간다", () => {
    const f = { ...newQuestionForm("q_1"), question_text: "지원 동기", answer_title: "결제 장애를 줄인 경험", body: "본문" }
    expect(questionClipboardText(f, 1)).toBe("1. 지원 동기\n\n결제 장애를 줄인 경험\n\n본문")
    const noTitle = { ...f, answer_title: "" }
    expect(questionClipboardText(noTitle, 2)).toBe("2. 지원 동기\n\n본문")
    expect(allClipboardText([f, noTitle])).toContain("\n\n---\n\n")
  })
})

// ---------------------------------------------------------------------------
// UQ-740 슬롯 불변식 (DM v4.15 2.5.1 "슬롯 키 `slot` (확정)" — 안정 키, 한 번 쓰면 재사용하지 않는다)
// ---------------------------------------------------------------------------
describe("S-46 슬롯 키는 안정 키다 (UQ-740)", () => {
  it("다음 슬롯 = 쓴 적 있는 번호의 최댓값 + 1 (빈 번호를 채우지 않는다)", () => {
    expect(nextSlot([])).toBe("q_1")
    expect(nextSlot(["q_1", "q_3"])).toBe("q_4")
    expect(nextSlot(["q_9", "q_2"])).toBe("q_10")
    // 형식이 아닌 값은 무시한다
    expect(nextSlot(["", "s_7", "q_2"])).toBe("q_3")
    expect(slotNumber("q_12")).toBe(12)
    expect(slotNumber("q_")).toBeNull()
  })

  it("문항을 지운 뒤 추가하면 지운 번호를 다시 쓰지 않는다 (이번 방문 안)", () => {
    const slots = createSlotAllocator(["q_1", "q_2", "q_3"])
    let forms = seedQuestionForms()
    // q_3 삭제(저장 전) → 남은 문항만 보면 다음은 q_3이지만, 발급기는 q_3을 기억한다
    forms = forms.filter((f) => f.slot !== "q_3")
    forms = [...forms, newQuestionForm(slots.allocate())]
    expect(forms.map((f) => f.slot)).toEqual(["q_1", "q_2", "q_4"])
    // 방금 만든 q_4도 지우고 또 추가 → q_5
    forms = forms.filter((f) => f.slot !== "q_4")
    forms = [...forms, newQuestionForm(slots.allocate())]
    expect(forms.map((f) => f.slot)).toEqual(["q_1", "q_2", "q_5"])
  })

  it("저장된 정본에 빈 번호가 있어도(q_1, q_3) 다음은 q_4다 — 정상이다", () => {
    const slots = createSlotAllocator(["q_1", "q_3"])
    expect(slots.allocate()).toBe("q_4")
  })

  it("열린 대화의 제안이 가리키는 슬롯도 쓴 번호로 친다 (지워진 문항의 제안이 새 문항에 붙지 않게)", () => {
    // 정본에는 q_1·q_2만 남았지만 대화에는 지워진 q_3의 제안이 남아 있다
    const slots = createSlotAllocator(["q_1", "q_2", "q_3"])
    expect(slots.allocate()).toBe("q_4")
  })

  it("순서를 바꿔도 슬롯은 바뀌지 않는다", () => {
    const [a, b, c] = seedQuestionForms()
    const reordered = toCoverLetterBody([c, a, b])
    expect(reordered.questions.map((q) => [q.slot, q.question_id])).toEqual([
      [c.slot, c.question_id],
      [a.slot, a.question_id],
      [b.slot, b.question_id],
    ])
  })

  it("저장 왕복(폼 → 정본 → 폼) 뒤에도 슬롯·순서가 그대로다", () => {
    const [a, b, c] = seedQuestionForms()
    const extra = newQuestionForm("q_7")
    // q_2를 지우고, q_7을 맨 앞으로 옮긴 폼
    const sent = toCoverLetterBody([extra, a, c])
    // 정본은 받은 slot을 그대로, sort_order를 1부터 — 배열 순서가 섞여 와도 sort_order로 되살린다
    const stored = { questions: [...sent.questions].reverse() }
    const back = toQuestionForms(stored)
    expect(back.map((f) => f.slot)).toEqual(["q_7", "q_1", "q_3"])
    expect(back.map((f) => f.question_id)).toEqual([extra.question_id, a.question_id, c.question_id])
    void b
  })
})
