import { describe, expect, it } from "vitest";
import { AiError, ProviderError } from "@/server/ai/errors";
import type { Llm } from "@/server/ai/llm";
import { FREE_TIER_MIN_INTERVAL_MS } from "@/server/jobs/constants";
import { createRecordingKeyStatusReporter, createStaticKeySource, createStaticProviderContext, type ProviderContext } from "@/server/jobs/provider-context";
import { createJobRunner } from "@/server/jobs/runner";
import { toAiJobStatusResponse } from "@/server/jobs/status";
import { AiJobStatusResponseSchema, errorCategoryOf, isManuallyRetryable } from "@/lib/contracts/ai";
import type { JobTypeDefinition } from "@/server/jobs/types";
import { MemoryJobStore, MemoryUsageStore, createScriptedAdapter, fakeClock, memoryScope, scriptedLlmFactory, type ScriptedResponse } from "@/test/job-fakes";
import { InsightRpcError, type InsightInputs, type InsightStore } from "./db";
import { createInsightJobDefinition, hasPreR17Checkpoint, type InsightMatchStage, type InsightPipeline } from "./job";
import { insightJobPartial } from "./partial";
import { AppError } from "@/lib/contracts/errors";
import { emptyCareerRows } from "@/server/ai/context-pack/career-rows";

/**
 * S6 insight job on the REAL runner (memory stores, scripted provider through the real createLlm).
 * R17: the JD is its raw text — stage 1 is ONE call (no batches, no extraction first); the JD text
 * hash is fixed at prepare and a change mid-run ends the job `stalled`.
 */

const USER = "00000000-0000-4000-8000-000000000001";
const PROJECT = "00000000-0000-4000-8000-0000000000aa";
const INSIGHT_ID = "00000000-0000-4000-8000-0000000000bb";
const PAID: ProviderContext = { provider: "anthropic", connectionTier: "paid", keyStatus: "valid" };
const FREE: ProviderContext = { provider: "gemini", connectionTier: "free", keyStatus: "valid" };
const OK: ScriptedResponse = { json: { ok: true } };

function inputs(rawTextHash = "jd-h"): InsightInputs {
  return {
    jd: {
      jobDescriptionId: "jd-1",
      updatedAt: null,
      rawTextHash,
      rawTextEditedAt: null,
      sentences: [{ sid: "S1", text: "Spring 경험", start: 0, end: 9 }],
      positionTitle: null,
    },
    careerRows: emptyCareerRows({ year: 2026, month: 11 }),
  };
}

type FakeCtx = { jdTextHash: string };
type FakeMatch = InsightMatchStage & { v: 2 };

function call(llm: Llm, callKey: string, signal: AbortSignal) {
  return llm.complete({ feature: "AI-02.test", promptVersion: "t", callKey, systemBlocks: [], userBlocks: [{ text: "u" }], outputSchema: null, signal });
}

type FakeAttempt = { kind: "first" | "regen"; violations: string[] };

