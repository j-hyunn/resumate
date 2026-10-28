import { inspect } from "node:util";
import { ApiError } from "@google/genai";
import { describe, expect, it } from "vitest";
import type { AiErrorCode } from "@/lib/contracts/errors";
import { buildParams, createGeminiAdapter, mapGeminiError, type GeminiLike } from "./gemini";
import type { LlmStreamEvent, ProviderCallRequest } from "./types";

/** Fake `@google/genai`: recorded chunks / ApiError bodies. No network. */
const NOW = Date.parse("2026-10-28T03:00:00Z"); // 2026-10-27 20:00 PDT
const KEY = "AIza-test-gemini-0000";

function req(overrides: Partial<ProviderCallRequest> = {}): ProviderCallRequest {
  return {
    model: "gemini-3.8-flash",
    apiKey: KEY,
    systemBlocks: [{ text: "common" }, { text: "feature", cache: true }],
    userBlocks: [{ text: "<career_data>…</career_data>" }, { text: "input" }],
    outputSchema: {
      type: "object",
      properties: { target: { type: "string", enum: ["a"] }, body: { type: "string" } },
      required: ["target", "body"],
      additionalProperties: false,
    },
    maxOutputTokens: 1000,
    reasoningLevel: "low",
    ...overrides,
  };
}

const usageMetadata = { promptTokenCount: 1000, cachedContentTokenCount: 600, candidatesTokenCount: 50, thoughtsTokenCount: 30, totalTokenCount: 1080 };

function chunks(text: string, finishReason = "STOP") {
  const out: unknown[] = [];
  for (let i = 0; i < text.length; i += 5) {
    out.push({ candidates: [{ content: { role: "model", parts: [{ text: "(thinking)", thought: true }, { text: text.slice(i, i + 5) }] } }] });
  }
  out.push({ candidates: [{ content: { parts: [] }, finishReason }], usageMetadata });
  return out;
}

function fakeSdk(script: { chunks?: unknown[]; throwAt?: number; error?: unknown; getError?: unknown; createError?: unknown }) {
  const calls: { params: Record<string, unknown>; apiKey: string }[] = [];
  const createClient = (apiKey: string): GeminiLike => ({
    models: {
      generateContentStream: async (params: never) => {
        calls.push({ params: params as Record<string, unknown>, apiKey });
        if (script.createError) throw script.createError;
        return (async function* () {
          let i = 0;
          for (const c of script.chunks ?? []) {
            if (script.throwAt === i) throw script.error;
            yield c;
            i++;
          }
        })();
      },
      generateContent: async (params: never) => {
        calls.push({ params: params as Record<string, unknown>, apiKey });
        if (script.createError) throw script.createError;
        return { candidates: [{ finishReason: "MAX_TOKENS" }], usageMetadata: { promptTokenCount: 3, candidatesTokenCount: 5 } };
      },
      get: async () => {
        if (script.getError) throw script.getError;
        return { name: "models/gemini-3.8-flash" };
      },
    },
  });
  return { calls, adapter: createGeminiAdapter({ createClient, now: () => NOW }) };
}

async function collect(stream: AsyncIterable<LlmStreamEvent>) {
  const out: LlmStreamEvent[] = [];
  for await (const e of stream) out.push(e);
  return out;
}

function gErr(status: number, rpcStatus: string, message = "x", details: unknown[] = []) {
  return new ApiError({ status, message: JSON.stringify({ error: { code: status, status: rpcStatus, message, details } }) });
}
const quota = (quotaId: string, quotaValue = "15") => ({
  "@type": "type.googleapis.com/google.rpc.QuotaFailure",
  violations: [{ quotaMetric: "generativelanguage.googleapis.com/generate_content_free_tier_requests", quotaId, quotaValue }],
});
const retryInfo = (delay: string) => ({ "@type": "type.googleapis.com/google.rpc.RetryInfo", retryDelay: delay });

describe("gemini adapter — request shape", () => {
  it("responseJsonSchema with propertyOrdering, systemInstruction, thinkingLevel, no explicit cache", () => {
    const params = buildParams(req());
    expect(params.config).toMatchObject({
      responseMimeType: "application/json",
      maxOutputTokens: 1000,
      thinkingConfig: { thinkingLevel: "LOW" },
      systemInstruction: { parts: [{ text: "common" }, { text: "feature" }] },
    });
    expect((params.config as unknown as { responseJsonSchema: { propertyOrdering: string[] } }).responseJsonSchema.propertyOrdering).toEqual(["target", "body"]);
    expect(params.contents[0].parts).toEqual([{ text: "<career_data>…</career_data>" }, { text: "input" }]);
    expect(params.config).not.toHaveProperty("cachedContent");
    expect(buildParams(req({ outputSchema: null })).config).not.toHaveProperty("responseJsonSchema");
  });
});

