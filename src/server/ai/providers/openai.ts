import OpenAI from "openai";
import { ProviderError } from "../errors";
import { toOpenAiTextFormat } from "./schema";
import { abortError, drainStream, errorEvent, nonNegative, parseRetryAfter, readString, unclassifiedError } from "./shared";
import { UNAVAILABLE_USAGE } from "./types";
import type { LlmStreamEvent, NormalizedUsage, ProviderAdapter, ProviderCallRequest, ProviderVerifyOutcome, ProviderVerifyRequest } from "./types";

/**
 * OpenAI adapter on `openai` 7.45 — Responses API (checked against the SDK
 * types and developers.openai.com error-code docs, 2026-10-28).
 *
 * - Structured output: `text.format = { type: "json_schema", name, schema, strict: true }`.
 * - Reasoning: `reasoning.effort` = reasoning level (C-4).
 * - System blocks → `instructions`, user blocks → one user message (C-8 prefix
 *   order kept; OpenAI caches long prefixes automatically, no breakpoints).
 * - `store: false`: responses are not kept on the provider side (C-7 data minimization).
 * - Streaming usage: the Responses stream's terminal `response.completed` /
 *   `response.incomplete` / `response.failed` event carries `response.usage`
 *   (no `include_usage` option needed — that is Chat Completions).
 * - `usage.input_tokens` includes cached tokens → C-13 input = input − cached.
 *   `input_tokens_details.cache_write_tokens` stays inside input (no OpenAI
 *   cache-write price, 00_model-mapping §2) [구현 결정].
 * - SDK retries off (`maxRetries: 0`).
 */

const PROVIDER = "openai" as const;

export type OpenAiLike = {
  responses: { create: (body: never, options?: { signal?: AbortSignal }) => Promise<unknown> };
  models: { retrieve: (model: string, options?: { signal?: AbortSignal }) => Promise<unknown> };
};

export type OpenAiAdapterOptions = {
  createClient?: (apiKey: string) => OpenAiLike;
  now?: () => number;
};

/** Responses API rejects max_output_tokens below 16, so the C-10.5 "1~5 tokens" check uses 16 [구현 결정]. */
export const VERIFY_MAX_OUTPUT_TOKENS = 16;

export function createOpenAiAdapter(options: OpenAiAdapterOptions = {}): ProviderAdapter {
  const createClient = options.createClient ?? ((apiKey: string) => new OpenAI({ apiKey, maxRetries: 0 }) as unknown as OpenAiLike);
  const now = options.now ?? Date.now;

  async function* stream(request: ProviderCallRequest): AsyncGenerator<LlmStreamEvent> {
    const startedAt = now();
    let emitted = false;
    let usage: NormalizedUsage | null = null;
    const model = request.model;
    let text = "";
    let refused = false;
    let terminal: RawResponse | null = null;
    try {
      const client = createClient(request.apiKey);
      const events = (await client.responses.create(buildParams(request) as never, { signal: request.signal })) as AsyncIterable<RawEvent>;
      for await (const event of events) {
        if (event.type === "response.output_text.delta" && typeof event.delta === "string") {
          text += event.delta;
          emitted = true;
          yield { type: "delta", text: event.delta };
        } else if (event.type === "response.refusal.delta" || event.type === "response.refusal.done") {
          refused = true;
        } else if (event.type === "response.completed" || event.type === "response.incomplete" || event.type === "response.failed") {
          terminal = event.response ?? null;
          usage = toUsage(terminal?.usage) ?? usage;
        } else if (event.type === "error") {
          throw responseError(event.code);
        }
      }
    } catch (err) {
      yield errorEvent(mapOpenAiError(err, request.signal, now()), emitted, usage);
      return;
    }
    const failure = terminalError(terminal, refused, request.outputSchema !== null);
    if (failure) {
      yield errorEvent(failure, emitted, usage);
      return;
    }
    yield { type: "done", result: { text, model, usage: usage ?? UNAVAILABLE_USAGE, latencyMs: now() - startedAt } };
  }

  async function verify(request: ProviderVerifyRequest): Promise<ProviderVerifyOutcome> {
    const client = createClient(request.apiKey);
    try {
      await client.models.retrieve(request.model, { signal: request.signal });
    } catch (err) {
      return { ok: false, stage: 1, error: mapOpenAiError(err, request.signal, now()), usage: null };
    }
    try {
      const response = (await client.responses.create(
        { model: request.model, input: "ping", max_output_tokens: VERIFY_MAX_OUTPUT_TOKENS, reasoning: { effort: "low" }, store: false } as never,
        { signal: request.signal },
      )) as RawResponse;
      const failed = response.status === "failed" ? responseError(response.error?.code) : null;
      if (failed && failed.code !== "safety_blocked") return { ok: false, stage: 2, error: failed, usage: toUsage(response.usage) };
      return { ok: true, usage: toUsage(response.usage) ?? UNAVAILABLE_USAGE };
    } catch (err) {
      return { ok: false, stage: 2, error: mapOpenAiError(err, request.signal, now()), usage: null };
    }
  }

  return { id: PROVIDER, stream, complete: (request) => drainStream(stream(request)), verify };
}