function fakePipeline(calls: string[], firstViolations: string[] = []): InsightPipeline<FakeCtx, FakeMatch, FakeAttempt> {
  return {
    promptVersion: "ai-02.test",
    tier: "default",
    buildContext: (i) => ({ jdTextHash: i.jd.rawTextHash }),
    hashes: (c) => ({ careerSnapshotHash: "career-h", jdTextHash: c.jdTextHash }),
    async match(input, deps) {
      calls.push("match");
      await call(deps.llm, "insight.match", deps.signal);
      return {
        v: 2,
        jdTextHash: input.context.jdTextHash,
        matches: [
          { requirement_id: "M1", requirement: { content: "Spring", category: "required", importance: "high", sentence_ids: ["S1"] }, status: "met" as const, rationale: "r", missing_aspect: null },
        ],
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
      payload: { matches: input.match.matches.length, provider: input.provider, ...(input.regen ? { regen: true } : {}), snapshot: input.snapshot },
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
  /** null = the project / JD is gone. */
  noJd?: boolean;
  /** Throw this from the match call instead of calling (once per entry). */
  failMatch?: () => Error | null;
  stepTimeoutMs?: number;
  /** JD raw-text hash the DB returns after the first load (raw text edited mid-run). */
  jdHashLater?: string;
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
  let loads = 0;
  const base = fakePipeline(calls, opts.firstViolations);
  let regenFailed = false;
  const definition: JobTypeDefinition<Llm> = createInsightJobDefinition({
    pipeline: {
      ...base,
      async match(input, deps) {
        const err = opts.failMatch?.() ?? null;
        if (err) {
          calls.push("match");
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
    loadInputs: async () => {
      loads++;
      if (opts.noJd) return null;
      return inputs(loads > 1 && opts.jdHashLater !== undefined ? opts.jdHashLater : "jd-h");
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
  return { clock, store, usage, scripted, insights, calls, runner, drain, start, wake, job: (id: string) => store.jobs.get(id)! };
}

describe("insight job — paid tier (one stage-1 call, R17)", () => {
  it("runs prepare → match (1 call) → synthesize → validate; one usage record per call", async () => {
    const h = setup({ responses: [OK, OK] });
    const jobId = await h.start();
    await h.drain();
    const job = h.job(jobId);
    expect(job.status).toBe("succeeded");
    expect(h.calls).toEqual(["match", "synthesize"]);
    expect(h.usage.forJob(jobId).map((r) => r.callKey)).toEqual(["insight.match", "insight.synthesize"]);
    expect(h.insights.begins).toEqual([jobId]);
    expect(h.insights.completes).toEqual([
      { runGeneration: job.runGeneration, payload: { matches: 1, provider: "anthropic", snapshot: { careerSnapshotHash: "career-h", jdTextHash: "jd-h" } } },
    ]);
    expect(job.stepOutputs.prepare).toEqual({ insightId: INSIGHT_ID, sentenceCount: 1, snapshot: { careerSnapshotHash: "career-h", jdTextHash: "jd-h" } });
    expect(job.stepOutputs.synthesize_regen).toEqual({ regen: null });
    expect(job.stepOutputs.validate).toEqual({ insightId: INSIGHT_ID, versionNo: 1 });
    // S-16 partial once the match checkpoint exists: the requirement travels with the verdict.
    const partial = toAiJobStatusResponse(job).partial as ReturnType<typeof insightJobPartial>;
    expect(partial).toMatchObject({ kind: "insight_matches", batchesDone: 1, batchesTotal: 1 });
    expect(partial!.requirementMatches[0]).toMatchObject({ requirementId: "M1", requirement: { content: "Spring", sentenceIds: ["S1"] }, status: "met" });
  });

  it("a retryable match failure is scheduled (next_run_at) and the wake calls match once more", async () => {
    const h = setup({ responses: [{ error: "provider_unavailable" }, OK, OK] });
    const jobId = await h.start();
    await h.drain();
    let job = h.job(jobId);
    expect(job.status).toBe("queued");
    expect(job.nextRunAt).not.toBeNull();
    expect(insightJobPartial(job)).toBeNull();
    await h.wake(jobId);
    job = h.job(jobId);
    expect(job.status).toBe("succeeded");
    expect(h.calls).toEqual(["match", "match", "synthesize"]);
    expect(h.usage.forJob(jobId)).toHaveLength(3); // the failed call is recorded too
    expect(h.insights.completes).toHaveLength(1);
  });

  it("a match that finally fails fails the job; a manual retry resumes at match", async () => {
    let thrown = false;
    const h = setup({
      responses: [OK, OK],
      failMatch: () => {
        if (thrown) return null;
        thrown = true;
        return new AiError("schema_invalid", { retryable: false });
      },
    });
    const jobId = await h.start();
    await h.drain();
    let job = h.job(jobId);
    expect(job).toMatchObject({ status: "failed", errorCode: "schema_invalid" });
    expect(h.insights.completes).toHaveLength(0);
    await h.runner.retryJob({ jobId, userId: USER });
    await h.drain();
    job = h.job(jobId);
    expect(job.status).toBe("succeeded");
    expect(h.calls).toEqual(["match", "match", "synthesize"]);
    expect(h.usage.forJob(jobId)).toHaveLength(2); // the thrown attempt made no provider call
  });

  it("the JD raw text changed after prepare → stalled, nothing completed", async () => {
    const h = setup({ responses: [OK, OK], jdHashLater: "jd-h-edited" });
    const jobId = await h.start();
    await h.drain();
    expect(h.job(jobId)).toMatchObject({ status: "failed", errorCode: "stalled" });
    expect(h.calls).toEqual([]);
    expect(h.insights.completes).toHaveLength(0);
  });

  it("a step deadline on the match call is retried once (timeout) and recorded", async () => {
    const h = setup({ responses: [{ hang: true }, OK, OK], stepTimeoutMs: 200 });
    const jobId = await h.start();
    await h.drain();
    if (h.job(jobId).status === "queued") await h.wake(jobId);
    expect(h.job(jobId).status).toBe("succeeded");
    expect(h.usage.forJob(jobId).map((r) => r.callKey).filter((k) => k === "insight.match")).toHaveLength(2);
  });

  it("stale_run from complete_insight never completes the job without a ready row", async () => {
    const h = setup({ responses: [OK, OK] });
    h.insights.applied = false;
    const jobId = await h.start();
    await h.drain();
    expect(h.job(jobId)).toMatchObject({ status: "failed", errorCode: "stalled" });
  });

  it("a cancel requested during match ends canceled; no synthesize, no complete", async () => {
    const h = setup({ responses: [{ hang: true }] });
    const jobId = await h.start();
    const run = h.drain();
    await new Promise((r) => setTimeout(r, 20));
    h.store.requestCancel(jobId);
    await run;
    expect(h.job(jobId).status).toBe("canceled");
    expect(h.calls).toEqual(["match"]);
    expect(h.insights.completes).toHaveLength(0);
    expect(h.usage.forJob(jobId)).toHaveLength(1);
  });
});

describe("insight job — free tier (C-12 spacing)", () => {
  it("match and synthesize are separate runs spaced ≥ FREE_TIER_MIN_INTERVAL_MS; prepare needs no spacing", async () => {
    const h = setup({ context: FREE, responses: [OK, OK] });
    const jobId = await h.start();
    await h.drain();
    let job = h.job(jobId);
    expect(job.status).toBe("queued");
    expect(job.stepOutputs.match).toBeDefined();
    expect(job.progress).toMatchObject({ stage: "match", done: 1, total: 1 });
    expect(Date.parse(job.nextRunAt!) - h.clock.ms()).toBe(FREE_TIER_MIN_INTERVAL_MS);
    await h.wake(jobId);
    job = h.job(jobId);
    expect(job.status).toBe("succeeded");
    expect(h.calls).toEqual(["match", "synthesize"]);
    const times = h.usage.forJob(jobId).map((r) => Date.parse(r.occurredAt));
    for (let i = 1; i < times.length; i++) expect(times[i]! - times[i - 1]!).toBeGreaterThanOrEqual(FREE_TIER_MIN_INTERVAL_MS);
  });
});

describe("insight job — synthesis split (QA-S6-03)", () => {
  it("free tier: synthesize and the V-5 regeneration are separate runs spaced ≥ 6 s; validate needs no spacing", async () => {
    const h = setup({ context: FREE, responses: [OK, OK, OK], firstViolations: ["37%"] });
    const jobId = await h.start();
    await h.drain(); // prepare → match → spacing before synthesize
    await h.wake(jobId); // synthesize → spacing before synthesize_regen
    let job = h.job(jobId);
    expect(job.status).toBe("queued");
    expect(job.stepOutputs.synthesize).toEqual({ first: { kind: "first", violations: ["37%"] } });
    expect(Date.parse(job.nextRunAt!) - h.clock.ms()).toBe(FREE_TIER_MIN_INTERVAL_MS);
    await h.wake(jobId); // regen → validate (no call, no spacing) → done
    job = h.job(jobId);
    expect(job.status).toBe("succeeded");
    expect(h.calls).toEqual(["match", "synthesize", "synthesize.regen"]);
    expect(h.insights.completes[0]!.payload).toMatchObject({ regen: true });
  });

  it("a failed regeneration is retried alone: the first synthesis call is not made again", async () => {
    const h = setup({ responses: [OK, OK, OK], firstViolations: ["37%"], failRegenOnce: new ProviderError("timeout") });
    const jobId = await h.start();
    await h.drain();
    expect(h.job(jobId).status).toBe("succeeded");
    expect(h.calls).toEqual(["match", "synthesize", "synthesize.regen", "synthesize.regen"]);
    expect(h.usage.forJob(jobId).map((r) => r.callKey)).toEqual(["insight.match", "insight.synthesize", "insight.synthesize.regen"]);
  });

  it("requirements_changed from the pipeline (JD text changed since stage 1) ends the job stalled, no retry", async () => {
    const h = setup({ responses: [OK, OK], firstViolations: ["1"], failRegenOnce: Object.assign(new Error("changed"), { code: "requirements_changed" }) });
    const jobId = await h.start();
    await h.drain();
    expect(h.job(jobId)).toMatchObject({ status: "failed", errorCode: "stalled" });
    expect(h.calls.filter((c) => c === "synthesize.regen")).toHaveLength(1);
  });

  it("no V-5 violation: synthesize_regen passes without a call", async () => {
    const h = setup({ context: FREE, responses: [OK, OK] });
    const jobId = await h.start();
    await h.drain();
    await h.wake(jobId);
    expect(h.job(jobId).status).toBe("succeeded");
    expect(h.calls).toEqual(["match", "synthesize"]);
  });
});

describe("insight job — prepare (R17: no extraction first)", () => {
  it("no JD (project gone) → stalled without begin or a provider call", async () => {
    const h = setup({ noJd: true });
    const jobId = await h.start();
    await h.drain();
    expect(h.job(jobId)).toMatchObject({ status: "failed", errorCode: "stalled" });
    expect(h.insights.begins).toEqual([]);
    expect(h.usage.forJob(jobId)).toHaveLength(0);
  });

  it("begin_insight refusals (job_description_not_found, insight_in_progress) become a system failure", async () => {
    for (const raise of ["job_description_not_found", "insight_in_progress"]) {
      const h = setup();
      h.insights.begin = async () => {
        throw new InsightRpcError(raise, new AppError(raise));
      };
      const jobId = await h.start();
      await h.drain();
      expect(h.job(jobId)).toMatchObject({ status: "failed", errorCode: "stalled" });
      expect(h.calls).toEqual([]);
    }
  });

  it("a pre-R17 checkpoint (`{ batches }` match output) can't continue: stalled", async () => {
    const h = setup({ responses: [OK] });
    const jobId = await h.start();
    // Simulate an in-flight pre-R17 job: replace the stored checkpoints after prepare.
    const job = h.job(jobId);
    job.stepOutputs = { prepare: { insightId: INSIGHT_ID, requirementCount: 3, snapshot: { careerSnapshotHash: "c", requirementsHash: "r" } } };
    await h.drain();
    expect(h.job(jobId)).toMatchObject({ status: "failed", errorCode: "stalled" });
  });
});

describe("pre-R17 job rows (R17 QA-02 / QA-03)", () => {
  /** A failed insight job (match failed for good) whose row we then age into a pre-R17 shape. */
  async function failedJob() {
    const h = setup({ responses: [], failMatch: () => new AiError("schema_invalid", { retryable: false }) });
    const jobId = await h.start();
    await h.drain();
    expect(h.job(jobId)).toMatchObject({ status: "failed", errorCode: "schema_invalid" });
    return { h, jobId };
  }

  it("QA-02: a legacy `not_a_jd` row is input / no retry everywhere: category, status response (schema-valid message), runner retry 409", async () => {
    expect(errorCategoryOf("not_a_jd")).toBe("input");
    expect(isManuallyRetryable("not_a_jd")).toBe(false);
    const { h, jobId } = await failedJob();
    h.job(jobId).errorCode = "not_a_jd";
    const status = toAiJobStatusResponse(h.job(jobId));
    expect(AiJobStatusResponseSchema.safeParse(status).success).toBe(true);
    expect(status).toMatchObject({
      error: { code: "not_a_jd", category: "input", failureCause: null, message: "채용 공고가 아닌 것 같습니다. 내용을 확인해 주세요." },
      errorCategory: "input",
      canRetry: false,
      retry: null,
    });
    await expect(h.runner.retryJob({ jobId, userId: USER })).rejects.toMatchObject({ code: "ai_job_not_retryable", status: 409 });
    expect(h.job(jobId).status).toBe("failed");
  });

  it("QA-03: a failed job with a pre-R17 prepare checkpoint is refused up front (409, canRetry false) instead of ending stalled", async () => {
    const { h, jobId } = await failedJob();
    // Before the age-up the retry would be offered.
    expect(toAiJobStatusResponse(h.job(jobId)).canRetry).toBe(true);
    h.job(jobId).stepOutputs = { prepare: { insightId: INSIGHT_ID, requirementCount: 3, extractedJobId: null, snapshot: { careerSnapshotHash: "c", requirementsHash: "r" } } };
    expect(toAiJobStatusResponse(h.job(jobId))).toMatchObject({ canRetry: false, retry: null });
    await expect(h.runner.retryJob({ jobId, userId: USER })).rejects.toMatchObject({ code: "ai_job_not_retryable", status: 409 });
    expect(h.job(jobId)).toMatchObject({ status: "failed", errorCode: "schema_invalid" });
    expect(h.calls.filter((c) => c === "match")).toHaveLength(1); // nothing ran again
  });

  it("QA-03: a pre-R17 match checkpoint (`{ batches }`) is refused too; R17 checkpoints are not", () => {
    const r17Prepare = { insightId: INSIGHT_ID, sentenceCount: 1, snapshot: { careerSnapshotHash: "c", jdTextHash: "h" } };
    expect(hasPreR17Checkpoint({})).toBe(false);
    expect(hasPreR17Checkpoint({ prepare: r17Prepare })).toBe(false);
    expect(hasPreR17Checkpoint({ prepare: r17Prepare, match: { v: 2, matches: [] } })).toBe(false);
    expect(hasPreR17Checkpoint({ prepare: r17Prepare, match: { batches: [] } })).toBe(true);
    expect(hasPreR17Checkpoint({ prepare: { insightId: INSIGHT_ID, snapshot: { careerSnapshotHash: "c", requirementsHash: "r" } } })).toBe(true);
  });

  it("QA-03: the user can still start a new run on the same project (regenerate path is a new job)", async () => {
    const { h, jobId } = await failedJob();
    h.job(jobId).stepOutputs = { prepare: { insightId: INSIGHT_ID, snapshot: { careerSnapshotHash: "c", requirementsHash: "r" } } };
    const h2 = setup({ responses: [OK, OK] });
    const next = await h2.start();
    await h2.drain();
    expect(h2.job(next).status).toBe("succeeded");
  });
});
