/**
 * 공급자 화면 이름·순서·플랜 안내 (UX v5.17 S-40 · S-42, design-system 5.11.2). Plain module (no "use client")
 * so server components (S-30 AI 데이터 처리) and client rows read the same values.
 * 이름은 `AI_PROVIDER_LABELS` 하나가 원천이다 (확정 2026-11-06 (사용자, UI42-5) — `openai` = "GPT").
 */
import type { AiProviderName } from "@/types/db"
import { AI_PROVIDER_LABELS } from "@/lib/mock/ai-providers"

/** 행 순서 고정 Gemini → GPT → Claude (UX v5.17 S-40; v5.10 Gemini → Claude → GPT에서 바뀜) */
export const PROVIDER_ROW_ORDER: readonly AiProviderName[] = ["gemini", "openai", "anthropic"]

/** 행·사용량 탭의 화면 이름 = `AI_PROVIDER_LABELS` (C-19·C-20과 같은 글자) */
export const PROVIDER_ROW_NAMES: Record<AiProviderName, string> = AI_PROVIDER_LABELS

/** 플랜 안내 (UX v5.17 SD-1 — 키를 발급·사용할 수 있는 플랜 조건 안내, 구독 계정 연결 아님) */
export const PROVIDER_PLAN_NOTES: Record<AiProviderName, string> = {
  gemini: "무료/유료 가능",
  openai: "GPT Pro 플랜 이상만 가능",
  anthropic: "Claude MAX 플랜 이상만 가능",
}
