import { ApiError, GoogleGenAI, ThinkingLevel } from "@google/genai";
import { ProviderError } from "../errors";
import { toGeminiResponseJsonSchema } from "./schema";
import {
  GEMINI_QUOTA_TIME_ZONE,
  abortError,
  drainStream,
  errorEvent,
  nextMidnightIn,
  nonNegative,
  parseDurationSeconds,
  readString,
  unclassifiedError,
} from "./shared";
import { UNAVAILABLE_USAGE } from "./types";
import type { LlmStreamEvent, NormalizedUsage, ProviderAdapter, ProviderCallRequest, ProviderVerifyOutcome, ProviderVerifyRequest } from "./types";

/**
 * Gemini adapter on `@google/genai` 2.31 (checked against the SDK types and
 * ai.google.dev api-errors / troubleshooting pages, 2026-10-28).
 *
 * - Structured output: `responseMimeType: "application/json"` +
 *   `responseJsonSchema` (JSON Schema form; the SDK documents it as the
 *   alternative to the OpenAPI-subset `responseSchema`) with `propertyOrdering`.
 * - Reasoning: `thinkingConfig.thinkingLevel` LOW / MEDIUM (C-4 "Gemini thinking" [가정]).
 * - Streaming: `models.generateContentStream`; text = non-thought parts.
 * - Usage: `usageMetadata` — promptTokenCount includes cachedContentTokenCount,
 *   so C-13 input = prompt − cached; output = candidates + thoughts
 *   (thinking is billed as output); reasoning = thoughtsTokenCount.
 * - Errors: `ApiError { status, message }` where message is the JSON error body
 *   (`{ error: { code, status, message, details[] } }`). Daily vs per-minute
 *   429 is told apart by `QuotaFailure.violations[].quotaId` (`PerDay` /
 *   `PerMinute`); `RetryInfo.retryDelay` → retryAfter.
 * - SDK retries: none unless `retryOptions` is set; we pin `attempts: 1`.
 * - No explicit context cache (storage cost, C-10.3); implicit caching only.
 */

const PROVIDER = "gemini" as const;

export type GeminiLike = {
  models: {
    generateContentStream: (params: never) => Promise<AsyncIterable<unknown>>;
    generateContent: (params: never) => Promise<unknown>;
    get: (params: never) => Promise<unknown>;
  };
};

export type GeminiAdapterOptions = {
  createClient?: (apiKey: string) => GeminiLike;
  now?: () => number;
};

export const VERIFY_MAX_OUTPUT_TOKENS = 5;

const THINKING_LEVEL = { low: ThinkingLevel.LOW, medium: ThinkingLevel.MEDIUM } as const;

export function createGeminiAdapter(options: GeminiAdapterOptions = {}): ProviderAdapter {
  const createClient =
    options.createClient ??
    ((apiKey: string) => new GoogleGenAI({ apiKey, httpOptions: { retryOptions: { attempts: 1 } } }) as unknown as GeminiLike);
  const now = options.now ?? Date.now;

  async function* stream(request: ProviderCallRequest): AsyncGenerator<LlmStreamEvent> {
    const startedAt = now();
    let emitted = false;
    let usage: NormalizedUsage | null = null;
    const model = request.model;
    let text = "";
    let finishReason: string | undefined;
    let blocked = false;
    try {
      const client = createClient(request.apiKey);
      const chunks = (await client.models.generateContentStream(buildParams(request) as never)) as AsyncIterable<RawChunk>;
      for await (const chunk of chunks) {
        usage = toUsage(chunk.usageMetadata) ?? usage;
        if (chunk.promptFeedback?.blockReason) blocked = true;
        const candidate = chunk.candidates?.[0];
        if (candidate?.finishReason) finishReason = candidate.finishReason;
        const piece = (candidate?.content?.parts ?? [])
          .filter((p) => !p.thought && typeof p.text === "string")
          .map((p) => p.text as string)
          .join("");
        if (piece) {
          text += piece;
          emitted = true;
          yield { type: "delta", text: piece };
        }
      }
    } catch (err) {
      yield errorEvent(mapGeminiError(err, request.signal, now()), emitted, usage);
      return;
    }
    const failure = finishError(blocked, finishReason, request.outputSchema !== null);
    if (failure) {
      yield errorEvent(failure, emitted, usage);
      return;
    }
    yield { type: "done", result: { text, model, usage: usage ?? UNAVAILABLE_USAGE, latencyMs: now() - startedAt } };
  }

  async function verify(request: ProviderVerifyRequest): Promise<ProviderVerifyOutcome> {
    const client = createClient(request.apiKey);
    try {
      await client.models.get({ model: request.model, config: { abortSignal: request.signal } } as never);
    } catch (err) {
      return { ok: false, stage: 1, error: mapGeminiError(err, request.signal, now()), usage: null };
    }
    try {
      const response = (await client.models.generateContent({
        model: request.model,
        contents: [{ role: "user", parts: [{ text: "ping" }] }],
        config: { maxOutputTokens: VERIFY_MAX_OUTPUT_TOKENS, thinkingConfig: { thinkingLevel: ThinkingLevel.LOW }, abortSignal: request.signal },
      } as never)) as RawChunk;
      // Any 200 passes (a safety block or MAX_TOKENS stop still proves the key can run the model).
      return { ok: true, usage: toUsage(response.usageMetadata) ?? UNAVAILABLE_USAGE };
    } catch (err) {
      return { ok: false, stage: 2, error: mapGeminiError(err, request.signal, now()), usage: null };
    }
  }

  return { id: PROVIDER, stream, complete: (request) => drainStream(stream(request)), verify };
}

