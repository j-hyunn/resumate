import { describe, expect, it } from "vitest";
import { AiError, ProviderError } from "@/server/ai/errors";
import type { Llm } from "@/server/ai/llm";
import type { JdRequirementInput } from "@/server/ai/context-pack/jd";
import { FREE_TIER_MIN_INTERVAL_MS } from "@/server/jobs/constants";
import { createRecordingKeyStatusReporter, createStaticKeySource, createStaticProviderContext, type ProviderContext } from "@/server/jobs/provider-context";
import { createJobRunner } from "@/server/jobs/runner";
import { toAiJobStatusResponse } from "@/server/jobs/status";
import type { JobTypeDefinition } from "@/server/jobs/types";
import type { EnsureJdResult } from "@/server/services/application/extraction";
import { MemoryJobStore, MemoryUsageStore, createScriptedAdapter, fakeClock, memoryScope, scriptedLlmFactory, type ScriptedResponse } from "@/test/job-fakes";
import { InsightRpcError, type InsightInputs, type InsightStore } from "./db";
import { batchIds, createInsightJobDefinition, pickFailure, savedBatches, type InsightBatch, type InsightPipeline } from "./job";
import { insightJobPartial } from "./partial";
import { AppError } from "@/lib/contracts/errors";

/**
 * S6 insight job on the REAL runner (memory stores, scripted provider through
 * the real createLlm): paid parallel batches, free-tier one-batch-per-run with
 * call spacing, per-batch saving so retries never re-call a finished batch,
 * D-30 extraction first, stale runs, cancel, partial results.
 */

const USER = "00000000-0000-4000-8000-000000000001";
const PROJECT = "00000000-0000-4000-8000-0000000000aa";
const INSIGHT_ID = "00000000-0000-4000-8000-0000000000bb";
const PAID: ProviderContext = { provider: "anthropic", connectionTier: "paid", keyStatus: "valid" };
const FREE: ProviderContext = { provider: "gemini", connectionTier: "free", keyStatus: "valid" };
const OK: ScriptedResponse = { json: { ok: true } };

function requirements(n: number): JdRequirementInput[] {
  return Array.from({ length: n }, (_, i) => ({
    id: `00000000-0000-4000-8000-${String(i + 1).padStart(12, "0")}`,
    category: "required",
    content: `요건 ${i + 1}`,
    importance: "normal",
    source_sids: [],
    sort_order: i,
    updated_at: null,
  }));
}

function inputs(n: number): InsightInputs {
  return {
    jd: { jobDescriptionId: "jd-1", updatedAt: null, extractionStatus: "succeeded", extractionJobId: null, sentences: [], positionTitle: null, seniorityLabel: null },
    requirements: requirements(n),
    careerRows: { profile: null, experiences: [], educations: [], projects: [], projectDetails: [], achievements: [], skills: [], projectSkills: [] },
  };
}

type FakeCtx = { ids: string[] };
type FakeBatch = InsightBatch & { v: 1 };

function call(llm: Llm, callKey: string, signal: AbortSignal) {
  return llm.complete({ feature: "AI-02.test", promptVersion: "t", callKey, systemBlocks: [], userBlocks: [{ text: "u" }], outputSchema: null, signal });
}

type FakeAttempt = { kind: "first" | "regen"; violations: string[] };

function fakePipeline(calls: string[], firstViolations: string[] = []): InsightPipeline<FakeCtx, FakeBatch, FakeAttempt> {
  return {
    promptVersion: "ai-02.test",
    tier: "default",
    batchSize: 8,
    buildContext: (i) => ({ ids: i.requirements.map((r) => r.id) }),
    requirementIds: (c) => c.ids,
    hashes: () => ({ careerSnapshotHash: "career-h", requirementsHash: "req-h" }),
    async match(input, deps) {
      calls.push(`match.${input.batchIndex + 1}`);
      await call(deps.llm, `insight.match.${input.batchIndex + 1}`, deps.signal);
      return {
        v: 1,
        batchIndex: input.batchIndex,
        matches: input.requirementIds.map((id) => ({ requirement_id: id, status: "met" as const, rationale: "r", missing_aspect: null })),
      };
    },
    async synthesize(_input, deps) {
      calls.push("synthesize");
      await call(deps.llm, "insight.synthesize", deps.signal);
      return { kind: "first", violations: firstViolations };
    },
    violations: (a) => a.violations,
    async regenerate(_input, deps) {
      calls.push("synthesize.regen");
      await call(deps.llm, "insight.synthesize.regen", deps.signal);
      return { kind: "regen", violations: [] };
    },
    finalize: (input) => ({
      payload: { batches: input.batches.length, provider: input.provider, ...(input.regen ? { regen: true } : {}), snapshot: input.snapshot },
      inputHash: "input-h",
    }),
    inputHash: () => "input-h",
  };
}