describe("gemini adapter — stream and usage", () => {
  it("skips thought parts; usage input = prompt − cached, output = candidates + thoughts", async () => {
    const { calls, adapter } = fakeSdk({ chunks: chunks('{"target":"a","body":"b"}') });
    const events = await collect(adapter.stream(req()));
    expect(calls[0].apiKey).toBe(KEY);
    const done = events.at(-1);
    expect(done).toMatchObject({
      type: "done",
      result: {
        text: '{"target":"a","body":"b"}',
        model: "gemini-3.8-flash",
        usage: { inputTokens: 400, cachedInputTokens: 600, cacheWriteTokens: 0, outputTokens: 80, reasoningTokens: 30, usageSource: "provider_reported" },
      },
    });
  });

  it.each<[string, unknown[], AiErrorCode, boolean]>([
    ["promptFeedback.blockReason", [{ promptFeedback: { blockReason: "SAFETY" }, usageMetadata }], "safety_blocked", true],
    ["finishReason SAFETY", chunks('{"target":', "SAFETY"), "safety_blocked", false],
    ["finishReason PROHIBITED_CONTENT", chunks('{"t":', "PROHIBITED_CONTENT"), "safety_blocked", false],
    ["finishReason MAX_TOKENS (structured)", chunks('{"t":', "MAX_TOKENS"), "schema_invalid", false],
  ])("%s → %s", async (_, script, code, before) => {
    const { adapter } = fakeSdk({ chunks: script });
    const events = await collect(adapter.stream(req()));
    expect(events.at(-1)).toMatchObject({ type: "error", error: { code, beforeFirstToken: before }, usage: { usageSource: "provider_reported" } });
  });

  it("stream cut after first chunk keeps partial position", async () => {
    const { adapter } = fakeSdk({ chunks: chunks('{"target":"a","body":"bbbbbbbb"}'), throwAt: 2, error: gErr(503, "UNAVAILABLE") });
    const events = await collect(adapter.stream(req()));
    expect(events.at(-1)).toMatchObject({ type: "error", error: { code: "provider_unavailable", beforeFirstToken: false }, usage: { usageSource: "unavailable" } });
  });
});

