import { describe, expect, it } from "vitest";
import { AppError } from "@/lib/contracts/errors";
import { splitJdSentences } from "@/server/ai/context-pack/jd";
import { KO_BACKEND, NOT_A_JD } from "@/server/ai/__fixtures__/AI-01/jds";
import { ProviderError } from "@/server/ai/errors";
import { createRecordingKeyStatusReporter, createStaticKeySource, createStaticProviderContext, type ProviderContext } from "@/server/jobs/provider-context";
import type { LlmFactoryInput } from "@/server/jobs/types";
import { MemoryJobStore, MemoryUsageStore, createScriptedAdapter, fakeClock, scriptedLlmFactory, type ScriptedResponse } from "@/test/job-fakes";
import { MemoryJdDb, productionJdExtractorForTests } from "@/test/jd-extraction-fakes";
import { ensureJdExtracted, type JdExtractionDeps } from "./extraction";

/**
 * AI-01 sync extraction exit paths (S5 plan API 3): success, connection gate,
 * run gate, already extracted, in progress / dead job replaced, retries
 * (timeout immediate, short rate-limit wait inline, long wait → final
 * retry_after), not_a_jd, key_invalid, project deleted mid-run (= canceled),
 * stale run. Real AI-01 pipeline + real createLlm over a scripted adapter, so
 * usage records are exactly one per provider call.
 */

const USER = "00000000-0000-4000-8000-000000000001";
const PROJECT = "00000000-0000-4000-8000-0000000000a1";
const JD = "00000000-0000-4000-8000-0000000000b1";
const PAID: ProviderContext = { provider: "anthropic", connectionTier: "paid", keyStatus: "valid" };
const KEY = "sk-ant-test-secret-key-0001";

function setup(opts: { responses?: ScriptedResponse[]; context?: ProviderContext | null; raw?: string; gate?: JdExtractionDeps["runGate"]; status?: "pending" | "succeeded" | "failed" } = {}) {
  const clock = fakeClock();
  const store = new MemoryJobStore(clock.now);
  const usage = new MemoryUsageStore(USER);
  const keyStatus = createRecordingKeyStatusReporter();
  const context = opts.context === undefined ? PAID : opts.context;
  const adapter = createScriptedAdapter(context?.provider ?? "anthropic", opts.responses ?? [], clock.ms);
  const llm = scriptedLlmFactory(adapter.adapter, clock.ms);
  const raw = opts.raw ?? KO_BACKEND.raw;
  const jds = new MemoryJdDb({
    applicationProjectId: PROJECT,
    jobDescriptionId: JD,
    extractionStatus: opts.status ?? "pending",
    sentences: splitJdSentences(raw),
    companyName: null,
    companyNameSource: null,
    positionTitle: null,
    positionTitleSource: null,
  });
  const sleeps: number[] = [];
  const tiers: string[] = [];
  const deps: JdExtractionDeps = {
    userId: USER,
    jds,
    store,
    usage,
    providerContext: createStaticProviderContext(context),
    keySource: createStaticKeySource(KEY, () => new ProviderError("key_missing")),
    keyStatus,
    runGate: opts.gate ?? null,
    createLlm: (input: LlmFactoryInput) => {
      tiers.push(input.tier);
      return llm(input);
    },
    extract: productionJdExtractorForTests,
    now: clock.now,
    sleep: async (ms) => {
      sleeps.push(ms);
      clock.advance(ms);
    },
    timing: { heartbeatMs: 1_000_000 },
  };
  return { clock, store, usage, keyStatus, jds, adapter, deps, sleeps, tiers };
}

const onlyJob = (store: MemoryJobStore) => [...store.jobs.values()];