class FakeInsightStore implements InsightStore {
  begins: string[] = [];
  completes: Array<{ runGeneration: number; payload: unknown }> = [];
  applied = true;
  async begin(_project: string, jobId: string) {
    this.begins.push(jobId);
    return INSIGHT_ID;
  }
  async complete(args: { insightId: string; jobId: string; runGeneration: number; payload: unknown }) {
    this.completes.push({ runGeneration: args.runGeneration, payload: args.payload });
    return { applied: this.applied, versionNo: this.applied ? 1 : null };
  }
  async fail() {
    return true;
  }
}

type SetupOpts = {
  context?: ProviderContext;
  responses?: ScriptedResponse[];
  reqs?: number;
  ensure?: () => Promise<EnsureJdResult>;
  failMatch?: (batchIndex: number) => Error | null;
  stepTimeoutMs?: number;
  /** Requirement count the DB returns after the first load (requirements edited mid-run). */
  reqsLater?: number;
  /** V-5 violations of the first synthesis answer (→ synthesize_regen calls). */
  firstViolations?: string[];
  /** Make the regeneration call throw this once. */
  failRegenOnce?: Error;
};

function setup(opts: SetupOpts = {}) {
  const clock = fakeClock();
  const context = opts.context ?? PAID;
  const store = new MemoryJobStore(clock.now);
  const usage = new MemoryUsageStore(USER);
  const scripted = createScriptedAdapter(context.provider, opts.responses ?? [], clock.ms);
  const insights = new FakeInsightStore();
  const calls: string[] = [];
  const ensureCalls: string[] = [];
  let loads = 0;
  const base = fakePipeline(calls, opts.firstViolations);
  let regenFailed = false;
  const definition: JobTypeDefinition<Llm> = createInsightJobDefinition({
    pipeline: {
      ...base,
      async match(input, deps) {
        const err = opts.failMatch?.(input.batchIndex) ?? null;
        if (err) {
          calls.push(`match.${input.batchIndex + 1}`);
          throw err;
        }
        return base.match(input, deps);
      },
      async regenerate(input, deps) {
        if (opts.failRegenOnce && !regenFailed) {
          regenFailed = true;
          calls.push("synthesize.regen");
          throw opts.failRegenOnce;
        }
        return base.regenerate(input, deps);
      },
    },
    storeFor: () => insights,
    ensureJd: async (ctx, id) => {
      ensureCalls.push(`${ctx.provider}:${ctx.connectionTier}:${id}`);
      return opts.ensure ? opts.ensure() : { status: "already_extracted" };
    },
    loadInputs: async () => {
      loads++;
      return inputs(loads > 1 && opts.reqsLater !== undefined ? opts.reqsLater : (opts.reqs ?? 20));
    },
    now: clock.now,
  });
  const scheduled: (() => Promise<void>)[] = [];
  const runner = createJobRunner<Llm>({
    forUser: () =>
      memoryScope(store, usage, {
        keySource: createStaticKeySource("sk-test-key-0000", () => new ProviderError("key_missing")),
        keyStatus: createRecordingKeyStatusReporter(),
      }),
    providerContext: createStaticProviderContext(context),
    createLlm: scriptedLlmFactory(scripted.adapter, clock.ms),
    settleLlm: (llm, ms) => llm.settle(ms),
    getDefinition: (t) => (t === "insight" ? definition : undefined),
    schedule: (task) => void scheduled.push(task),
    continueJob: async () => {},
    now: clock.now,
    random: () => 0,
    timing: { stepTimeoutMs: opts.stepTimeoutMs ?? 2_000, heartbeatIntervalMs: 5, invocationBudgetMs: 55_000 },
  });
  async function drain() {
    while (scheduled.length) await scheduled.shift()!();
    await new Promise((r) => setTimeout(r, 0));
  }
  async function start() {
    const res = await runner.startJob({
      userId: USER,
      jobType: "insight",
      target: { type: "application_project", id: PROJECT },
      applicationProjectId: PROJECT,
      params: { applicationProjectId: PROJECT },
    });
    return res.jobId;
  }
  /** Wake a scheduled job like the status poll (B-4). */
  async function wake(jobId: string) {
    const at = store.jobs.get(jobId)!.nextRunAt;
    expect(at).not.toBeNull();
    clock.advance(Date.parse(at!) - clock.ms());
    await runner.getStatus({ jobId, userId: USER });
    await drain();
  }
  return { clock, store, usage, scripted, insights, calls, ensureCalls, runner, drain, start, wake, job: (id: string) => store.jobs.get(id)! };
}

