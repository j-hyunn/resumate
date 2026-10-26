import { afterEach, describe, expect, it, vi } from "vitest";
import { AiError } from "@/server/ai/errors";
import { MemoryJobStore, MemoryLedger, fakeClock, memoryScope } from "@/test/job-fakes";
import { STALLED_AFTER_MS } from "./constants";
import { createJobRunner } from "./runner";
import type { JobRef, JobStep, JobTypeDefinition, RunnerDeps } from "./types";

const USER = "00000000-0000-4000-8000-000000000001";

type Harness = ReturnType<typeof setup>;

function setup(def: JobTypeDefinition, opts: { limits?: ConstructorParameters<typeof MemoryLedger>[0]; timing?: RunnerDeps["timing"] } = {}) {
  const clock = fakeClock();
  const store = new MemoryJobStore(clock.now);
  const ledger = new MemoryLedger(opts.limits);
  store.ledger = ledger;
  const scheduled: (() => Promise<void>)[] = [];
  const continued: JobRef[] = [];
  const runner = createJobRunner({
    forUser: () => memoryScope(store, ledger, { fake: true }),
    getDefinition: (t) => (t === def.jobType ? def : undefined),
    schedule: (task) => {
      scheduled.push(task);
    },
    continueJob: async (ref) => {
      continued.push(ref);
    },
    now: clock.now,
    timing: { stepTimeoutMs: 1_000, heartbeatIntervalMs: 5, invocationBudgetMs: 55_000, ...opts.timing },
  });
  /** Runs everything scheduled so far (the `after()` callbacks). */
  async function drain() {
    while (scheduled.length) await scheduled.shift()!();
  }
  return { clock, store, ledger, runner, scheduled, continued, drain };
}

function insightDef(steps: JobStep[]): JobTypeDefinition {
  return { jobType: "insight", steps, usage: { feature: "insight", units: 1 } };
}

const ok = (stage: string, value: unknown = { stage }): JobStep => ({ stage, run: async () => value });

/** The ledger rule: no reservation of the job is left `reserved`. */
function expectSettled(h: Harness, jobId: string, expected: "charged" | "released") {
  const statuses = h.ledger.statusesOf(jobId);
  expect(statuses.length).toBeGreaterThan(0);
  expect(statuses.every((s) => s !== "reserved")).toBe(true);
  expect(statuses.at(-1)).toBe(expected);
}

async function start(h: Harness, extra: Partial<Parameters<Harness["runner"]["startJob"]>[0]> = {}) {
  return h.runner.startJob({ userId: USER, jobType: "insight", params: { a: 1 }, ...extra });
}

afterEach(() => {
  vi.useRealTimers();
});

describe("startJob", () => {
  it("reserves, inserts queued, schedules the run", async () => {
    const h = setup(insightDef([ok("match")]));
    const { jobId, reused } = await start(h);
    expect(reused).toBe(false);
    expect(h.store.jobs.get(jobId)?.status).toBe("queued");
    expect(h.store.jobs.get(jobId)?.progress).toEqual({ stage: "match", done: 0, total: 1 });
    expect(h.ledger.statusesOf(jobId)).toEqual(["reserved"]);
    expect(h.scheduled).toHaveLength(1);
  });

  it("reuses a succeeded job with the same input_hash: no new job, no usage", async () => {
    const h = setup(insightDef([ok("match")]));
    const first = await start(h, { inputHash: "h1" });
    await h.drain();
    const second = await start(h, { inputHash: "h1" });
    expect(second).toEqual({ jobId: first.jobId, reused: true, inProgress: false });
    expect(h.ledger.rows).toHaveLength(1);
    expect(h.store.jobs.size).toBe(1);
  });

  it("explicit regenerate skips reuse and reserves with reason explicit_regenerate", async () => {
    const h = setup(insightDef([ok("match")]));
    await start(h, { inputHash: "h1" });
    await h.drain();
    const again = await start(h, { inputHash: "h1", regenerate: true });
    expect(again.reused).toBe(false);
    expect(h.ledger.rows).toHaveLength(2);
  });

  it("limit reached: throws usage_limit_reached and leaves no job row", async () => {
    const h = setup(insightDef([ok("match")]), { limits: { insight: 0 } });
    await expect(start(h)).rejects.toMatchObject({ code: "usage_limit_reached" });
    expect(h.store.jobs.size).toBe(0);
  });

  it("insert failure releases the reservation", async () => {
    const h = setup(insightDef([ok("match")]));
    h.store.failNext.insert = 1;
    await expect(start(h)).rejects.toThrow();
    expect(h.ledger.rows).toHaveLength(1);
    expect(h.ledger.rows[0]!.status).toBe("released");
  });

  it("no-charge job types reserve nothing", async () => {
    const h = setup({ jobType: "insight", steps: [ok("match")] });
    const { jobId } = await start(h);
    await h.drain();
    expect(h.store.jobs.get(jobId)?.status).toBe("succeeded");
    expect(h.ledger.rows).toHaveLength(0);
  });
});

