import { inspect } from "node:util";
import OpenAI from "openai";
import { describe, expect, it } from "vitest";
import type { AiErrorCode } from "@/lib/contracts/errors";
import { buildParams, createOpenAiAdapter, mapOpenAiError, toUsage, type OpenAiLike } from "./openai";
import type { LlmStreamEvent, ProviderCallRequest } from "./types";

/** Fake `openai` SDK (Responses API): recorded stream events / errors. No network. */
const NOW = Date.parse("2026-10-28T03:00:00Z");
const KEY = "sk-test-openai-0000";

function req(overrides: Partial<ProviderCallRequest> = {}): ProviderCallRequest {
  return {
    model: "gpt-6.1-terra",
    apiKey: KEY,
    systemBlocks: [{ text: "common" }, { text: "feature", cache: true }],
    userBlocks: [{ text: "<career_data>…</career_data>" }, { text: "input" }],
    outputSchema: { type: "object", properties: { a: { type: "string" } }, required: ["a"], additionalProperties: false },
    maxOutputTokens: 1000,
    reasoningLevel: "medium",
    ...overrides,
  };
}

const usage = { input_tokens: 1000, input_tokens_details: { cached_tokens: 800, cache_write_tokens: 0 }, output_tokens: 60, output_tokens_details: { reasoning_tokens: 20 }, total_tokens: 1060 };

function recorded(text: string, terminal: Record<string, unknown> = { type: "response.completed", response: { status: "completed", model: "gpt-6.1-terra-2026-09-01", usage } }) {
  const events: unknown[] = [{ type: "response.created", response: { status: "in_progress", model: "gpt-6.1-terra-2026-09-01" } }];
  for (let i = 0; i < text.length; i += 4) events.push({ type: "response.output_text.delta", delta: text.slice(i, i + 4) });
  events.push(terminal);
  return events;
}

function fakeSdk(script: { events?: unknown[]; throwAt?: number; error?: unknown; retrieveError?: unknown; createError?: unknown; verifyResponse?: unknown }) {
  const calls: { body: Record<string, unknown>; apiKey: string }[] = [];
  const createClient = (apiKey: string): OpenAiLike => ({
    responses: {
      create: async (body: never) => {
        calls.push({ body: body as Record<string, unknown>, apiKey });
        if (script.createError) throw script.createError;
        if (!(body as { stream?: boolean }).stream) return script.verifyResponse ?? { status: "completed", usage };
        return (async function* () {
          let i = 0;
          for (const e of script.events ?? []) {
            if (script.throwAt === i) throw script.error;
            yield e;
            i++;
          }
        })();
      },
    },
    models: {
      retrieve: async () => {
        if (script.retrieveError) throw script.retrieveError;
        return { id: "gpt-6.1-terra" };
      },
    },
  });
  return { calls, adapter: createOpenAiAdapter({ createClient, now: () => NOW }) };
}

async function collect(stream: AsyncIterable<LlmStreamEvent>) {
  const out: LlmStreamEvent[] = [];
  for await (const e of stream) out.push(e);
  return out;
}

const apiError = (status: number, code: string | null, message = "x", headers: Record<string, string> = {}, type = "invalid_request_error") =>
  OpenAI.APIError.generate(status, { error: { message, type, code, param: null } }, message, new Headers(headers));

describe("openai adapter — request shape", () => {
  it("Responses API: strict json_schema text.format, reasoning effort, instructions = system, store false", () => {
    const params = buildParams(req());
    expect(params.text).toEqual({ format: { type: "json_schema", name: "output", schema: req().outputSchema, strict: true } });
    expect(params.reasoning).toEqual({ effort: "medium" });
    expect(params.instructions).toBe("common\n\nfeature");
    expect(params.input[0].content.map((c) => c.text)).toEqual(["<career_data>…</career_data>", "input"]);
    expect(params.store).toBe(false);
    expect(JSON.stringify(params)).not.toContain("cache_control");
    expect(buildParams(req({ outputSchema: null }))).not.toHaveProperty("text");
  });
});

