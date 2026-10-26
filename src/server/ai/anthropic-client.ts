import "server-only";
import Anthropic from "@anthropic-ai/sdk";
import { getServerEnv } from "@/server/env";
import { addUsage, type AiClient, type AiRequest, type AiResult, type AiStreamChunk, type AiTextBlock, type AiUsage } from "./client";
import { AiError, mapSdkError } from "./errors";
import { consoleAiLogger, type AiLogger } from "./log";
import { AI_UNAVAILABLE_FALLBACK, REFUSAL_FALLBACKS_ENABLED } from "./models";

/**
 * Production AiClient on @anthropic-ai/sdk 1.1.0.
 *
 * - Structured output: `output_config.format = { type: "json_schema", schema }`
 *   (AI spec C-4, decisions 2026-10-26). Sonnet 5.5 / Opus 5.5 reject forced
 *   `tool_choice`, so no tool is sent at all.
 * - Thinking: omitted → adaptive on Sonnet 5.5 / Opus 5.5 / Haiku 5.5. Depth is
 *   `output_config.effort` per feature card (C-4).
 * - Refusals: server-side fallback `fallbacks: "default"` (beta
 *   `server-side-fallback-2026-07-01`) when REFUSAL_FALLBACKS_ENABLED (one
 *   switch, models.ts). If the whole chain still refuses → AiError("refused"),
 *   not retryable while fallbacks are on (QA-S3-07).
 * - Usage: summed over `usage.iterations` when present (each fallback attempt
 *   is billed; top-level usage covers only the last one).
 * - Unavailable: SDK retries 429/5xx (maxRetries 2), then one attempt on
 *   AI_UNAVAILABLE_FALLBACK[model] [가정] (C-6 "모델 장애 시 대체").
 * - Always streams (long outputs must not hit HTTP timeouts); `complete()`
 *   just drains the stream.
 * - Logs C-7 fields only.
 */

const REFUSAL_FALLBACK_BETA = "server-side-fallback-2026-07-01";
export const DEFAULT_MAX_TOKENS = 16_000;

type BetaStreamParams = Parameters<Anthropic["beta"]["messages"]["stream"]>[0];

export type AnthropicAiClientOptions = {
  apiKey?: string;
  logger?: AiLogger;
  /** Override for tests of the fallback map. */
  unavailableFallback?: Readonly<Partial<Record<string, string>>>;
  /** Defaults to REFUSAL_FALLBACKS_ENABLED. */
  refusalFallbacks?: boolean;
  /** Injected SDK instance (tests). */
  sdk?: Anthropic;
  now?: () => number;
};

