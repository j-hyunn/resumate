import type { ProviderError } from "../errors";

/**
 * BYOK provider layer types (AI spec C-10, D-28). Feature code builds one
 * provider-neutral request; the adapter for the job's fixed provider maps it.
 * No type here carries an API key except `ProviderCallRequest.apiKey`, which
 * lives only for the duration of one adapter call (NFR-KEY-05).
 */

export const PROVIDER_IDS = ["openai", "gemini", "anthropic"] as const;
export type ProviderId = (typeof PROVIDER_IDS)[number];

export const MODEL_TIERS = ["light", "default", "heavy"] as const;
export type ModelTier = (typeof MODEL_TIERS)[number];

export const CONNECTION_TIERS = ["free", "paid"] as const;
export type ConnectionTier = (typeof CONNECTION_TIERS)[number];

/** C-4 / C-10.1 "낮은/중간 사고 설정". */
export type ReasoningLevel = "low" | "medium";

/** A system or user block. `cache: true` marks a cache breakpoint; only the Claude adapter uses it (C-8, C-10.3). */
export type AiTextBlock = { text: string; cache?: boolean };

/** C-13 token fields, normalized across providers. */
export type NormalizedUsage = {
  /** Uncached input tokens. */
  inputTokens: number;
  /** Cache-read input tokens. */
  cachedInputTokens: number;
  /** Cache-write tokens (Claude only; 0 elsewhere). */
  cacheWriteTokens: number;
  /** Output tokens, thinking included (billed as output). */
  outputTokens: number;
  /** Thinking tokens when the provider reports them separately (display only). */
  reasoningTokens: number | null;
  usageSource: "provider_reported" | "unavailable";
};

export const UNAVAILABLE_USAGE: NormalizedUsage = Object.freeze({
  inputTokens: 0,
  cachedInputTokens: 0,
  cacheWriteTokens: 0,
  outputTokens: 0,
  reasoningTokens: null,
  usageSource: "unavailable",
});

export type AiCallResult = {
  /** Raw output text (structured-output JSON when a schema was sent). Never log it (C-7). */
  text: string;
  /** The mapped model id that was called (price-table key; provider snapshot suffixes are not used). */
  model: string;
  usage: NormalizedUsage;
  latencyMs: number;
};

/** C-10.3 common stream events. Exactly one terminal event (`done` or `error`), always last. */
export type LlmStreamEvent =
  | { type: "delta"; text: string }
  | { type: "done"; result: AiCallResult }
  | { type: "error"; error: ProviderError; usage: NormalizedUsage };

/** What an adapter gets for one call. The model is already resolved from the tier. */
export type ProviderCallRequest = {
  model: string;
  apiKey: string;
  systemBlocks: readonly AiTextBlock[];
  userBlocks: readonly AiTextBlock[];
  /** Canonical JSON schema (providers/schema.ts) or null for free text. */
  outputSchema: Record<string, unknown> | null;
  maxOutputTokens: number;
  reasoningLevel: ReasoningLevel;
  signal?: AbortSignal;
};

/** C-10.5 two-step key check, per adapter. No retries. */
export type ProviderVerifyRequest = { apiKey: string; model: string; signal?: AbortSignal };
export type ProviderVerifyOutcome =
  | { ok: true; usage: NormalizedUsage }
  | { ok: false; stage: 1 | 2; error: ProviderError; usage: NormalizedUsage | null };

export interface ProviderAdapter {
  readonly id: ProviderId;
  /**
   * Streams normalized events. Never throws for provider failures: they end
   * the stream as one `error` event (with `beforeFirstToken` set and any usage
   * the provider reported). Adapters never sleep or retry (C-11.3 is the runner's).
   */
  stream(request: ProviderCallRequest): AsyncIterable<LlmStreamEvent>;
  /** Drains `stream` (long outputs stay off HTTP timeouts). Throws the ProviderError of an `error` event. */
  complete(request: ProviderCallRequest): Promise<AiCallResult>;
  verify(request: ProviderVerifyRequest): Promise<ProviderVerifyOutcome>;
}

export function addUsage(a: NormalizedUsage, b: NormalizedUsage): NormalizedUsage {
  const reported = a.usageSource === "provider_reported" || b.usageSource === "provider_reported";
  return {
    inputTokens: a.inputTokens + b.inputTokens,
    cachedInputTokens: a.cachedInputTokens + b.cachedInputTokens,
    cacheWriteTokens: a.cacheWriteTokens + b.cacheWriteTokens,
    outputTokens: a.outputTokens + b.outputTokens,
    reasoningTokens: a.reasoningTokens === null && b.reasoningTokens === null ? null : (a.reasoningTokens ?? 0) + (b.reasoningTokens ?? 0),
    usageSource: reported ? "provider_reported" : "unavailable",
  };
}
