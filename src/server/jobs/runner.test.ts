import { describe, expect, it } from "vitest";
import { AppError } from "@/lib/contracts/errors";
import type { AiErrorCode } from "@/lib/contracts/enums";
import { AiError, ProviderError } from "@/server/ai/errors";
import type { Llm } from "@/server/ai/llm";
import { resolveModel } from "@/server/ai/providers/models";
import {
  MemoryJobStore,
  MemoryUsageStore,
  createScriptedAdapter,
  fakeClock,
  memoryScope,
  scriptedLlmFactory,
  type ScriptedResponse,
} from "@/test/job-fakes";
import { FREE_TIER_MIN_INTERVAL_MS, STALLED_AFTER_MS } from "./constants";
import {
  createRecordingKeyStatusReporter,
  createStaticKeySource,
  createStaticProviderContext,
  runGateError,
  type ProviderContext,
} from "./provider-context";
import { createJobRunner } from "./runner";
import { UNPRICED_VERSION } from "./usage-recorder";
import type { JobRecord, JobRef, JobStep, JobTypeDefinition, RunnerDeps, StepContext } from "./types";

/**
 * Job runner v4 exit paths (S3a plan API 3–7, AI C-11.3 / C-12 / C-13).
 * Every test asserts job state, scheduling fields, and exactly one
 * ai_usage_records row per provider call actually made.
 * Provider calls go through the REAL createLlm over a scripted adapter.
 */

const USER = "00000000-0000-4000-8000-000000000001";
const TARGET = { type: "application_project", id: "00000000-0000-4000-8000-0000000000aa" };
const PAID: ProviderContext = { provider: "anthropic", connectionTier: "paid", keyStatus: "valid" };
const FREE: ProviderContext = { provider: "gemini", connectionTier: "free", keyStatus: "valid" };
const KEY = "sk-test-secret-key-9876";

type Ctx = StepContext<Llm>;

function callLlm(ctx: Ctx, n: number) {
  return ctx.llm.complete({
    feature: "TEST",
    promptVersion: "test.v1",
    callKey: `${ctx.callKeyPrefix}.${n}`,
    systemBlocks: [{ text: "s" }],
    userBlocks: [{ text: "u" }],
    outputSchema: null,
    signal: ctx.signal,
  });
}

/** A step that makes `calls` provider calls in sequence. */
function llmStep(stage: string, calls = 1, extra: Partial<JobStep<Llm>> = {}): JobStep<Llm> {
  return {
    stage,
    run: async (ctx) => {
      for (let n = 1; n <= calls; n++) await callLlm(ctx, n);
      return { stage };
    },
    ...extra,
  };
}

/** A streaming step: forwards deltas; a provider error event is thrown as-is (beforeFirstToken kept). */
function streamStep(stage: string): JobStep<Llm> {
  return {
    stage,
    run: async (ctx) => {
      let text = "";
      for await (const event of ctx.llm.stream({
        feature: "TEST",
        promptVersion: "test.v1",
        callKey: `${ctx.callKeyPrefix}.1`,
        systemBlocks: [],
        userBlocks: [{ text: "u" }],
        outputSchema: null,
        signal: ctx.signal,
      })) {
        if (event.type === "delta") text += event.text;
        if (event.type === "error") throw event.error;
      }
      return { length: text.length };
    },
  };
}

function def(steps: JobStep<Llm>[], extra: Partial<JobTypeDefinition<Llm>> = {}): JobTypeDefinition<Llm> {
  return { jobType: "insight", modelTier: "default", steps, ...extra };
}

type SetupOpts = {
  responses?: ScriptedResponse[];
  context?: ProviderContext | null;
  key?: string | null;
  timing?: RunnerDeps["timing"];
  runnable?: Parameters<typeof createStaticProviderContext>[1];
  checkRunAllowed?: RunnerDeps["checkRunAllowed"];
};

function setup(definition: JobTypeDefinition<Llm>, opts: SetupOpts = {}) {
  const clock = fakeClock();
  const context = opts.context === undefined ? PAID : opts.context;
  const store = new MemoryJobStore(clock.now);
  const usage = new MemoryUsageStore(USER);
  const scripted = createScriptedAdapter(context?.provider ?? "anthropic", opts.responses ?? [], clock.ms);
  const keyStatus = createRecordingKeyStatusReporter();
  const keySource = createStaticKeySource(opts.key === undefined ? KEY : opts.key, () => new ProviderError("key_missing"));
  const scheduled: (() => Promise<void>)[] = [];
  const continued: JobRef[] = [];
  const logs: { event: string; fields: Record<string, unknown> }[] = [];
  const runner = createJobRunner<Llm>({
    forUser: () => memoryScope(store, usage, { keySource, keyStatus }),
    providerContext: createStaticProviderContext(context, opts.runnable),
    checkRunAllowed: opts.checkRunAllowed,
    createLlm: scriptedLlmFactory(scripted.adapter, clock.ms),
    settleLlm: (llm, timeoutMs) => llm.settle(timeoutMs),
    getDefinition: (t) => (t === definition.jobType ? definition : undefined),
    schedule: (task) => {
      scheduled.push(task);
    },
    continueJob: async (ref) => {
      continued.push(ref);
    },
    now: clock.now,
    random: () => 0,
    log: (event, fields) => logs.push({ event, fields }),
    timing: { stepTimeoutMs: 1_000, heartbeatIntervalMs: 5, invocationBudgetMs: 55_000, ...opts.timing },
  });
  async function drain() {
    while (scheduled.length) await scheduled.shift()!();
    await new Promise((r) => setTimeout(r, 0)); // late usage records of aborted calls
  }
  const job = (id: string) => store.jobs.get(id)!;
  const records = (id: string) => usage.forJob(id);
  return { clock, store, usage, scripted, keyStatus, runner, scheduled, continued, logs, drain, job, records };
}

type H = ReturnType<typeof setup>;

async function start(h: H, extra: Partial<Parameters<H["runner"]["startJob"]>[0]> = {}) {
  return h.runner.startJob({ userId: USER, jobType: "insight", params: { a: 1 }, target: TARGET, ...extra });
}

