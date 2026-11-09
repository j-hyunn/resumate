import { describe, expect, it } from "vitest"
import {
  allClipboardText,
  countChars,
  isUntouchedSeed,
  newQuestionForm,
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
    expect(newQuestionForm().char_limit).toBe(String(COVER_LETTER_DEFAULT_CHAR_LIMIT))
  })

  it("손대지 않은 기본 3문항만 있으면 변경 없음으로 본다", () => {
    expect(isUntouchedSeed(seedQuestionForms())).toBe(true)
    const touched = seedQuestionForms()
    touched[0] = { ...touched[0], char_limit: "1000" }
    expect(isUntouchedSeed(touched)).toBe(false)
    expect(isUntouchedSeed([...seedQuestionForms(), newQuestionForm()])).toBe(false)
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

  it("저장 입력은 slot·sort_order를 순서대로 다시 매기고 근거를 싣지 않는다 (CF-S1·CF-S2)", () => {
    const forms = seedQuestionForms()
    const body = toCoverLetterBody([forms[2], forms[0], forms[1]])
    expect(body.questions.map((q) => q.slot)).toEqual(["q_1", "q_2", "q_3"])
    expect(body.questions.map((q) => q.sort_order)).toEqual([1, 2, 3])
    expect(body.questions[0].char_limit).toBe(COVER_LETTER_DEFAULT_CHAR_LIMIT)
    // 저장 입력에 `sources` 키가 없다 — 서버가 applied_proposals의 제안에서 evidence_links를 만든다
    for (const q of body.questions) expect("sources" in q).toBe(false)
  })

  it("빈 제목·메모는 null로 보낸다 (CF-6)", () => {
    const f = { ...newQuestionForm(), question_text: "문항", answer_title: "  ", user_note: "" }
    const q = toCoverLetterBody([f]).questions[0]
    expect(q.answer_title).toBeNull()
    expect(q.user_note).toBeNull()
  })

  it("글자 수는 내용만 센다 — 기준에 따라 공백을 뺀다 (CF-6)", () => {
    expect(countChars("가 나 다", "with_spaces")).toBe(5)
    expect(countChars("가 나 다", "without_spaces")).toBe(3)
  })

  it("복사에는 제목이 들어간다", () => {
    const f = { ...newQuestionForm(), question_text: "지원 동기", answer_title: "결제 장애를 줄인 경험", body: "본문" }
    expect(questionClipboardText(f, 1)).toBe("1. 지원 동기\n\n결제 장애를 줄인 경험\n\n본문")
    const noTitle = { ...f, answer_title: "" }
    expect(questionClipboardText(noTitle, 2)).toBe("2. 지원 동기\n\n본문")
    expect(allClipboardText([f, noTitle])).toContain("\n\n---\n\n")
  })
})
