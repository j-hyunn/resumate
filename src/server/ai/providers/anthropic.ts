import Anthropic from "@anthropic-ai/sdk";
import { ProviderError } from "../errors";
import { toAnthropicFormat } from "./schema";
import { abortError, drainStream, errorEvent, nonNegative, parseRetryAfter, readString, unclassifiedError } from "./shared";
import type {
  AiTextBlock,
  LlmStreamEvent,
  NormalizedUsage,
  ProviderAdapter,
  ProviderCallRequest,
  ProviderVerifyOutcome,
  ProviderVerifyRequest,
} from "./types";
import { UNAVAILABLE_USAGE } from "./types";

/**
 * Claude adapter on @anthropic-ai/sdk 1.1.0 (claude-api skill, 2026-10-28).
 *
 * - Structured output: `output_config.format = { type: "json_schema", schema }`.
 *   No tools, no forced `tool_choice` (400 on Sonnet 5.5 / Opus 5.5).
 * - Thinking: omitted → adaptive on Haiku/Sonnet/Opus 5.5. Depth is
 *   `output_config.effort` = reasoning level (C-4).
 * - Cache: `cache_control: ephemeral` after blocks marked `cache` (C-8; Claude only).
 * - No refusal fallbacks, no model fallback (D-31): `stop_reason: refusal` → safety_blocked.
 * - SDK retries off (`maxRetries: 0`): retrying is the runner's job (C-11.3).
 * - Always streams; usage comes from `message_start` / `message_delta`, so a
 *   stream cut mid-way still reports the last usage seen (C-13).
 */

const PROVIDER = "anthropic" as const;

/** The SDK surface this adapter uses (tests pass a fake). */
export type AnthropicLike = {
  messages: { create: (body: never, options?: { signal?: AbortSignal }) => Promise<unknown> };
  models: { retrieve: (model: string, params?: undefined, options?: { signal?: AbortSignal }) => Promise<unknown> };
};

export type AnthropicAdapterOptions = {
  createClient?: (apiKey: string) => AnthropicLike;
  now?: () => number;
};

export const VERIFY_MAX_TOKENS = 5;

export function createAnthropicAdapter(options: AnthropicAdapterOptions = {}): ProviderAdapter {
  const createClient = options.createClient ?? ((apiKey: string) => new Anthropic({ apiKey, maxRetries: 0 }) as unknown as AnthropicLike);
  const now = options.now ?? Date.now;

  async function* stream(request: ProviderCallRequest): AsyncGenerator<LlmStreamEvent> {
    const startedAt = now();
    const acc = new UsageAccumulator();
    let emitted = false;
    const model = request.model;
    let stopReason: string | null = null;
    let text = "";
    try {
      const client = createClient(request.apiKey);
      const events = (await client.messages.create(buildParams(request) as never, { signal: request.signal })) as AsyncIterable<RawEvent>;
      for await (const event of events) {
        if (event.type === "message_start") {
          acc.merge(event.message?.usage);
        } else if (event.type === "content_block_delta" && event.delta?.type === "text_delta" && typeof event.delta.text === "string") {
          text += event.delta.text;
          emitted = true;
          yield { type: "delta", text: event.delta.text };
        } else if (event.type === "message_delta") {
          stopReason = event.delta?.stop_reason ?? stopReason;
          acc.merge(event.usage);
        }
      }
    } catch (err) {
      yield errorEvent(mapAnthropicError(err, request.signal, now()), emitted, acc.value());
      return;
    }
    const usage = acc.value() ?? undefined;
    const stopError = stopReasonError(stopReason, request.outputSchema !== null);
    if (stopError) {
      yield errorEvent(stopError, emitted, usage ?? null);
      return;
    }
    yield { type: "done", result: { text, model, usage: usage ?? UNAVAILABLE_USAGE, latencyMs: now() - startedAt } };
  }

  async function verify(request: ProviderVerifyRequest): Promise<ProviderVerifyOutcome> {
    const client = createClient(request.apiKey);
    try {
      await client.models.retrieve(request.model, undefined, { signal: request.signal });
    } catch (err) {
      return { ok: false, stage: 1, error: mapAnthropicError(err, request.signal, now()), usage: null };
    }
    try {
      const message = (await client.messages.create(
        {
          model: request.model,
          max_tokens: VERIFY_MAX_TOKENS,
          messages: [{ role: "user", content: "ping" }],
          output_config: { effort: "low" },
        } as never,
        { signal: request.signal },
      )) as { usage?: RawUsage };
      const acc = new UsageAccumulator();
      acc.merge(message.usage);
      // Any 200 passes, including a refusal or max_tokens stop: the key can run the model.
      return { ok: true, usage: acc.value() ?? UNAVAILABLE_USAGE };
    } catch (err) {
      return { ok: false, stage: 2, error: mapAnthropicError(err, request.signal, now()), usage: null };
    }
  }

  return { id: PROVIDER, stream, complete: (request) => drainStream(stream(request)), verify };
}

export function buildParams(request: ProviderCallRequest) {
  return {
    model: request.model,
    max_tokens: request.maxOutputTokens,
    stream: true as const,
    system: request.systemBlocks.map(toTextBlockParam),
    messages: [{ role: "user" as const, content: request.userBlocks.map(toTextBlockParam) }],
    output_config: {
      effort: request.reasoningLevel,
      ...(request.outputSchema ? { format: toAnthropicFormat(request.outputSchema) } : {}),
    },
  };
}

