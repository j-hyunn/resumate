/**
 * C-21 AI 데이터 사용 고지 본문 (UX v5.13 C-21, OD-L2 / OD-L2a). Facts per provider × tier come from
 * AI spec v4.11 C-7.1 (provider terms re-checked 2026-11-05 — re-check before launch). Screen copy only:
 * the consent record and `requires_reconsent` live in `ai_disclosures` (DM 2.11.6, backend migration).
 *
 * Moved out of `src/lib/mock/ai-providers.ts` (decisions 4.12 UI 10): the real screens read this module.
 */
import type { AiProviderName, ConnectionTier } from "@/types/db"

/** ai_disclosures.version of these facts (DM 2.11.6). Claude rows require re-consent (OD-L2a). */
export const DISCLOSURE_VERSION = "v2026-11-05"
/** terms_checked_at of this version (AI C-7.1 확인일) */
export const DISCLOSURE_TERMS_CHECKED_AT = "2026-11-05"

export interface DisclosureFacts {
  /** 처리 국가 (C-21 "공급자·처리 국가") */
  country: string
  training: string
  human_review: string
  retention: string
  terms_url: string
}

const GEMINI_TERMS = "https://aistudio.google.com/docs/terms"
const OPENAI_DATA = "https://developers.openai.com/api/docs/guides/your-data"
const ANTHROPIC_RETENTION = "https://privacy.claude.com/en/articles/7996866-how-long-do-you-store-my-organization-s-data"

const OPENAI: DisclosureFacts = {
  country: "국외(미국)",
  training: "API 데이터는 학습에 쓰지 않아요(조직이 직접 데이터 공유를 켠 경우만 예외)",
  human_review: "일반 검토는 없어요. 정책 위반이 의심되는 경우에 한해 검토될 수 있어요",
  retention: "남용 감시 로그 최대 30일(법적 의무 등이 있으면 더 길 수 있어요)",
  terms_url: OPENAI_DATA,
}

// OD-L2a: inference region default `global`, storage in the US → re-consent
const ANTHROPIC: DisclosureFacts = {
  country: "추론: global(여러 국가) · 저장: 미국",
  training: "학습에 쓰지 않아요",
  human_review: "정책 위반으로 자동 표시된 경우 보관 기간이 늘어나요",
  retention: "입력·출력은 30일 이내 자동 삭제돼요(정책 위반 표시 건은 최대 2년)",
  terms_url: ANTHROPIC_RETENTION,
}

export const DISCLOSURE_FACTS: Record<AiProviderName, Record<ConnectionTier, DisclosureFacts>> = {
  gemini: {
    free: {
      country: "국외(미국 등)",
      training: "Google 제품 개선·ML 기술 개발에 쓰여요",
      human_review: "사람 검토자가 입력·출력을 읽을 수 있어요(계정·키와 분리한 뒤)",
      retention: "남용 감시 로그 55일. 제품 개선에 쓰는 데이터의 보관 기간은 공개되지 않았어요",
      terms_url: GEMINI_TERMS,
    },
    paid: {
      country: "국외(미국 등)",
      training: "제품 개선에 쓰지 않아요",
      human_review: "남용 감시에서 위반 의심으로 표시된 경우에만 검토될 수 있어요",
      retention: "남용 감시 로그 55일",
      terms_url: GEMINI_TERMS,
    },
  },
  anthropic: { free: ANTHROPIC, paid: ANTHROPIC },
  openai: { free: OPENAI, paid: OPENAI },
}

/** C-21 "전송되는 데이터" — D-DM-12 (a): includes unsaved form content (OD-L2) */
export const SENT_DATA_ITEMS = ["커리어 데이터(작성 중인(저장하지 않은) 내용 포함)", "공고 원문", "자소서 메모", "면접 답변", "AI 작성 대화"] as const

/**
 * R-OD-15: the free-tier data-use sentence, the emphasized notice and its checkbox apply only where the
 * provider uses inputs for training (AI C-7.1) — today Gemini free only.
 */
export function usesInputsForTraining(provider: AiProviderName | null | undefined, tier: ConnectionTier | null | undefined): boolean {
  return provider === "gemini" && tier === "free"
}
