import type { AiEffort } from "./models";

/**
 * The model-call boundary. Pipelines and the job runner depend on this
 * interface only; production uses `createAnthropicAiClient()` and tests use
 * `createFakeAiClient()`. No real API calls in tests.
 *
 * Structured output (AI spec C-4): every call asks for JSON that matches
 * `outputSchema` via `output_config.format` (json_schema). No tools are sent
 * (C-4 "도구를 주지 않는다"). The client returns the raw JSON text; parsing and
 * V-6 live in `structured.ts`.
 */

/** A system or user content block. `cache: true` puts a cache breakpoint after it (C-8). */
export type AiTextBlock = { text: string; cache?: boolean };

export type AiRequest = {
  /** Feature + step id for logs, e.g. "AI-02.match". */
  feature: string;
  /** Stored with the result and part of input_hash (C-4). */
  promptVersion: string;
  model: string;
  /**
   * C-8 prefix order: [common system] → [feature system]. Instructions only (C-4).
   */
  system: readonly AiTextBlock[];
  /**
   * C-8 prefix order: [career pack] → [JD] → [variable input], each wrapped in
   * its data tag (<career_data>, <jd>, …). Sent as one user message.
   */
  user: readonly AiTextBlock[];
  /** JSON schema for output_config.format. */
  outputSchema: Record<string, unknown>;
  effort?: AiEffort;
  maxTokens?: number;
  /** For logs only. */
  jobId?: string | null;
  /** Abort with reason "canceled" for a user cancel; any other reason is a timeout. */
  signal?: AbortSignal;
};

export type AiUsage = {
  inputTokens: number;
  outputTokens: number;
  cacheReadInputTokens: number;
  cacheCreationInputTokens: number;
};

export type AiResult = {
  /** Raw JSON text of the structured output. Never log it (C-7). */
  text: string;
  /** Model that actually produced the output (may differ after a fallback). */
  model: string;
  usage: AiUsage;
  latencyMs: number;
  /** True when a refusal fallback or the unavailable-model fallback served the call. */
  fallbackUsed: boolean;
};

export type AiStreamChunk =
  | { type: "text_delta"; text: string }
  /** Last chunk of a successful stream. */
  | { type: "final"; result: AiResult };

export interface AiClient {
  /** One structured call. Throws AiError (C-6 codes) on failure. */
  complete(request: AiRequest): Promise<AiResult>;
  /**
   * Streams the structured-output JSON text as it is generated, then a `final`
   * chunk. Throws AiError mid-iteration on failure.
   */
  stream(request: AiRequest): AsyncIterable<AiStreamChunk>;
}

export const EMPTY_USAGE: AiUsage = Object.freeze({
  inputTokens: 0,
  outputTokens: 0,
  cacheReadInputTokens: 0,
  cacheCreationInputTokens: 0,
});

export function addUsage(a: AiUsage, b: AiUsage): AiUsage {
  return {
    inputTokens: a.inputTokens + b.inputTokens,
    outputTokens: a.outputTokens + b.outputTokens,
    cacheReadInputTokens: a.cacheReadInputTokens + b.cacheReadInputTokens,
    cacheCreationInputTokens: a.cacheCreationInputTokens + b.cacheCreationInputTokens,
  };
}