describe("openai adapter — stream and usage", () => {
  it("normalizes deltas and usage (input = input − cached, reasoning reported); model = mapped id", async () => {
    const { calls, adapter } = fakeSdk({ events: recorded('{"a":"b"}') });
    const events = await collect(adapter.stream(req()));
    expect(calls[0].apiKey).toBe(KEY);
    expect(events.at(-1)).toEqual({
      type: "done",
      result: {
        text: '{"a":"b"}',
        model: "gpt-6.1-terra",
        usage: { inputTokens: 200, cachedInputTokens: 800, cacheWriteTokens: 0, outputTokens: 60, reasoningTokens: 20, usageSource: "provider_reported" },
        latencyMs: 0,
      },
    });
  });

  it.each<[string, Record<string, unknown>, AiErrorCode]>([
    ["incomplete max_output_tokens (structured)", { type: "response.incomplete", response: { status: "incomplete", incomplete_details: { reason: "max_output_tokens" }, usage } }, "schema_invalid"],
    ["incomplete content_filter", { type: "response.incomplete", response: { status: "incomplete", incomplete_details: { reason: "content_filter" }, usage } }, "safety_blocked"],
    ["failed server_error", { type: "response.failed", response: { status: "failed", error: { code: "server_error" }, usage } }, "provider_unavailable"],
    ["failed rate_limit_exceeded", { type: "response.failed", response: { status: "failed", error: { code: "rate_limit_exceeded" }, usage } }, "rate_limited"],
    ["failed invalid_prompt", { type: "response.failed", response: { status: "failed", error: { code: "invalid_prompt" }, usage } }, "safety_blocked"],
  ])("%s → %s with usage", async (_, terminal, code) => {
    const { adapter } = fakeSdk({ events: recorded('{"a":', terminal) });
    const events = await collect(adapter.stream(req()));
    expect(events.at(-1)).toMatchObject({ type: "error", error: { code, beforeFirstToken: false }, usage: { inputTokens: 200, usageSource: "provider_reported" } });
  });

  it("refusal content → safety_blocked", async () => {
    const { adapter } = fakeSdk({ events: [{ type: "response.refusal.delta", delta: "I can't" }, { type: "response.completed", response: { status: "completed", usage } }] });
    const events = await collect(adapter.stream(req()));
    expect(events.at(-1)).toMatchObject({ type: "error", error: { code: "safety_blocked", beforeFirstToken: true } });
  });

  it("stream `error` event → mapped code; no terminal response → unclassified", async () => {
    const { adapter } = fakeSdk({ events: [{ type: "error", code: "rate_limit_exceeded", message: "m", param: null, sequence_number: 1 }] });
    expect((await collect(adapter.stream(req()))).at(-1)).toMatchObject({ type: "error", error: { code: "rate_limited" }, usage: { usageSource: "unavailable" } });
    const cut = fakeSdk({ events: [{ type: "response.output_text.delta", delta: "{" }] });
    expect((await collect(cut.adapter.stream(req()))).at(-1)).toMatchObject({ type: "error", error: { code: "provider_unavailable", unclassified: true, beforeFirstToken: false } });
  });
});

