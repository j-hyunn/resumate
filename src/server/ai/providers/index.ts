import { createAnthropicAdapter } from "./anthropic";
import { createGeminiAdapter } from "./gemini";
import { createOpenAiAdapter } from "./openai";
import type { ProviderAdapter, ProviderId } from "./types";

/** Production adapters, created lazily (SDK clients are built per call with the job's key). */
const cache: Partial<Record<ProviderId, ProviderAdapter>> = {};

export function getProviderAdapter(provider: ProviderId): ProviderAdapter {
  cache[provider] ??= provider === "anthropic" ? createAnthropicAdapter() : provider === "openai" ? createOpenAiAdapter() : createGeminiAdapter();
  return cache[provider];
}
