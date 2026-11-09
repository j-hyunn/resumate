/**
 * S-46 문항 폼 모델 — 두 상태(문항 설정 / 작성)와 "문항 편집"이 함께 쓴다. 순수하므로 따로 테스트한다.
 *
 * 화면은 `char_limit`을 **문자열**로 들고 있다(빈 값을 구분해 "글자 수 제한을 입력해 주세요"를 띄우려면
 * 숫자로는 안 된다). 저장 직전에 숫자로 바꾼다 — R15 계약에서 `char_limit`은 **필수**이고 빈 값이면
 * 서버가 `invalid_fields`(경로 `questions.q_n.char_limit`)로 거부한다.
 *
 * **근거(`sources`)는 폼에 없다** (CF-S1·CF-S2): 문항 근거의 원천은 그 문항 초안 제안의 `sources[]`이고
 * 저장 RPC가 `applied_proposals`에서 `evidence_links`를 만든다. 화면은 근거를 저장 요청에 싣지 않는다.
 */
import type { CoverLetterBlock, CoverLetterBody, CoverLetterQuestion, CoverLetterTemplateKey, CountBasis, QuestionClass } from "@/types/db"
import {
  COVER_LETTER_CHAR_LIMIT_MAX,
  COVER_LETTER_CHAR_LIMIT_MIN,
  COVER_LETTER_DEFAULT_CHAR_LIMIT,
  COVER_LETTER_DEFAULT_COUNT_BASIS,
  COVER_LETTER_DEFAULT_QUESTIONS,
  COVER_LETTER_LIMITS,
} from "@/lib/data/cover-letter-defaults"

export interface QuestionForm {
  slot: string
  question_id: string
  question_text: string
  /** CF-6 — 글자 수 제한에 넣지 않는다 */
  answer_title: string
  /** 입력 문자열. 빈 값은 검증 오류 */
  char_limit: string
  count_basis: CountBasis
  user_note: string
  body: string
  template_key: CoverLetterTemplateKey | null
  question_class: QuestionClass | null
  blocks: CoverLetterBlock[]
}

function newQuestionId(): string {
  return typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `q-${Math.random().toString(36).slice(2)}`
}

/** 기본 3문항 (문구 OD-D1 K-28, 글자 수 제한 **800** = CF-U2 — 시안의 600은 쓰지 않는다) */
export function seedQuestionForms(): QuestionForm[] {
  return COVER_LETTER_DEFAULT_QUESTIONS.map((q, i) => ({
    slot: `q_${i + 1}`,
    question_id: newQuestionId(),
    question_text: q.question_text ?? "",
    answer_title: "",
    char_limit: String(COVER_LETTER_DEFAULT_CHAR_LIMIT),
    count_basis: COVER_LETTER_DEFAULT_COUNT_BASIS,
    user_note: "",
    body: "",
    template_key: q.template_key,
    question_class: q.template_key,
    blocks: [],
  }))
}

// ---------------------------------------------------------------------------
// 슬롯 키 (DM v4.15 2.5.1 "슬롯 키 `slot` (확정)")
//
// `slot`은 서류 안에서 문항을 가리키는 **짧은 안정 키** `q_{n}`이다. `p_applied_proposals`·
// `evidence_links.item_key`(`{slot}.sources.{n}`·`{slot}.blocks.{id}`)·모델 입출력이 모두 이 키를 쓴다.
// 그래서 **문항이 처음 생길 때 한 번 정하고 그 뒤로 바꾸지 않는다**. 번호는 그 서류에서 한 번 쓰면
// **재사용하지 않는다**(지워진 슬롯의 근거 행과 섞이지 않게). 화면 순서는 **`sort_order`만**으로 나타낸다.
// 저장 RPC는 받은 `slot`을 그대로 쓰고 다시 매기지 않는다. `q_1, q_3`처럼 빈 번호가 있는 정본은 정상이다.
// ---------------------------------------------------------------------------

const SLOT_RE = /^q_([0-9]{1,3})$/