describe("openai adapter — C-11.2 error table", () => {
  it.each<[string, unknown, AiErrorCode]>([
    ["429 rate_limit_exceeded (per minute)", apiError(429, "rate_limit_exceeded", "Rate limit reached for gpt-6.1-terra on requests per min (RPM)"), "rate_limited"],
    ["429 rate_limit_exceeded (per day)", apiError(429, "rate_limit_exceeded", "Rate limit reached for gpt-6.1-terra on requests per day (RPD): Limit 200"), "daily_quota_exhausted"],
    ["429 quota_exceeded", apiError(429, "quota_exceeded"), "daily_quota_exhausted"],
    ["429 insufficient_quota", apiError(429, "insufficient_quota", "You exceeded your current quota", {}, "insufficient_quota"), "billing_required"],
    ["429 credit_balance_exhausted", apiError(429, "credit_balance_exhausted"), "billing_required"],
    ["429 project_spend_limit_exceeded", apiError(429, "project_spend_limit_exceeded"), "billing_required"],
    ["401 invalid_api_key", apiError(401, "invalid_api_key"), "key_invalid"],
    ["403 permission", apiError(403, null, "You are not allowed to sample from this project"), "key_invalid"],
    ["403 model access", apiError(403, "model_not_found", "Project does not have access to model gpt-6.1-sol"), "model_not_available"],
    ["403 unsupported region [가정]", apiError(403, "unsupported_country_region_territory", "Country, region, or territory not supported"), "billing_required"],
    ["404 model_not_found", apiError(404, "model_not_found"), "model_not_available"],
    ["500", apiError(500, null, "server", {}, "server_error"), "provider_unavailable"],
    ["502", apiError(502, null), "provider_unavailable"],
    ["503", apiError(503, null), "provider_unavailable"],
    ["400 context_length_exceeded", apiError(400, "context_length_exceeded"), "input_too_long"],
    ["400 content policy", apiError(400, "content_policy_violation"), "safety_blocked"],
    ["connection", new OpenAI.APIConnectionError({ message: "reset" }), "provider_unavailable"],
    ["timeout", new OpenAI.APIConnectionTimeoutError(), "timeout"],
  ])("%s → %s", (_, err, code) => {
    expect(mapOpenAiError(err, undefined, NOW)).toMatchObject({ code, provider: "openai", unclassified: false });
  });

  it("Retry-After header → retryAfter", () => {
    const mapped = mapOpenAiError(apiError(429, "rate_limit_exceeded", "per min", { "retry-after": "12" }), undefined, NOW);
    expect(mapped.retryAfter?.getTime()).toBe(NOW + 12_000);
  });

  it("unknown 400 → unclassified provider_unavailable", () => {
    expect(mapOpenAiError(apiError(400, "unknown_parameter"), undefined, NOW)).toMatchObject({ code: "provider_unavailable", unclassified: true });
  });

  it("cancel / timeout abort", () => {
    const c = new AbortController();
    c.abort("canceled");
    expect(mapOpenAiError(new OpenAI.APIUserAbortError(), c.signal, NOW)).toMatchObject({ code: "canceled" });
  });
});

describe("openai adapter — usage edge cases", () => {
  it("missing usage → null; cached never exceeds input", () => {
    expect(toUsage(null)).toBeNull();
    expect(toUsage({ input_tokens: 10, input_tokens_details: { cached_tokens: 50 }, output_tokens: 1 })).toMatchObject({ inputTokens: 0, cachedInputTokens: 10 });
  });
});

describe("openai adapter — key verification (C-10.5)", () => {
  it("passes with the 16-token minimum generation", async () => {
    const { calls, adapter } = fakeSdk({});
    expect(await adapter.verify({ apiKey: KEY, model: "gpt-6.1-terra" })).toMatchObject({ ok: true, usage: { inputTokens: 200 } });
    expect(calls[0].body).toMatchObject({ max_output_tokens: 16, store: false });
  });

  it("stage 1 404 → model_not_available; stage 2 429 insufficient_quota → billing_required", async () => {
    expect(await fakeSdk({ retrieveError: apiError(404, "model_not_found") }).adapter.verify({ apiKey: KEY, model: "m" })).toMatchObject({ ok: false, stage: 1, error: { code: "model_not_available" } });
    expect(await fakeSdk({ createError: apiError(429, "insufficient_quota") }).adapter.verify({ apiKey: KEY, model: "m" })).toMatchObject({ ok: false, stage: 2, error: { code: "billing_required" } });
  });
});

describe("openai adapter — key never in errors (NFR-KEY-05, QA-S3a-05)", () => {
  it("a 401 body/headers echoing the key leave no trace in the mapped error", async () => {
    const echo = apiError(401, "invalid_api_key", `Incorrect API key provided: ${KEY.slice(0, 3)}…${KEY.slice(-4)}. Full: ${KEY}`, {
      "x-echo-key": KEY,
    });
    const mapped = mapOpenAiError(echo, undefined, NOW);
    expect(mapped.code).toBe("key_invalid");
    expect(mapped.cause).toBeUndefined();
    expect(mapped.sdkErrorName).toBe("AuthenticationError");
    for (const text of [mapped.message, JSON.stringify(mapped), inspect(mapped, { depth: 10 }), String(mapped.stack)]) {
      expect(text).not.toContain(KEY);
      expect(text).not.toContain(KEY.slice(-4));
    }
  });

  it("stream error events carry no key either", async () => {
    const { adapter } = fakeSdk({ createError: apiError(401, "invalid_api_key", `Incorrect API key provided: ${KEY}`) });
    const events = await collect(adapter.stream(req()));
    const text = inspect(events, { depth: 10 }) + JSON.stringify(events);
    expect(text).not.toContain(KEY);
    expect(text).not.toContain(KEY.slice(-4));
  });
});