/** Wake a scheduled job the way the status poll does (B-4): advance to next_run_at, GET, run. */
async function wake(h: H, jobId: string) {
  const at = h.job(jobId).nextRunAt;
  expect(at).not.toBeNull();
  h.clock.advance(Date.parse(at!) - h.clock.ms());
  await h.runner.getStatus({ jobId, userId: USER });
  await h.drain();
}

function expectScheduled(j: JobRecord, opts: { waitMs: number; retryCount: number; gen: number; waitTotal: number; now: number }) {
  const runAt = new Date(opts.now + opts.waitMs).toISOString();
  expect(j.status).toBe("queued");
  expect(j.nextRunAt).toBe(runAt);
  expect(j.progress.waiting_retry_until).toBe(runAt);
  expect(j.retryCount).toBe(opts.retryCount);
  expect(j.runGeneration).toBe(opts.gen);
  expect(j.retryWaitTotalMs).toBe(opts.waitTotal);
}

const okJson = { json: { ok: true } } as const;

// ======================================================================

describe("startJob", () => {
  it("not connected → ai_not_connected, no job row", async () => {
    const h = setup(def([llmStep("match")]), { context: null });
    await expect(start(h)).rejects.toMatchObject({ code: "ai_not_connected", status: 409 });
    expect(h.store.jobs.size).toBe(0);
  });

  it("invalid key → key_invalid, no job row; needs_check is allowed", async () => {
    const h = setup(def([llmStep("match")]), { context: { ...PAID, keyStatus: "invalid" } });
    await expect(start(h)).rejects.toMatchObject({ code: "key_invalid" });
    expect(h.store.jobs.size).toBe(0);
    const h2 = setup(def([llmStep("match")]), { context: { ...PAID, keyStatus: "needs_check" } });
    await expect(start(h2)).resolves.toMatchObject({ reused: false, inProgress: false });
  });

  it("fixes provider, model tier (registry), and connection tier into the queued row", async () => {
    const h = setup(def([llmStep("match")], { modelTier: "light" }), { context: FREE });
    const { jobId } = await start(h);
    expect(h.job(jobId)).toMatchObject({
      status: "queued",
      provider: "gemini",
      modelTier: "light",
      connectionTier: "free",
      runGeneration: 1,
      retryCount: 0,
      targetType: TARGET.type,
      targetId: TARGET.id,
      progress: { stage: "match", done: 0, total: 1 },
    });
    expect(h.scheduled).toHaveLength(1);
  });

  it("same target in flight → that job (inProgress), also when losing the insert race", async () => {
    const h = setup(def([llmStep("match")]));
    const first = await start(h);
    expect(await start(h)).toEqual({ jobId: first.jobId, reused: false, inProgress: true });
    // Race: our pre-check saw nothing, the unique index refuses the insert.
    const find = h.store.findInFlight.bind(h.store);
    let calls = 0;
    h.store.findInFlight = async (q) => (calls++ === 0 ? null : find(q));
    expect(await start(h)).toEqual({ jobId: first.jobId, reused: false, inProgress: true });
    expect(h.store.jobs.size).toBe(1);
  });

  it("input_hash reuse (same provider): no new job, no provider call, no usage record; regenerate calls again", async () => {
    const h = setup(def([llmStep("match")]), { responses: [okJson, okJson] });
    const first = await start(h, { inputHash: "h1" });
    await h.drain();
    expect(h.records(first.jobId)).toHaveLength(1);
    const again = await start(h, { inputHash: "h1" });
    expect(again).toEqual({ jobId: first.jobId, reused: true, inProgress: false });
    expect(h.usage.records).toHaveLength(1);
    expect(h.scripted.calls).toHaveLength(1);
    const regen = await start(h, { inputHash: "h1", regenerate: true });
    await h.drain();
    expect(regen.reused).toBe(false);
    expect(h.usage.records).toHaveLength(2);
  });

  it("reuse is per provider (C-6 v4)", async () => {
    const h = setup(def([llmStep("match")]), { responses: [okJson] });
    const first = await start(h, { inputHash: "h1" });
    await h.drain();
    h.job(first.jobId).provider = "openai"; // succeeded with another provider
    const again = await start(h, { inputHash: "h1" });
    expect(again.reused).toBe(false);
  });
});

describe("success", () => {
  it("succeeded; one usage record per call with feature, tiers, model, price version, and cost", async () => {
    const h = setup(def([llmStep("match", 2), llmStep("synthesize")]), { responses: [okJson, okJson, okJson] });
    const { jobId } = await start(h, { applicationProjectId: "00000000-0000-4000-8000-0000000000bb" });
    await h.drain();
    const j = h.job(jobId);
    expect(j.status).toBe("succeeded");
    expect(j.progress).toEqual({ stage: "synthesize", done: 1, total: 1 });
    expect(j.retryCount).toBe(0);
    const recs = h.records(jobId);
    expect(recs.map((r) => r.callKey)).toEqual(["insight.match.1", "insight.match.2", "insight.synthesize.1"]);
    for (const r of recs) {
      expect(r).toMatchObject({
        feature: "insight",
        jobType: "insight",
        provider: "anthropic",
        model: resolveModel("anthropic", "default"),
        modelTier: "default",
        connectionTier: "paid",
        outcome: "succeeded",
        errorCode: null,
        applicationProjectId: "00000000-0000-4000-8000-0000000000bb",
        priceTableVersion: "v-test",
        // 1000 in × $1 + 200 out × $5 per 1M
        estimatedCostUsd: 0.002,
      });
    }
    expect(h.usage.priceLookups).toBe(1); // cached per invocation
    // The key reached the adapter and nothing else.
    expect(h.scripted.calls.every((c) => c.apiKey === KEY)).toBe(true);
    expect(JSON.stringify([...h.store.jobs.values(), h.usage.records, h.logs])).not.toContain(KEY);
  });

  it("draft_source_ranking output is stored before completing; records count under career_description", async () => {
    const h = setup(
      { jobType: "draft_source_ranking", modelTier: "light", steps: [llmStep("rank")], output: (prev) => prev.rank },
      { responses: [okJson] },
    );
    const { jobId } = await h.runner.startJob({ userId: USER, jobType: "draft_source_ranking", target: TARGET });
    await h.drain();
    expect(h.job(jobId).status).toBe("succeeded");
    expect(h.records(jobId)[0]).toMatchObject({ feature: "career_description", modelTier: "light", model: resolveModel("anthropic", "light") });
  });
});