describe("insight job — paid tier (parallel batches)", () => {
  it("runs prepare → match (3 batches in one step) → synthesize → validate; one usage record per call", async () => {
    const h = setup({ responses: [OK, OK, OK, OK], reqs: 20 });
    const jobId = await h.start();
    await h.drain();
    const job = h.job(jobId);
    expect(job.status).toBe("succeeded");
    expect(h.calls.sort()).toEqual(["match.1", "match.2", "match.3", "synthesize"]);
    expect(h.usage.forJob(jobId)).toHaveLength(4);
    expect(h.usage.forJob(jobId).map((r) => r.callKey).sort()).toEqual(["insight.match.1", "insight.match.2", "insight.match.3", "insight.synthesize"]);
    expect(h.insights.begins).toEqual([jobId]);
    expect(h.insights.completes).toEqual([
      { runGeneration: job.runGeneration, payload: { batches: 3, provider: "anthropic", snapshot: { careerSnapshotHash: "career-h", requirementsHash: "req-h" } } },
    ]);
    expect(job.stepOutputs.synthesize_regen).toEqual({ regen: null });
    expect(job.stepOutputs.validate).toEqual({ insightId: INSIGHT_ID, versionNo: 1 });
    // The partial batches were dropped once the stage completed.
    expect(job.meta.partials).toBeUndefined();
    expect(h.ensureCalls).toEqual([`anthropic:paid:${PROJECT}`]);
  });

  it("a failed batch is retried alone; finished batches are not called again (C-11.3 per call)", async () => {
    // batches 1 and 3 succeed, batch 2 hits provider_unavailable → scheduled retry of the step.
    const h = setup({ responses: [OK, { error: "provider_unavailable" }, OK, OK, OK], reqs: 20 });
    const jobId = await h.start();
    await h.drain();
    let job = h.job(jobId);
    expect(job.status).toBe("queued");
    expect(job.nextRunAt).not.toBeNull();
    expect(job.progress).toMatchObject({ stage: "match", done: 2, total: 3 });
    const saved = job.meta.partials?.match as { batches: FakeBatch[] };
    expect(saved.batches.map((b) => b.batchIndex)).toEqual([0, 2]);
    // S-16 partial: verdicts of the saved batches only.
    const partial = toAiJobStatusResponse(job).partial as ReturnType<typeof insightJobPartial>;
    expect(partial).toMatchObject({ kind: "insight_matches", batchesDone: 2, batchesTotal: 3 });
    expect(partial!.requirementMatches).toHaveLength(12); // batches 1 (8) + 3 (4)

    await h.wake(jobId);
    job = h.job(jobId);
    expect(job.status).toBe("succeeded");
    expect(h.calls.filter((c) => c.startsWith("match"))).toHaveLength(4); // 3 + the one retry
    expect(h.calls.filter((c) => c === "match.2")).toHaveLength(2);
    expect(h.usage.forJob(jobId)).toHaveLength(5); // failed call recorded too
    expect(h.insights.completes).toHaveLength(1);
  });

  it("a batch that finally fails fails the job (no partial insight); manual retry re-calls only that batch", async () => {
    let thrown = false;
    const h = setup({
      responses: [OK, OK, OK, OK, OK],
      reqs: 20,
      // The 2nd batch fails schema_invalid once (the pipeline already used its V-6 retry → not retryable).
      failMatch: (batchIndex) => {
        if (batchIndex !== 1 || thrown) return null;
        thrown = true;
        return new AiError("schema_invalid", { retryable: false });
      },
    });
    const jobId = await h.start();
    await h.drain();
    let job = h.job(jobId);
    expect(job.status).toBe("failed");
    expect(job.errorCode).toBe("schema_invalid");
    expect(h.insights.completes).toHaveLength(0);
    expect((job.meta.partials?.match as { batches: FakeBatch[] }).batches).toHaveLength(2);

    const retried = await h.runner.retryJob({ jobId, userId: USER });
    expect(retried.inProgress).toBe(false);
    await h.drain();
    job = h.job(jobId);
    expect(job.status).toBe("succeeded");
    expect(h.calls.filter((c) => c === "match.1")).toHaveLength(1);
    expect(h.calls.filter((c) => c === "match.3")).toHaveLength(1);
    expect(h.calls.filter((c) => c === "match.2")).toHaveLength(2);
    expect(h.usage.forJob(jobId)).toHaveLength(4); // the thrown attempt made no provider call
  });

  it("QA-S6-02: a step deadline cutting a slow batch keeps the finished batch; the retry calls only the slow one", async () => {
    // 12 requirements → 2 batches: batch 1 answers at once, batch 2 hangs past the step deadline.
    const h = setup({ responses: [OK, { hang: true }, OK, OK], reqs: 12, stepTimeoutMs: 200 });
    const jobId = await h.start();
    await h.drain();
    const job = h.job(jobId);
    expect(job.status).toBe("succeeded");
    expect(h.calls.filter((c) => c === "match.1")).toHaveLength(1);
    expect(h.calls.filter((c) => c === "match.2")).toHaveLength(2);
    const keys = h.usage.forJob(jobId).map((r) => r.callKey);
    expect(keys.filter((k) => k === "insight.match.1")).toHaveLength(1);
    expect(keys.filter((k) => k === "insight.match.2")).toHaveLength(2); // the timed-out call is recorded too
  });

  it("QA-S6-09: later steps judge the requirement list fixed at prepare, not one edited mid-run", async () => {
    const h = setup({ responses: [OK, OK, OK, OK], reqs: 20, reqsLater: 3 });
    const jobId = await h.start();
    await h.drain();
    expect(h.job(jobId).status).toBe("succeeded");
    expect(h.calls.filter((c) => c.startsWith("match"))).toHaveLength(3); // 20 requirements → 3 batches
    expect((h.job(jobId).stepOutputs.prepare as { requirements: unknown[] }).requirements).toHaveLength(20);
  });

  it("stale_run from complete_insight never completes the job without a ready row", async () => {
    const h = setup({ responses: [OK, OK], reqs: 3 });
    h.insights.applied = false;
    const jobId = await h.start();
    await h.drain();
    expect(h.job(jobId).status).toBe("failed");
    expect(h.job(jobId).errorCode).toBe("stalled");
  });

  it("a cancel requested during match ends canceled; no synthesize, no complete", async () => {
    const h = setup({ responses: [{ hang: true }], reqs: 3 });
    const jobId = await h.start();
    const run = h.drain();
    await new Promise((r) => setTimeout(r, 20));
    h.store.requestCancel(jobId);
    await run;
    expect(h.job(jobId).status).toBe("canceled");
    expect(h.calls).toEqual(["match.1"]);
    expect(h.insights.completes).toHaveLength(0);
    expect(h.usage.forJob(jobId)).toHaveLength(1);
  });
});


