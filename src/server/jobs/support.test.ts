import { describe, expect, it } from "vitest";
import { AiJobStatusResponseSchema, AI_STREAM_EVENT_TYPES as CONTRACT_EVENTS, errorCategoryOf } from "@/lib/contracts/ai";
import { AI_ERROR_CODES } from "@/lib/contracts/enums";
import { AI_STREAM_EVENT_TYPES as PIPELINE_EVENTS } from "@/server/ai/streaming/events";
import { toUsageSummary, kstPeriodMonth } from "@/server/services/usage";
import { signContinueToken, verifyContinueToken } from "./continue-token";
import { isCronAuthorized } from "./stalled-sweep";
import { toAiJobStatusResponse } from "./status";
import type { JobRecord } from "./types";

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

describe("status response", () => {
  const base: JobRecord = {
    id: JOB,
    userId: USER,
    jobType: "insight",
    status: "failed",
    progress: { stage: "match", done: 1, total: 3 },
    params: { secret: "x" },
    attemptCount: 2,
    errorCode: "schema_invalid",
    inputHash: "hash",
    cancelRequestedAt: null,
    heartbeatAt: null,
    startedAt: null,
    finishedAt: null,
    createdAt: "2026-10-26T00:00:00Z",
    updatedAt: "2026-10-26T00:00:01Z",
    stepOutputs: { match: { privateModelOutput: true } },
    meta: { usageEventId: "44444444-4444-4444-8444-444444444444", runBase: 1 },
  };

  it("matches the contract, carries the category, and never exposes step_outputs / params", () => {
    const res = toAiJobStatusResponse(base);
    expect(AiJobStatusResponseSchema.parse(res)).toEqual(res);
    expect(res.error).toMatchObject({ code: "schema_invalid", category: "transient" });
    expect(res.canRetry).toBe(true);
    expect(JSON.stringify(res)).not.toContain("privateModelOutput");
    expect(JSON.stringify(res)).not.toContain("secret");
  });

  it("input failures can't be retried; running jobs have no error", () => {
    expect(toAiJobStatusResponse({ ...base, errorCode: "not_a_jd" }).canRetry).toBe(false);
    expect(toAiJobStatusResponse({ ...base, status: "running", errorCode: null }).error).toBeNull();
  });
});

describe("contracts mirror", () => {
  it("every error code has a category (mirror of the generated column)", () => {
    const expected: Record<string, string> = {
      model_unavailable: "transient",
      rate_limited: "transient",
      schema_invalid: "transient",
      refused: "transient",
      not_a_jd: "input",
      insufficient_data: "input",
      input_too_long: "input",
      timeout: "timeout",
      stalled: "timeout",
      canceled: "canceled",
    };
    for (const code of AI_ERROR_CODES) expect(errorCategoryOf(code)).toBe(expected[code]);
  });
  it("stream event names match the pipeline's", () => {
    expect([...CONTRACT_EVENTS]).toEqual([...PIPELINE_EVENTS]);
  });
});

describe("usage summary", () => {
  it("KST month boundary", () => {
    expect(kstPeriodMonth(new Date("2026-10-31T14:59:59Z"))).toBe("2026-10-01");
    expect(kstPeriodMonth(new Date("2026-10-31T15:00:00Z"))).toBe("2026-11-01");
  });
  it("fills features without a limit row as limit null", () => {
    const s = toUsageSummary({ insight: { limit: 10, used: 2, remaining: 8 } }, new Date("2026-10-26T00:00:00Z"));
    expect(s.features.insight).toEqual({ limit: 10, used: 2, remaining: 8 });
    expect(s.features.chat_message).toEqual({ limit: null, used: 0, remaining: null });
    expect(Object.keys(s.features)).toHaveLength(5);
  });
});
