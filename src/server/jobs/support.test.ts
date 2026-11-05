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
import { estimateCost, estimateCostUsd, kstDate, kstPeriodMonth, UNPRICED_COST, USAGE_FEATURE_BY_JOB_TYPE } from "./cost";
import { isCronAuthorized } from "./cron";
import {
  createDevEnvKeySource,
  createDevEnvProviderContext,
  createDevEnvKeyStatusReporter,
  createStaticProviderContext,
  DevAiEnvInProductionError,
  readDevAiEnv,
} from "./provider-context";
import { decideRetry } from "./retry";
import { loadActiveForPreview, loadRetryBlocked, retryPreviewOf, toAiJobStatusResponse } from "./status";
import { parseRetryResult } from "./supabase-store";
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

describe("status response — evaluation with no re-grade target (Q53-5)", () => {
  const evaluation: JobRecord = { ...base, jobType: "interview_evaluation", targetType: "interview_session", targetId: "s1" };
  const db = (rows: unknown[] | Error) =>
    ({
      rpc: async () => {
        if (rows instanceof Error) throw rows;
        return { data: rows, error: null };
      },
    }) as unknown as Parameters<typeof loadRetryBlocked>[1];
  const row = (regrade_target_count: number) => ({ session_id: "s1", decision: "resummarize", cause: null, regrade_target_count, succeeded_count: 1 });

  it("a blocked job offers no retry", () => {
    const res = toAiJobStatusResponse(evaluation, null, { provider: "gemini", connectionTier: "free" }, true);
    expect(res.canRetry).toBe(false);
    expect(res.retry).toBeNull();
  });

  it("QA-W0-04: a questions job past prepare is blocked once the JD left `succeeded`", async () => {
    const jdDb = (extraction_status: string | Error) =>
      ({
        from: () => ({
          select: () => ({
            eq: () => ({
              maybeSingle: async () => {
                if (extraction_status instanceof Error) throw extraction_status;
                return { data: { extraction_status }, error: null };
              },
            }),
          }),
        }),
      }) as unknown as Parameters<typeof loadRetryBlocked>[1];
    const questions = { ...evaluation, jobType: "interview_questions" as const, applicationProjectId: "ap1", stepOutputs: { prepare: {} } };
    await expect(loadRetryBlocked(questions, jdDb("pending"))).resolves.toBe(true);
    await expect(loadRetryBlocked(questions, jdDb("succeeded"))).resolves.toBe(false);
    await expect(loadRetryBlocked({ ...questions, stepOutputs: {} }, jdDb("pending"))).resolves.toBe(false);
    await expect(loadRetryBlocked(questions, jdDb(new Error("down")))).resolves.toBe(false);
  });

  it("loadRetryBlocked: only a failed, retryable evaluation with 0 targets; errors → false", async () => {
    await expect(loadRetryBlocked(evaluation, db([row(0)]))).resolves.toBe(true);
    await expect(loadRetryBlocked(evaluation, db([row(1)]))).resolves.toBe(false);
    await expect(loadRetryBlocked(evaluation, db([]))).resolves.toBe(false);
    await expect(loadRetryBlocked(evaluation, db(new Error("down")))).resolves.toBe(false);
    await expect(loadRetryBlocked(base, db([row(0)]))).resolves.toBe(false);
    await expect(loadRetryBlocked({ ...evaluation, status: "running", errorCode: null }, db([row(0)]))).resolves.toBe(false);
  });
});

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