describe("runJob — success", () => {
  it("runs steps in order with previous outputs, checkpoints, succeeds and charges", async () => {
    const seen: unknown[] = [];
    const h = setup({
      ...insightDef([
        ok("match", { batches: 2 }),
        {
          stage: "synthesize",
          total: 3,
          run: async (ctx) => {
            seen.push(ctx.previous);
            await ctx.reportProgress(2, 3);
            return { done: true };
          },
        },
      ]),
      output: (prev) => ({ keys: Object.keys(prev) }),
    });
    const { jobId } = await start(h);
    await h.drain();
    const job = h.store.jobs.get(jobId)!;
    expect(job.status).toBe("succeeded");
    expect(job.errorCode).toBeNull();
    expect(job.stepOutputs).toEqual({ match: { batches: 2 }, synthesize: { done: true } });
    expect(job.progress).toEqual({ stage: "synthesize", done: 3, total: 3 });
    expect(job.attemptCount).toBe(1);
    expect(seen).toEqual([{ match: { batches: 2 } }]);
    expectSettled(h, jobId, "charged");
  });

  it("a second runner can't claim a running job", async () => {
    const h = setup(insightDef([ok("match")]));
    const { jobId } = await start(h);
    h.store.jobs.get(jobId)!.status = "running";
    expect(await h.runner.runJob({ jobId, userId: USER })).toBe("not_claimed");
  });

  it("complete RPC fails transiently → retried, succeeded + charged, never left reserved", async () => {
    const h = setup(insightDef([ok("match")]));
    h.store.failNext.complete = 1;
    const { jobId } = await start(h);
    await h.drain();
    expect(h.store.jobs.get(jobId)?.status).toBe("succeeded");
    expectSettled(h, jobId, "charged");
  });

  it("complete RPC failing on every try → failed + released, never left reserved", async () => {
    const h = setup(insightDef([ok("match")]));
    h.store.failNext.complete = 99;
    const { jobId } = await start(h);
    await h.drain();
    expect(h.store.jobs.get(jobId)).toMatchObject({ status: "failed", errorCode: "model_unavailable" });
    expectSettled(h, jobId, "released");
  });

  it("complete refused (job no longer running) → lost, released", async () => {
    let jobIdRef = "";
    const h = setup(
      insightDef([
        {
          stage: "match",
          run: async () => {
            // A cancel path finished the job between the last step and complete.
            return "x";
          },
        },
      ]),
    );
    const original = h.store.complete.bind(h.store);
    h.store.complete = async (id, gen, usageId, progress) => {
      h.store.jobs.get(jobIdRef)!.status = "canceled";
      return original(id, gen, usageId, progress);
    };
    const { jobId } = await start(h);
    jobIdRef = jobId;
    await h.drain();
    expect(h.store.jobs.get(jobId)?.status).toBe("canceled");
    expectSettled(h, jobId, "released");
  });

  it("final output is persisted before complete", async () => {
    const order: string[] = [];
    const h = setup({ ...insightDef([ok("rank", [1, 2])]), output: (prev) => prev.rank });
    const update = h.store.update.bind(h.store);
    h.store.update = async (id, gen, patch) => {
      if (patch.output !== undefined) order.push("output");
      return update(id, gen, patch);
    };
    const complete = h.store.complete.bind(h.store);
    h.store.complete = async (id, gen, usageId, p) => {
      order.push("complete");
      return complete(id, gen, usageId, p);
    };
    await start(h);
    await h.drain();
    expect(order).toEqual(["output", "complete"]);
  });
});

