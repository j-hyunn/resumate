/**
 * Provider reference data (mock), client-safe. Leader decision Q-6: provider URLs live here as
 * mock constants shaped like the `ai_providers` table (+ a few UI fields the table doesn't have
 * yet), to be replaced by backend data later. Also mock model IDs, price table and disclosures.
 *
 * Model IDs: Anthropic IDs come from 03-ai-features C-10; Gemini / OpenAI mappings are "Flash 계열"
 * / "GPT-5 계열" in the spec without fixed IDs → mock IDs. // [UI-가정]
 * URLs: public provider pages, unverified for the mock. // [UI-가정]
 */
import type {
  AiDisclosure,
  AiPriceTable,
  AiProvider,
  AiProviderName,
  ConnectionTier,
  ModelTier,
} from "@/types/db"

/** Display order is fixed: Gemini → Claude → OpenAI (S-40) */
export const AI_PROVIDER_ORDER: readonly AiProviderName[] = ["gemini", "anthropic", "openai"]

/** C-19 / C-20 공급자 이름 (no logos — leader decision Q-4) */
export const AI_PROVIDER_LABELS: Record<AiProviderName, string> = {
  gemini: "Gemini",
  anthropic: "Claude",
  openai: "OpenAI",
}

/** S-40 카드 제목 (전체 이름) */
export const AI_PROVIDER_FULL_NAMES: Record<AiProviderName, string> = {
  gemini: "Google Gemini",
  anthropic: "Anthropic Claude",
  openai: "OpenAI",
}

/** ai_providers rows + UI-only URLs (status page, key issue page) */
export interface AiProviderInfo extends AiProvider {
  /** // [UI-가정] not a table column yet (Q-6) */
  status_url: string
  /** // [UI-가정] not a table column yet (Q-6) — S-41 ③ "{공급자} 키 발급 페이지 열기" */
  key_issue_url: string
  /** "upgrade guide" link for model_not_available (C-20) — // [UI-가정] */
  upgrade_url: string
  /** S-40 카드 설명 */
  description: string
  /** 기본 등급 (S-41 ①: Gemini 무료, 그 밖 유료) */
  default_tier: ConnectionTier
  /** mock key-format check (S-41 ③ "{공급자} 키 형식이 아니에요") — // [UI-가정] */
  key_prefixes: string[]
}

export const AI_PROVIDERS: Record<AiProviderName, AiProviderInfo> = {
  gemini: {
    provider: "gemini",
    display_order: 1,
    is_available: true,
    is_recommended: true,
    dashboard_url: "https://aistudio.google.com/",
    billing_url: "https://aistudio.google.com/",
    key_guide_version: "1",
    key_guide_checked_at: "2026-10-26",
    status_url: "https://aistudio.google.com/status",
    key_issue_url: "https://aistudio.google.com/apikey",
    upgrade_url: "https://ai.google.dev/pricing",
    description: "결제 등록 없이 무료 키 발급",
    default_tier: "free",
    key_prefixes: ["AIza", "AQ."],
  },
  anthropic: {
    provider: "anthropic",
    display_order: 2,
    is_available: true,
    is_recommended: false,
    dashboard_url: "https://console.anthropic.com/",
    billing_url: "https://console.anthropic.com/settings/billing",
    key_guide_version: "1",
    key_guide_checked_at: "2026-10-26",
    status_url: "https://status.anthropic.com/",
    key_issue_url: "https://console.anthropic.com/settings/keys",
    upgrade_url: "https://docs.anthropic.com/",
    description: "유료 결제 필요",
    default_tier: "paid",
    key_prefixes: ["sk-ant-"],
  },
  openai: {
    provider: "openai",
    display_order: 3,
    is_available: true,
    is_recommended: false,
    dashboard_url: "https://platform.openai.com/usage",
    billing_url: "https://platform.openai.com/settings/organization/billing",
    key_guide_version: "1",
    key_guide_checked_at: "2026-10-26",
    status_url: "https://status.openai.com/",
    key_issue_url: "https://platform.openai.com/api-keys",
    upgrade_url: "https://platform.openai.com/docs/guides/rate-limits",
    description: "유료 결제 필요",
    default_tier: "paid",
    key_prefixes: ["sk-"],
  },
}

/** Model per provider × tier (03 C-10) */
export const MOCK_MODELS: Record<AiProviderName, Record<ModelTier, string>> = {
  anthropic: { light: "claude-haiku-5-5", default: "claude-sonnet-5-5", heavy: "claude-opus-5-5" },
  gemini: { light: "gemini-flash-lite-mock", default: "gemini-flash-mock", heavy: "gemini-pro-mock" },
  openai: { light: "gpt-mini-mock", default: "gpt-standard-mock", heavy: "gpt-reasoning-mock" },
}

