import { describe, expect, it } from "vitest";
import {
  AiJobStatusResponseSchema,
  AiUsageSummarySchema,
  AI_STREAM_EVENT_TYPES as CONTRACT_EVENTS,
  aiErrorEvent,
  errorCategoryOf,
  failureCauseOf,
} from "@/lib/contracts/ai";
import { AI_ERROR_CODES, AI_JOB_TYPES, USAGE_FEATURES } from "@/lib/contracts/enums";
import { AiError, ProviderError } from "@/server/ai/errors";
import { AI_STREAM_EVENT_TYPES as PIPELINE_EVENTS } from "@/server/ai/streaming/events";
import { toAiUsageSummary } from "@/server/services/usage";
import { signContinueToken, verifyContinueToken } from "./continue-token";
import { estimateCostUsd, kstDate, kstPeriodMonth, USAGE_FEATURE_BY_JOB_TYPE } from "./cost";
import { isCronAuthorized } from "./cron";
import {
  createDevEnvKeySource,
  createDevEnvProviderContext,
  createDevEnvKeyStatusReporter,
  DevAiEnvInProductionError,
  readDevAiEnv,
} from "./provider-context";
import { decideRetry } from "./retry";
import { toAiJobStatusResponse } from "./status";
import { toUsageInsert } from "./supabase-usage";
import type { JobRecord, NormalizedUsage, PriceRow } from "./types";

const SECRET = "test-secret-at-least-32-characters-long!!";
const JOB = "11111111-1111-4111-8111-111111111111";
const USER = "22222222-2222-4222-8222-222222222222";

describe("continue token", () => {
  it("round-trips for the same job", () => {
    const t = signContinueToken({ jobId: JOB, userId: USER }, SECRET);
    expect(verifyContinueToken(t, JOB, SECRET)).toEqual({ jobId: JOB, userId: USER });
  });
  it("rejects another job id, a wrong secret, a tampered body, and expiry", () => {
    const now = new Date("2026-10-26T00:00:00Z");
    const t = signContinueToken({ jobId: JOB, userId: USER }, SECRET, now);
    expect(verifyContinueToken(t, "33333333-3333-4333-8333-333333333333", SECRET, now)).toBeNull();
    expect(verifyContinueToken(t, JOB, `${SECRET}x`, now)).toBeNull();
    const [, sig] = t.split(".");
    const forged = Buffer.from(JSON.stringify({ j: JOB, u: "evil", e: 9e9 })).toString("base64url");
    expect(verifyContinueToken(`${forged}.${sig}`, JOB, SECRET, now)).toBeNull();
    expect(verifyContinueToken(t, JOB, SECRET, new Date(now.getTime() + 121_000))).toBeNull();
    expect(verifyContinueToken("garbage", JOB, SECRET, now)).toBeNull();
  });
});

describe("cron auth", () => {
  it("accepts only the exact bearer secret", () => {
    expect(isCronAuthorized("Bearer s3cret-0000000000", "s3cret-0000000000")).toBe(true);
    expect(isCronAuthorized("Bearer wrong", "s3cret-0000000000")).toBe(false);
    expect(isCronAuthorized(null, "s3cret-0000000000")).toBe(false);
  });
});

// ---------------- status response (useAiJob, S3a plan API 8) ----------------

const base: JobRecord = {
  id: JOB,
  userId: USER,
  jobType: "insight",
  status: "failed",
  progress: { stage: "match", done: 1, total: 3 },
  params: { secret: "x" },
  applicationProjectId: null,
  targetType: "application_project",
  targetId: "55555555-5555-4555-8555-555555555555",
  provider: "gemini",
  modelTier: "default",
  connectionTier: "free",
  runGeneration: 3,
  retryCount: 2,
  retryWaitTotalMs: 6000,
  nextRunAt: null,
  retryAfter: "2026-10-28T00:01:00.000Z",
  quotaResetsAt: null,
  errorCode: "rate_limited",
  inputHash: "hash",
  cancelRequestedAt: null,
  heartbeatAt: null,
  startedAt: null,
  finishedAt: null,
  createdAt: "2026-10-26T00:00:00Z",
  updatedAt: "2026-10-26T00:00:01Z",
  stepOutputs: { match: { privateModelOutput: true } },
  meta: { runBase: 1, waitBase: 0, retries: { match: { rate_limited: 2 } } },
};