export function buildParams(request: ProviderCallRequest) {
  return {
    model: request.model,
    instructions: request.systemBlocks.map((b) => b.text).join("\n\n"),
    input: [
      {
        role: "user" as const,
        content: request.userBlocks.map((b) => ({ type: "input_text" as const, text: b.text })),
      },
    ],
    max_output_tokens: request.maxOutputTokens,
    reasoning: { effort: request.reasoningLevel },
    store: false,
    stream: true as const,
    ...(request.outputSchema ? { text: { format: toOpenAiTextFormat(request.outputSchema) } } : {}),
  };
}

function terminalError(response: RawResponse | null, refused: boolean, structured: boolean): ProviderError | null {
  if (refused) return new ProviderError("safety_blocked", { provider: PROVIDER });
  if (!response) return new ProviderError("provider_unavailable", { provider: PROVIDER, unclassified: true });
  if (response.status === "failed") return responseError(response.error?.code);
  if (response.status === "incomplete") {
    const reason = response.incomplete_details?.reason;
    if (reason === "content_filter") return new ProviderError("safety_blocked", { provider: PROVIDER });
    if (reason === "max_output_tokens" && structured) return new ProviderError("schema_invalid", { provider: PROVIDER });
    if (reason === "max_output_tokens") return null;
    return new ProviderError("provider_unavailable", { provider: PROVIDER, unclassified: true });
  }
  return null;
}

/** `response.error.code` / stream `error` event code (ResponseError codes in the SDK types). */
function codeFromResponseError(code: string | null | undefined) {
  switch (code) {
    case "rate_limit_exceeded":
      return "rate_limited" as const;
    case "server_error":
    case "vector_store_timeout":
      return "provider_unavailable" as const;
    case "invalid_prompt":
    case "bio_policy":
    case "misalignment_policy_violation":
    case "image_content_policy_violation":
      return "safety_blocked" as const;
    case "context_length_exceeded":
      return "input_too_long" as const;
    case "insufficient_quota":
      return "billing_required" as const;
    default:
      return null;
  }
}

function responseError(code: string | null | undefined): ProviderError {
  const mapped = codeFromResponseError(code);
  return mapped ? new ProviderError(mapped, { provider: PROVIDER }) : new ProviderError("provider_unavailable", { provider: PROVIDER, unclassified: true });
}

// ---------- C-11.2 OpenAI column ----------

const BILLING_CODES = new Set([
  "insufficient_quota",
  "credit_balance_exhausted",
  "organization_spend_limit_exceeded",
  "project_spend_limit_exceeded",
  "organization_usage_limit_exceeded",
  "billing_hard_limit_reached",
]);
const DAILY_CODES = new Set(["quota_exceeded"]);
const DAILY_MESSAGE = /per day|\bRPD\b|\bTPD\b|daily/i;
const SAFETY_CODES = new Set(["content_policy_violation", "invalid_prompt", "bio_policy", "misalignment_policy_violation"]);
const REGION_CODES = new Set(["unsupported_country_region_territory"]);