describe("runJob — failure paths release usage", () => {
  it("non-retryable AiError (input_too_long): failed once, no retry, released", async () => {
    const run = vi.fn(async () => {
      throw new AiError("input_too_long");
    });
    const h = setup(insightDef([{ stage: "match", run }]));
    const { jobId } = await start(h);
    await h.drain();
    expect(run).toHaveBeenCalledTimes(1);
    expect(h.store.jobs.get(jobId)).toMatchObject({ status: "failed", errorCode: "input_too_long" });
    expectSettled(h, jobId, "released");
  });

  it("schema_invalid after the automatic retry: failed, attempt 2, released", async () => {
    const run = vi.fn(async () => {
      throw new AiError("schema_invalid");
    });
    const h = setup(insightDef([{ stage: "match", run }]));
    const { jobId } = await start(h);
    await h.drain();
    expect(run).toHaveBeenCalledTimes(2);
    expect(h.store.jobs.get(jobId)).toMatchObject({ status: "failed", errorCode: "schema_invalid", attemptCount: 2 });
    expectSettled(h, jobId, "released");
  });

  it("transient failure then success: succeeded on the retry, charged", async () => {
    let calls = 0;
    const h = setup(
      insightDef([
        ok("match"),
        {
          stage: "synthesize",
          run: async (ctx) => {
            calls++;
            if (ctx.attempt === 1) throw new AiError("rate_limited");
            return "ok";
          },
        },
      ]),
    );
    const { jobId } = await start(h);
    await h.drain();
    expect(calls).toBe(2);
    expect(h.store.jobs.get(jobId)).toMatchObject({ status: "succeeded", attemptCount: 2 });
    expectSettled(h, jobId, "charged");
  });

  it("unknown exception: retried once, then failed as model_unavailable, released", async () => {
    const run = vi.fn(async () => {
      throw new TypeError("bug");
    });
    const h = setup(insightDef([{ stage: "match", run }]));
    const { jobId } = await start(h);
    await h.drain();
    expect(run).toHaveBeenCalledTimes(2);
    expect(h.store.jobs.get(jobId)).toMatchObject({ status: "failed", errorCode: "model_unavailable" });
    expectSettled(h, jobId, "released");
  });

  it("hanging step: step deadline → timeout, retried once, failed, released", async () => {
    const run = vi.fn((ctx: { signal: AbortSignal }) => new Promise<never>(() => void ctx.signal)); // ignores the signal
    const h = setup(insightDef([{ stage: "match", timeoutMs: 20, run }]));
    const { jobId } = await start(h);
    await h.drain();
    expect(run).toHaveBeenCalledTimes(2);
    expect(h.store.jobs.get(jobId)).toMatchObject({ status: "failed", errorCode: "timeout" });
    expectSettled(h, jobId, "released");
  });

  it("cancel during a step (heartbeat sees cancel_requested_at): canceled, not retried, released", async () => {
    let jobIdRef = "";
    const h = setup(
      insightDef([
        {
          stage: "match",
          run: (ctx) =>
            new Promise((_, reject) => {
              h.store.requestCancel(jobIdRef);
              ctx.signal.addEventListener("abort", () => reject(new AiError(ctx.signal.reason === "canceled" ? "canceled" : "timeout")));
            }),
        },
      ]),
    );
    const { jobId } = await start(h);
    jobIdRef = jobId;
    await h.drain();
    expect(h.store.jobs.get(jobId)).toMatchObject({ status: "canceled", errorCode: "canceled", attemptCount: 1 });
    expectSettled(h, jobId, "released");
  });

  it("cancel requested before the run starts: canceled without running a step, released", async () => {
    const run = vi.fn(async () => "x");
    const h = setup(insightDef([{ stage: "match", run }]));
    const { jobId } = await start(h);
    h.store.requestCancel(jobId);
    await h.drain();
    expect(run).not.toHaveBeenCalled();
    expect(h.store.jobs.get(jobId)?.status).toBe("canceled");
    expectSettled(h, jobId, "released");
  });

  it("settleCancelIfQueued finishes a queued (yielded) job as canceled", async () => {
    const h = setup(insightDef([ok("match")]));
    const { jobId } = await start(h);
    h.store.requestCancel(jobId);
    const job = await h.runner.settleCancelIfQueued({ jobId, userId: USER });
    expect(job?.status).toBe("canceled");
    expectSettled(h, jobId, "released");
  });

  it("DB failure while saving a checkpoint: failed + released", async () => {
    const h = setup(insightDef([ok("match")]));
    h.store.failNext.saveStepOutputs = 1;
    const { jobId } = await start(h);
    await h.drain();
    expect(h.store.jobs.get(jobId)).toMatchObject({ status: "failed", errorCode: "model_unavailable" });
    expectSettled(h, jobId, "released");
  });

  it("finish() throwing on failure still releases usage", async () => {
    const h = setup(insightDef([{ stage: "match", run: async () => Promise.reject(new AiError("refused")) }]));
    const { jobId } = await start(h);
    h.store.failNext.finish = 5;
    await h.drain();
    expectSettled(h, jobId, "released");
  });

  it("ledger release blip on failure is retried", async () => {
    const h = setup(insightDef([{ stage: "match", run: async () => Promise.reject(new AiError("input_too_long")) }]));
    h.ledger.failNext.releaseJob = 1;
    const { jobId } = await start(h);
    await h.drain();
    expectSettled(h, jobId, "released");
  });
});

