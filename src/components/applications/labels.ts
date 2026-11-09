/**
 * 자기소개서 관리 표시 라벨 (client-safe). 문구는 명세가 주면 그대로, `[UI-가정]`은 명세에 없는 것.
 */
import type { CountBasis, GapActionType, JdRequirementCategory } from "@/types/db"

/** AI-01 카테고리 기준 (03 AI-01: 주요 업무 / 자격요건 / 우대사항) */
export const REQUIREMENT_CATEGORY_LABELS: Record<JdRequirementCategory, string> = {
  responsibility: "주요 업무",
  required: "자격요건",
  preferred: "우대사항",
}
export const REQUIREMENT_CATEGORY_ORDER: JdRequirementCategory[] = ["responsibility", "required", "preferred"]

/** importance = 'high' — // [UI-가정] design-system P-3 */
export const IMPORTANCE_HIGH_LABEL = "핵심"

/**
 * (v5.20, CF-1·CF-7) 폐기된 라벨: `DRAFT_TYPE_LABELS`(서류 2종) · `DRAFT_STATUS_LABELS`(S-17 초안
 * 목록 상태) · `SOURCE_ROLE_LABELS`·`SOURCE_ORIGIN_LABELS`·`SELECTION_ORIGIN_LABELS`(옛 C-11 근거
 * 선택) · `OMITTED_*`(AI-03 안내). 서류가 자소서 하나가 되고 S-17·S-19·S-45가 폐기돼 쓰는 화면이
 * 없어졌다. 새 C-11은 읽기 전용 목록이다(CL-5).
 */

export const COUNT_BASIS_LABELS: Record<CountBasis, string> = {
  with_spaces: "공백 포함",
  without_spaces: "공백 제외",
}

/** gaps[].actions[].type — // [UI-가정] screen labels not in the spec */
export const GAP_ACTION_LABELS: Record<GapActionType, string> = {
  add_data: "관련 경험 추가",
  reframe: "다르게 설명하기",
  prepare_answer: "면접 대비",
}
