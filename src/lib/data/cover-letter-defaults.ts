/**
 * 자소서 문항 기본값 (UX v5.20 S-46 "문항 설정 상태", OD-D1 K-28 문구).
 *
 * 기본 3문항과 "+ 문항 추가"로 만든 문항에 **글자 수 제한 800자**를 미리 채운다
 * (CF-U2 확정 2026-11-08 — 시안의 600은 쓰지 않는다). DB 기본값은 없고 화면이 채운다.
 */
import type { CoverLetterTemplateKey, CountBasis } from "@/types/db"

/** 문항 최대 개수 (v5.20, CF-5 — 이전 10) */
export const COVER_LETTER_MAX_QUESTIONS = 5

/** 글자 수 제한 기본값 (v5.20, CF-U2 확정) */
export const COVER_LETTER_DEFAULT_CHAR_LIMIT = 800

/** 글자 수 제한 범위 (DM 2.7.3) */
export const COVER_LETTER_CHAR_LIMIT_MIN = 1
export const COVER_LETTER_CHAR_LIMIT_MAX = 10_000

/** 글자 수 기준 기본값 — 공백 포함 `[UI-가정]` (UX S-46) */
export const COVER_LETTER_DEFAULT_COUNT_BASIS: CountBasis = "with_spaces"

/** 입력 상한 (DM 4.5) */
export const COVER_LETTER_LIMITS = {
  question_text: 1_000,
  answer_title: 100,
  user_note: 300,
  body: 8_000,
} as const

/** 기본 3문항 (문구는 OD-D1 K-28 그대로) */
export const COVER_LETTER_DEFAULT_QUESTIONS: ReadonlyArray<{
  template_key: CoverLetterTemplateKey
  question_text: string
}> = [
  { template_key: "motivation", question_text: "지원 동기를 작성해 주세요." },
  { template_key: "job_competency", question_text: "직무 역량을 보여 줄 수 있는 경험을 작성해 주세요." },
  { template_key: "future_plan", question_text: "입사 후 포부 및 성장 계획을 작성해 주세요." },
]

/** 입사 후 포부 문항의 메모 힌트 (UX S-46 문항 설정 상태) */
export const COVER_LETTER_FUTURE_PLAN_NOTE_HINT = "배운 점이 있으면 AI가 참고해요"