export function mapOpenAiError(err: unknown, signal: AbortSignal | undefined, now: number): ProviderError {
  const aborted = abortError(PROVIDER, signal, err);
  if (aborted) return aborted;
  if (err instanceof ProviderError) return err;
  if (err instanceof OpenAI.APIUserAbortError) return new ProviderError("timeout", { provider: PROVIDER, cause: err });
  if (err instanceof OpenAI.APIConnectionTimeoutError) return new ProviderError("timeout", { provider: PROVIDER, cause: err });
  if (err instanceof OpenAI.APIConnectionError) return new ProviderError("provider_unavailable", { provider: PROVIDER, cause: err });
  if (!(err instanceof OpenAI.APIError)) return unclassifiedError(PROVIDER, err);

  const status = typeof err.status === "number" ? err.status : null;
  const code = err.code ?? readString(err.error, "code") ?? "";
  const type = err.type ?? readString(err.error, "type") ?? "";
  const message = readString(err.error, "message") ?? "";
  const retryAfter = parseRetryAfter(err.headers?.get?.("retry-after"), now);
  const base = { provider: PROVIDER, cause: err } as const;

  if (status === 401) return new ProviderError("key_invalid", base);
  if (status === 403) {
    if (code === "model_not_found" || /model/i.test(message)) return new ProviderError("model_not_available", base);
    // Unsupported country/region: like Gemini's FAILED_PRECONDITION region case → cause 3 [가정].
    if (REGION_CODES.has(code) || /country|region|territory/i.test(message)) return new ProviderError("billing_required", base);
    return new ProviderError("key_invalid", base);
  }
  if (status === 404) return new ProviderError("model_not_available", base);
  if (status === 429) {
    if (BILLING_CODES.has(code) || BILLING_CODES.has(type)) return new ProviderError("billing_required", base);
    if (DAILY_CODES.has(code) || DAILY_MESSAGE.test(message)) {
      // OpenAI publishes no fixed reset hour; Retry-After (if any) is the best reset estimate.
      return new ProviderError("daily_quota_exhausted", { ...base, quotaResetsAt: retryAfter });
    }
    return new ProviderError("rate_limited", { ...base, retryAfter });
  }
  if (status === 400 || status === 413) {
    if (code === "context_length_exceeded" || status === 413) return new ProviderError("input_too_long", base);
    if (SAFETY_CODES.has(code)) return new ProviderError("safety_blocked", base);
    return unclassifiedError(PROVIDER, err);
  }
  if (status !== null && status >= 500) return new ProviderError("provider_unavailable", { ...base, retryAfter });
  return unclassifiedError(PROVIDER, err);
}

// ---------- usage ----------

type RawUsage = {
  input_tokens?: number | null;
  output_tokens?: number | null;
  input_tokens_details?: { cached_tokens?: number | null } | null;
  output_tokens_details?: { reasoning_tokens?: number | null } | null;
};

type RawResponse = {
  model?: string;
  status?: string;
  usage?: RawUsage | null;
  error?: { code?: string | null } | null;
  incomplete_details?: { reason?: string | null } | null;
};

type RawEvent = { type: string; delta?: unknown; response?: RawResponse; code?: string | null };

export function toUsage(usage: RawUsage | null | undefined): NormalizedUsage | null {
  if (!usage) return null;
  const input = nonNegative(usage.input_tokens);
  const cached = Math.min(input, nonNegative(usage.input_tokens_details?.cached_tokens));
  const reasoning = usage.output_tokens_details?.reasoning_tokens;
  return {
    inputTokens: input - cached,
    cachedInputTokens: cached,
    cacheWriteTokens: 0,
    outputTokens: nonNegative(usage.output_tokens),
    reasoningTokens: typeof reasoning === "number" ? nonNegative(reasoning) : null,
    usageSource: "provider_reported",
  };
}