export function buildParams(request: ProviderCallRequest) {
  return {
    model: request.model,
    contents: [{ role: "user", parts: request.userBlocks.map((b) => ({ text: b.text })) }],
    config: {
      systemInstruction: { parts: request.systemBlocks.map((b) => ({ text: b.text })) },
      maxOutputTokens: request.maxOutputTokens,
      thinkingConfig: { thinkingLevel: THINKING_LEVEL[request.reasoningLevel] },
      ...(request.outputSchema
        ? { responseMimeType: "application/json", responseJsonSchema: toGeminiResponseJsonSchema(request.outputSchema) }
        : {}),
      abortSignal: request.signal,
    },
  };
}

/** C-10.3 safety column: `promptFeedback.blockReason` or a safety-type `finishReason` → safety_blocked. */
const SAFETY_FINISH = new Set(["SAFETY", "PROHIBITED_CONTENT", "BLOCKLIST", "SPII", "RECITATION", "IMAGE_SAFETY", "IMAGE_PROHIBITED_CONTENT", "LANGUAGE"]);

function finishError(blocked: boolean, finishReason: string | undefined, structured: boolean): ProviderError | null {
  if (blocked || (finishReason && SAFETY_FINISH.has(finishReason))) return new ProviderError("safety_blocked", { provider: PROVIDER });
  if (finishReason === "MAX_TOKENS" && structured) return new ProviderError("schema_invalid", { provider: PROVIDER });
  return null;
}

// ---------- C-11.2 Gemini column ----------

type GoogleErrorBody = { error?: { code?: number; status?: string; message?: string; details?: Array<Record<string, unknown>> } };

const TOO_LONG_MESSAGE = /token count|exceeds the maximum|too many tokens|input context is too long/i;