describe("status response", () => {
  it("matches the contract, carries category / cause / retryAfter / provider, and never exposes step_outputs / params", () => {
    const res = toAiJobStatusResponse(base);
    expect(AiJobStatusResponseSchema.parse(res)).toEqual(res);
    expect(res.error).toMatchObject({ code: "rate_limited", category: "provider_limit", failureCause: "rate_limited" });
    expect(res).toMatchObject({
      errorCategory: "provider_limit",
      failureCause: "rate_limited",
      retryAfter: "2026-10-28T00:01:00.000Z",
      provider: "gemini",
      modelTier: "default",
      connectionTier: "free",
      retryCount: 2,
      canRetry: true,
    });
    expect(JSON.stringify(res)).not.toContain("privateModelOutput");
    expect(JSON.stringify(res)).not.toContain("secret");
  });

  it("daily quota: quotaResetsAt; input failures can't be retried; running jobs have no error", () => {
    const quota = toAiJobStatusResponse({ ...base, errorCode: "daily_quota_exhausted", retryAfter: null, quotaResetsAt: "2026-10-28T07:00:00.000Z" });
    expect(quota.quotaResetsAt).toBe("2026-10-28T07:00:00.000Z");
    expect(quota.failureCause).toBe("daily_quota_exhausted");
    expect(toAiJobStatusResponse({ ...base, errorCode: "safety_blocked" }).canRetry).toBe(false);
    expect(toAiJobStatusResponse({ ...base, errorCode: "safety_blocked" }).failureCause).toBe("input_rejected");
    const running = toAiJobStatusResponse({ ...base, status: "running", errorCode: null, retryAfter: null });
    expect(running.error).toBeNull();
    expect(running.errorCategory).toBeNull();
  });

  it("waitingRetryUntil while queued for a retry, progress without the stored key", () => {
    const res = toAiJobStatusResponse({
      ...base,
      status: "queued",
      errorCode: null,
      retryAfter: null,
      nextRunAt: "2026-10-28T00:00:02.000Z",
      progress: { stage: "match", done: 0, total: 3, waiting_retry_until: "2026-10-28T00:00:02.000Z" },
    });
    expect(res.waitingRetryUntil).toBe("2026-10-28T00:00:02.000Z");
    expect(res.progress).toEqual({ stage: "match", done: 0, total: 3 });
    expect(res.retryAfter).toBeNull();
  });

  it("key_missing: user_account category, no F-AI-08 cause, retryable after reconnecting", () => {
    const res = toAiJobStatusResponse({ ...base, errorCode: "key_missing", retryAfter: null });
    expect(res.error).toMatchObject({ category: "user_account", failureCause: null });
    expect(res.canRetry).toBe(true);
  });
});

// ---------------- contracts mirror the DB generated columns (C-11.1) ----------------

describe("contracts mirror", () => {
  const expected: Record<string, [string, string | null]> = {
    rate_limited: ["provider_limit", "rate_limited"],
    daily_quota_exhausted: ["provider_limit", "daily_quota_exhausted"],
    billing_required: ["user_account", "billing_required"],
    key_invalid: ["user_account", "key_invalid"],
    key_missing: ["user_account", null],
    model_not_available: ["user_account", "model_not_available"],
    provider_unavailable: ["transient", "provider_unavailable"],
    input_too_long: ["input", "input_rejected"],
    safety_blocked: ["input", "input_rejected"],
    insufficient_data: ["input", null],
    not_a_jd: ["input", null],
    schema_invalid: ["system", null],
    timeout: ["system", null],
    stalled: ["system", null],
    canceled: ["system", null],
  };
  it("every error code has the DB category and failure cause", () => {
    expect([...AI_ERROR_CODES].sort()).toEqual(Object.keys(expected).sort());
    for (const code of AI_ERROR_CODES) {
      expect([errorCategoryOf(code), failureCauseOf(code)]).toEqual(expected[code]);
    }
  });
  it("every job type maps to a usage feature in the CHECK list", () => {
    for (const t of AI_JOB_TYPES) expect(USAGE_FEATURES).toContain(USAGE_FEATURE_BY_JOB_TYPE[t]);
    expect(USAGE_FEATURE_BY_JOB_TYPE.draft_source_ranking).toBe("career_description");
    expect(USAGE_FEATURE_BY_JOB_TYPE.writing_chat_turn).toBe("writing_chat");
  });
  it("stream event names match the pipeline's", () => {
    expect([...CONTRACT_EVENTS]).toEqual([...PIPELINE_EVENTS]);
  });
  it("SSE error event: category, cause, times; internal_error is a retryable system failure", () => {
    expect(aiErrorEvent("rate_limited", { retryAfter: "2026-10-28T00:01:00.000Z" })).toMatchObject({
      category: "provider_limit",
      failureCause: "rate_limited",
      retryable: true,
      retryAfter: "2026-10-28T00:01:00.000Z",
      quotaResetsAt: null,
    });
    expect(aiErrorEvent("safety_blocked").retryable).toBe(false);
    expect(aiErrorEvent("internal_error")).toMatchObject({ category: "system", failureCause: null, retryable: true });
  });
});

