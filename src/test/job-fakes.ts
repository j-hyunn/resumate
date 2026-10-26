import { AppError } from "@/lib/contracts/errors";
import type { UsageFeature, UsageStatus } from "@/lib/contracts/enums";
import type { AiWriterSupabaseClient } from "@/server/db/types";
import type { JobMeta, JobPatch, JobRecord, JobStore, Ledger, NewJob, ReserveInput, ReusableJobQuery, UserScope } from "@/server/jobs/types";

/**
 * Test-only in-memory ai_jobs store and usage ledger with the same conditional
 * semantics as the DB: writes match status AND attempt_count (generation),
 * claim only queued, complete charges ONE reservation by id, settle only reserved.
 */

const ACTIVE = new Set(["queued", "running"]);

export class MemoryJobStore implements JobStore {
  readonly jobs = new Map<string, JobRecord>();
  /** Set to make the next N calls of a method throw. */
  failNext: Partial<Record<keyof JobStore, number>> = {};
  /** The ledger complete() charges (complete_ai_job charges in the same transaction). */
  ledger?: MemoryLedger;
  /** Simulates the partial unique in-flight index (QA-S3-03). */
  uniqueInFlight = true;

  constructor(private readonly clock: () => Date) {}

  private maybeFail(method: keyof JobStore) {
    const n = this.failNext[method] ?? 0;
    if (n > 0) {
      this.failNext[method] = n - 1;
      throw new Error(`fake ${method} failure`);
    }
  }

  private apply(job: JobRecord, patch: JobPatch) {
    const { output, usage, model, promptVersion, ...rest } = patch;
    void output;
    void usage;
    void model;
    void promptVersion;
    Object.assign(job, rest, { updatedAt: this.clock().toISOString() });
  }

  private match(jobId: string, gen: number, statuses: Set<string> = ACTIVE): JobRecord | null {
    const job = this.jobs.get(jobId);
    return job && statuses.has(job.status) && job.attemptCount === gen ? job : null;
  }

  private sameScope(job: JobRecord, q: ReusableJobQuery) {
    return job.userId === q.userId && job.jobType === q.jobType && job.inputHash === q.inputHash;
  }

  async get(jobId: string) {
    this.maybeFail("get");
    const job = this.jobs.get(jobId);
    return job ? structuredClone(job) : null;
  }

  async findReusable(q: ReusableJobQuery) {
    for (const job of this.jobs.values()) if (this.sameScope(job, q) && job.status === "succeeded") return { id: job.id };
    return null;
  }

  async findInFlight(q: ReusableJobQuery) {
    this.maybeFail("findInFlight");
    for (const job of this.jobs.values()) if (this.sameScope(job, q) && ACTIVE.has(job.status)) return { id: job.id };
    return null;
  }

  async insert(job: NewJob) {
    this.maybeFail("insert");
    if (this.uniqueInFlight && job.inputHash) {
      for (const other of this.jobs.values()) {
        if (other.userId === job.userId && other.jobType === job.jobType && other.inputHash === job.inputHash && ACTIVE.has(other.status)) {
          throw new AppError("conflict");
        }
      }
    }
    const t = this.clock().toISOString();
    this.jobs.set(job.id, {
      id: job.id,
      userId: job.userId,
      jobType: job.jobType,
      status: "queued",
      progress: job.progress,
      params: job.params,
      attemptCount: job.meta.runBase,
      errorCode: null,
      inputHash: job.inputHash,
      cancelRequestedAt: null,
      heartbeatAt: null,
      startedAt: null,
      finishedAt: null,
      createdAt: t,
      updatedAt: t,
      stepOutputs: {},
      meta: { ...job.meta },
    });
  }

  async claim(jobId: string, opts: { now: string; staleBefore: string }) {
    this.maybeFail("claim");
    const job = this.jobs.get(jobId);
    if (!job || job.status !== "queued") return null;
    if (job.heartbeatAt && job.heartbeatAt >= opts.staleBefore) return null;
    this.apply(job, { status: "running", heartbeatAt: opts.now });
    return structuredClone(job);
  }

  async update(jobId: string, gen: number, patch: JobPatch) {
    this.maybeFail("update");
    const job = this.match(jobId, gen);
    if (!job) return false;
    this.apply(job, patch);
    return true;
  }

  async saveStepOutputs(jobId: string, gen: number, outputs: Record<string, unknown>, meta: JobMeta, patch?: JobPatch) {
    this.maybeFail("saveStepOutputs");
    const job = this.match(jobId, gen);
    if (!job) return false;
    job.stepOutputs = structuredClone(outputs);
    job.meta = { ...meta };
    if (patch) this.apply(job, patch);
    return true;
  }

