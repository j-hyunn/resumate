import { inspect } from "node:util";
import Anthropic from "@anthropic-ai/sdk";
import { describe, expect, it } from "vitest";
import type { AiErrorCode } from "@/lib/contracts/errors";
import { ProviderError } from "../errors";
import { buildParams, createAnthropicAdapter, mapAnthropicError, type AnthropicLike } from "./anthropic";
import type { LlmStreamEvent, ProviderCallRequest } from "./types";

/** Fake @anthropic-ai/sdk: recorded stream events / errors. No network. */
const NOW = Date.parse("2026-10-28T03:00:00Z");
const KEY = "sk-ant-test-0000";

function req(overrides: Partial<ProviderCallRequest> = {}): ProviderCallRequest {
  return {
    model: "claude-sonnet-5-5",
    apiKey: KEY,
    systemBlocks: [{ text: "common" }, { text: "feature", cache: true }],
    userBlocks: [{ text: "<career_data>…</career_data>", cache: true }, { text: "input" }],
    outputSchema: { type: "object", properties: { a: { type: "string" } }, required: ["a"], additionalProperties: false },
    maxOutputTokens: 1000,
    reasoningLevel: "low",
    ...overrides,
  };
}

const startUsage = { input_tokens: 120, output_tokens: 1, cache_read_input_tokens: 900, cache_creation_input_tokens: 0 };

function recorded(text: string, stopReason = "end_turn", chunks = 3) {
  const parts: unknown[] = [{ type: "message_start", message: { model: "claude-sonnet-5-5", usage: startUsage } }];
  const size = Math.ceil(text.length / chunks);
  for (let i = 0; i < text.length; i += size) parts.push({ type: "content_block_delta", index: 0, delta: { type: "text_delta", text: text.slice(i, i + size) } });
  parts.push({ type: "message_delta", delta: { stop_reason: stopReason }, usage: { output_tokens: 42, output_tokens_details: { thinking_tokens: 10 } } });
  parts.push({ type: "message_stop" });
  return parts;
}

function fakeSdk(script: { events?: unknown[]; throwAt?: number; error?: unknown; retrieveError?: unknown; createError?: unknown }) {
  const calls: { body: Record<string, unknown>; apiKey: string }[] = [];
  const createClient = (apiKey: string): AnthropicLike => ({
    messages: {
      create: async (body: never) => {
        calls.push({ body: body as Record<string, unknown>, apiKey });
        if (script.createError) throw script.createError;
        if (!(body as { stream?: boolean }).stream) return { usage: { input_tokens: 8, output_tokens: 5 } };
        return (async function* () {
          let i = 0;
          for (const e of script.events ?? []) {
            if (script.throwAt === i) throw script.error;
            yield e;
            i++;
          }
          if (script.throwAt === i) throw script.error;
        })();
      },
    },
    models: {
      retrieve: async () => {
        if (script.retrieveError) throw script.retrieveError;
        return { id: "claude-sonnet-5-5" };
      },
    },
  });
  return { calls, adapter: createAnthropicAdapter({ createClient, now: () => NOW }) };
}

async function collect(stream: AsyncIterable<LlmStreamEvent>) {
  const out: LlmStreamEvent[] = [];
  for await (const e of stream) out.push(e);
  return out;
}

const apiError = (status: number, type: string, message = "x", headers: Record<string, string> = {}) =>
  Anthropic.APIError.generate(status, { type: "error", error: { type, message } }, message, new Headers(headers));