export function mapGeminiError(err: unknown, signal: AbortSignal | undefined, now: number): ProviderError {
  const aborted = abortError(PROVIDER, signal, err);
  if (aborted) return aborted;
  if (err instanceof ProviderError) return err;
  if (isAbortLike(err)) return new ProviderError("timeout", { provider: PROVIDER, cause: err });
  if (!(err instanceof ApiError)) {
    // fetch-level failure (DNS, reset) → transient; anything else unclassified.
    return err instanceof TypeError ? new ProviderError("provider_unavailable", { provider: PROVIDER, cause: err }) : unclassifiedError(PROVIDER, err);
  }
  const body = parseBody(err.message);
  const status = err.status;
  // Older bodies use RPC names (RESOURCE_EXHAUSTED); the newer error-code doc uses snake_case (quota_exceeded).
  const rpcStatus = (body.error?.status ?? "").toUpperCase();
  const message = body.error?.message ?? "";
  const details = body.error?.details ?? [];
  const reasons = details.map((d) => readString(d, "reason")).filter((r): r is string => !!r);
  const base = { provider: PROVIDER, cause: err } as const;

  if (reasons.includes("API_KEY_INVALID") || status === 401) return new ProviderError("key_invalid", base);
  if (status === 402 || rpcStatus === "PAYMENT_REQUIRED") return new ProviderError("billing_required", base);
  if (status === 403 || rpcStatus === "PERMISSION_DENIED") return new ProviderError("key_invalid", base);
  if (status === 404 || rpcStatus === "NOT_FOUND") return new ProviderError("model_not_available", base);
  if (rpcStatus === "QUOTA_EXCEEDED") {
    return new ProviderError("daily_quota_exhausted", { ...base, quotaResetsAt: nextMidnightIn(GEMINI_QUOTA_TIME_ZONE, new Date(now)) });
  }
  if (status === 429 || rpcStatus === "RESOURCE_EXHAUSTED") return classifyQuota(details, message, now, base);
  if (status === 400) {
    if (rpcStatus === "FAILED_PRECONDITION") return new ProviderError("billing_required", base);
    if (TOO_LONG_MESSAGE.test(message)) return new ProviderError("input_too_long", base);
    return unclassifiedError(PROVIDER, err);
  }
  if (status >= 500) {
    const retryAfter = retryDelay(details, now);
    return new ProviderError("provider_unavailable", { ...base, retryAfter });
  }
  return unclassifiedError(PROVIDER, err);
}

function classifyQuota(details: Array<Record<string, unknown>>, message: string, now: number, base: { provider: "gemini"; cause: unknown }): ProviderError {
  const violations = details.flatMap((d) => (Array.isArray(d.violations) ? (d.violations as Array<Record<string, unknown>>) : []));
  const quotaIds = violations.map((v) => readString(v, "quotaId") ?? "");
  // Free-tier limit 0 for this model = the model isn't usable on this tier (C-11.2 cause 5).
  const zeroLimit = violations.some((v) => String(v.quotaValue ?? "") === "0") || /limit:\s*0\b/.test(message);
  if (zeroLimit) return new ProviderError("model_not_available", base);
  if (quotaIds.some((id) => /PerDay/i.test(id))) {
    return new ProviderError("daily_quota_exhausted", { ...base, quotaResetsAt: nextMidnightIn(GEMINI_QUOTA_TIME_ZONE, new Date(now)) });
  }
  // PerMinute, or no quota detail at all (ambiguous 429 → cause 1, C-11.2 note).
  return new ProviderError("rate_limited", { ...base, retryAfter: retryDelay(details, now) });
}

function retryDelay(details: Array<Record<string, unknown>>, now: number): Date | undefined {
  for (const d of details) {
    const at = parseDurationSeconds(d.retryDelay, now);
    if (at) return at;
  }
  return undefined;
}

function parseBody(message: string): GoogleErrorBody {
  try {
    const parsed = JSON.parse(message) as unknown;
    return parsed && typeof parsed === "object" ? (parsed as GoogleErrorBody) : {};
  } catch {
    return {};
  }
}

function isAbortLike(err: unknown): boolean {
  return err instanceof Error && (err.name === "AbortError" || err.name === "TimeoutError");
}

// ---------- usage ----------

type RawUsage = {
  promptTokenCount?: number;
  cachedContentTokenCount?: number;
  candidatesTokenCount?: number;
  thoughtsTokenCount?: number;
  toolUsePromptTokenCount?: number;
};

type RawChunk = {
  candidates?: Array<{ content?: { parts?: Array<{ text?: string; thought?: boolean }> }; finishReason?: string }>;
  promptFeedback?: { blockReason?: string };
  usageMetadata?: RawUsage;
  modelVersion?: string;
};

export function toUsage(usage: RawUsage | undefined): NormalizedUsage | null {
  if (!usage) return null;
  const prompt = nonNegative(usage.promptTokenCount) + nonNegative(usage.toolUsePromptTokenCount);
  const cached = Math.min(prompt, nonNegative(usage.cachedContentTokenCount));
  const thoughts = typeof usage.thoughtsTokenCount === "number" ? nonNegative(usage.thoughtsTokenCount) : null;
  return {
    inputTokens: prompt - cached,
    cachedInputTokens: cached,
    cacheWriteTokens: 0,
    outputTokens: nonNegative(usage.candidatesTokenCount) + (thoughts ?? 0),
    reasoningTokens: thoughts,
    usageSource: "provider_reported",
  };
}