export function createAnthropicAiClient(options: AnthropicAiClientOptions = {}): AiClient {
  const sdk = options.sdk ?? new Anthropic({ apiKey: options.apiKey ?? getServerEnv().ANTHROPIC_API_KEY, maxRetries: 2 });
  const logger = options.logger ?? consoleAiLogger;
  const fallbackMap = options.unavailableFallback ?? AI_UNAVAILABLE_FALLBACK;
  const now = options.now ?? Date.now;
  const refusalFallbacks = options.refusalFallbacks ?? REFUSAL_FALLBACKS_ENABLED;

  type CallState = { fallbackUsed: boolean; usage: AiUsage | null };

  async function* streamOnce(request: AiRequest, model: string, startedAt: number, state: CallState) {
    const stream = sdk.beta.messages.stream(buildParams(request, model, refusalFallbacks), { signal: request.signal });
    for await (const event of stream) {
      if (event.type === "content_block_delta" && event.delta.type === "text_delta") {
        yield { type: "text_delta", text: event.delta.text } as const;
      }
    }
    const message = await stream.finalMessage();
    const usage = toUsage(message.usage);
    // Usage of earlier attempts in this run (a failed primary before the unavailable fallback) is added.
    state.usage = state.usage ? addUsage(state.usage, usage) : usage;
    if (
      message.content.some((block) => block.type === "fallback") ||
      (message.usage.iterations ?? []).some((it) => it.type === "fallback_message")
    ) {
      state.fallbackUsed = true;
    }
    // C-6: a refusal fails the job; the user retries from the screen (no automatic retry).
    if (message.stop_reason === "refusal") throw new AiError("refused");
    if (message.stop_reason === "model_context_window_exceeded") throw new AiError("input_too_long");
    // Truncated JSON can't be valid; the V-6 retry path treats it like a schema miss.
    if (message.stop_reason === "max_tokens") throw new AiError("schema_invalid");
    const text = message.content
      .filter((block): block is Extract<typeof block, { type: "text" }> => block.type === "text")
      .map((block) => block.text)
      .join("");
    const result: AiResult = {
      text,
      model: message.model,
      usage: state.usage,
      latencyMs: now() - startedAt,
      fallbackUsed: state.fallbackUsed,
    };
    return result;
  }

  async function* run(request: AiRequest): AsyncGenerator<AiStreamChunk> {
    const startedAt = now();
    const state: CallState = { fallbackUsed: false, usage: null };
    let model = request.model;
    let emitted = false;
    try {
      for (;;) {
        try {
          const iterator = streamOnce(request, model, startedAt, state);
          let step = await iterator.next();
          while (!step.done) {
            emitted = true;
            yield step.value;
            step = await iterator.next();
          }
          logger(callLog(request, step.value.model, "ok", null, step.value.usage, step.value.latencyMs, state.fallbackUsed));
          yield { type: "final", result: step.value };
          return;
        } catch (err) {
          const mapped = mapSdkError(err, request.signal);
          const fallback = fallbackMap[model];
          // Switch models only before any text went out: deltas already shown can't be retracted.
          if (mapped?.code === "model_unavailable" && fallback && !emitted && model === request.model) {
            model = fallback;
            state.fallbackUsed = true;
            continue;
          }
          throw mapped ?? err;
        }
      }
    } catch (err) {
      const code = err instanceof AiError ? err.code : "internal_error";
      logger(callLog(request, model, "error", code, state.usage, now() - startedAt, state.fallbackUsed));
      throw err;
    }
  }

  return {
    async complete(request) {
      for await (const chunk of run(request)) {
        if (chunk.type === "final") return chunk.result;
      }
      throw new AiError("schema_invalid");
    },
    stream: run,
  };
}

export function buildParams(request: AiRequest, model: string, refusalFallbacks: boolean = REFUSAL_FALLBACKS_ENABLED): BetaStreamParams {
  return {
    model,
    max_tokens: request.maxTokens ?? DEFAULT_MAX_TOKENS,
    ...(refusalFallbacks ? { betas: [REFUSAL_FALLBACK_BETA], fallbacks: "default" as const } : {}),
    system: request.system.map(toTextBlockParam),
    messages: [{ role: "user", content: request.user.map(toTextBlockParam) }],
    output_config: {
      ...(request.effort ? { effort: request.effort } : {}),
      format: { type: "json_schema", schema: request.outputSchema },
    },
  };
}

function toTextBlockParam(block: AiTextBlock) {
  return block.cache
    ? { type: "text" as const, text: block.text, cache_control: { type: "ephemeral" as const } }
    : { type: "text" as const, text: block.text };
}

type UsageLike = {
  input_tokens: number;
  output_tokens: number;
  cache_read_input_tokens: number | null;
  cache_creation_input_tokens: number | null;
};

/** Sums `iterations` when present (fallback / compaction / advisor attempts are each billed); else top level. */
export function toUsage(usage: UsageLike & { iterations?: ReadonlyArray<UsageLike> | null }): AiUsage {
  if (usage.iterations && usage.iterations.length > 0) {
    return usage.iterations.map((it) => toUsage({ ...it, iterations: null })).reduce(addUsage);
  }
  return {
    inputTokens: usage.input_tokens,
    outputTokens: usage.output_tokens,
    cacheReadInputTokens: usage.cache_read_input_tokens ?? 0,
    cacheCreationInputTokens: usage.cache_creation_input_tokens ?? 0,
  };
}

function callLog(
  request: AiRequest,
  model: string,
  outcome: "ok" | "error",
  errorCode: string | null,
  usage: AiUsage | null,
  latencyMs: number,
  fallbackUsed: boolean,
) {
  return {
    event: "ai_call" as const,
    jobId: request.jobId ?? null,
    feature: request.feature,
    promptVersion: request.promptVersion,
    model,
    outcome,
    errorCode,
    inputTokens: usage?.inputTokens ?? 0,
    outputTokens: usage?.outputTokens ?? 0,
    cacheReadInputTokens: usage?.cacheReadInputTokens ?? 0,
    cacheCreationInputTokens: usage?.cacheCreationInputTokens ?? 0,
    latencyMs,
    fallbackUsed,
  };
}