/** `q_{n}`의 n (형식이 아니면 null) */
export function slotNumber(slot: string): number | null {
  const m = SLOT_RE.exec(slot)
  return m ? Number(m[1]) : null
}

/**
 * 다음 슬롯 = 지금까지 **이 서류에서 쓴 적 있는** 번호의 최댓값 + 1.
 * `used`에는 저장된 정본의 슬롯 · 이번 방문에 만든(지운 것 포함) 슬롯 · 대화 제안이 가리키는 슬롯을
 * 모두 넣는다 — 지금 폼에 남은 문항만 보면 방금 지운 번호를 다시 쓰게 된다.
 */
export function nextSlot(used: Iterable<string>): string {
  let max = 0
  for (const s of used) {
    const n = slotNumber(s)
    if (n !== null && n > max) max = n
  }
  return `q_${max + 1}`
}

/**
 * 슬롯 발급기 — 화면이 한 방문 동안 하나를 들고 있다. 발급한 번호는 그 문항을 지워도 기억해서
 * 다시 내주지 않는다.
 */
export function createSlotAllocator(initiallyUsed: Iterable<string>): { allocate: () => string; markUsed: (slots: Iterable<string>) => void } {
  const used = new Set<string>()
  const markUsed = (slots: Iterable<string>) => {
    for (const s of slots) if (slotNumber(s) !== null) used.add(s)
  }
  markUsed(initiallyUsed)
  return {
    allocate: () => {
      const slot = nextSlot(used)
      used.add(slot)
      return slot
    },
    markUsed,
  }
}

/** "+ 문항 추가": 빈 문항 하나 (글자 수 제한 800 미리 채움). `slot`은 발급기에서 받는다 */
export function newQuestionForm(slot: string): QuestionForm {
  return {
    slot,
    question_id: newQuestionId(),
    question_text: "",
    answer_title: "",
    char_limit: String(COVER_LETTER_DEFAULT_CHAR_LIMIT),
    count_basis: COVER_LETTER_DEFAULT_COUNT_BASIS,
    user_note: "",
    body: "",
    template_key: null,
    question_class: null,
    blocks: [],
  }
}

/** 정본 → 폼. 화면 순서는 `sort_order`이고 `slot`은 받은 그대로 둔다 (UQ-740) */
export function toQuestionForms(body: CoverLetterBody): QuestionForm[] {
  return [...body.questions].sort((a, b) => a.sort_order - b.sort_order).map((q) => ({
    slot: q.slot,
    question_id: q.question_id,
    question_text: q.question_text ?? "",
    answer_title: q.answer_title ?? "",
    char_limit: String(q.char_limit ?? ""),
    // DB가 null을 허용하는 것이 정본이다 — 화면은 기본값으로 좁혀 쓴다 (기준 기본 = 공백 포함)
    count_basis: q.count_basis ?? COVER_LETTER_DEFAULT_COUNT_BASIS,
    user_note: q.user_note ?? "",
    body: q.body,
    template_key: q.template_key,
    question_class: q.question_class,
    blocks: q.blocks,
  }))
}

/**
 * 저장 입력 — **`slot`은 그대로 보내고 `sort_order`만 화면 순서로 매긴다**(UQ-740).
 * 순서를 바꾸거나 문항을 지워도 남은 문항의 슬롯이 바뀌지 않아야 근거·제안이 제 문항에 붙어 있다.
 */
export function toCoverLetterBody(forms: QuestionForm[]): CoverLetterBody {
  return {
    questions: forms.map((f, i): CoverLetterQuestion => ({
      slot: f.slot,
      question_id: f.question_id,
      question_text: f.question_text.trim(),
      answer_title: f.answer_title.trim() || null,
      template_key: f.template_key,
      question_class: f.question_class,
      char_limit: Number(f.char_limit),
      count_basis: f.count_basis,
      user_note: f.user_note.trim() || null,
      body: f.body,
      blocks: f.blocks,
      sort_order: i + 1,
    })),
  }
}

