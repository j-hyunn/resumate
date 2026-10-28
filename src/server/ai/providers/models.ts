import type { ModelTier, ProviderId } from "./types";

/**
 * C-10.1 tier → model per provider. Fixed by Resumate (D-31): no automatic
 * fallback to another model or provider, not on outage, not on refusal.
 * Model ids confirmed by the user in `_workspace/backend/S3a/00_model-mapping.md`
 * (2026-10-28). A change here is an operator mapping change: re-run the
 * evaluation set, and add the new models to `ai_price_tables`.
 */
export const MODEL_MAP: Readonly<Record<ProviderId, Readonly<Record<ModelTier, string>>>> = Object.freeze({
  openai: Object.freeze({ light: "gpt-6-luna", default: "gpt-6.1-terra", heavy: "gpt-6.1-sol" }),
  // light/default must be free-tier models (F-AI-05). heavy has no free tier.
  gemini: Object.freeze({ light: "gemini-3.5-flash-lite", default: "gemini-3.8-flash", heavy: "gemini-4-argon" }),
  anthropic: Object.freeze({ light: "claude-haiku-5-5", default: "claude-sonnet-5-5", heavy: "claude-opus-5-5" }),
});

export function resolveModel(provider: ProviderId, tier: ModelTier): string {
  return MODEL_MAP[provider][tier];
}

/** Every mapped model id (price-table coverage check). */
export function allMappedModels(): Array<{ provider: ProviderId; tier: ModelTier; model: string }> {
  return (Object.keys(MODEL_MAP) as ProviderId[]).flatMap((provider) =>
    (Object.keys(MODEL_MAP[provider]) as ModelTier[]).map((tier) => ({ provider, tier, model: MODEL_MAP[provider][tier] })),
  );
}

/** Default max output tokens per call when the feature doesn't set one. */
export const DEFAULT_MAX_OUTPUT_TOKENS = 16_000;
