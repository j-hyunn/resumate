/**
 * A3 display labels (client-safe). Copy comes from the specs where given; `[UI-가정]` marks
 * labels the spec doesn't give (v3 detail specs for S-15~S-19 are not in the repo).
 */
import type {
  CountBasis,
  DraftSourceOrigin,
  DraftSourceRole,
  DraftStatus,
  DraftType,
  GapActionType,
  JdRequirementCategory,
  DraftSelectionOrigin,
} from "@/types/db"

/** AI-01 카테고리 기준 (03 AI-01: 주요 업무 / 자격요건 / 우대사항) */
export const REQUIREMENT_CATEGORY_LABELS: Record<JdRequirementCategory, string> = {
  responsibility: "주요 업무",
  required: "자격요건",
  preferred: "우대사항",
}
export const REQUIREMENT_CATEGORY_ORDER: JdRequirementCategory[] = ["responsibility", "required", "preferred"]

/** importance = 'high' — // [UI-가정] design-system P-3 */
export const IMPORTANCE_HIGH_LABEL = "핵심"

export const DRAFT_TYPE_LABELS: Record<DraftType, string> = {
  career_description: "경력기술서",
  cover_letter: "자소서 문항 답변", // D-UX-23 (U36-2): the application project itself is "자기소개서"
}

/** drafts.status (02 S-17 v5.3 초안 목록 상태). partially_failed는 화면에서 "{n}개 문항 생성 실패" */
export const DRAFT_STATUS_LABELS: Record<DraftStatus, string> = {
  composing: "작성 중",
  generating: "생성 중",
  ready: "완료",
  partially_failed: "일부 실패",
  failed: "생성 실패",
}

/** C-11 role / origin (design-system 3.10) */
export const SOURCE_ROLE_LABELS: Record<DraftSourceRole, string> = { primary: "주 근거", supporting: "보조" }
export const SOURCE_ORIGIN_LABELS: Record<DraftSourceOrigin, string> = { ai: "AI 선택", user: "내가 추가" }

/**
 * S-19 생성 직후 안내 "포함하지 않은 항목" — AI-03 `omitted[].reason` (03 AI-03: user_excluded | low_relevance). QA-W5-01.
 * `user_excluded` also covers the projects over the 8 cap, which the "확인해 주세요" note explains. // [UI-가정] 문구
 */
export const OMITTED_REASON_LABELS: Record<string, string> = {
  user_excluded: "포함 항목 설정에 따라 이번 초안에 넣지 않았어요",
  low_relevance: "이 자기소개서와 관련이 적어 이번 초안에 넣지 않았어요",
}
/** a reason this screen doesn't know yet // [UI-가정] */
export const OMITTED_REASON_FALLBACK = "이번 초안에 넣지 않았어요"
/** the project isn't in the source tree any more (deleted or back to 작성 중 since the run) // [UI-가정] */
export const OMITTED_PROJECT_FALLBACK = "지금은 찾을 수 없는 프로젝트"

/** C-11 drafts.options.selection_origin */
export const SELECTION_ORIGIN_LABELS: Record<DraftSelectionOrigin, string> = {
  insight: "인사이트 우선순위",
  ai_ranking: "AI가 고름",
  user: "직접 고름",
}

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