describe("retry badge preview (C-11.4, A1 R2, UX C-20 / S-40)", () => {
  it("same active provider + tier → resume; another provider or tier → from scratch", () => {
    expect(retryPreviewOf(base, { provider: "gemini", connectionTier: "free" })).toEqual({ provider: "gemini", fromScratch: false });
    expect(retryPreviewOf(base, { provider: "openai", connectionTier: "free" })).toEqual({ provider: "openai", fromScratch: true });
    expect(retryPreviewOf(base, { provider: "gemini", connectionTier: "paid" })).toEqual({ provider: "gemini", fromScratch: true });
  });

  it("no active provider → provider null; request-scoped jobs never 'from scratch'; null unless the button applies", () => {
    expect(retryPreviewOf(base, null)).toEqual({ provider: null, fromScratch: false });
    expect(retryPreviewOf({ ...base, jobType: "career_description" }, { provider: "openai", connectionTier: "paid" })).toEqual({ provider: "openai", fromScratch: false });
    expect(retryPreviewOf({ ...base, errorCode: "safety_blocked" }, { provider: "openai", connectionTier: "paid" })).toBeNull();
    expect(retryPreviewOf({ ...base, status: "running", errorCode: null }, { provider: "openai", connectionTier: "paid" })).toBeNull();
  });

  it("status response carries it and matches the contract", () => {
    const res = toAiJobStatusResponse(base, null, { provider: "anthropic", connectionTier: "paid" });
    expect(AiJobStatusResponseSchema.parse(res)).toEqual(res);
    expect(res.retry).toEqual({ provider: "anthropic", fromScratch: true });
    expect(toAiJobStatusResponse({ ...base, status: "succeeded", errorCode: null }).retry).toBeNull();
  });

  it("loadActiveForPreview reads only for a retryable failed job and swallows errors (display only)", async () => {
    let reads = 0;
    const source = createStaticProviderContext(() => {
      reads += 1;
      return { provider: "openai", connectionTier: "paid", keyStatus: "valid" };
    });
    await expect(loadActiveForPreview({ ...base, status: "running", errorCode: null }, source, USER)).resolves.toBeNull();
    expect(reads).toBe(0);
    await expect(loadActiveForPreview(base, source, USER)).resolves.toMatchObject({ provider: "openai", connectionTier: "paid" });
    const failing = { forUser: async () => null, peekActive: async () => Promise.reject(new Error("db down")) };
    await expect(loadActiveForPreview(base, failing, USER)).resolves.toBeNull();
  });
});