describe("C-11.3 retries", () => {
  it("rate_limited: queued + next_run_at (no wait in the function), woken by the status poll, then succeeds", async () => {
    const h = setup(def([llmStep("match")]), { responses: [{ error: "rate_limited" }, okJson] });
    const { jobId } = await start(h);
    const t0 = h.clock.ms();
    await h.drain();
    expectScheduled(h.job(jobId), { waitMs: 2_000, retryCount: 1, gen: 2, waitTotal: 2_000, now: t0 });
    expect(h.job(jobId).meta.retries).toEqual({ match: { rate_limited: 1 } });
    expect(h.records(jobId)).toEqual([expect.objectContaining({ outcome: "failed", errorCode: "rate_limited", usage: expect.objectContaining({ usageSource: "unavailable" }), estimatedCostUsd: 0 })]);

    // Not due yet: polling doesn't run it.
    await h.runner.getStatus({ jobId, userId: USER });
    expect(h.scheduled).toHaveLength(0);
    await wake(h, jobId);
    const j = h.job(jobId);
    expect(j.status).toBe("succeeded");
    expect(j.nextRunAt).toBeNull();
    expect(j.retryCount).toBe(1);
    expect(h.records(jobId).map((r) => r.outcome)).toEqual(["failed", "succeeded"]);
  });

  it("rate_limited ×5: 4 retries (2/4/8/16 s), then failed with retry_after = now + 1 min", async () => {
    const h = setup(def([llmStep("match")]), { responses: Array(5).fill({ error: "rate_limited" }) });
    const { jobId } = await start(h);
    await h.drain();
    for (const wait of [4_000, 8_000, 16_000]) {
      const t = Date.parse(h.job(jobId).nextRunAt!);
      await wake(h, jobId);
      expect(Date.parse(h.job(jobId).nextRunAt!) - t).toBe(wait);
    }
    await wake(h, jobId);
    const j = h.job(jobId);
    expect(j).toMatchObject({ status: "failed", errorCode: "rate_limited", retryCount: 4, retryWaitTotalMs: 30_000, nextRunAt: null });
    expect(j.retryAfter).toBe(new Date(h.clock.ms() + 60_000).toISOString());
    expect(h.records(jobId)).toHaveLength(5);
    expect(h.scripted.calls).toHaveLength(5);
  });

  it("provider_unavailable ×3: 2 retries (2/4 s), then failed with retry_after = now + 1 min", async () => {
    const h = setup(def([llmStep("match")]), { responses: Array(3).fill({ error: "provider_unavailable" }) });
    const { jobId } = await start(h);
    await h.drain();
    await wake(h, jobId);
    await wake(h, jobId);
    const j = h.job(jobId);
    expect(j).toMatchObject({ status: "failed", errorCode: "provider_unavailable", retryCount: 2, retryWaitTotalMs: 6_000 });
    expect(j.retryAfter).toBe(new Date(h.clock.ms() + 60_000).toISOString());
    expect(h.records(jobId)).toHaveLength(3);
  });

  it("provider Retry-After is used as the wait; the 120 s total cap ends retries", async () => {
    const h = setup(def([llmStep("match")]), {
      responses: [
        { error: "rate_limited", retryAfterMs: 100_000 },
        { error: "rate_limited", retryAfterMs: 30_000 },
      ],
    });
    const { jobId } = await start(h);
    const t0 = h.clock.ms();
    await h.drain();
    expectScheduled(h.job(jobId), { waitMs: 100_000, retryCount: 1, gen: 2, waitTotal: 100_000, now: t0 });
    await wake(h, jobId);
    const j = h.job(jobId);
    expect(j).toMatchObject({ status: "failed", errorCode: "rate_limited", retryCount: 1, retryWaitTotalMs: 100_000 });
    expect(j.retryAfter).toBe(new Date(h.clock.ms() + 60_000).toISOString());
    expect(h.records(jobId)).toHaveLength(2);
  });

  it("retry counts are per call: a later step gets its own budget", async () => {
    const h = setup(def([llmStep("match"), llmStep("synthesize")]), {
      responses: [{ error: "provider_unavailable" }, { error: "provider_unavailable" }, okJson, { error: "provider_unavailable" }, okJson],
    });
    const { jobId } = await start(h);
    await h.drain();
    await wake(h, jobId);
    await wake(h, jobId); // match ok, synthesize fails once
    await wake(h, jobId);
    expect(h.job(jobId)).toMatchObject({ status: "succeeded", retryCount: 3 });
    expect(h.job(jobId).meta.retries).toEqual({ match: { provider_unavailable: 2 }, synthesize: { provider_unavailable: 1 } });
    expect(h.records(jobId)).toHaveLength(5);
  });

  it("schema_invalid: one immediate retry in the same invocation, then failed (no retry_after)", async () => {
    let tries = 0;
    const step: JobStep<Llm> = {
      stage: "match",
      run: async (ctx) => {
        tries++;
        await callLlm(ctx, 1);
        throw new AiError("schema_invalid");
      },
    };
    const h = setup(def([step]), { responses: [okJson, okJson] });
    const { jobId } = await start(h);
    await h.drain();
    expect(tries).toBe(2);
    expect(h.job(jobId)).toMatchObject({ status: "failed", errorCode: "schema_invalid", retryCount: 1, runGeneration: 2, retryAfter: null, retryWaitTotalMs: 0 });
    expect(h.records(jobId)).toHaveLength(2);
  });

  it("schema_invalid after the pipeline's own V-6 retry (retryable: false) is not retried again", async () => {
    const step: JobStep<Llm> = { stage: "match", run: async () => Promise.reject(new AiError("schema_invalid", { retryable: false })) };
    const h = setup(def([step]));
    const { jobId } = await start(h);
    await h.drain();
    expect(h.job(jobId)).toMatchObject({ status: "failed", errorCode: "schema_invalid", retryCount: 0 });
    expect(h.records(jobId)).toHaveLength(0); // no provider call in this fake step
  });

  it("timeout (hanging provider): retried once, then failed timeout; one record per aborted call", async () => {
    const h = setup(def([llmStep("match")]), { responses: [{ hang: true }, { hang: true }], timing: { stepTimeoutMs: 30 } });
    const { jobId } = await start(h);
    await h.drain();
    expect(h.job(jobId)).toMatchObject({ status: "failed", errorCode: "timeout", retryCount: 1 });
    expect(h.records(jobId)).toHaveLength(2);
    expect(h.records(jobId).every((r) => r.outcome === "failed" && r.errorCode === "timeout")).toBe(true);
  });

  it("daily_quota_exhausted: no retry, quota_resets_at stored", async () => {
    const resets = new Date("2026-10-28T07:00:00.000Z");
    const h = setup(def([llmStep("match")]), { responses: [{ error: "daily_quota_exhausted", quotaResetsAt: resets, usage: { inputTokens: 10 } }] });
    const { jobId } = await start(h);
    await h.drain();
    expect(h.job(jobId)).toMatchObject({ status: "failed", errorCode: "daily_quota_exhausted", retryCount: 0, quotaResetsAt: resets.toISOString(), retryAfter: null });
    // A failed call that reported tokens is recorded with them (F-AI-07 (7)).
    expect(h.records(jobId)).toEqual([expect.objectContaining({ outcome: "failed", usage: expect.objectContaining({ inputTokens: 10, usageSource: "provider_reported" }) })]);
  });

  it("key_invalid: no retry, key marked invalid", async () => {
    const h = setup(def([llmStep("match")]), { responses: [{ error: "key_invalid" }] });
    const { jobId } = await start(h);
    await h.drain();
    expect(h.job(jobId)).toMatchObject({ status: "failed", errorCode: "key_invalid", retryCount: 0 });
    expect(h.keyStatus.invalidated).toEqual([jobId]);
    expect(h.records(jobId)).toHaveLength(1);
  });

  it("key_missing (key deleted mid-run): failed before any provider call, no usage record", async () => {
    const h = setup(def([llmStep("match")]), { key: null });
    const { jobId } = await start(h);
    await h.drain();
    expect(h.job(jobId)).toMatchObject({ status: "failed", errorCode: "key_missing", retryCount: 0 });
    expect(h.scripted.calls).toHaveLength(0);
    expect(h.records(jobId)).toHaveLength(0);
    expect(h.keyStatus.invalidated).toEqual([]);
  });

  it.each<AiErrorCode>(["billing_required", "model_not_available", "input_too_long", "safety_blocked"])("%s: no retry, final failure", async (code) => {
    const h = setup(def([llmStep("match")]), { responses: [{ error: code }] });
    const { jobId } = await start(h);
    await h.drain();
    expect(h.job(jobId)).toMatchObject({ status: "failed", errorCode: code, retryCount: 0, retryAfter: null, quotaResetsAt: null });
    expect(h.records(jobId)).toHaveLength(1);
  });

  it("QA-S3a-02: a non-provider exception in a step (our bug / DB error) → stalled, no retry, logged unclassified", async () => {
    const step: JobStep<Llm> = { stage: "match", run: async () => Promise.reject(new TypeError("bug")) };
    const h = setup(def([step]));
    const { jobId } = await start(h);
    await h.drain();
    expect(h.job(jobId)).toMatchObject({ status: "failed", errorCode: "stalled", retryCount: 0, retryAfter: null, nextRunAt: null });
    expect(h.logs.some((l) => l.event === "ai_job.step_error" && l.fields.unclassified === true)).toBe(true);
    expect(h.records(jobId)).toHaveLength(0);
  });

  it("QA-S3a-02: an unknown failure INSIDE a provider call → provider_unavailable (unclassified), retried 2×, one row per call", async () => {
    const h = setup(def([llmStep("match")]), { responses: [{ throwRaw: true }, { throwRaw: true }, { throwRaw: true }] });
    const { jobId } = await start(h);
    await h.drain();
    expect(h.job(jobId)).toMatchObject({ status: "queued", retryCount: 1 });
    await wake(h, jobId);
    await wake(h, jobId);
    expect(h.job(jobId)).toMatchObject({ status: "failed", errorCode: "provider_unavailable", retryCount: 2 });
    expect(h.logs.some((l) => l.event === "ai_job.step_error" && l.fields.unclassified === true)).toBe(true);
    expect(h.records(jobId)).toHaveLength(3);
    expect(h.records(jobId).every((r) => r.errorCode === "provider_unavailable")).toBe(true);
  });

  it("QA-S3a-03: a step that forgets ctx.signal still stops on the deadline (run signal on every call)", async () => {
    const careless: JobStep<Llm> = {
      stage: "match",
      run: async (ctx) =>
        ctx.llm.complete({ feature: "T", promptVersion: "v", callKey: `${ctx.callKeyPrefix}.1`, systemBlocks: [], userBlocks: [{ text: "u" }], outputSchema: null }),
    };
    const h = setup(def([careless]), { responses: [{ hang: true }, { hang: true }], timing: { stepTimeoutMs: 20 } });
    const { jobId } = await start(h);
    await h.scheduled.shift()!();
    expect(h.job(jobId)).toMatchObject({ status: "failed", errorCode: "timeout", retryCount: 1 });
    expect(h.records(jobId).map((r) => r.errorCode)).toEqual(["timeout", "timeout"]);
  });

  it("stream cut after the first token: not retried; the reported usage is recorded once", async () => {
    const h = setup(def([streamStep("generate")]), { responses: [{ errorAfterChunks: "provider_unavailable", json: { long: "text" }, chunks: 3 }] });
    const { jobId } = await start(h);
    await h.drain();
    const j = h.job(jobId);
    expect(j).toMatchObject({ status: "failed", errorCode: "provider_unavailable", retryCount: 0 });
    expect(j.retryAfter).toBe(new Date(h.clock.ms() + 60_000).toISOString());
    expect(h.records(jobId)).toEqual([expect.objectContaining({ outcome: "failed", usage: expect.objectContaining({ outputTokens: 3, usageSource: "provider_reported" }) })]);
  });

  it("stream error before the first token is retried", async () => {
    const h = setup(def([streamStep("generate")]), { responses: [{ errorAfterChunks: "provider_unavailable", json: { a: 1 }, chunks: 0 }, okJson] });
    const { jobId } = await start(h);
    await h.drain();
    expect(h.job(jobId).status).toBe("queued");
    await wake(h, jobId);
    expect(h.job(jobId)).toMatchObject({ status: "succeeded", retryCount: 1 });
    expect(h.records(jobId)).toHaveLength(2);
  });
});