describe("insight job — free tier (C-12 one batch per run)", () => {
  it("each batch is its own run spaced ≥ FREE_TIER_MIN_INTERVAL_MS; progress match n/3 and partial grow", async () => {
    const h = setup({ context: FREE, responses: [OK, OK, OK, OK], reqs: 20 });
    const jobId = await h.start();
    await h.drain();
    // prepare (no call) → match batch 1 → STEP_CONTINUE → spacing wait for batch 2.
    let job = h.job(jobId);
    expect(job.status).toBe("queued");
    expect(job.progress).toMatchObject({ stage: "match", done: 1, total: 3 });
    expect(Date.parse(job.nextRunAt!) - h.clock.ms()).toBe(FREE_TIER_MIN_INTERVAL_MS);
    expect(insightJobPartial(job)).toMatchObject({ batchesDone: 1, batchesTotal: 3 });

    await h.wake(jobId);
    job = h.job(jobId);
    expect(job.progress).toMatchObject({ stage: "match", done: 2, total: 3 });
    await h.wake(jobId); // batch 3 → stage done → spacing before synthesize
    job = h.job(jobId);
    expect(job.stepOutputs.match).toBeDefined();
    expect(insightJobPartial(job)).toMatchObject({ batchesDone: 3, batchesTotal: 3 });
    await h.wake(jobId);
    job = h.job(jobId);
    expect(job.status).toBe("succeeded");
    expect(h.calls).toEqual(["match.1", "match.2", "match.3", "synthesize"]);
    const times = h.usage.forJob(jobId).map((r) => Date.parse(r.occurredAt));
    for (let i = 1; i < times.length; i++) expect(times[i]! - times[i - 1]!).toBeGreaterThanOrEqual(FREE_TIER_MIN_INTERVAL_MS);
    expect(h.ensureCalls).toEqual([`gemini:free:${PROJECT}`]);
  });
});

