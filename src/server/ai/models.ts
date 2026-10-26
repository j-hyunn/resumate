/**
 * Model routing (backend-context "Tech stack", AI spec per-feature cards).
 * Features pick a tier; the id lives here so a model change is one edit.
 */

export const AI_MODELS = {
  /** Default for most features (AI-02, AI-03, AI-04, AI-05, AI-06, AI-12). */
  default: "claude-sonnet-5-5",
  /** Light: short extraction-style calls when a card allows it. */
  light: "claude-haiku-5-5",
  /** Heavy: only when a card escalates (e.g. AI-02 stage 2 review). */
  heavy: "claude-opus-5-5",
} as const;

export type AiModelTier = keyof typeof AI_MODELS;
export type AiModelId = (typeof AI_MODELS)[AiModelTier];

/** output_config.effort values accepted by the current models. */
export const AI_EFFORTS = ["low", "medium", "high", "xhigh", "max"] as const;
export type AiEffort = (typeof AI_EFFORTS)[number];

/**
 * C-6 "모델 장애 시 대체" [가정]: when the primary model is unavailable
 * (overloaded / 5xx after SDK retries), retry once on the previous-generation
 * model of the same tier with the same prompt. Cache is per model, so the
 * fallback call pays full input price. Empty entry = no fallback.
 */
export const AI_UNAVAILABLE_FALLBACK: Readonly<Partial<Record<string, string>>> = {
  "claude-sonnet-5-5": "claude-sonnet-5",
  "claude-opus-5-5": "claude-opus-5",
};

export function resolveModel(tier: AiModelTier): AiModelId {
  return AI_MODELS[tier];
}

/**
 * Server-side refusal fallback (`fallbacks: "default"`, beta
 * server-side-fallback-2026-07-01). Off per C-6 "거절 → 실패 처리 후 재시도
 * 안내" (user decision, decisions 2026-10-27). With it off, a refusal fails
 * the job at once.
 * `refused` is never retried automatically in either setting (see errors.ts);
 * the user retries from the screen.
 */
export const REFUSAL_FALLBACKS_ENABLED = false;
