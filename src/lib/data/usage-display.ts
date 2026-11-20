/**
 * S-42 표시 행 묶음 (AI C-13.1, DM 2.9.5 — SD-4·SD-A12; R14 RM-A2: 면접 2행 삭제). Client-safe constant (no server imports):
 * the S-24 ② 사용량 표(`AiUsageByProvider`, client component) reads it directly. **표시 단계 상수**다 —
 * RPC·데이터 계층은 저장 값을 그대로 돌려주고, 이 표만 `career_description` + `cover_letter`를
 * "자기소개서 작성 AI 채팅" 한 행으로 접는다. 묶음 정의의 유일한 원천은 AI 명세 C-13.1 표다.
 * (`src/lib/data/ai-usage.ts`가 같은 이름으로 다시 내보낸다.)
 *
 * (v5.21, JR-Q5 `[가정]`) **기본 4행** + 과거 AI-01 기록(`jd_extraction`)이 **있는 달에만** 맨 아래 "JD 요건 추출(종료)"
 * 행(`legacy: true`). 그 행은 늘 맨 아래다(5.1o "S-42 과거 기록 행은 늘 맨 아래").
 */
import type { AiUsageFeature } from "@/types/db"

export interface UsageFeatureDisplayGroup {
  label: string
  features: readonly AiUsageFeature[]
  /** a retired feature's row — shown only when the month has its records */
  legacy?: boolean
}

export const USAGE_FEATURE_DISPLAY_GROUPS: ReadonlyArray<UsageFeatureDisplayGroup> = [
  { label: "프로젝트/산출물 작성 AI 채팅", features: ["writing_chat"] },
  { label: "인사이트", features: ["insight"] },
  { label: "자기소개서 작성 AI 채팅", features: ["career_description", "cover_letter"] },
  { label: "연결 확인", features: ["key_verification"] },
  { label: "JD 요건 추출(종료)", features: ["jd_extraction"], legacy: true },
]

/** The rows to show for a month: every base row, a legacy row only when `hasRecords(features)` (JR-Q5) */
export function visibleUsageGroups(hasRecords: (features: readonly AiUsageFeature[]) => boolean): UsageFeatureDisplayGroup[] {
  return USAGE_FEATURE_DISPLAY_GROUPS.filter((g) => !g.legacy || hasRecords(g.features))
}
