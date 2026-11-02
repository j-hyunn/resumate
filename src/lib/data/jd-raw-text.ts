/**
 * 공고 원문 입력 규칙 (S-14 입력 검사, S-15 공고 원문 수정). Client-safe, pure.
 * Values are implementation values marked [가정] in 02 S-14 / 04 §4.5.
 */
import type { AiErrorCode } from "@/types/db"

/** 04 §4.5 raw_text 상한 (막는 값) */
export const JD_RAW_TEXT_MAX = 50_000
/** 02 S-14: 200자 미만 경고 (막지 않음) */
export const JD_RAW_TEXT_SHORT = 200
/** 02 S-14: 24,000자 초과 경고 (막지 않음) */
export const JD_RAW_TEXT_LONG = 24_000

export const JD_SHORT_WARNING = "공고가 짧아요. 전체 공고를 붙여넣으면 요건을 더 정확히 정리해요"
export const JD_LONG_WARNING = "공고가 길어요. 공고와 관계없는 부분은 빼 주세요"

/** C-20 "입력 원인 실패의 이동" (Q53-2 · 9): failures that S-15 can fix by editing the 공고 원문 */
export function isInputCausedJdFailure(code: AiErrorCode | null | undefined): boolean {
  return code === "not_a_jd" || code === "input_too_long" || code === "safety_blocked"
}