// ---------------------------------------------------------------------------
// 검증 (UX S-46 "검증")
// ---------------------------------------------------------------------------

export interface QuestionErrors {
  question_text?: string
  char_limit?: string
  answer_title?: string
  user_note?: string
  body?: string
}

export const QUESTION_ERROR_COPY = {
  question_required: "문항을 입력해 주세요",
  limit_required: "글자 수를 입력해 주세요",
  limit_range: "1~10,000자 사이로 입력해 주세요",
} as const

export function fieldTooLong(limit: number): string {
  return `${limit.toLocaleString()}자까지 쓸 수 있어요`
}

/** 저장을 막는 검증 — 첫 오류 칸에 포커스를 주려고 index를 함께 돌려준다 */
export function validateQuestions(forms: QuestionForm[]): { errors: Record<number, QuestionErrors>; firstIndex: number | null } {
  const errors: Record<number, QuestionErrors> = {}
  forms.forEach((f, i) => {
    const e: QuestionErrors = {}
    if (!f.question_text.trim()) e.question_text = QUESTION_ERROR_COPY.question_required
    else if (f.question_text.length > COVER_LETTER_LIMITS.question_text) e.question_text = fieldTooLong(COVER_LETTER_LIMITS.question_text)
    const limit = f.char_limit.trim()
    if (!limit) e.char_limit = QUESTION_ERROR_COPY.limit_required
    else {
      const n = Number(limit)
      if (!Number.isFinite(n) || !Number.isInteger(n) || n < COVER_LETTER_CHAR_LIMIT_MIN || n > COVER_LETTER_CHAR_LIMIT_MAX)
        e.char_limit = QUESTION_ERROR_COPY.limit_range
    }
    if (f.answer_title.length > COVER_LETTER_LIMITS.answer_title) e.answer_title = fieldTooLong(COVER_LETTER_LIMITS.answer_title)
    if (f.user_note.length > COVER_LETTER_LIMITS.user_note) e.user_note = fieldTooLong(COVER_LETTER_LIMITS.user_note)
    if (f.body.length > COVER_LETTER_LIMITS.body) e.body = fieldTooLong(COVER_LETTER_LIMITS.body)
    if (Object.keys(e).length > 0) errors[i] = e
  })
  const indexes = Object.keys(errors).map(Number)
  return { errors, firstIndex: indexes.length > 0 ? Math.min(...indexes) : null }
}

/** 손대지 않은 기본 3문항만 있는 새 화면은 "변경 없음"으로 본다 (UX S-46 `[가정]`) */
export function isUntouchedSeed(forms: QuestionForm[]): boolean {
  if (forms.length !== COVER_LETTER_DEFAULT_QUESTIONS.length) return false
  return forms.every(
    (f, i) =>
      f.question_text === COVER_LETTER_DEFAULT_QUESTIONS[i].question_text &&
      f.char_limit === String(COVER_LETTER_DEFAULT_CHAR_LIMIT) &&
      f.count_basis === COVER_LETTER_DEFAULT_COUNT_BASIS &&
      !f.user_note.trim() &&
      !f.answer_title.trim() &&
      !f.body.trim(),
  )
}

/** 글자 수 표시 — **내용만** 센다 (제목 제외, CF-6) */
export function countChars(body: string, basis: CountBasis): number {
  return basis === "without_spaces" ? body.replace(/\s/g, "").length : body.length
}

/** 전체 복사 / 문항 복사 — 문항 + 제목 + 답변을 순서대로 (제목도 넣는다 `[UI-가정]`) */
export function questionClipboardText(f: QuestionForm, index: number): string {
  const lines = [`${index}. ${f.question_text.trim()}`]
  if (f.answer_title.trim()) lines.push(f.answer_title.trim())
  lines.push(f.body.trim())
  return lines.filter(Boolean).join("\n\n")
}

export function allClipboardText(forms: QuestionForm[]): string {
  return forms.map((f, i) => questionClipboardText(f, i + 1)).join("\n\n---\n\n")
}