describe("cancel / stalled / lost", () => {
  it("cancel while a call hangs → canceled (no retry); the aborted call is recorded", async () => {
    const h = setup(def([llmStep("match")]), { responses: [{ hang: true }], timing: { stepTimeoutMs: 5_000 } });
    const { jobId } = await start(h);
    const run = h.drain();
    await new Promise((r) => setTimeout(r, 15));
    h.store.requestCancel(jobId);
    await run;
    await h.drain();
    expect(h.job(jobId)).toMatchObject({ status: "canceled", errorCode: "canceled", retryCount: 0 });
    expect(h.records(jobId)).toEqual([expect.objectContaining({ outcome: "failed", errorCode: "canceled" })]);
  });

  it("cancel of a job waiting for a scheduled retry (next_run_at in the future)", async () => {
    const h = setup(def([llmStep("match")]), { responses: [{ error: "rate_limited" }] });
    const { jobId } = await start(h);
    await h.drain();
    expect(h.job(jobId).status).toBe("queued");
    h.store.requestCancel(jobId);
    const after = await h.runner.settleCancelIfQueued({ jobId, userId: USER });
    expect(after).toMatchObject({ status: "canceled", errorCode: "canceled", nextRunAt: null });
    expect(h.records(jobId)).toHaveLength(1);
  });

  it("cancel before the first run: canceled, no provider call", async () => {
    const h = setup(def([llmStep("match")]));
    const { jobId } = await start(h);
    h.store.requestCancel(jobId);
    await h.drain();
    expect(h.job(jobId).status).toBe("canceled");
    expect(h.records(jobId)).toHaveLength(0);
  });

  it("stalled: a running job with an old heartbeat fails on the status read; a waiting job is never stalled", async () => {
    const h = setup(def([llmStep("match")]), { responses: [{ error: "rate_limited" }] });
    const a = await start(h);
    await h.drain(); // queued, waiting for next_run_at
    const stuck = await start(h, { target: { type: "application_project", id: "00000000-0000-4000-8000-0000000000cc" } });
    h.scheduled.length = 0;
    Object.assign(h.job(stuck.jobId), { status: "running", heartbeatAt: new Date(h.clock.ms()).toISOString() });
    h.clock.advance(STALLED_AFTER_MS + 1);
    const res = await h.runner.getStatus({ jobId: stuck.jobId, userId: USER });
    expect(res).toMatchObject({ status: "failed", errorCode: "stalled" });
    expect(h.runner.isStalled(h.job(a.jobId))).toBe(false);
    // Long overdue (user left; cron later): the poll wakes it instead of failing it.
    await h.runner.getStatus({ jobId: a.jobId, userId: USER });
    expect(h.scheduled).toHaveLength(1);
  });

  it("zombie runner: the sweep fails the job mid-step → lost, nothing overwritten", async () => {
    let swept = false;
    const step: JobStep<Llm> = {
      stage: "match",
      run: async (ctx) => {
        await callLlm(ctx, 1);
        h.store.sweep(ctx.jobId);
        swept = true;
        return { done: true };
      },
    };
    const h: H = setup(def([step, llmStep("synthesize")]), { responses: [okJson, okJson] });
    const { jobId } = await start(h);
    await h.drain();
    expect(swept).toBe(true);
    expect(h.job(jobId)).toMatchObject({ status: "failed", errorCode: "stalled" });
    expect(h.records(jobId)).toHaveLength(1); // only the call made
    expect(h.logs.some((l) => l.event === "ai_job.lost")).toBe(true);
  });

  it("complete_ai_job keeps failing → failed stalled (never left running)", async () => {
    const h = setup(def([llmStep("match")]), { responses: [okJson] });
    const { jobId } = await start(h);
    h.store.failNext.complete = 2;
    await h.drain();
    expect(h.job(jobId)).toMatchObject({ status: "failed", errorCode: "stalled" });
    expect(h.records(jobId)).toHaveLength(1);
  });

  it("checkpoint write error outside a step → failed stalled", async () => {
    const h = setup(def([llmStep("match")]), { responses: [okJson] });
    const { jobId } = await start(h);
    h.store.failNext.saveStepOutputs = 1;
    await h.drain();
    expect(h.job(jobId)).toMatchObject({ status: "failed", errorCode: "stalled" });
    expect(h.records(jobId)).toHaveLength(1);
  });
});