describe("ensureJdExtracted — success", () => {
  it("runs one light-tier call, applies the payload, completes the job, records one usage row", async () => {
    const t = setup({ responses: [{ json: KO_BACKEND.output }] });
    const r = await ensureJdExtracted(t.deps, PROJECT);
    expect(r.status).toBe("succeeded");
    const [job] = onlyJob(t.store);
    expect(job!.status).toBe("succeeded");
    expect(job!.jobType).toBe("jd_extraction");
    expect(job!.applicationProjectId).toBe(PROJECT);
    expect([job!.targetType, job!.targetId]).toEqual(["job_description", JD]);
    expect(job!.modelTier).toBe("light");
    expect(t.tiers).toEqual(["light"]);
    expect(t.jds.state.extractionStatus).toBe("succeeded");
    expect(t.jds.applied).toHaveLength(1);
    const payload = t.jds.applied[0]!.payload as { requirements: unknown[]; requirements_hash: string };
    expect(payload.requirements).toHaveLength(6);
    expect(payload.requirements_hash).toMatch(/^[0-9a-f]{64}$/);
    expect(t.jds.applied[0]!.runGeneration).toBe(job!.runGeneration);
    const rows = t.usage.forJob(job!.id);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ feature: "jd_extraction", applicationProjectId: PROJECT, outcome: "succeeded", modelTier: "light" });
    expect(t.keyStatus.successes).toEqual([job!.id]);
    // The key never reaches any stored row.
    expect(JSON.stringify([...t.store.jobs.values(), t.usage.records, t.jds.applied])).not.toContain(KEY);
  });

  it("passes only user-entered company / position to the model", async () => {
    const t = setup({ responses: [{ json: KO_BACKEND.output }] });
    t.jds.state.companyName = "AI가 채운 회사";
    t.jds.state.companyNameSource = "ai";
    t.jds.state.positionTitle = "직접 쓴 포지션";
    t.jds.state.positionTitleSource = "user";
    await ensureJdExtracted(t.deps, PROJECT);
    const prompt = JSON.stringify(t.adapter.calls[0]);
    expect(prompt).toContain("직접 쓴 포지션");
    expect(prompt).not.toContain("AI가 채운 회사");
  });
});

describe("ensureJdExtracted — refusals before any call", () => {
  it("already extracted → no job", async () => {
    const t = setup({ status: "succeeded" });
    expect(await ensureJdExtracted(t.deps, PROJECT)).toEqual({ status: "already_extracted" });
    expect(t.store.jobs.size).toBe(0);
  });

  it("unknown project → not_found", async () => {
    const t = setup();
    await expect(ensureJdExtracted(t.deps, "00000000-0000-4000-8000-0000000000ff")).rejects.toMatchObject({ code: "not_found" });
  });

  it("no connection → key_missing without a job; invalid key → key_invalid", async () => {
    const none = setup({ context: null });
    expect(await ensureJdExtracted(none.deps, PROJECT)).toMatchObject({ status: "failed", jobId: null, code: "key_missing" });
    expect(none.store.jobs.size).toBe(0);
    const invalid = setup({ context: { ...PAID, keyStatus: "invalid" } });
    expect(await ensureJdExtracted(invalid.deps, PROJECT)).toMatchObject({ status: "failed", jobId: null, code: "key_invalid" });
  });

  it("consent no longer current → key_missing (decisions 2026-10-29)", async () => {
    const t = setup();
    t.deps.providerContext = { forUser: async () => Promise.reject(new AppError("ai_consent_required")), assertJobRunnable: async () => {} };
    expect(await ensureJdExtracted(t.deps, PROJECT)).toMatchObject({ status: "failed", code: "key_missing" });
  });

  it("run gate blocks → job failed with that code, no call, JD stays pending", async () => {
    const t = setup({ gate: async () => "key_missing" });
    const r = await ensureJdExtracted(t.deps, PROJECT);
    expect(r).toMatchObject({ status: "failed", code: "key_missing" });
    expect(onlyJob(t.store)[0]!.status).toBe("failed");
    expect(t.adapter.calls).toHaveLength(0);
    expect(t.jds.state.extractionStatus).toBe("pending");
  });

  it("another live extraction → 409 extraction_in_progress; a dead one is closed as stalled and replaced", async () => {
    const t = setup({ responses: [{ json: KO_BACKEND.output }] });
    await t.store.insert({
      id: "00000000-0000-4000-8000-0000000000d1",
      userId: USER,
      jobType: "jd_extraction",
      applicationProjectId: PROJECT,
      targetType: "job_description",
      targetId: JD,
      provider: "anthropic",
      modelTier: "light",
      connectionTier: "paid",
      params: {},
      inputHash: null,
      promptVersion: null,
      model: null,
      progress: { stage: "extract", done: 0, total: 1 },
      meta: { runBase: 1, waitBase: 0, retries: {} },
    });
    await t.store.claim("00000000-0000-4000-8000-0000000000d1", { now: t.clock.now().toISOString(), staleBefore: new Date(t.clock.ms() + 1000).toISOString() });
    await expect(ensureJdExtracted(t.deps, PROJECT)).rejects.toMatchObject({ code: "extraction_in_progress", status: 409 });

    t.clock.advance(60_000);
    const r = await ensureJdExtracted(t.deps, PROJECT);
    expect(r.status).toBe("succeeded");
    expect(t.store.jobs.get("00000000-0000-4000-8000-0000000000d1")!).toMatchObject({ status: "failed", errorCode: "stalled" });
  });

  it("begin refuses (already extracted meanwhile) → job canceled, already_extracted", async () => {
    const t = setup();
    t.jds.beginError = new AppError("already_extracted", undefined, { status: 409 });
    expect(await ensureJdExtracted(t.deps, PROJECT)).toEqual({ status: "already_extracted" });
    expect(onlyJob(t.store)[0]).toMatchObject({ status: "canceled", errorCode: "canceled" });
  });
});