describe("insight job — synthesis split (QA-S6-03)", () => {
  it("free tier: synthesize and the V-5 regeneration are separate runs spaced ≥ 6 s; validate needs no spacing", async () => {
    const h = setup({ context: FREE, responses: [OK, OK, OK], reqs: 3, firstViolations: ["37%"] });
    const jobId = await h.start();
    await h.drain(); // prepare → match (1 batch) → spacing before synthesize
    await h.wake(jobId); // synthesize → spacing before synthesize_regen
    let job = h.job(jobId);
    expect(job.status).toBe("queued");
    expect(job.stepOutputs.synthesize).toEqual({ first: { kind: "first", violations: ["37%"] } });
    expect(Date.parse(job.nextRunAt!) - h.clock.ms()).toBe(FREE_TIER_MIN_INTERVAL_MS);
    await h.wake(jobId); // regen → validate (no call, no spacing) → done
    job = h.job(jobId);
    expect(job.status).toBe("succeeded");
    expect(h.calls).toEqual(["match.1", "synthesize", "synthesize.regen"]);
    expect(h.insights.completes[0]!.payload).toMatchObject({ regen: true });
    const times = h.usage.forJob(jobId).map((r) => Date.parse(r.occurredAt));
    for (let i = 1; i < times.length; i++) expect(times[i]! - times[i - 1]!).toBeGreaterThanOrEqual(FREE_TIER_MIN_INTERVAL_MS);
  });

  it("a failed regeneration is retried alone: the first synthesis call is not made again", async () => {
    const h = setup({ responses: [OK, OK, OK], reqs: 3, firstViolations: ["37%"], failRegenOnce: new ProviderError("timeout") });
    const jobId = await h.start();
    await h.drain();
    expect(h.job(jobId).status).toBe("succeeded");
    expect(h.calls).toEqual(["match.1", "synthesize", "synthesize.regen", "synthesize.regen"]);
    expect(h.usage.forJob(jobId).map((r) => r.callKey)).toEqual(["insight.match.1", "insight.synthesize", "insight.synthesize.regen"]);
  });

  it("requirements_changed from the pipeline ends the job stalled, no retry", async () => {
    const h = setup({ responses: [OK, OK], reqs: 3, firstViolations: ["1"], failRegenOnce: Object.assign(new Error("changed"), { code: "requirements_changed" }) });
    const jobId = await h.start();
    await h.drain();
    expect(h.job(jobId)).toMatchObject({ status: "failed", errorCode: "stalled" });
    expect(h.calls.filter((c) => c === "synthesize.regen")).toHaveLength(1);
  });

  it("no V-5 violation: synthesize_regen passes without a call", async () => {
    const h = setup({ context: FREE, responses: [OK, OK], reqs: 3 });
    const jobId = await h.start();
    await h.drain();
    await h.wake(jobId); // synthesize → regen skipped (no spacing) → validate → done
    expect(h.job(jobId).status).toBe("succeeded");
    expect(h.calls).toEqual(["match.1", "synthesize"]);
  });
});