describe("QA-S3a round 1", () => {
  it("QA-S3a-03: a call the aborted step left running still gets its usage row before runJob returns", async () => {
    // The step ignores ctx.signal; the provider answers after the step deadline.
    const careless: JobStep<Llm> = {
      stage: "match",
      run: async (ctx) =>
        ctx.llm.complete({ feature: "T", promptVersion: "v", callKey: `${ctx.callKeyPrefix}.1`, systemBlocks: [], userBlocks: [{ text: "u" }], outputSchema: null }),
    };
    const h = setup(def([careless]), { responses: [{ json: { slow: 1 }, delayMs: 60 }, { json: { slow: 2 }, delayMs: 60 }], timing: { stepTimeoutMs: 10 } });
    const { jobId } = await start(h);
    const run = h.scheduled.shift()!;
    await run(); // no extra ticks: the runner itself must wait
    expect(h.job(jobId)).toMatchObject({ status: "failed", errorCode: "timeout", retryCount: 1 });
    expect(h.records(jobId)).toHaveLength(2);
  });

  it("QA-S3a-03: the settle wait is bounded", async () => {
    const careless: JobStep<Llm> = {
      stage: "match",
      run: async (ctx) =>
        ctx.llm.complete({ feature: "T", promptVersion: "v", callKey: `${ctx.callKeyPrefix}.1`, systemBlocks: [], userBlocks: [{ text: "u" }], outputSchema: null }),
    };
    const h = setup(def([careless]), {
      responses: [{ json: {}, delayMs: 2_000 }, { json: {}, delayMs: 2_000 }],
      timing: { stepTimeoutMs: 10, usageSettleGraceMs: 30 },
    });
    const { jobId } = await start(h);
    const t = Date.now();
    await h.scheduled.shift()!();
    expect(Date.now() - t).toBeLessThan(1_000);
    expect(h.job(jobId).status).toBe("failed");
    expect(h.logs.some((l) => l.event === "ai_job.usage_settle_timeout")).toBe(true);
  });

  it("QA-S3a-04: cancel requested during a step that then fails retryably → canceled, no retry scheduled or run", async () => {
    const step: JobStep<Llm> = {
      stage: "match",
      run: async (ctx) => {
        h.store.requestCancel(ctx.jobId); // user presses stop while the call is in flight
        return callLlm(ctx, 1);
      },
    };
    const h: H = setup(def([step]), { responses: [{ error: "rate_limited" }, okJson] });
    const { jobId } = await start(h);
    await h.drain();
    expect(h.job(jobId)).toMatchObject({ status: "canceled", errorCode: "canceled", retryCount: 0, nextRunAt: null });
    expect(h.scripted.calls).toHaveLength(1);
    expect(h.records(jobId)).toHaveLength(1);
  });

  it("QA-S3a-04: same for an immediate retry cause (schema_invalid)", async () => {
    const step: JobStep<Llm> = {
      stage: "match",
      run: async (ctx) => {
        await callLlm(ctx, 1);
        h.store.requestCancel(ctx.jobId);
        throw new AiError("schema_invalid");
      },
    };
    const h: H = setup(def([step]), { responses: [okJson, okJson] });
    const { jobId } = await start(h);
    await h.drain();
    expect(h.job(jobId)).toMatchObject({ status: "canceled", retryCount: 0 });
    expect(h.scripted.calls).toHaveLength(1);
  });

  it("QA-S3a-07: input_hash is built from the provider and model fixed at start", async () => {
    const seen: unknown[] = [];
    const hash = (ctx: { provider: string; model: string }) => {
      seen.push(ctx);
      return `h:${ctx.provider}:${ctx.model}`;
    };
    const h = setup(def([llmStep("match")], { modelTier: "light" }), { responses: [okJson] });
    const first = await start(h, { inputHash: hash });
    await h.drain();
    expect(seen[0]).toEqual({ provider: "anthropic", model: resolveModel("anthropic", "light"), modelTier: "light", connectionTier: "paid" });
    expect(h.job(first.jobId).inputHash).toBe(`h:anthropic:${resolveModel("anthropic", "light")}`);
    expect(await start(h, { inputHash: hash })).toEqual({ jobId: first.jobId, reused: true, inProgress: false });
  });
});