// ---------------- cost (C-13) ----------------

const usage = (u: Partial<NormalizedUsage>): NormalizedUsage => ({
  inputTokens: 0,
  cachedInputTokens: 0,
  cacheWriteTokens: 0,
  outputTokens: 0,
  reasoningTokens: null,
  usageSource: "provider_reported",
  ...u,
});

const sonnet: PriceRow = {
  version: "v2026-10-28",
  inputUsdPerMtok: 2,
  cachedInputUsdPerMtok: 0.1,
  cacheWriteUsdPerMtok: 2.5,
  outputUsdPerMtok: 10,
  longContextThresholdTokens: null,
  longContextInputUsdPerMtok: null,
  longContextCachedInputUsdPerMtok: null,
  longContextCacheWriteUsdPerMtok: null,
  longContextOutputUsdPerMtok: null,
};
const haiku: PriceRow = {
  version: "v2026-10-28",
  inputUsdPerMtok: 0.1,
  cachedInputUsdPerMtok: 0.01,
  cacheWriteUsdPerMtok: 0.125,
  outputUsdPerMtok: 0.5,
  longContextThresholdTokens: 100_000,
  longContextInputUsdPerMtok: 0.5,
  longContextCachedInputUsdPerMtok: 0.05,
  longContextCacheWriteUsdPerMtok: 0.625,
  longContextOutputUsdPerMtok: 2.5,
};

describe("estimateCostUsd", () => {
  it("sums the four token kinds at their prices", () => {
    // 10k×2 + 50k×0.1 + 4k×2.5 + 2k×10 = 20000+5000+10000+20000 micro-USD = 0.055
    expect(estimateCostUsd(usage({ inputTokens: 10_000, cachedInputTokens: 50_000, cacheWriteTokens: 4_000, outputTokens: 2_000 }), sonnet)).toBe(0.055);
  });
  it("long-context prices once the whole prompt exceeds the threshold", () => {
    const at = usage({ inputTokens: 60_000, cachedInputTokens: 40_000, outputTokens: 1_000 }); // prompt = 100k → normal
    expect(estimateCostUsd(at, haiku)).toBe((60_000 * 0.1 + 40_000 * 0.01 + 1_000 * 0.5) / 1e6);
    const over = usage({ inputTokens: 60_001, cachedInputTokens: 40_000, outputTokens: 1_000 });
    expect(estimateCostUsd(over, haiku)).toBe(Math.round(60_001 * 0.5 + 40_000 * 0.05 + 1_000 * 2.5) / 1e6);
  });
  it("missing long-context cache prices fall back to the normal cache prices; missing cache price to input", () => {
    const p = { ...haiku, longContextCachedInputUsdPerMtok: null, longContextCacheWriteUsdPerMtok: null };
    const u = usage({ inputTokens: 200_000, cachedInputTokens: 10_000, cacheWriteTokens: 1_000 });
    expect(estimateCostUsd(u, p)).toBe(Math.round(200_000 * 0.5 + 10_000 * 0.01 + 1_000 * 0.125) / 1e6);
    const noCache = { ...sonnet, cachedInputUsdPerMtok: null };
    expect(estimateCostUsd(usage({ cachedInputTokens: 1_000_000 }), noCache)).toBe(2);
  });
  it("unavailable usage costs 0", () => {
    expect(estimateCostUsd(usage({ usageSource: "unavailable" }), sonnet)).toBe(0);
  });
  it("KST date / month boundaries", () => {
    expect(kstDate(new Date("2026-11-30T15:00:00Z"))).toBe("2026-12-01");
    expect(kstPeriodMonth(new Date("2026-10-31T14:59:59Z"))).toBe("2026-10-01");
    expect(kstPeriodMonth(new Date("2026-10-31T15:00:00Z"))).toBe("2026-11-01");
  });
  it("usage insert row never sends period_month and keeps tokens as reported", () => {
    const row = toUsageInsert({
      occurredAt: "2026-10-28T00:00:00.000Z",
      feature: "insight",
      jobType: "insight",
      aiJobId: JOB,
      callKey: "insight.match.1",
      applicationProjectId: null,
      provider: "anthropic",
      model: "claude-sonnet-5-5",
      modelTier: "default",
      connectionTier: "paid",
      usage: usage({ inputTokens: 5, reasoningTokens: 2 }),
      outcome: "failed",
      errorCode: "rate_limited",
      priceTableVersion: "v2026-10-28",
      estimatedCostUsd: 0.00001,
    });
    expect(row).not.toHaveProperty("period_month");
    expect(row).not.toHaveProperty("user_id");
    expect(row).toMatchObject({ input_tokens: 5, reasoning_tokens: 2, usage_source: "provider_reported", error_code: "rate_limited" });
  });
});