export const PRICE_TABLE_VERSION = "v2026-10-26"

/** ai_price_tables (03 C-13 초안). Gemini/OpenAI prices are "미정" in the spec → mock values. // [UI-가정] */
export function mockPriceTables(): AiPriceTable[] {
  const row = (
    n: number,
    provider: AiProviderName,
    model: string,
    input: number,
    cached: number | null,
    write: number | null,
    output: number,
  ): AiPriceTable => ({
    id: `00000000-0000-4d06-8000-${String(n).padStart(12, "0")}`,
    version: PRICE_TABLE_VERSION,
    effective_from: "2026-10-26",
    provider,
    model,
    input_usd_per_mtok: input,
    cached_input_usd_per_mtok: cached,
    cache_write_usd_per_mtok: write,
    output_usd_per_mtok: output,
    long_context_threshold_tokens: null,
    long_context_input_usd_per_mtok: null,
    long_context_output_usd_per_mtok: null,
    source_checked_at: "2026-10-26",
  })
  return [
    row(1, "anthropic", "claude-haiku-5-5", 0.1, null, null, 0.5),
    row(2, "anthropic", "claude-sonnet-5-5", 2, 0.2, 2.5, 10),
    row(3, "anthropic", "claude-opus-5-5", 4, 0.2, 5, 20),
    row(4, "gemini", "gemini-flash-lite-mock", 0.1, 0.025, null, 0.4),
    row(5, "gemini", "gemini-flash-mock", 0.3, 0.075, null, 2.5),
    row(6, "gemini", "gemini-pro-mock", 1.25, 0.31, null, 10),
    row(7, "openai", "gpt-mini-mock", 0.25, 0.025, null, 2),
    row(8, "openai", "gpt-standard-mock", 1.25, 0.125, null, 10),
    row(9, "openai", "gpt-reasoning-mock", 15, 1.5, null, 60),
  ]
}

export const DISCLOSURE_VERSION = "2026-10-26"

/** ai_disclosures (one per provider × tier) */
export function mockDisclosures(): AiDisclosure[] {
  let n = 0
  const out: AiDisclosure[] = []
  for (const provider of AI_PROVIDER_ORDER) {
    for (const tier of ["free", "paid"] as const) {
      n += 1
      out.push({
        id: `00000000-0000-4d07-8000-${String(n).padStart(12, "0")}`,
        provider,
        connection_tier: tier,
        version: DISCLOSURE_VERSION,
        effective_at: "2026-10-26T00:00:00.000Z",
        requires_reconsent: false,
        requires_free_tier_ack: provider === "gemini" && tier === "free",
        document_path: `disclosures/${provider}/${tier}/${DISCLOSURE_VERSION}.md`,
        terms_checked_at: "2026-10-26",
      })
    }
  }
  return out
}

/**
 * C-21 고지 본문 values per provider × tier (학습 사용·사람 검토·보관 기간). Final text depends on
 * each provider's terms (D-10) → placeholders. // [UI-가정]
 */
export const DISCLOSURE_FACTS: Record<
  AiProviderName,
  Record<ConnectionTier, { country: string; training: string; human_review: string; retention: string; terms_url: string }>
> = {
  gemini: {
    free: { country: "국외(미국 등)", training: "Google 제품 개선에 쓰일 수 있어요", human_review: "사람이 검토할 수 있어요", retention: "공급자 정책에 따라요", terms_url: "https://ai.google.dev/gemini-api/terms" },
    paid: { country: "국외(미국 등)", training: "제품 개선에 쓰지 않아요", human_review: "남용 감시 목적 외에는 없어요", retention: "공급자 정책에 따라요", terms_url: "https://ai.google.dev/gemini-api/terms" },
  },
  anthropic: {
    free: { country: "국외(미국)", training: "학습에 쓰지 않아요", human_review: "안전 검토 목적 외에는 없어요", retention: "공급자 정책에 따라요", terms_url: "https://www.anthropic.com/legal/commercial-terms" },
    paid: { country: "국외(미국)", training: "학습에 쓰지 않아요", human_review: "안전 검토 목적 외에는 없어요", retention: "공급자 정책에 따라요", terms_url: "https://www.anthropic.com/legal/commercial-terms" },
  },
  openai: {
    free: { country: "국외(미국)", training: "API 데이터는 학습에 쓰지 않아요", human_review: "남용 감시 목적 외에는 없어요", retention: "공급자 정책에 따라요", terms_url: "https://openai.com/policies/business-terms" },
    paid: { country: "국외(미국)", training: "API 데이터는 학습에 쓰지 않아요", human_review: "남용 감시 목적 외에는 없어요", retention: "공급자 정책에 따라요", terms_url: "https://openai.com/policies/business-terms" },
  },
}