describe("usage recorder failures", () => {
  it("insert failing twice: the job still succeeds, the loss is logged (no re-run of spent tokens)", async () => {
    const h = setup(def([llmStep("match")]), { responses: [okJson] });
    const { jobId } = await start(h);
    h.usage.failNext.insert = 2;
    await h.drain();
    expect(h.job(jobId).status).toBe("succeeded");
    expect(h.records(jobId)).toHaveLength(0);
    expect(h.logs.some((l) => l.event === "ai_usage.record_failed")).toBe(true);
    expect(h.scripted.calls).toHaveLength(1);
  });

  it("insert failing once is retried: exactly one row", async () => {
    const h = setup(def([llmStep("match")]), { responses: [okJson] });
    const { jobId } = await start(h);
    h.usage.failNext.insert = 1;
    await h.drain();
    expect(h.records(jobId)).toHaveLength(1);
  });

  it("unknown price: recorded with version unpriced and cost 0", async () => {
    const h = setup(def([llmStep("match")]), { responses: [okJson] });
    h.usage.price = null;
    const { jobId } = await start(h);
    await h.drain();
    expect(h.records(jobId)[0]).toMatchObject({ priceTableVersion: UNPRICED_VERSION, estimatedCostUsd: 0 });
  });
});

describe("C-12 free tier", () => {
  const unfolded = (params: Record<string, unknown>) =>
    Array.from({ length: Number(params.batches) }, (_, i) => llmStep(`match_${i + 1}`));

  it("uses the sequential steps and spaces calls ≥ 6 s via next_run_at (no retry counted)", async () => {
    const parallel: JobStep<Llm> = { stage: "match", run: async () => ({ parallel: true }) };
    const h = setup(def([parallel], { freeTierSteps: unfolded }), { context: FREE, responses: [okJson, okJson, okJson] });
    const { jobId } = await h.runner.startJob({ userId: USER, jobType: "insight", params: { batches: 3 }, target: TARGET });
    expect(h.job(jobId).progress.stage).toBe("match_1");
    const t0 = h.clock.ms();
    await h.drain();
    let j = h.job(jobId);
    expect(j).toMatchObject({ status: "queued", retryCount: 0, runGeneration: 1, retryWaitTotalMs: 0 });
    expect(j.nextRunAt).toBe(new Date(t0 + FREE_TIER_MIN_INTERVAL_MS).toISOString());
    expect(Object.keys(j.stepOutputs)).toEqual(["match_1"]);
    await wake(h, jobId);
    await wake(h, jobId);
    j = h.job(jobId);
    expect(j.status).toBe("succeeded");
    const recs = h.records(jobId);
    expect(recs.map((r) => r.connectionTier)).toEqual(["free", "free", "free"]);
    const times = recs.map((r) => Date.parse(r.occurredAt));
    expect(times[1]! - times[0]!).toBeGreaterThanOrEqual(FREE_TIER_MIN_INTERVAL_MS);
    expect(times[2]! - times[1]!).toBeGreaterThanOrEqual(FREE_TIER_MIN_INTERVAL_MS);
  });

  it("spacing also applies across jobs of the same user and provider", async () => {
    const h = setup(def([llmStep("match")]), { context: FREE, responses: [okJson, okJson] });
    const a = await start(h);
    await h.drain();
    const b = await start(h, { target: { type: "application_project", id: "00000000-0000-4000-8000-0000000000dd" } });
    await h.drain();
    expect(h.job(a.jobId).status).toBe("succeeded");
    expect(h.job(b.jobId).status).toBe("queued");
    await wake(h, b.jobId);
    expect(h.job(b.jobId).status).toBe("succeeded");
  });

  it("paid tier runs the parallel steps without spacing", async () => {
    const h = setup(def([llmStep("match", 3)], { freeTierSteps: unfolded }), { responses: [okJson, okJson, okJson] });
    const { jobId } = await h.runner.startJob({ userId: USER, jobType: "insight", params: { batches: 3 }, target: TARGET });
    await h.drain();
    expect(h.job(jobId).status).toBe("succeeded");
    expect(h.records(jobId)).toHaveLength(3);
  });
});