describe("stalled", () => {
  it("status read fails a job whose heartbeat stopped, and releases", async () => {
    const h = setup(insightDef([ok("match")]));
    const { jobId } = await start(h);
    const job = h.store.jobs.get(jobId)!;
    job.status = "running";
    job.heartbeatAt = h.clock.now().toISOString();
    h.clock.advance(STALLED_AFTER_MS + 1);
    const after = await h.runner.getStatus({ jobId, userId: USER });
    expect(after).toMatchObject({ status: "failed", errorCode: "stalled" });
    expectSettled(h, jobId, "released");
  });

  it("a never-claimed queued job stalls by created_at", async () => {
    const h = setup(insightDef([ok("match")]));
    const { jobId } = await start(h);
    h.clock.advance(STALLED_AFTER_MS + 1);
    expect(await h.runner.getStatus({ jobId, userId: USER })).toMatchObject({ status: "failed", errorCode: "stalled" });
    expectSettled(h, jobId, "released");
  });

  it("zombie runner after the sweep: stops quietly (lost), usage stays released, never charged", async () => {
    let jobIdRef = "";
    const h = setup(
      insightDef([
        {
          stage: "match",
          run: async () => {
            // The sweep fails the job while the step is still running.
            const job = h.store.jobs.get(jobIdRef)!;
            job.status = "failed";
            job.errorCode = "stalled";
            await h.ledger.releaseJob(jobIdRef);
            return "late result";
          },
        },
      ]),
    );
    const { jobId } = await start(h);
    jobIdRef = jobId;
    const scheduled = h.scheduled.shift()!;
    await scheduled();
    expect(h.store.jobs.get(jobId)).toMatchObject({ status: "failed", errorCode: "stalled" });
    expect(h.store.jobs.get(jobId)?.stepOutputs).toEqual({});
    expect(h.ledger.statusesOf(jobId)).toEqual(["released"]);
  });

  it("heartbeat seeing a terminal status aborts the step as lost", async () => {
    let jobIdRef = "";
    const h = setup(
      insightDef([
        {
          stage: "match",
          run: (ctx) =>
            new Promise((_, reject) => {
              h.store.jobs.get(jobIdRef)!.status = "failed";
              ctx.signal.addEventListener("abort", () => reject(new Error("aborted")));
            }),
        },
      ]),
    );
    const { jobId } = await start(h);
    jobIdRef = jobId;
    const outcome = await (async () => {
      const task = h.scheduled.shift()!;
      await task();
      return h.store.jobs.get(jobId)!.status;
    })();
    expect(outcome).toBe("failed");
    expect(h.ledger.statusesOf(jobId)).toEqual(["released"]);
  });
});