describe("anthropic adapter — request shape", () => {
  it("structured output via output_config.format, effort = reasoning level, cache breakpoints, no tools / fallbacks / thinking", () => {
    const params = buildParams(req());
    expect(params.output_config).toEqual({ effort: "low", format: { type: "json_schema", schema: req().outputSchema } });
    expect(params.system[1]).toMatchObject({ cache_control: { type: "ephemeral" } });
    expect(params.system[0]).not.toHaveProperty("cache_control");
    expect(params.messages[0].content[0]).toMatchObject({ cache_control: { type: "ephemeral" } });
    for (const key of ["tools", "tool_choice", "fallbacks", "betas", "thinking"]) expect(params).not.toHaveProperty(key);
    expect(buildParams(req({ outputSchema: null })).output_config).toEqual({ effort: "low" });
  });

  it("passes the per-call key to the SDK client and nowhere else", async () => {
    const { calls, adapter } = fakeSdk({ events: recorded('{"a":"b"}') });
    await adapter.complete(req());
    expect(calls[0].apiKey).toBe(KEY);
    expect(JSON.stringify(calls[0].body)).not.toContain(KEY);
  });
});

describe("anthropic adapter — stream and usage (C-10.3, C-13)", () => {
  it("normalizes deltas, done, and usage (input excludes cache; thinking reported)", async () => {
    const { adapter } = fakeSdk({ events: recorded('{"a":"b"}') });
    const events = await collect(adapter.stream(req()));
    expect(events.filter((e) => e.type === "delta").map((e) => (e.type === "delta" ? e.text : "")).join("")).toBe('{"a":"b"}');
    expect(events.at(-1)).toEqual({
      type: "done",
      result: {
        text: '{"a":"b"}',
        model: "claude-sonnet-5-5",
        usage: { inputTokens: 120, cachedInputTokens: 900, cacheWriteTokens: 0, outputTokens: 42, reasoningTokens: 10, usageSource: "provider_reported" },
        latencyMs: 0,
      },
    });
  });

  it.each<[string, AiErrorCode]>([
    ["refusal", "safety_blocked"],
    ["model_context_window_exceeded", "input_too_long"],
    ["max_tokens", "schema_invalid"],
  ])("stop_reason %s → %s with the usage of the call", async (stop, code) => {
    const { adapter } = fakeSdk({ events: recorded('{"a":', stop) });
    const events = await collect(adapter.stream(req()));
    const last = events.at(-1);
    expect(last).toMatchObject({ type: "error", error: { code, beforeFirstToken: false }, usage: { outputTokens: 42, usageSource: "provider_reported" } });
  });

  it("error after the first token: beforeFirstToken false, last usage kept", async () => {
    const { adapter } = fakeSdk({ events: recorded('{"a":"bbbbbb"}'), throwAt: 2, error: apiError(529, "overloaded_error") });
    const events = await collect(adapter.stream(req()));
    expect(events.at(-1)).toMatchObject({ type: "error", error: { code: "provider_unavailable", beforeFirstToken: false }, usage: { inputTokens: 120 } });
  });

  it("error before any token: beforeFirstToken true, usage unavailable", async () => {
    const { adapter } = fakeSdk({ createError: apiError(429, "rate_limit_error", "x", { "retry-after": "7" }) });
    const events = await collect(adapter.stream(req()));
    expect(events).toHaveLength(1);
    const last = events[0] as Extract<LlmStreamEvent, { type: "error" }>;
    expect(last.error).toMatchObject({ code: "rate_limited", beforeFirstToken: true });
    expect(last.error.retryAfter?.toISOString()).toBe(new Date(NOW + 7000).toISOString());
    expect(last.usage.usageSource).toBe("unavailable");
  });

  it("complete() throws the ProviderError of an error event", async () => {
    const { adapter } = fakeSdk({ createError: apiError(401, "authentication_error") });
    await expect(adapter.complete(req())).rejects.toMatchObject({ code: "key_invalid" });
  });
});