describe("ensureJdExtracted — failures and retries (C-11.3)", () => {
  it("timeout → one immediate retry → success; two usage rows", async () => {
    const t = setup({ responses: [{ error: "timeout" }, { json: KO_BACKEND.output }] });
    const r = await ensureJdExtracted(t.deps, PROJECT);
    expect(r.status).toBe("succeeded");
    expect(t.usage.forJob(onlyJob(t.store)[0]!.id).map((u) => u.outcome)).toEqual(["failed", "succeeded"]);
  });

  it("short rate-limit wait is taken in the request", async () => {
    const t = setup({ responses: [{ error: "rate_limited", retryAfterMs: 2_000 }, { json: KO_BACKEND.output }] });
    expect((await ensureJdExtracted(t.deps, PROJECT)).status).toBe("succeeded");
    expect(t.sleeps.length).toBe(1);
    expect(t.sleeps[0]).toBeLessThanOrEqual(5_000);
  });

  it("long rate-limit wait → failed with a final retry_after ≥ 1 min; JD failed; key failure recorded", async () => {
    const t = setup({ responses: [{ error: "rate_limited", retryAfterMs: 40_000 }] });
    const r = await ensureJdExtracted(t.deps, PROJECT);
    expect(r).toMatchObject({ status: "failed", code: "rate_limited" });
    if (r.status !== "failed") throw new Error("unreachable");
    expect(Date.parse(r.retryAfter!) - t.clock.ms()).toBeGreaterThanOrEqual(60_000);
    const [job] = onlyJob(t.store);
    expect(job).toMatchObject({ status: "failed", errorCode: "rate_limited", retryAfter: r.retryAfter });
    expect(t.jds.state.extractionStatus).toBe("failed");
    expect(t.keyStatus.failures).toEqual([{ jobId: job!.id, cause: "rate_limited" }]);
    expect(t.usage.forJob(job!.id)).toHaveLength(1);
  });

  it("daily quota → failed with quota_resets_at, no retry", async () => {
    const resets = new Date("2026-10-29T07:00:00.000Z");
    const t = setup({ responses: [{ error: "daily_quota_exhausted", quotaResetsAt: resets }] });
    const r = await ensureJdExtracted(t.deps, PROJECT);
    expect(r).toMatchObject({ status: "failed", code: "daily_quota_exhausted", quotaResetsAt: resets.toISOString(), retryAfter: null });
    expect(t.adapter.calls).toHaveLength(1);
  });

  it("key_invalid → failed, key marked invalid, no retry", async () => {
    const t = setup({ responses: [{ error: "key_invalid" }] });
    const r = await ensureJdExtracted(t.deps, PROJECT);
    expect(r).toMatchObject({ status: "failed", code: "key_invalid" });
    expect(t.keyStatus.invalidated).toHaveLength(1);
  });

  it("not a JD → not_a_jd (input category), JD failed, nothing applied", async () => {
    const t = setup({ raw: NOT_A_JD.raw, responses: [{ json: NOT_A_JD.output }] });
    const r = await ensureJdExtracted(t.deps, PROJECT);
    expect(r).toMatchObject({ status: "failed", code: "not_a_jd" });
    expect(t.jds.applied).toHaveLength(0);
    expect(t.jds.state.extractionStatus).toBe("failed");
    expect(t.usage.records).toHaveLength(1);
  });

  it("manual retry after failure: same route again runs a new job and succeeds", async () => {
    const t = setup({ responses: [{ error: "key_invalid" }, { json: KO_BACKEND.output }] });
    expect((await ensureJdExtracted(t.deps, PROJECT)).status).toBe("failed");
    expect((await ensureJdExtracted(t.deps, PROJECT)).status).toBe("succeeded");
    expect(t.store.jobs.size).toBe(2);
  });
});