describe("yield and resume (60 s budget)", () => {
  it("yields between steps near the budget, continues in a new invocation from the next step", async () => {
    const calls: string[] = [];
    const clockRef: { current?: ReturnType<typeof fakeClock> } = {};
    const h = setup(
      insightDef([
        {
          stage: "match",
          timeoutMs: 30_000,
          run: async () => {
            calls.push("match");
            clockRef.current!.advance(30_000);
            return 1;
          },
        },
        {
          stage: "synthesize",
          timeoutMs: 30_000,
          run: async () => {
            calls.push("synthesize");
            return 2;
          },
        },
      ]),
    );
    clockRef.current = h.clock;
    const { jobId } = await start(h);
    await h.drain();
    expect(h.store.jobs.get(jobId)).toMatchObject({ status: "queued", stepOutputs: { match: 1 } });
    expect(h.continued).toEqual([{ jobId, userId: USER }]);
    expect(h.ledger.statusesOf(jobId)).toEqual(["reserved"]);

    // The continue route runs it again: step 1 is skipped.
    expect(await h.runner.runJob({ jobId, userId: USER })).toBe("succeeded");
    expect(calls).toEqual(["match", "synthesize"]);
    expectSettled(h, jobId, "charged");
  });

  it("a status poll resumes a yielded job whose continuation was lost", async () => {
    const h = setup(insightDef([ok("match"), ok("synthesize")]));
    const { jobId } = await start(h);
    const job = h.store.jobs.get(jobId)!;
    job.heartbeatAt = h.clock.now().toISOString(); // yielded
    h.scheduled.length = 0;
    h.clock.advance(11_000);
    await h.runner.getStatus({ jobId, userId: USER });
    expect(h.scheduled).toHaveLength(1);
    await h.drain();
    expect(h.store.jobs.get(jobId)?.status).toBe("succeeded");
    expectSettled(h, jobId, "charged");
  });
});

describe("manual retry", () => {
  it("re-reserves, resumes from the failed step, keeps completed steps", async () => {
    const calls: string[] = [];
    let failSynthesize = true;
    const h = setup(
      insightDef([
        {
          stage: "match",
          run: async () => {
            calls.push("match");
            return 1;
          },
        },
        {
          stage: "synthesize",
          run: async () => {
            calls.push("synthesize");
            if (failSynthesize) throw new AiError("model_unavailable");
            return 2;
          },
        },
      ]),
    );
    const { jobId } = await start(h);
    await h.drain();
    expect(h.store.jobs.get(jobId)).toMatchObject({ status: "failed", errorCode: "model_unavailable" });
    expect(h.ledger.statusesOf(jobId)).toEqual(["released"]);

    failSynthesize = false;
    const retried = await h.runner.retryJob({ jobId, userId: USER });
    expect(retried).toEqual({ jobId, reused: false, inProgress: false });
    await h.drain();
    expect(h.store.jobs.get(jobId)?.status).toBe("succeeded");
    expect(calls).toEqual(["match", "synthesize", "synthesize", "synthesize"]);
    expect(h.ledger.statusesOf(jobId)).toEqual(["released", "charged"]);
  });

  it("input-category failures are not retryable and reserve nothing", async () => {
    const h = setup(insightDef([{ stage: "match", run: async () => Promise.reject(new AiError("not_a_jd")) }]));
    const { jobId } = await start(h);
    await h.drain();
    await expect(h.runner.retryJob({ jobId, userId: USER })).rejects.toMatchObject({ code: "ai_job_not_retryable" });
    expect(h.ledger.statusesOf(jobId)).toEqual(["released"]);
  });

  it("retry hitting the limit leaves the job failed", async () => {
    const h = setup(insightDef([{ stage: "match", run: async () => Promise.reject(new AiError("timeout")) }]), { limits: { insight: 1 } });
    const { jobId } = await start(h);
    await h.drain();
    // Another job uses the last unit.
    await h.ledger.reserve({ feature: "insight", units: 1, reason: "initial", jobId: crypto.randomUUID() });
    await expect(h.runner.retryJob({ jobId, userId: USER })).rejects.toMatchObject({ code: "usage_limit_reached" });
    expect(h.store.jobs.get(jobId)?.status).toBe("failed");
  });
});