describe("insight job — prepare (D-30)", () => {
  it("extraction failure ends the job with that cause (retry_after kept), no match call", async () => {
    const retryAfter = "2026-10-28T00:05:00.000Z";
    const h = setup({ ensure: async () => ({ status: "failed", jobId: "x", code: "rate_limited", retryAfter, quotaResetsAt: null }) });
    const jobId = await h.start();
    await h.drain();
    const job = h.job(jobId);
    expect(job.status).toBe("failed");
    expect(job.errorCode).toBe("rate_limited");
    expect(job.retryAfter).not.toBeNull();
    expect(h.calls).toEqual([]);
    expect(h.insights.begins).toEqual([]);
  });

  it("extraction runs first, then the insight continues on the same job", async () => {
    const h = setup({ responses: [OK, OK], reqs: 5, ensure: async () => ({ status: "succeeded", jobId: "extract-job" }) });
    const jobId = await h.start();
    await h.drain();
    expect(h.job(jobId).status).toBe("succeeded");
    expect(h.job(jobId).stepOutputs.prepare).toMatchObject({ insightId: INSIGHT_ID, requirementCount: 5, extractedJobId: "extract-job" });
  });

  it("extraction_in_progress (non-AI refusal) fails stalled without a provider call", async () => {
    const h = setup({ ensure: async () => Promise.reject(new AppError("extraction_in_progress", "x", { status: 409 })) });
    const jobId = await h.start();
    await h.drain();
    expect(h.job(jobId)).toMatchObject({ status: "failed", errorCode: "stalled" });
  });

  it("a JD with zero requirements fails not_a_jd (input) without a call", async () => {
    const h = setup({ reqs: 0 });
    const jobId = await h.start();
    await h.drain();
    expect(h.job(jobId)).toMatchObject({ status: "failed", errorCode: "not_a_jd" });
    expect(h.usage.forJob(jobId)).toHaveLength(0);
  });
});

describe("insight job helpers", () => {
  it("batchIds splits by size in order", () => {
    expect(batchIds(["a", "b", "c"], 2)).toEqual([["a", "b"], ["c"]]);
    expect(batchIds([], 8)).toEqual([]);
  });

  it("savedBatches keeps only batches that still match the plan", () => {
    const plan = [["a", "b"], ["c"]];
    const ok = { batchIndex: 0, matches: [{ requirement_id: "a" }, { requirement_id: "b" }] };
    const moved = { batchIndex: 1, matches: [{ requirement_id: "x" }] };
    const saved = savedBatches({ batches: [ok, moved, { batchIndex: 7, matches: [] }] }, plan);
    expect([...saved.keys()]).toEqual([0]);
    expect(savedBatches(null, plan).size).toBe(0);
  });

  it("pickFailure prefers cancel, then provider errors", () => {
    const provider = new ProviderError("rate_limited");
    const canceled = new AiError("canceled");
    expect(pickFailure([new Error("x"), provider])).toBe(provider);
    expect(pickFailure([provider, canceled])).toBe(canceled);
  });

  it("InsightRpcError refusals become a system failure", async () => {
    const h = setup({ reqs: 3 });
    h.insights.begin = async () => {
      throw new InsightRpcError("insight_in_progress", new AppError("insight_in_progress"));
    };
    const jobId = await h.start();
    await h.drain();
    expect(h.job(jobId)).toMatchObject({ status: "failed", errorCode: "stalled" });
  });
});