// ---------------- retry decision (C-11.3) ----------------

describe("decideRetry", () => {
  const now = new Date("2026-10-28T00:00:00.000Z");
  const zero = () => 0;
  it("rate_limited: backoff 2/4/8/16 s (+jitter), then fail with retry_after ≥ 1 min", () => {
    const e = new ProviderError("rate_limited");
    expect(decideRetry({ error: e, retriesSoFar: 0, waitUsedMs: 0, now, random: zero })).toMatchObject({ kind: "retry_at", waitMs: 2000 });
    expect(decideRetry({ error: e, retriesSoFar: 3, waitUsedMs: 14_000, now, random: () => 0.5 })).toMatchObject({ kind: "retry_at", waitMs: 16_500 });
    const fail = decideRetry({ error: e, retriesSoFar: 4, waitUsedMs: 30_000, now, random: zero });
    expect(fail).toEqual({ kind: "fail", retryAfter: new Date(now.getTime() + 60_000), quotaResetsAt: null });
  });
  it("provider Retry-After wins, and the 120 s cap ends retries", () => {
    const e = new ProviderError("rate_limited", { retryAfter: new Date(now.getTime() + 30_000) });
    expect(decideRetry({ error: e, retriesSoFar: 0, waitUsedMs: 0, now })).toMatchObject({ kind: "retry_at", waitMs: 30_000 });
    expect(decideRetry({ error: e, retriesSoFar: 1, waitUsedMs: 90_001, now }).kind).toBe("fail");
    expect(decideRetry({ error: e, retriesSoFar: 1, waitUsedMs: 90_000, now }).kind).toBe("retry_at");
  });
  it("schema_invalid / timeout retry once right away; not retryable when the pipeline already spent it", () => {
    expect(decideRetry({ error: new AiError("schema_invalid"), retriesSoFar: 0, waitUsedMs: 0, now })).toEqual({ kind: "retry_now" });
    expect(decideRetry({ error: new AiError("timeout"), retriesSoFar: 1, waitUsedMs: 0, now }).kind).toBe("fail");
    expect(decideRetry({ error: new AiError("schema_invalid", { retryable: false }), retriesSoFar: 0, waitUsedMs: 0, now }).kind).toBe("fail");
  });
  it("stream cut after the first token is never retried", () => {
    const e = new ProviderError("provider_unavailable", { beforeFirstToken: false });
    expect(decideRetry({ error: e, retriesSoFar: 0, waitUsedMs: 0, now })).toEqual({ kind: "fail", retryAfter: new Date(now.getTime() + 60_000), quotaResetsAt: null });
  });
  it("daily quota: no retry, quota reset time kept", () => {
    const resets = new Date("2026-10-28T07:00:00.000Z");
    expect(decideRetry({ error: new ProviderError("daily_quota_exhausted", { quotaResetsAt: resets }), retriesSoFar: 0, waitUsedMs: 0, now })).toEqual({
      kind: "fail",
      retryAfter: null,
      quotaResetsAt: resets,
    });
  });
  it.each(["billing_required", "key_invalid", "key_missing", "model_not_available", "input_too_long", "safety_blocked"] as const)(
    "%s: no retry, no retry_after",
    (code) => {
      expect(decideRetry({ error: new ProviderError(code), retriesSoFar: 0, waitUsedMs: 0, now })).toEqual({ kind: "fail", retryAfter: null, quotaResetsAt: null });
    },
  );
});