  async heartbeat(jobId: string, gen: number, now: string) {
    this.maybeFail("heartbeat");
    const job = this.match(jobId, gen);
    if (!job) return { current: false, cancelRequested: false };
    job.heartbeatAt = now;
    return { current: true, cancelRequested: job.cancelRequestedAt !== null };
  }

  async finish(jobId: string, gen: number, patch: JobPatch & { status: "failed" | "canceled" }) {
    this.maybeFail("finish");
    const job = this.match(jobId, gen);
    if (!job) return false;
    this.apply(job, patch);
    return true;
  }

  async complete(jobId: string, gen: number, usageEventId: string | null, progress: JobRecord["progress"]) {
    this.maybeFail("complete");
    const job = this.jobs.get(jobId);
    if (!job) throw new AppError("not_found");
    if (job.status === "running" && job.attemptCount === gen) {
      this.apply(job, { status: "succeeded", errorCode: null, progress, finishedAt: this.clock().toISOString() });
    } else if (!(job.status === "succeeded" && job.attemptCount === gen)) {
      return false; // invalid_ai_job_transition, usage unchanged
    }
    if (usageEventId) this.ledger?.chargeOne(usageEventId, jobId);
    return true;
  }

  async requeueFailed(jobId: string, gen: number, now: string, outputs: Record<string, unknown>, meta: JobMeta) {
    this.maybeFail("requeueFailed");
    const job = this.match(jobId, gen, new Set(["failed"]));
    if (!job) return false;
    this.apply(job, { status: "queued", errorCode: null, finishedAt: null, heartbeatAt: now, attemptCount: gen + 1 });
    job.cancelRequestedAt = null; // DB guard clears it on failed → queued
    job.stepOutputs = structuredClone(outputs);
    job.meta = { ...meta };
    return true;
  }

  /** Simulates the user's cancel RPC. */
  requestCancel(jobId: string) {
    const job = this.jobs.get(jobId);
    if (job && ACTIVE.has(job.status)) job.cancelRequestedAt = this.clock().toISOString();
  }
}

export type LedgerRow = { id: string; jobId: string; feature: UsageFeature; units: number; status: UsageStatus };

export class MemoryLedger implements Ledger {
  readonly rows: LedgerRow[] = [];
  failNext: Partial<Record<"reserve" | "release" | "releaseJob", number>> = {};

  constructor(private readonly limits: Partial<Record<UsageFeature, number>> = { insight: 10, draft: 20 }) {}

  private maybeFail(method: "reserve" | "release" | "releaseJob") {
    const n = this.failNext[method] ?? 0;
    if (n > 0) {
      this.failNext[method] = n - 1;
      throw new Error(`fake ${method} failure`);
    }
  }

  async reserve(input: ReserveInput) {
    this.maybeFail("reserve");
    const limit = this.limits[input.feature];
    if (limit === undefined) throw new AppError("usage_limit_missing", "사용 한도 정보를 찾을 수 없습니다.", { status: 503 });
    const used = this.rows
      .filter((r) => r.feature === input.feature && r.status !== "released")
      .reduce((sum, r) => sum + r.units, 0);
    if (used + input.units > limit) throw new AppError("usage_limit_reached", "이번 달 사용 한도에 도달했습니다.", { status: 429 });
    const id = crypto.randomUUID();
    this.rows.push({ id, jobId: input.jobId, feature: input.feature, units: input.units, status: "reserved" });
    return id;
  }

  async release(usageEventId: string) {
    this.maybeFail("release");
    const row = this.rows.find((r) => r.id === usageEventId);
    if (!row) throw new AppError("usage_event_not_found");
    if (row.status === "charged") throw new AppError("invalid_usage_transition");
    row.status = "released";
  }

  async releaseJob(jobId: string) {
    this.maybeFail("releaseJob");
    for (const r of this.rows) if (r.jobId === jobId && r.status === "reserved") r.status = "released";
  }

  /** complete_ai_job's charge half: exactly one reservation. */
  chargeOne(usageEventId: string, jobId: string) {
    const row = this.rows.find((r) => r.id === usageEventId && r.jobId === jobId);
    if (!row) throw new AppError("usage_event_not_found");
    if (row.status === "released") throw new AppError("invalid_usage_transition");
    row.status = "charged";
  }

  statusesOf(jobId: string): UsageStatus[] {
    return this.rows.filter((r) => r.jobId === jobId).map((r) => r.status);
  }
}

/** A controllable clock: `advance(ms)` moves time forward (wall clock for the runner). */
export function fakeClock(start = new Date("2026-10-26T00:00:00.000Z")) {
  let t = start.getTime();
  return {
    now: () => new Date(t),
    advance: (ms: number) => {
      t += ms;
    },
  };
}

export function memoryScope<TAi>(store: MemoryJobStore, ledger: MemoryLedger, ai: TAi): UserScope<TAi> {
  return { store, ledger, ai, db: {} as AiWriterSupabaseClient };
}