describe("anthropic adapter — C-11.2 error table", () => {
  it.each<[string, unknown, AiErrorCode]>([
    ["429 rate_limit_error", apiError(429, "rate_limit_error"), "rate_limited"],
    ["400 credit balance", apiError(400, "invalid_request_error", "Your credit balance is too low to access the Anthropic API."), "billing_required"],
    ["400 usage limit", apiError(400, "invalid_request_error", "You have reached your specified API usage limits."), "billing_required"],
    ["402 billing_error", apiError(402, "billing_error"), "billing_required"],
    ["401 authentication_error", apiError(401, "authentication_error"), "key_invalid"],
    ["403 permission_error", apiError(403, "permission_error"), "key_invalid"],
    ["404 not_found_error", apiError(404, "not_found_error"), "model_not_available"],
    ["500 api_error", apiError(500, "api_error"), "provider_unavailable"],
    ["529 overloaded_error", apiError(529, "overloaded_error"), "provider_unavailable"],
    ["400 prompt too long", apiError(400, "invalid_request_error", "prompt is too long: 1200000 tokens > 1000000 maximum"), "input_too_long"],
    ["413 request_too_large", apiError(413, "request_too_large"), "input_too_long"],
    ["connection error", new Anthropic.APIConnectionError({ message: "reset" }), "provider_unavailable"],
    ["connection timeout", new Anthropic.APIConnectionTimeoutError(), "timeout"],
  ])("%s → %s", (_, err, code) => {
    const mapped = mapAnthropicError(err, undefined, NOW);
    expect(mapped).toBeInstanceOf(ProviderError);
    expect(mapped).toMatchObject({ code, provider: "anthropic", unclassified: false });
  });

  it("mid-stream SSE error without status maps by error.type", () => {
    const err = Anthropic.APIError.generate(undefined, { type: "error", error: { type: "overloaded_error", message: "Overloaded" } }, "Overloaded", undefined);
    expect(mapAnthropicError(err, undefined, NOW)).toMatchObject({ code: "provider_unavailable" });
  });

  it("other 400s and unknown throws are unclassified provider_unavailable [가정]", () => {
    expect(mapAnthropicError(apiError(400, "invalid_request_error", "messages: roles must alternate"), undefined, NOW)).toMatchObject({
      code: "provider_unavailable",
      unclassified: true,
    });
    expect(mapAnthropicError(new TypeError("boom"), undefined, NOW)).toMatchObject({ code: "provider_unavailable", unclassified: true });
  });

  it("our abort wins: canceled vs timeout", () => {
    const c = new AbortController();
    c.abort("canceled");
    expect(mapAnthropicError(new Anthropic.APIUserAbortError(), c.signal, NOW)).toMatchObject({ code: "canceled" });
    const t = new AbortController();
    t.abort("deadline");
    expect(mapAnthropicError(new Anthropic.APIUserAbortError(), t.signal, NOW)).toMatchObject({ code: "timeout" });
  });

  it("never copies the provider message or the key into the error", () => {
    const mapped = mapAnthropicError(apiError(401, "authentication_error", `invalid x-api-key ${KEY}`), undefined, NOW);
    expect(mapped.cause).toBeUndefined();
    for (const text of [mapped.message, JSON.stringify(mapped), inspect(mapped, { depth: 10 }), String(mapped.stack)]) {
      expect(text).not.toContain(KEY);
      expect(text).not.toContain(KEY.slice(-4));
    }
  });
});

describe("anthropic adapter — key verification (C-10.5)", () => {
  it("passes when lookup and the tiny generation succeed; reports the generation usage", async () => {
    const { calls, adapter } = fakeSdk({});
    const out = await adapter.verify({ apiKey: KEY, model: "claude-sonnet-5-5" });
    expect(out).toMatchObject({ ok: true, usage: { inputTokens: 8, outputTokens: 5 } });
    expect(calls[0].body).toMatchObject({ model: "claude-sonnet-5-5", max_tokens: 5 });
  });

  it("stage 1 key failure and stage 2 billing failure", async () => {
    expect(await fakeSdk({ retrieveError: apiError(401, "authentication_error") }).adapter.verify({ apiKey: KEY, model: "m" })).toMatchObject({
      ok: false,
      stage: 1,
      error: { code: "key_invalid" },
    });
    expect(await fakeSdk({ createError: apiError(402, "billing_error") }).adapter.verify({ apiKey: KEY, model: "m" })).toMatchObject({
      ok: false,
      stage: 2,
      error: { code: "billing_required" },
    });
  });
});