describe("manual retry", () => {
  it("resumes from the failed step with fresh per-call counts and wait budget; completed steps aren't re-called", async () => {
    const h = setup(def([llmStep("match"), llmStep("synthesize")]), {
      responses: [okJson, { error: "provider_unavailable" }, { error: "provider_unavailable" }, { error: "provider_unavailable" }, { error: "provider_unavailable" }, okJson],
    });
    const { jobId } = await start(h);
    await h.drain();
    await wake(h, jobId);
    await wake(h, jobId);
    expect(h.job(jobId)).toMatchObject({ status: "failed", errorCode: "provider_unavailable", retryCount: 2, retryWaitTotalMs: 6_000 });
    const gen = h.job(jobId).runGeneration;

    const res = await h.runner.retryJob({ jobId, userId: USER });
    expect(res).toEqual({ jobId, reused: false, inProgress: false });
    expect(h.job(jobId)).toMatchObject({ status: "queued", runGeneration: gen + 1, retryAfter: null, errorCode: null });
    expect(h.job(jobId).meta).toEqual({ runBase: gen + 1, waitBase: 6_000, retries: {} });
    await h.drain();
    expect(h.job(jobId).status).toBe("queued"); // first call of the new run failed → scheduled again
    await wake(h, jobId);
    expect(h.job(jobId)).toMatchObject({ status: "succeeded", retryCount: 3 });
    // match called once in total; synthesize 5 times (3 + 2).
    expect(h.records(jobId).map((r) => r.callKey)).toEqual([
      "insight.match.1",
      "insight.synthesize.1",
      "insight.synthesize.1",
      "insight.synthesize.1",
      "insight.synthesize.1",
      "insight.synthesize.1",
    ]);
  });

  it("input-category failures are not retryable (409)", async () => {
    const h = setup(def([llmStep("match")]), { responses: [{ error: "safety_blocked" }] });
    const { jobId } = await start(h);
    await h.drain();
    await expect(h.runner.retryJob({ jobId, userId: USER })).rejects.toMatchObject({ code: "ai_job_not_retryable", status: 409 });
  });

  it("another job on the same target already in flight → that job (QA-S3-12)", async () => {
    const h = setup(def([llmStep("match")]), { responses: [{ error: "key_invalid" }] });
    const failed = await start(h);
    await h.drain();
    const other = await start(h);
    expect(other.inProgress).toBe(false);
    const res = await h.runner.retryJob({ jobId: failed.jobId, userId: USER });
    expect(res).toEqual({ jobId: other.jobId, reused: false, inProgress: true });
    expect(h.job(failed.jobId).status).toBe("failed");
  });

  it("two retries at once: one wins, the other follows the running job", async () => {
    const h = setup(def([llmStep("match")]), { responses: [{ error: "billing_required" }] });
    const { jobId } = await start(h);
    await h.drain();
    const [a, b] = await Promise.all([h.runner.retryJob({ jobId, userId: USER }), h.runner.retryJob({ jobId, userId: USER })]);
    expect([a.inProgress, b.inProgress].sort()).toEqual([false, true]);
    expect(h.scheduled).toHaveLength(1);
  });

  it("not found", async () => {
    const h = setup(def([llmStep("match")]));
    await expect(h.runner.retryJob({ jobId: "00000000-0000-4000-8000-00000000ffff", userId: USER })).rejects.toBeInstanceOf(AppError);
  });
});

describe("invocation budget", () => {
  it("yields near the 60 s budget and continues in a new invocation", async () => {
    const slow = (stage: string): JobStep<Llm> => ({
      stage,
      timeoutMs: 30_000,
      run: async (ctx) => {
        await callLlm(ctx, 1);
        h.clock.advance(20_000);
        return {};
      },
    });
    const h: H = setup(def([slow("match"), slow("synthesize")]), { responses: [okJson, okJson], timing: { invocationBudgetMs: 45_000 } });
    const { jobId } = await start(h);
    await h.drain();
    expect(h.job(jobId).status).toBe("queued");
    expect(h.job(jobId).nextRunAt).toBeNull();
    expect(h.continued).toEqual([{ jobId, userId: USER }]);
    expect(await h.runner.runJob({ jobId, userId: USER })).toBe("succeeded");
    expect(h.records(jobId)).toHaveLength(2);
  });
});

describe("S3b key status reports (DM 2.11.3)", () => {
  it("success → recordSuccess once (needs_check → valid is the RPC's job)", async () => {
    const h = setup(def([llmStep("match")]), { responses: [okJson] });
    const { jobId } = await start(h);
    await h.drain();
    expect(h.job(jobId).status).toBe("succeeded");
    expect(h.keyStatus.successes).toEqual([jobId]);
    expect(h.keyStatus.failures).toEqual([]);
  });

  it.each<AiErrorCode>(["billing_required", "model_not_available", "daily_quota_exhausted"])("final %s → recordFailure with that cause, not invalid", async (code) => {
    const h = setup(def([llmStep("match")]), { responses: [{ error: code }] });
    const { jobId } = await start(h);
    await h.drain();
    expect(h.job(jobId)).toMatchObject({ status: "failed", errorCode: code });
    expect(h.keyStatus.failures).toEqual([{ jobId, cause: code }]);
    expect(h.keyStatus.invalidated).toEqual([]);
    expect(h.keyStatus.successes).toEqual([]);
  });

  it("key_invalid → markInvalid only; input / system causes report nothing", async () => {
    const h = setup(def([llmStep("match")]), { responses: [{ error: "key_invalid" }, { error: "safety_blocked" }] });
    const a = await start(h);
    await h.drain();
    const b = await start(h, { target: { type: "application_project", id: "99999999-9999-4999-8999-999999999999" } });
    await h.drain();
    expect(h.keyStatus.invalidated).toEqual([a.jobId]);
    expect(h.keyStatus.failures).toEqual([]);
    expect(h.job(b.jobId).errorCode).toBe("safety_blocked");
  });

  it("a reporter that throws never changes the job outcome", async () => {
    const h = setup(def([llmStep("match")]), { responses: [okJson] });
    h.keyStatus.recordSuccess = async () => {
      throw new Error("db down");
    };
    const { jobId } = await start(h);
    await h.drain();
    expect(h.job(jobId).status).toBe("succeeded");
    expect(h.logs.some((l) => l.event === "ai_job.key_success_report_failed")).toBe(true);
  });
});