// ---------------- dev env provider context ----------------

describe("development AI env source", () => {
  const missing = () => new ProviderError("key_missing");
  it("gives the env provider / tier and the key outside production", async () => {
    const env = readDevAiEnv({ NODE_ENV: "development", AI_DEV_PROVIDER: "gemini", AI_DEV_API_KEY: "dev-key", AI_DEV_CONNECTION_TIER: "free" });
    expect(await createDevEnvProviderContext(env).forUser(USER)).toEqual({ provider: "gemini", connectionTier: "free", keyStatus: "valid" });
    expect(await createDevEnvKeySource(env, missing).forJob(JOB)).toBe("dev-key");
  });
  it("not configured → not connected / key_missing", async () => {
    const env = readDevAiEnv({ NODE_ENV: "development" });
    expect(await createDevEnvProviderContext(env).forUser(USER)).toBeNull();
    await expect(createDevEnvKeySource(env, missing).forJob(JOB)).rejects.toMatchObject({ code: "key_missing" });
  });
  it("throws in production", async () => {
    const env = readDevAiEnv({ NODE_ENV: "production", AI_DEV_PROVIDER: "gemini", AI_DEV_API_KEY: "dev-key" });
    await expect(createDevEnvProviderContext(env).forUser(USER)).rejects.toBeInstanceOf(DevAiEnvInProductionError);
    await expect(createDevEnvKeySource(env, missing).forJob(JOB)).rejects.toBeInstanceOf(DevAiEnvInProductionError);
    await expect(createDevEnvKeyStatusReporter(env, () => {}).markInvalid(JOB)).rejects.toBeInstanceOf(DevAiEnvInProductionError);
  });
  it("the key never appears in the invalid-key log", async () => {
    const lines: string[] = [];
    const env = readDevAiEnv({ NODE_ENV: "development", AI_DEV_PROVIDER: "openai", AI_DEV_API_KEY: "sk-very-secret-1234" });
    await createDevEnvKeyStatusReporter(env, (e, f) => lines.push(JSON.stringify({ e, ...f }))).markInvalid(JOB);
    expect(lines.join("")).not.toContain("sk-very-secret");
  });
});

// ---------------- usage meter summary (DM §2.9.5) ----------------

describe("usage summary mapping", () => {
  it("maps the RPC JSON to camelCase (numeric strings too)", () => {
    const s = toAiUsageSummary({
      period_month: "2026-10-01",
      as_of: "2026-10-28T09:00:00Z",
      totals: { input_tokens: 10, cached_input_tokens: 1, cache_write_tokens: 0, output_tokens: 5, estimated_cost_usd: "0.0123", calls: 2, failed_calls: 1 },
      by_feature: [{ feature: "insight", input_tokens: 10, output_tokens: 5, estimated_cost_usd: 0.0123, calls: 2 }],
      by_provider: [{ provider: "gemini", connection_tier: "free", input_tokens: 10, output_tokens: 5, estimated_cost_usd: 0.0123, calls: 2 }],
      price_table_versions: [{ version: "v2026-10-28", source_checked_at: "2026-10-28" }],
    });
    expect(AiUsageSummarySchema.parse(s)).toEqual(s);
    expect(s.totals).toMatchObject({ estimatedCostUsd: 0.0123, failedCalls: 1 });
    expect(s.byProvider[0]).toMatchObject({ provider: "gemini", connectionTier: "free" });
    expect(s.previousMonth).toBeNull();
  });
  it("includes previous_month when present; empty month → zeros and []", () => {
    const s = toAiUsageSummary({
      period_month: "2026-10-01",
      as_of: "x",
      totals: {},
      by_feature: [],
      by_provider: [],
      price_table_versions: [],
      previous_month: { period_month: "2026-09-01", estimated_cost_usd: 1.5, input_tokens: 3, output_tokens: 4 },
    });
    expect(s.totals.calls).toBe(0);
    expect(s.previousMonth).toEqual({ periodMonth: "2026-09-01", estimatedCostUsd: 1.5, inputTokens: 3, outputTokens: 4 });
  });
  it("rejects an unknown feature (contract drift)", () => {
    expect(() =>
      toAiUsageSummary({ period_month: "2026-10-01", as_of: "x", totals: {}, by_feature: [{ feature: "chat_message" }], by_provider: [], price_table_versions: [] }),
    ).toThrow();
  });
});