function toTextBlockParam(block: AiTextBlock) {
  return block.cache
    ? { type: "text" as const, text: block.text, cache_control: { type: "ephemeral" as const } }
    : { type: "text" as const, text: block.text };
}

function stopReasonError(stopReason: string | null, structured: boolean): ProviderError | null {
  if (stopReason === "refusal") return new ProviderError("safety_blocked", { provider: PROVIDER });
  if (stopReason === "model_context_window_exceeded") return new ProviderError("input_too_long", { provider: PROVIDER });
  // Truncated JSON can't be valid: same retry budget as a V-6 miss.
  if (stopReason === "max_tokens" && structured) return new ProviderError("schema_invalid", { provider: PROVIDER });
  return null;
}

// ---------- C-11.2 Claude column ----------

const BILLING_MESSAGE = /credit balance|billing|usage limit|spend limit|purchase credits/i;
const TOO_LONG_MESSAGE = /prompt is too long|too many tokens|context window|maximum context length/i;

export function mapAnthropicError(err: unknown, signal: AbortSignal | undefined, now: number): ProviderError {
  const aborted = abortError(PROVIDER, signal, err);
  if (aborted) return aborted;
  if (err instanceof ProviderError) return err;
  if (err instanceof Anthropic.APIUserAbortError) return new ProviderError("timeout", { provider: PROVIDER, cause: err });
  if (err instanceof Anthropic.APIConnectionTimeoutError) return new ProviderError("timeout", { provider: PROVIDER, cause: err });
  if (err instanceof Anthropic.APIConnectionError) return new ProviderError("provider_unavailable", { provider: PROVIDER, cause: err });
  if (!(err instanceof Anthropic.APIError)) return unclassifiedError(PROVIDER, err);

  const status = typeof err.status === "number" ? err.status : null;
  // Mid-stream SSE errors carry no status; the body's error.type tells the cause.
  const type = readString(err.error, "error", "type") ?? readString(err.error, "type");
  const message = readString(err.error, "error", "message") ?? "";
  const retryAfter = parseRetryAfter(headerValue(err.headers, "retry-after"), now);
  const base = { provider: PROVIDER, cause: err } as const;

  if (status === 401 || type === "authentication_error") return new ProviderError("key_invalid", base);
  if (status === 403 || type === "permission_error") return new ProviderError("key_invalid", base);
  if (status === 402 || type === "billing_error") return new ProviderError("billing_required", base);
  if (status === 404 || type === "not_found_error") return new ProviderError("model_not_available", base);
  if (status === 413 || type === "request_too_large") return new ProviderError("input_too_long", base);
  if (status === 429 || type === "rate_limit_error") return new ProviderError("rate_limited", { ...base, retryAfter });
  if (status === 400 || type === "invalid_request_error") {
    if (BILLING_MESSAGE.test(message)) return new ProviderError("billing_required", base);
    if (TOO_LONG_MESSAGE.test(message)) return new ProviderError("input_too_long", base);
    return unclassifiedError(PROVIDER, err);
  }
  if ((status !== null && status >= 500) || type === "api_error" || type === "overloaded_error") {
    return new ProviderError("provider_unavailable", { ...base, retryAfter });
  }
  return unclassifiedError(PROVIDER, err);
}

function headerValue(headers: unknown, name: string): string | null {
  if (headers && typeof (headers as Headers).get === "function") return (headers as Headers).get(name);
  if (headers && typeof headers === "object") {
    const v = (headers as Record<string, unknown>)[name];
    return typeof v === "string" ? v : null;
  }
  return null;
}

// ---------- usage ----------

type RawUsage = {
  input_tokens?: number | null;
  output_tokens?: number | null;
  cache_read_input_tokens?: number | null;
  cache_creation_input_tokens?: number | null;
  output_tokens_details?: { thinking_tokens?: number | null } | null;
};

type RawEvent = {
  type: string;
  message?: { model?: string; usage?: RawUsage };
  delta?: { type?: string; text?: string; stop_reason?: string | null };
  usage?: RawUsage;
};

/** Claude `input_tokens` already excludes cache reads/writes, matching C-13. Later events overwrite earlier counts. */
class UsageAccumulator {
  private seen = false;
  private input = 0;
  private cacheRead = 0;
  private cacheWrite = 0;
  private output = 0;
  private thinking: number | null = null;

  merge(usage: RawUsage | null | undefined): void {
    if (!usage) return;
    this.seen = true;
    if (typeof usage.input_tokens === "number") this.input = nonNegative(usage.input_tokens);
    if (typeof usage.cache_read_input_tokens === "number") this.cacheRead = nonNegative(usage.cache_read_input_tokens);
    if (typeof usage.cache_creation_input_tokens === "number") this.cacheWrite = nonNegative(usage.cache_creation_input_tokens);
    if (typeof usage.output_tokens === "number") this.output = nonNegative(usage.output_tokens);
    const thinking = usage.output_tokens_details?.thinking_tokens;
    if (typeof thinking === "number") this.thinking = nonNegative(thinking);
  }

  value(): NormalizedUsage | null {
    if (!this.seen) return null;
    return {
      inputTokens: this.input,
      cachedInputTokens: this.cacheRead,
      cacheWriteTokens: this.cacheWrite,
      outputTokens: this.output,
      reasoningTokens: this.thinking,
      usageSource: "provider_reported",
    };
  }
}
