import { describe, expect, it } from "vitest";
import { AI_ERROR_CODES } from "@/lib/contracts/errors";
import { AiError, ProviderError, RETRY_WAIT_TOTAL_CAP_MS, finalRetryAfter, isRetryableAiErrorCode, retryDelayMs, retryPolicy } from "./errors";

describe("retryPolicy (C-11.3)", () => {
  it("matches the table", () => {
    expect(retryPolicy("rate_limited")).toMatchObject({ maxRetries: 4, backoffMs: [2000, 4000, 8000, 16000], jitterMs: 1000 });
    expect(retryPolicy("provider_unavailable")).toMatchObject({ maxRetries: 2, backoffMs: [2000, 4000], jitterMs: 1000 });
    expect(retryPolicy("schema_invalid").maxRetries).toBe(1);
    expect(retryPolicy("timeout").maxRetries).toBe(1);
    for (const code of [
      "daily_quota_exhausted",
      "billing_required",
      "key_invalid",
      "key_missing",
      "model_not_available",
      "input_too_long",
      "safety_blocked",
      "insufficient_data",
      "not_a_jd",
      "stalled",
      "canceled",
    ] as const) {
      expect(retryPolicy(code).maxRetries).toBe(0);
      expect(isRetryableAiErrorCode(code)).toBe(false);
      expect(new AiError(code).retryable).toBe(false);
    }
    expect(RETRY_WAIT_TOTAL_CAP_MS).toBe(120_000);
  });

  it("every v4 error code has a Korean message and status", () => {
    for (const code of AI_ERROR_CODES) {
      const e = new AiError(code);
      expect(e.message).toMatch(/[가-힣]/);
      expect(e.status).toBeGreaterThanOrEqual(400);
    }
  });
});

describe("retryDelayMs / finalRetryAfter", () => {
  const now = 1_000_000;
  it("backoff + jitter, last step repeats", () => {
    const e = new ProviderError("rate_limited");
    expect(retryDelayMs(e, 0, { now, random: () => 0 })).toBe(2000);
    expect(retryDelayMs(e, 3, { now, random: () => 0.999 })).toBe(16_999);
    expect(retryDelayMs(e, 9, { now, random: () => 0 })).toBe(16_000);
    expect(retryDelayMs(new AiError("schema_invalid"), 0, { now })).toBe(0);
  });

  it("provider retry time wins", () => {
    const e = new ProviderError("rate_limited", { retryAfter: new Date(now + 30_000) });
    expect(retryDelayMs(e, 0, { now })).toBe(30_000);
  });

  it("final retry_after: at least one minute for 1 and 6, null otherwise", () => {
    expect(finalRetryAfter(new ProviderError("rate_limited"), 4, now)?.getTime()).toBe(now + 60_000);
    expect(finalRetryAfter(new ProviderError("rate_limited", { retryAfter: new Date(now + 300_000) }), 4, now)?.getTime()).toBe(now + 300_000);
    expect(finalRetryAfter(new ProviderError("provider_unavailable"), 2, now)?.getTime()).toBe(now + 60_000);
    expect(finalRetryAfter(new ProviderError("key_invalid"), 0, now)).toBeNull();
  });
});

describe("ProviderError", () => {
  it("defaults: beforeFirstToken true, classified; `with` keeps fields", () => {
    const e = new ProviderError("rate_limited", { provider: "gemini", retryAfter: new Date(5) });
    expect(e).toMatchObject({ beforeFirstToken: true, unclassified: false, retryable: true });
    const copy = e.with({ beforeFirstToken: false });
    expect(copy).toMatchObject({ code: "rate_limited", provider: "gemini", beforeFirstToken: false });
    expect(copy.retryAfter?.getTime()).toBe(5);
    expect(copy).toBeInstanceOf(AiError);
  });
});
