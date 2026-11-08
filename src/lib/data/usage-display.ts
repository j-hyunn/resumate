/**
 * S-42 표시 7행 묶음 (AI C-13.1, DM 2.9.5 — SD-4·SD-A12). Client-safe constant (no server imports):
 * the S-24 ② 사용량 표(`AiUsageByProvider`, client component) reads it directly. **표시 단계 상수**다 —
 * RPC·데이터 계층은 저장 값 8개를 그대로 돌려주고, 이 표만 `career_description` + `cover_letter`를
 * "자기소개서 작성 AI 채팅" 한 행으로 접는다. 묶음 정의의 유일한 원천은 AI 명세 C-13.1 표다.
 * (`src/lib/data/ai-usage.ts`가 같은 이름으로 다시 내보낸다.)
 */
import type { AiUsageFeature } from "@/types/db"

export const USAGE_FEATURE_DISPLAY_GROUPS: ReadonlyArray<{ label: string; features: readonly AiUsageFeature[] }> = [
  { label: "프로젝트/산출물 작성 AI 채팅", features: ["writing_chat"] },
  { label: "요건 추출", features: ["jd_extraction"] },
  { label: "인사이트", features: ["insight"] },
  { label: "자기소개서 작성 AI 채팅", features: ["career_description", "cover_letter"] },
  { label: "면접 질문", features: ["interview_questions"] },
  { label: "면접 채점", features: ["interview_evaluation"] },
  { label: "연결 확인", features: ["key_verification"] },
]
