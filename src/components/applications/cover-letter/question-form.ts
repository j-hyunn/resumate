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
export function createSlotAllocator(
  initiallyUsed: Iterable<string>,
  /**
   * 정본이 기억하는 **쓴 적 있는 최고 번호**(`application_documents.slot_high_water`, R15 후속 3).
   * 서버는 저장한 번호를, 화면은 저장하지 않은 번호(열린 제안·이번 방문 발급분)를 맡는다 — 새 번호는
   * `max(highWater, 열린 제안, 이번 방문 발급분) + 1`. 값이 없으면 0이다.
   */
  opts: { highWater?: number } = {},
): {
  allocate: (inUse?: Iterable<string>) => string
  markUsed: (slots: Iterable<string>) => void
  /** 저장 응답의 `slotHighWater`를 넣는다(내려가지 않는다) */
  markHighWater: (n: number) => void
} {
  const used = new Set<string>()
  const markHighWater = (n: number) => {
    const hw = Math.max(0, Math.floor(n))
    if (hw > 0) used.add(`q_${hw}`)
  }
  markHighWater(opts.highWater ?? 0)
  const markUsed = (slots: Iterable<string>) => {
    for (const s of slots) if (slotNumber(s) !== null) used.add(s)
  }
  markUsed(initiallyUsed)
  return {
    /**
     * `inUse` = **발급하는 그 순간 화면에 있는 모든 슬롯**(`slotsInUse()`가 모은다 — 지금 폼 · 정본 · 열린
     * 대화의 제안). 발급기가 따로 기억하지 못한 길(입력 보존 복원 · 기록에서 연 대화 — UQ-756·757)로
     * 들어온 번호도 이렇게 매번 한 함수를 지나 "쓴 번호"가 된다.
     */
    allocate: (inUse?: Iterable<string>) => {
      if (inUse) markUsed(inUse)
      const slot = nextSlot(used)
      used.add(slot)
      return slot
    },
    markUsed,
    markHighWater,
  }
}

/**
 * 발급 순간 "쓴 번호"로 칠 슬롯을 **한 곳에서** 모은다 (UQ-756·757): 지금 폼(입력 보존으로 되살린 문항 포함) ·
 * 저장된 정본 · 지금 열린 대화의 제안. 번호가 들어오는 길을 이 함수 하나로 모아, 새 길이 생겨도 빠뜨리지 않게 한다.
 */
export function slotsInUse(sources: {
  forms: ReadonlyArray<{ slot: string }>
  document?: { body: { questions: ReadonlyArray<{ slot: string }> } } | null
  chat?: { structured_draft: { document: { questions: ReadonlyArray<{ slot: string }> } } } | null
}): string[] {
  return [
    ...sources.forms.map((f) => f.slot),
    ...(sources.document?.body.questions.map((q) => q.slot) ?? []),
    ...(sources.chat?.structured_draft.document.questions.map((q) => q.slot) ?? []),
  ]
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

/**
 * `invalid_slot` 거부 문구 `[UI-가정]` — 문항 키가 겹치거나 형식이 아닐 때. 문항을 지우고 다시 넣으면 새 키를 받는다.
 * (UQ-756 — 예전에는 "저장 실패"로만 보여 원인을 알 수 없었다)
 */
export function invalidSlotCopy(questionNo: number | null): string {
  return questionNo
    ? `문항 ${questionNo}의 키가 다른 문항과 겹쳐 저장하지 못했어요. 그 문항을 지우고 다시 추가해 주세요`
    : "문항 키가 겹쳐 저장하지 못했어요. 마지막에 추가한 문항을 지우고 다시 추가해 주세요"
}

// ---------------------------------------------------------------------------
// CF-S8 (확정 2026-11-10, 사용자) — 턴 전에 저장할지 판정
//
// AI가 초안 대상으로 아는 문항은 **저장된 문항뿐**이다(`form_snapshot`은 저장된 문항의 값만 덮는다,
// DM 2.5.1). 그래서 문항 **추가·삭제·순서 바꿈**이 저장되지 않은 채로 턴을 보내면 화면이 먼저 저장한다.
// 판정은 저장된 정본의 `[slot, question_id]` 순서 목록과 지금 폼의 목록을 비교한다 — 답변·제목·메모 같은
// **값만** 바뀐 경우는 거짓(스냅숏이 이미 덮는다 `[가정]`).
// ---------------------------------------------------------------------------

export type QuestionStructure = ReadonlyArray<readonly [slot: string, questionId: string]>

/** 문항 구성 = 순서대로 `[slot, question_id]` */
export function questionStructure(questions: ReadonlyArray<{ slot: string; question_id: string; sort_order?: number }>): QuestionStructure {
  const ordered = questions.every((q) => typeof q.sort_order === "number") ? [...questions].sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0)) : questions
  return ordered.map((q) => [q.slot, q.question_id] as const)
}

/**
 * 저장되지 않은 **문항 구성 변경**(추가·삭제·순서 바꿈)이 있는가. `stored`가 `null`(정본 행 없음 = 문항 설정
 * 상태)이면 대화가 없으니 해당 없음 → 거짓.
 */
export function questionStructureChanged(stored: QuestionStructure | null, forms: ReadonlyArray<{ slot: string; question_id: string }>): boolean {
  if (!stored) return false
  if (stored.length !== forms.length) return true
  return forms.some((f, i) => f.slot !== stored[i][0] || f.question_id !== stored[i][1])
}