describe("QA-S3a-11 invocation budget includes the step deadline and the settle wait", () => {
  function twoSteps(firstTakesMs: number) {
    const step = (stage: string, advance: number): JobStep<Llm> => ({
      stage,
      timeoutMs: 40_000,
      run: async (ctx) => {
        await callLlm(ctx, 1);
        h.clock.advance(advance);
        return {};
      },
    });
    const h: H = setup(def([step("match", firstTakesMs), step("synthesize", 0)]), {
      responses: [okJson, okJson],
      timing: { invocationBudgetMs: 58_000, settleWorstMs: 5_000 },
    });
    return h;
  }

  it("does not start a step whose deadline + settle worst would pass the budget (15 + 40 + 5 > 58)", async () => {
    const h = twoSteps(15_000);
    const { jobId } = await start(h);
    await h.drain();
    expect(h.job(jobId).status).toBe("queued");
    expect(h.continued).toEqual([{ jobId, userId: USER }]);
  });

  it("13 s in, a 40 s step still fits (13 + 40 + 5 = 58)", async () => {
    const h = twoSteps(13_000);
    const { jobId } = await start(h);
    await h.drain();
    expect(h.job(jobId).status).toBe("succeeded");
    expect(h.continued).toEqual([]);
  });

  it("the first step of an invocation is shortened to fit instead of running past the budget", async () => {
    // Room = 300 - 100 = 200 ms: the 60 s deadline becomes 200 ms, the hanging call times out
    // quickly; its automatic retry (timeout: 1) no longer fits → continued in a new invocation.
    const h = setup(def([llmStep("match", 1, { timeoutMs: 60_000 })]), {
      responses: [{ hang: true }, { hang: true }],
      timing: { invocationBudgetMs: 300, settleWorstMs: 100, minStepTimeoutMs: 50, usageSettleGraceMs: 10 },
    });
    const t = Date.now();
    const { jobId } = await start(h);
    await h.drain();
    expect(Date.now() - t).toBeLessThan(5_000);
    expect(h.job(jobId)).toMatchObject({ status: "queued", retryCount: 1 });
    expect(h.records(jobId)).toHaveLength(1);
    expect(h.records(jobId)[0]).toMatchObject({ outcome: "failed", errorCode: "timeout" });
  });
});

describe("QA-S3b-01 / -05 run gates", () => {
  async function failedJob(h: H) {
    const { jobId } = await start(h);
    await h.drain();
    expect(h.job(jobId)).toMatchObject({ status: "failed", errorCode: "billing_required" });
    return jobId;
  }

  it.each([
    ["consent withdrawn", "ai_consent_required"],
    ["key deleted", "key_missing"],
    ["key invalid", "key_invalid"],
  ] as const)("manual retry refused when %s: 409, job stays failed, no provider call", async (_name, code) => {
    let gate: AppError | null = null;
    const h = setup(def([llmStep("match")]), { responses: [{ error: "billing_required" }, okJson], runnable: () => gate });
    const jobId = await failedJob(h);
    gate = runGateError(code);
    await expect(h.runner.retryJob({ jobId, userId: USER })).rejects.toMatchObject({ code, status: 409 });
    await h.drain();
    expect(h.job(jobId).status).toBe("failed");
    expect(h.scripted.calls).toHaveLength(1);
  });

  it("manual retry stays on the job's fixed provider after the active provider changed (F-AI-03 (2))", async () => {
    const seen: string[] = [];
    // Active is now OpenAI; the job is Anthropic and Anthropic's key + consent are still fine.
    const h = setup(def([llmStep("match")]), {
      responses: [{ error: "billing_required" }, okJson],
      runnable: (job) => (seen.push(job.provider), null),
    });
    const jobId = await failedJob(h);
    await h.runner.retryJob({ jobId, userId: USER });
    await h.drain();
    expect(seen).toEqual(["anthropic"]);
    expect(h.job(jobId)).toMatchObject({ status: "succeeded", provider: "anthropic" });
  });

  it("key_verification jobs are not retryable (QA-S3b-05)", async () => {
    const h = setup(def([llmStep("match")]), { responses: [] });
    const id = "00000000-0000-4000-8000-0000000000aa";
    await h.store.insert({
      id,
      userId: USER,
      jobType: "key_verification",
      applicationProjectId: null,
      targetType: "ai_provider",
      targetId: "00000000-0000-5000-8000-0000000000bb",
      provider: "anthropic",
      modelTier: "default",
      connectionTier: "paid",
      params: {},
      inputHash: null,
      promptVersion: null,
      model: null,
      progress: { stage: "verify", done: 0, total: 1 },
      meta: { runBase: 1, waitBase: 0, retries: {} },
    });
    await h.store.finish(id, 1, { status: "failed", errorCode: "key_invalid" });
    await expect(h.runner.retryJob({ jobId: id, userId: USER })).rejects.toMatchObject({ code: "ai_job_not_retryable", status: 409 });
    expect(h.job(id).status).toBe("failed");
  });

  it("run-time gate blocks before any provider call (claim and each step)", async () => {
    let calls = 0;
    const h = setup(def([llmStep("match"), llmStep("synthesize")]), {
      responses: [okJson, okJson],
      checkRunAllowed: async () => (++calls === 2 ? "key_missing" : null),
    });
    const { jobId } = await start(h);
    await h.drain();
    expect(h.job(jobId)).toMatchObject({ status: "failed", errorCode: "key_missing" });
    expect(h.scripted.calls).toHaveLength(1); // step 2 never called the provider
    expect(h.keyStatus.successes).toEqual([]);
  });

  it("run-time gate errors fail closed (stalled, no call)", async () => {
    const h = setup(def([llmStep("match")]), {
      responses: [okJson],
      checkRunAllowed: async () => {
        throw new Error("db down");
      },
    });
    const { jobId } = await start(h);
    await h.drain();
    expect(h.job(jobId)).toMatchObject({ status: "failed", errorCode: "stalled" });
    expect(h.scripted.calls).toHaveLength(0);
  });
});
