import { describe, expect, it } from "vitest";
import { MODEL_MAP, allMappedModels, resolveModel } from "./models";
import { GEMINI_QUOTA_TIME_ZONE, nextMidnightIn, parseDurationSeconds, parseRetryAfter } from "./shared";

describe("nextMidnightIn America/Los_Angeles (C-11.2 Gemini daily reset, tz database)", () => {
  it.each([
    // PDT (UTC−7): next midnight 07:00Z = KST 16:00
    ["2026-10-28T03:00:00Z", "2026-10-28T07:00:00.000Z"],
    ["2026-10-28T07:00:00Z", "2026-10-29T07:00:00.000Z"],
    // PST (UTC−8): 08:00Z = KST 17:00
    ["2026-12-15T12:00:00Z", "2026-12-16T08:00:00.000Z"],
    // Day of the fall-back switch (2026-11-01): midnight after is in PST
    ["2026-11-01T10:00:00Z", "2026-11-02T08:00:00.000Z"],
    // Day before spring-forward (2027-03-14): midnight that day is still PST
    ["2027-03-13T20:00:00Z", "2027-03-14T08:00:00.000Z"],
    ["2027-03-14T12:00:00Z", "2027-03-15T07:00:00.000Z"],
  ])("%s → %s", (now, expected) => {
    expect(nextMidnightIn(GEMINI_QUOTA_TIME_ZONE, new Date(now)).toISOString()).toBe(expected);
  });
});

describe("retry time parsing", () => {
  const now = Date.parse("2026-10-28T00:00:00Z");
  it("Retry-After seconds and HTTP date", () => {
    expect(parseRetryAfter("30", now)?.getTime()).toBe(now + 30_000);
    expect(parseRetryAfter("Wed, 28 Oct 2026 00:01:00 GMT", now)?.toISOString()).toBe("2026-10-28T00:01:00.000Z");
    expect(parseRetryAfter("soon", now)).toBeUndefined();
    expect(parseRetryAfter(null, now)).toBeUndefined();
  });
  it("Gemini retryDelay", () => {
    expect(parseDurationSeconds("1.5s", now)?.getTime()).toBe(now + 1500);
    expect(parseDurationSeconds(3, now)).toBeUndefined();
  });
});

describe("model mapping (C-10.1, 00_model-mapping.md)", () => {
  it("is the user-confirmed table, 9 models, no duplicates", () => {
    expect(resolveModel("anthropic", "default")).toBe("claude-sonnet-5-5");
    expect(resolveModel("openai", "light")).toBe("gpt-6-luna");
    expect(resolveModel("gemini", "default")).toBe("gemini-3.8-flash");
    expect(resolveModel("gemini", "heavy")).toBe("gemini-4-argon");
    const all = allMappedModels();
    expect(all).toHaveLength(9);
    expect(new Set(all.map((m) => m.model)).size).toBe(9);
    expect(Object.isFrozen(MODEL_MAP.openai)).toBe(true);
  });
});