describe("QA-S3 round 1 regressions", () => {
  it("QA-S3-01 concurrent manual retries: one winner, exactly one new reservation, charged once", async () => {
    let fail = true;
    const h = setup(insightDef([{ stage: "match", run: async () => (fail ? Promise.reject(new AiError("timeout")) : "ok") }]));
    const { jobId } = await start(h);
    await h.drain();
    expect(h.ledger.statusesOf(jobId)).toEqual(["released"]);
    fail = false;
    const [a, b] = await Promise.all([h.runner.retryJob({ jobId, userId: USER }), h.runner.retryJob({ jobId, userId: USER })]);
    expect([a.inProgress, b.inProgress].sort()).toEqual([false, true]);
    await h.drain();
    expect(h.store.jobs.get(jobId)?.status).toBe("succeeded");
    expect(h.ledger.statusesOf(jobId)).toEqual(["released", "charged"]);
  });

  it("QA-S3-01 leftover reservation + retry: leftover released first, only the new one charged", async () => {
    let fail = true;
    const h = setup(insightDef([{ stage: "match", run: async () => (fail ? Promise.reject(new AiError("input_too_long")) : "ok") }]));
    h.ledger.failNext.release = 2; // the failure's release is lost → leftover `reserved`
    const { jobId } = await start(h);
    await h.drain();
    // input errors aren't retryable; use a transient one for the retry path
    h.store.jobs.get(jobId)!.errorCode = "model_unavailable";
    expect(h.ledger.statusesOf(jobId)).toEqual(["reserved"]);
    fail = false;
    await h.runner.retryJob({ jobId, userId: USER });
    await h.drain();
    expect(h.ledger.statusesOf(jobId)).toEqual(["released", "charged"]);
  });

  it("QA-S3-01 retry whose leftover release fails: back to failed, no new reservation", async () => {
    const h = setup(insightDef([{ stage: "match", run: async () => Promise.reject(new AiError("timeout")) }]));
    const { jobId } = await start(h);
    await h.drain();
    h.ledger.failNext.releaseJob = 1;
    await expect(h.runner.retryJob({ jobId, userId: USER })).rejects.toThrow();
    expect(h.store.jobs.get(jobId)).toMatchObject({ status: "failed", errorCode: "timeout" });
    expect(h.ledger.statusesOf(jobId)).toEqual(["released"]);
  });

  it("QA-S3-01 a charging job without its reservation id never runs free", async () => {
    const run = vi.fn(async () => "x");
    const h = setup(insightDef([{ stage: "match", run }]));
    const { jobId } = await start(h);
    h.store.jobs.get(jobId)!.meta.usageEventId = null;
    await h.drain();
    expect(run).not.toHaveBeenCalled();
    expect(h.store.jobs.get(jobId)?.status).toBe("failed");
  });

  it("QA-S3-03 double start (sequential): follows the in-flight job, no second reservation", async () => {
    const h = setup(insightDef([ok("match")]));
    const first = await start(h, { inputHash: "same" });
    const second = await start(h, { inputHash: "same" });
    expect(second).toEqual({ jobId: first.jobId, reused: false, inProgress: true });
    const regen = await start(h, { inputHash: "same", regenerate: true });
    expect(regen.jobId).toBe(first.jobId);
    expect(h.ledger.rows).toHaveLength(1);
  });

  it("QA-S3-03 double start (race on the unique index): loser releases its reservation and follows the winner", async () => {
    const h = setup(insightDef([ok("match")]));
    const [a, b] = await Promise.all([start(h, { inputHash: "race" }), start(h, { inputHash: "race" })]);
    expect(a.jobId).toBe(b.jobId);
    expect(h.store.jobs.size).toBe(1);
    await h.drain();
    expect(h.ledger.rows.map((r) => r.status).sort()).toEqual(["charged", "released"]);
  });

  it("QA-S3-04 poll right after retrying an old job: not stalled (heartbeat = now)", async () => {
    const h = setup(insightDef([{ stage: "match", run: async () => Promise.reject(new AiError("timeout")) }]));
    const { jobId } = await start(h);
    await h.drain();
    h.clock.advance(STALLED_AFTER_MS * 10); // failed long ago
    await h.runner.retryJob({ jobId, userId: USER });
    h.scheduled.length = 0; // after() hasn't claimed yet
    const polled = await h.runner.getStatus({ jobId, userId: USER });
    expect(polled.status).toBe("queued");
    expect(polled.heartbeatAt).toBe(h.clock.now().toISOString());
  });

  it("QA-S3-05 late runner of an older generation can't touch the retried run", async () => {
    let jobIdRef = "";
    let release: (v: unknown) => void = () => {};
    let firstRun = true;
    const h = setup(
      insightDef([
        {
          stage: "match",
          timeoutMs: 10_000,
          run: () => {
            if (!firstRun) return Promise.resolve("new");
            firstRun = false;
            return new Promise((r) => (release = r));
          },
        },
      ]),
      { timing: { heartbeatIntervalMs: 60_000 } },
    );
    const { jobId } = await start(h);
    jobIdRef = jobId;
    const oldRun = h.scheduled.shift()!();
    await vi.waitFor(() => expect(h.store.jobs.get(jobIdRef)?.status).toBe("running"));
    const firstUsage = h.store.jobs.get(jobId)!.meta.usageEventId!;
    // Sweep fails it, then the user retries (generation 2).
    const job = h.store.jobs.get(jobId)!;
    job.status = "failed";
    job.errorCode = "stalled";
    await h.ledger.release(firstUsage);
    await h.runner.retryJob({ jobId, userId: USER });
    // The old runner finishes late.
    release("stale");
    await oldRun;
    expect(h.store.jobs.get(jobId)).toMatchObject({ status: "queued", attemptCount: 2, stepOutputs: {} });
    await h.drain();
    expect(h.store.jobs.get(jobId)).toMatchObject({ status: "succeeded", stepOutputs: { match: "new" } });
    expect(h.ledger.statusesOf(jobId)).toEqual(["released", "charged"]);
  });

  it("QA-S3-05 late stalled detection with an old snapshot doesn't fail the new generation or release its usage", async () => {
    const h = setup(insightDef([{ stage: "match", run: async () => Promise.reject(new AiError("timeout")) }]));
    const { jobId } = await start(h);
    const snapshot = structuredClone(h.store.jobs.get(jobId)!); // queued, gen 1
    await h.drain(); // fails (gen 2 after the auto retry)
    await h.runner.retryJob({ jobId, userId: USER });
    h.scheduled.length = 0;
    h.clock.advance(STALLED_AFTER_MS + 1);
    await h.runner.markStalledIfNeeded(memoryScope(h.store, h.ledger, { fake: true }), snapshot);
    expect(h.store.jobs.get(jobId)?.status).toBe("queued");
    expect(h.ledger.statusesOf(jobId)).toEqual(["released", "reserved"]);
  });
});