describe("retry_ai_job result parsing", () => {
  it("requeued → result; not requeued → null; malformed → internal_error", () => {
    expect(parseRetryResult({ requeued: true, restarted: true, status: "queued", provider: "openai", model: "m", model_tier: "default", connection_tier: "paid", run_generation: 5 })).toEqual({
      restarted: true,
      provider: "openai",
      connectionTier: "paid",
      runGeneration: 5,
    });
    expect(parseRetryResult({ requeued: false, status: "running", run_generation: 4 })).toBeNull();
    expect(() => parseRetryResult({ requeued: true, restarted: "yes", provider: "openai", connection_tier: "paid", run_generation: 5 })).toThrow();
    expect(() => parseRetryResult({ requeued: true, restarted: false, provider: "mistral", connection_tier: "paid", run_generation: 5 })).toThrow();
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

describe("estimateCost (AI C-13 입력 쪽 / 출력 쪽, v4.12 SD-A11)", () => {
  it("splits the four token kinds: 캐시 쓰기는 입력 쪽, 출력은 출력 쪽", () => {
    // 입력 10k×2 + 캐시 읽기 50k×0.1 + 캐시 쓰기 4k×2.5 = 35,000 micro-USD = 0.035
    // 출력 2k×10 = 20,000 micro-USD = 0.02
    const c = estimateCost(usage({ inputTokens: 10_000, cachedInputTokens: 50_000, cacheWriteTokens: 4_000, outputTokens: 2_000 }), sonnet);
    expect(c).toEqual({ inputCostUsd: 0.035, outputCostUsd: 0.02, estimatedCostUsd: 0.055 });
    // 합계는 반올림된 두 값의 합이다 (float 덧셈 오차 없이 — 0.055, not 0.05500000000000001)
    expect(c.estimatedCostUsd).toBe(Math.round((c.inputCostUsd + c.outputCostUsd) * 1e6) / 1e6);
    expect(estimateCostUsd(usage({ inputTokens: 10_000, cachedInputTokens: 50_000, cacheWriteTokens: 4_000, outputTokens: 2_000 }), sonnet)).toBe(0.055);
  });
  it("reasoning_tokens are inside output_tokens — never added twice", () => {
    const withReasoning = estimateCost(usage({ outputTokens: 2_000, reasoningTokens: 1_500 }), sonnet);
    expect(withReasoning).toEqual(estimateCost(usage({ outputTokens: 2_000, reasoningTokens: null }), sonnet));
    expect(withReasoning.outputCostUsd).toBe(0.02);
  });
  it("long-context prices once the whole prompt exceeds the threshold — 네 단가를 함께 바꾼다", () => {
    const at = usage({ inputTokens: 60_000, cachedInputTokens: 40_000, outputTokens: 1_000 }); // prompt = 100k → normal
    expect(estimateCost(at, haiku)).toEqual({
      inputCostUsd: (60_000 * 0.1 + 40_000 * 0.01) / 1e6,
      outputCostUsd: (1_000 * 0.5) / 1e6,
      estimatedCostUsd: (60_000 * 0.1 + 40_000 * 0.01 + 1_000 * 0.5) / 1e6,
    });
    const over = usage({ inputTokens: 60_001, cachedInputTokens: 40_000, outputTokens: 1_000 });
    const c = estimateCost(over, haiku);
    // 입력 쪽도 출력 쪽도 장문 단가 (입력만 / 출력만 바뀌는 경우는 없다)
    expect(c.inputCostUsd).toBe(Math.round(60_001 * 0.5 + 40_000 * 0.05) / 1e6);
    expect(c.outputCostUsd).toBe((1_000 * 2.5) / 1e6);
    expect(c.estimatedCostUsd).toBe(Math.round(60_001 * 0.5 + 40_000 * 0.05 + 1_000 * 2.5) / 1e6);
  });
  it("missing long-context cache prices fall back to the normal cache prices; missing cache price to input", () => {
    const p = { ...haiku, longContextCachedInputUsdPerMtok: null, longContextCacheWriteUsdPerMtok: null };
    const u = usage({ inputTokens: 200_000, cachedInputTokens: 10_000, cacheWriteTokens: 1_000 });
    expect(estimateCost(u, p).inputCostUsd).toBe(Math.round(200_000 * 0.5 + 10_000 * 0.01 + 1_000 * 0.125) / 1e6);
    const noCache = { ...sonnet, cachedInputUsdPerMtok: null };
    expect(estimateCost(usage({ cachedInputTokens: 1_000_000 }), noCache)).toEqual({ inputCostUsd: 2, outputCostUsd: 0, estimatedCostUsd: 2 });
  });
  it("unavailable usage costs 0 on all three values", () => {
    expect(estimateCost(usage({ usageSource: "unavailable" }), sonnet)).toEqual(UNPRICED_COST);
  });
  it("가격표에 없는 모델: 세 값 모두 0", () => {
    expect(UNPRICED_COST).toEqual({ inputCostUsd: 0, outputCostUsd: 0, estimatedCostUsd: 0 });
  });
  it("세 값을 각각 numeric(12,6)에서 반올림하고 합을 다시 반올림하지 않는다", () => {
    // 0.0000005 USD 단위가 섞여도 합계 = 반올림된 두 값의 합
    const odd = { ...sonnet, inputUsdPerMtok: 1.5, outputUsdPerMtok: 2.5 };
    const c = estimateCost(usage({ inputTokens: 1, outputTokens: 1 }), odd);
    expect(c.inputCostUsd).toBe(0.000002); // 1.5 micro → 2 (round-half-up)
    expect(c.outputCostUsd).toBe(0.000003); // 2.5 micro → 3
    expect(c.estimatedCostUsd).toBe(0.000005);
    expect(c.estimatedCostUsd).toBe(Math.round((c.inputCostUsd + c.outputCostUsd) * 1e6) / 1e6);
  });
});

describe("KST helpers", () => {
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
      inputCostUsd: 0.00001,
      outputCostUsd: 0.000005,
      estimatedCostUsd: 0.000015,
    });
    expect(row).not.toHaveProperty("period_month");
    expect(row).not.toHaveProperty("user_id");
    expect(row).toMatchObject({ input_tokens: 5, reasoning_tokens: 2, usage_source: "provider_reported", error_code: "rate_limited" });
    // R13 (DM 2.9.2, SD-A11): 세 비용 값을 함께 insert 한다.
    expect(row).toMatchObject({ input_cost_usd: 0.00001, output_cost_usd: 0.000005, estimated_cost_usd: 0.000015 });
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

describe("usage summary mapping (DM 2.9.5 v4.12 providers[])", () => {
  const bucket = (over: Record<string, unknown> = {}) => ({
    input_tokens: 10,
    cached_input_tokens: 1,
    cache_write_tokens: 0,
    output_tokens: 5,
    input_cost_usd: "0.0100",
    output_cost_usd: 0.0023,
    estimated_cost_usd: "0.0123",
    calls: 2,
    failed_calls: 1,
    ...over,
  });

  it("maps the RPC JSON to camelCase (numeric strings too) and keeps the stored feature values", () => {
    const s = toAiUsageSummary({
      period_month: "2026-10-01",
      as_of: "2026-10-28T09:00:00Z",
      totals: bucket(),
      providers: [
        {
          provider: "gemini",
          connection_tiers: ["free", "paid"],
          totals: bucket(),
          by_feature: [{ feature: "insight", ...bucket() }, { feature: "cover_letter", ...bucket() }],
          price_table_versions: [{ version: "v2026-10-28", source_checked_at: "2026-10-28" }],
        },
      ],
      price_table_versions: [{ version: "v2026-10-28", source_checked_at: "2026-10-28" }],
    });
    expect(AiUsageSummarySchema.parse(s)).toEqual(s);
    expect(s.totals).toMatchObject({ inputCostUsd: 0.01, outputCostUsd: 0.0023, estimatedCostUsd: 0.0123, failedCalls: 1 });
    expect(s.providers[0]).toMatchObject({ provider: "gemini", connectionTiers: ["free", "paid"] });
    // 7행 묶음은 화면 상수다 — RPC 응답은 저장 값 8개를 그대로 돌려준다 (AI C-13.1, SD-4)
    expect(s.providers[0]!.byFeature.map((f) => f.feature)).toEqual(["insight", "cover_letter"]);
    expect(s.previousMonth).toBeNull();
  });

  it("includes previous_month when present; empty month → zeros and []", () => {
    const s = toAiUsageSummary({
      period_month: "2026-10-01",
      as_of: "x",
      totals: {},
      providers: [],
      price_table_versions: [],
      previous_month: { period_month: "2026-09-01", estimated_cost_usd: 1.5, input_tokens: 3, output_tokens: 4 },
    });
    expect(s.totals.calls).toBe(0);
    expect(s.totals.inputCostUsd).toBe(0);
    expect(s.providers).toEqual([]);
    expect(s.previousMonth).toEqual({ periodMonth: "2026-09-01", estimatedCostUsd: 1.5, inputTokens: 3, outputTokens: 4 });
  });

  it("rejects an unknown feature and an unknown provider (contract drift)", () => {
    const withFeature = (feature: string) => ({
      period_month: "2026-10-01",
      as_of: "x",
      totals: {},
      providers: [{ provider: "gemini", connection_tiers: ["free"], totals: {}, by_feature: [{ feature }], price_table_versions: [] }],
      price_table_versions: [],
    });
    expect(() => toAiUsageSummary(withFeature("chat_message"))).toThrow();
    expect(() => toAiUsageSummary({ ...withFeature("insight"), providers: [{ provider: "mistral", connection_tiers: [], totals: {}, by_feature: [], price_table_versions: [] }] })).toThrow();
  });

  it("the old by_feature / by_provider response is refused (응답 교체)", () => {
    expect(() =>
      toAiUsageSummary({
        period_month: "2026-10-01",
        as_of: "x",
        totals: {},
        by_feature: [{ feature: "insight" }],
        by_provider: [{ provider: "gemini", connection_tier: "free" }],
        price_table_versions: [],
        providers: [{ provider: "gemini", connection_tiers: ["free"], totals: {}, by_feature: [], price_table_versions: [] }],
      }).providers,
    ).not.toThrow();
  });
});