describe("ensureJdExtracted — QA-S5-01 / QA-S5-02", () => {
  it("a JD with 0 sentences (symbols only) ends as not_a_jd: no provider call, no usage row, JD failed", async () => {
    const t = setup({ raw: "----\n• • •", responses: [{ json: KO_BACKEND.output }] });
    t.jds.state.sentences = [];
    const r = await ensureJdExtracted(t.deps, PROJECT);
    expect(r).toMatchObject({ status: "failed", code: "not_a_jd" });
    expect(t.adapter.calls).toHaveLength(0);
    expect(t.usage.records).toHaveLength(0);
    expect(onlyJob(t.store)[0]).toMatchObject({ status: "failed", errorCode: "not_a_jd" });
    expect(t.jds.state.extractionStatus).toBe("failed");
    expect(t.keyStatus.failures).toHaveLength(0);
  });

  it("user-edited requirements refuse the apply → 409, job ended (canceled), JD failed (never left running)", async () => {
    const t = setup({ responses: [{ json: KO_BACKEND.output }] });
    t.jds.applyError = new AppError("user_edited_requirements_exist", undefined, { status: 409 });
    await expect(ensureJdExtracted(t.deps, PROJECT)).rejects.toMatchObject({ code: "user_edited_requirements_exist", status: 409 });
    expect(onlyJob(t.store)[0]).toMatchObject({ status: "canceled", errorCode: "canceled" });
    expect(t.jds.state.extractionStatus).toBe("failed");
    expect(t.usage.records).toHaveLength(1);
  });
});

describe("ensureJdExtracted — project deleted mid-run (FL-06)", () => {
  it("apply finds no JD → canceled, usage still recorded", async () => {
    const t = setup({ responses: [{ json: KO_BACKEND.output }] });
    t.jds.applyError = new AppError("not_found");
    const r = await ensureJdExtracted(t.deps, PROJECT);
    expect(r).toMatchObject({ status: "failed", code: "canceled" });
    expect(onlyJob(t.store)[0]).toMatchObject({ status: "canceled" });
    expect(t.usage.records).toHaveLength(1);
  });

  it("stale run (apply ignored) → canceled, no success reported", async () => {
    const t = setup({ responses: [{ json: KO_BACKEND.output }] });
    t.jds.applyStale = true;
    const r = await ensureJdExtracted(t.deps, PROJECT);
    expect(r).toMatchObject({ status: "failed", code: "canceled" });
    expect(t.keyStatus.successes).toHaveLength(0);
  });

  it("heartbeat sees the job row gone (cascade) → call aborted, canceled", async () => {
    const t = setup({ responses: [{ hang: true }] });
    t.deps.timing = { heartbeatMs: 5 };
    const run = ensureJdExtracted(t.deps, PROJECT);
    // Simulate the cascade delete once the job exists.
    await new Promise((r) => setTimeout(r, 1));
    for (const id of [...t.store.jobs.keys()]) t.store.jobs.delete(id);
    const r = await run;
    expect(r).toMatchObject({ status: "failed", code: "canceled" });
    expect(t.usage.records).toHaveLength(1);
  });
});