describe("gemini adapter — C-11.2 error table", () => {
  it.each<[string, unknown, AiErrorCode]>([
    ["429 PerMinute", gErr(429, "RESOURCE_EXHAUSTED", "Quota exceeded", [quota("GenerateRequestsPerMinutePerProjectPerModel-FreeTier"), retryInfo("21s")]), "rate_limited"],
    ["429 PerDay", gErr(429, "RESOURCE_EXHAUSTED", "Quota exceeded", [quota("GenerateRequestsPerDayPerProjectPerModel-FreeTier")]), "daily_quota_exhausted"],
    ["429 no details (ambiguous → 1)", gErr(429, "RESOURCE_EXHAUSTED"), "rate_limited"],
    ["429 free-tier limit 0", gErr(429, "RESOURCE_EXHAUSTED", "limit: 0, model: gemini-4-argon", [quota("GenerateRequestsPerDayPerProjectPerModel-FreeTier", "0")]), "model_not_available"],
    ["400 FAILED_PRECONDITION", gErr(400, "FAILED_PRECONDITION", "User location is not supported for the API use without a billing account linked."), "billing_required"],
    ["402 prepay credits", gErr(402, "PAYMENT_REQUIRED"), "billing_required"],
    ["400 API_KEY_INVALID", gErr(400, "INVALID_ARGUMENT", "API key not valid.", [{ "@type": "type.googleapis.com/google.rpc.ErrorInfo", reason: "API_KEY_INVALID" }]), "key_invalid"],
    ["403 PERMISSION_DENIED", gErr(403, "PERMISSION_DENIED", "Your API key was reported as leaked."), "key_invalid"],
    ["404 NOT_FOUND", gErr(404, "NOT_FOUND", "models/x is not found"), "model_not_available"],
    ["500 INTERNAL", gErr(500, "INTERNAL"), "provider_unavailable"],
    ["503 UNAVAILABLE", gErr(503, "UNAVAILABLE"), "provider_unavailable"],
    ["504 DEADLINE_EXCEEDED", gErr(504, "DEADLINE_EXCEEDED"), "provider_unavailable"],
    ["400 token count", gErr(400, "INVALID_ARGUMENT", "The input token count (1200000) exceeds the maximum number of tokens allowed (1048576)."), "input_too_long"],
    ["fetch failure", new TypeError("fetch failed"), "provider_unavailable"],
    ["429 quota_exceeded (snake_case code)", gErr(429, "quota_exceeded", "Daily quota exceeded"), "daily_quota_exhausted"],
    ["400 failed_precondition (snake_case code)", gErr(400, "failed_precondition"), "billing_required"],
  ])("%s → %s", (_, err, code) => {
    expect(mapGeminiError(err, undefined, NOW)).toMatchObject({ code, provider: "gemini", unclassified: false });
  });

  it("RetryInfo.retryDelay → retryAfter", () => {
    const mapped = mapGeminiError(gErr(429, "RESOURCE_EXHAUSTED", "q", [quota("PerMinute"), retryInfo("21s")]), undefined, NOW);
    expect(mapped.retryAfter?.getTime()).toBe(NOW + 21_000);
  });

  it("daily quota reset = next 00:00 America/Los_Angeles (PDT → 07:00Z)", () => {
    const mapped = mapGeminiError(gErr(429, "RESOURCE_EXHAUSTED", "q", [quota("GenerateRequestsPerDayPerProjectPerModel-FreeTier")]), undefined, NOW);
    expect(mapped.quotaResetsAt?.toISOString()).toBe("2026-10-28T07:00:00.000Z");
  });

  it("other INVALID_ARGUMENT and non-API errors → unclassified", () => {
    expect(mapGeminiError(gErr(400, "INVALID_ARGUMENT", "Invalid JSON payload"), undefined, NOW)).toMatchObject({ code: "provider_unavailable", unclassified: true });
    expect(mapGeminiError(new Error("weird"), undefined, NOW)).toMatchObject({ code: "provider_unavailable", unclassified: true });
  });

  it("abort: canceled vs timeout", () => {
    const c = new AbortController();
    c.abort("canceled");
    expect(mapGeminiError(new DOMException("aborted", "AbortError"), c.signal, NOW)).toMatchObject({ code: "canceled" });
    expect(mapGeminiError(new DOMException("aborted", "AbortError"), undefined, NOW)).toMatchObject({ code: "timeout" });
  });
});

describe("gemini adapter — key verification (C-10.5)", () => {
  it("any 200 passes (MAX_TOKENS stop included)", async () => {
    const { calls, adapter } = fakeSdk({});
    expect(await adapter.verify({ apiKey: KEY, model: "gemini-3.8-flash" })).toMatchObject({ ok: true, usage: { inputTokens: 3, outputTokens: 5 } });
    expect(calls[0].params).toMatchObject({ config: { maxOutputTokens: 5 } });
  });

  it("stage 1 API_KEY_INVALID; stage 2 daily quota", async () => {
    const bad = gErr(400, "INVALID_ARGUMENT", "API key not valid.", [{ reason: "API_KEY_INVALID" }]);
    expect(await fakeSdk({ getError: bad }).adapter.verify({ apiKey: KEY, model: "m" })).toMatchObject({ ok: false, stage: 1, error: { code: "key_invalid" } });
    const daily = gErr(429, "RESOURCE_EXHAUSTED", "q", [quota("GenerateRequestsPerDayPerProjectPerModel-FreeTier")]);
    expect(await fakeSdk({ createError: daily }).adapter.verify({ apiKey: KEY, model: "m" })).toMatchObject({ ok: false, stage: 2, error: { code: "daily_quota_exhausted" } });
  });
});

describe("gemini adapter — key never in errors (NFR-KEY-05, QA-S3a-05)", () => {
  it("an error body echoing the key leaves no trace in the mapped error", async () => {
    const echo = gErr(400, "INVALID_ARGUMENT", `API key not valid: ${KEY}`, [{ reason: "API_KEY_INVALID", metadata: { key: KEY } }]);
    const mapped = mapGeminiError(echo, undefined, NOW);
    expect(mapped.code).toBe("key_invalid");
    expect(mapped.cause).toBeUndefined();
    for (const text of [mapped.message, JSON.stringify(mapped), inspect(mapped, { depth: 10 }), String(mapped.stack)]) {
      expect(text).not.toContain(KEY);
      expect(text).not.toContain(KEY.slice(-4));
    }
    const { adapter } = fakeSdk({ createError: echo });
    const events = await collect(adapter.stream(req()));
    expect(inspect(events, { depth: 10 }) + JSON.stringify(events)).not.toContain(KEY.slice(-4));
  });
});
