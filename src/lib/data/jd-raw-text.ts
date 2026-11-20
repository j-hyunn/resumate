/**
 * 공고 원문 입력 규칙과 문구 (S-14 입력 검사, S-15 공고 내용 수정). Client-safe, pure.
 * Values are implementation values marked [가정] in 02 S-14 / 04 §4.5. (v5.21, JR-1·JR-7) 요건 추출이 없어
 * 공고 원문은 그대로 쓰이고, 언제든 고칠 수 있다(진행 중 인사이트만 막는다).
 */
import type { AiErrorCode } from "@/types/db"

/** 04 §4.5 raw_text 상한 (막는 값) */
export const JD_RAW_TEXT_MAX = 50_000
/** 02 S-14: 200자 미만 경고 (막지 않음) */
export const JD_RAW_TEXT_SHORT = 200
/** 02 S-14: 24,000자 초과 경고 (막지 않음) */
export const JD_RAW_TEXT_LONG = 24_000

/** (v5.21, JR-1) S-14 입력 검사 `[가정]` 문구 */
export const JD_SHORT_WARNING = "공고가 짧아요. 전체 공고를 붙여넣으면 인사이트가 더 정확해져요"
export const JD_LONG_WARNING = "공고가 길어요. 공고와 관계없는 부분은 빼 주세요"

/** (v5.21) `jd_no_sentences` — S-14 생성 · S-15 저장 · S-16 생성 거부 `[가정]` 문구 */
export const JD_NO_SENTENCES_MESSAGE = "공고 내용을 확인해 주세요. 문장으로 읽을 수 있는 내용이 없어요"

/** (v5.21, JR-7) S-14 ② 공고 원문 안내 `[가정]` */
export const JD_RAW_TEXT_EDITABLE_NOTE = "만든 뒤에도 채용 공고 탭에서 공고 내용을 고칠 수 있어요"

/** (v5.21, JR-7) S-15 [공고 내용 수정] 비활성 이유 · `jd_job_in_progress` 저장 거부 `[가정]` */
export const JD_LOCKED_IN_PROGRESS_MESSAGE = "인사이트를 만드는 중에는 수정할 수 없어요"

/**
 * C-20 "입력 원인 실패의 이동" 인사이트 행 (v5.21, JR-7): 공고 원문을 고쳐 풀 수 있는 원인 → S-15 공고 내용 수정
 * 상태로 연다. (`not_a_jd`는 폐기 — AI-01이 내던 원인. `insufficient_data`는 C-09)
 */
export function isJdFixableFailure(code: AiErrorCode | null | undefined): boolean {
  return code === "input_too_long" || code === "safety_blocked"
}
