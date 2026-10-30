import { AppError } from "@/lib/contracts/errors";
import type { AiErrorCode, AiProvider, ConnectionTier } from "@/lib/contracts/enums";
import { ProviderError } from "@/server/ai/errors";
import { createLlm, type Llm } from "@/server/ai/llm";
import { silentAiLogger } from "@/server/ai/log";
import type { AiCallResult, LlmStreamEvent, NormalizedUsage, ProviderAdapter, ProviderCallRequest } from "@/server/ai/providers/types";
import { UNAVAILABLE_USAGE } from "@/server/ai/providers/types";
import type { AiWriterSupabaseClient } from "@/server/db/types";
import type {
  ClaimOptions,
  InFlightQuery,
  JobMeta,
  JobPatch,
  JobRecord,
  JobStore,
  LlmFactoryInput,
  NewJob,
  PriceRow,
  RequeueFailedInput,
  RequeueFailedResult,
  ReusableJobQuery,
  UsageRecordRow,
  UsageStore,
  UserScope,
} from "@/server/jobs/types";
import type { KeySource, KeyStatusReporter } from "@/server/jobs/provider-context";

/**
 * Test-only in-memory ai_jobs / ai_usage_records stores with the same
 * conditional semantics as the DB (S3a): writes match status AND
 * run_generation, claim only queued AND due, one in-flight job per target,
 * complete only running of the same generation (idempotent when already
 * succeeded), failed → queued clears the final-failure fields.
 * Plus a scripted provider adapter driven through the REAL `createLlm`, so
 * key lookup, usage records, and the stream contract behave as in production.
 */

const ACTIVE = new Set(["queued", "running"]);

export class MemoryJobStore implements JobStore {
  readonly jobs = new Map<string, JobRecord>();
  /** Set to make the next N calls of a method throw. */
  failNext: Partial<Record<keyof JobStore, number>> = {};

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
    return job && statuses.has(job.status) && job.runGeneration === gen ? job : null;
  }

  private targetTaken(job: Pick<JobRecord, "id" | "userId" | "jobType" | "targetType" | "targetId">): boolean {
    if (!job.targetType || !job.targetId) return false;
    for (const other of this.jobs.values()) {
      if (
        other.id !== job.id &&
        other.userId === job.userId &&
        other.jobType === job.jobType &&
        other.targetType === job.targetType &&
        other.targetId === job.targetId &&
        ACTIVE.has(other.status)
      ) {
        return true;
      }
    }
    return false;
  }

  async get(jobId: string) {
    this.maybeFail("get");
    const job = this.jobs.get(jobId);
    return job ? structuredClone(job) : null;
  }

  async findReusable(q: ReusableJobQuery) {
    for (const job of this.jobs.values()) {
      if (
        job.userId === q.userId &&
        job.jobType === q.jobType &&
        job.provider === q.provider &&
        job.inputHash === q.inputHash &&
        job.applicationProjectId === q.applicationProjectId &&
        job.status === "succeeded"
      ) {
        return { id: job.id };
      }
    }
    return null;
  }

  async findInFlight(q: InFlightQuery) {
    this.maybeFail("findInFlight");
    for (const job of this.jobs.values()) {
      if (job.userId !== q.userId || job.jobType !== q.jobType || !ACTIVE.has(job.status)) continue;
      if (q.target ? job.targetType === q.target.type && job.targetId === q.target.id : q.inputHash !== null && job.inputHash === q.inputHash) {
        return { id: job.id };
      }
    }
    return null;
  }

  async insert(job: NewJob) {
    this.maybeFail("insert");
    if (this.targetTaken({ id: job.id, userId: job.userId, jobType: job.jobType, targetType: job.targetType, targetId: job.targetId })) {
      throw new AppError("conflict");
    }
    const t = this.clock().toISOString();
    this.jobs.set(job.id, {
      id: job.id,
      userId: job.userId,
      jobType: job.jobType,
      status: "queued",
      progress: job.progress,
      params: job.params,
      applicationProjectId: job.applicationProjectId,
      targetType: job.targetType,
      targetId: job.targetId,
      provider: job.provider,
      modelTier: job.modelTier,
      connectionTier: job.connectionTier,
      runGeneration: job.meta.runBase,
      retryCount: 0,
      retryWaitTotalMs: 0,
      nextRunAt: null,
      retryAfter: null,
      quotaResetsAt: null,
      errorCode: null,
      inputHash: job.inputHash,
      cancelRequestedAt: null,
      heartbeatAt: null,
      startedAt: null,
      finishedAt: null,
      createdAt: t,
      updatedAt: t,
      stepOutputs: {},
      meta: structuredClone(job.meta),
    });
  }

  async claim(jobId: string, opts: ClaimOptions) {
    this.maybeFail("claim");
    const job = this.jobs.get(jobId);
    if (!job || job.status !== "queued") return null;
    if (job.heartbeatAt && job.heartbeatAt >= opts.staleBefore) return null;
    if (!opts.ignoreNextRunAt && job.nextRunAt && job.nextRunAt > opts.now) return null;
    this.apply(job, { status: "running", heartbeatAt: opts.now, nextRunAt: null });
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
    job.meta = structuredClone(meta);
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

  async complete(jobId: string, gen: number, progress: JobRecord["progress"]) {
    this.maybeFail("complete");
    const job = this.jobs.get(jobId);
    if (!job) throw new AppError("not_found");
    if (job.status === "running" && job.runGeneration === gen) {
      this.apply(job, { status: "succeeded", progress, nextRunAt: null, finishedAt: this.clock().toISOString() });
      return true;
    }
    return job.status === "succeeded" && job.runGeneration === gen; // else invalid_ai_job_transition
  }

  /**
   * The user's active connection as `retry_ai_job` reads it (profiles.active_ai_provider +
   * that key's tier). Default: the job's own connection (a same-provider retry).
   */
  activeConnection: (() => { provider: AiProvider; connectionTier: ConnectionTier } | null) | null = null;
  /** Requeue calls seen (model / tier the runner routed). */
  readonly requeues: RequeueFailedInput[] = [];

  async requeueFailed(input: RequeueFailedInput): Promise<RequeueFailedResult | null> {
    this.maybeFail("requeueFailed");
    this.requeues.push(structuredClone(input));
    const job = this.match(input.jobId, input.expectedGeneration, new Set(["failed"]));
    if (!job) return null;
    const active = this.activeConnection ? this.activeConnection() : { provider: job.provider, connectionTier: job.connectionTier };
    if (!active) throw new AppError("key_missing", undefined, { status: 409 });
    if (active.provider !== input.expectedProvider || active.connectionTier !== input.expectedConnectionTier) {
      throw new AppError("ai_connection_changed", undefined, { status: 409 });
    }
    if (this.targetTaken(job)) throw new AppError("conflict");
    const restarted = active.provider !== job.provider || active.connectionTier !== job.connectionTier;
    // DB guard on failed → queued clears error_code, finished_at, cancel_requested_at, retry_after, quota_resets_at.
    this.apply(job, {
      status: "queued",
      errorCode: null,
      finishedAt: null,
      retryAfter: null,
      quotaResetsAt: null,
      nextRunAt: null,
      heartbeatAt: this.clock().toISOString(),
      runGeneration: input.expectedGeneration + 1,
    });
    job.cancelRequestedAt = null;
    job.provider = active.provider;
    job.connectionTier = active.connectionTier;
    job.modelTier = input.modelTier;
    this.models.set(job.id, input.model);
    const partials = job.meta.partials;
    if (restarted) {
      job.stepOutputs = {};
      job.meta = structuredClone(input.meta);
    } else {
      job.meta = structuredClone(partials && Object.keys(partials).length > 0 ? { ...input.meta, partials } : input.meta);
    }
    return { restarted, provider: active.provider, connectionTier: active.connectionTier, runGeneration: job.runGeneration };
  }

  /** ai_jobs.model as the last requeue set it (JobRecord has no model). */
  readonly models = new Map<string, string>();

  /** Simulates the user's cancel RPC. */
  requestCancel(jobId: string) {
    const job = this.jobs.get(jobId);
    if (job && ACTIVE.has(job.status) && !job.cancelRequestedAt) job.cancelRequestedAt = this.clock().toISOString();
  }

  /** Simulates sweep_stalled_ai_jobs for one job. */
  sweep(jobId: string) {
    const job = this.jobs.get(jobId);
    if (job && ACTIVE.has(job.status)) this.apply(job, { status: "failed", errorCode: "stalled", finishedAt: this.clock().toISOString() });
  }
}

export const TEST_PRICE: PriceRow = {
  version: "v-test",
  inputUsdPerMtok: 1,
  cachedInputUsdPerMtok: 0.1,
  cacheWriteUsdPerMtok: null,
  outputUsdPerMtok: 5,
  longContextThresholdTokens: null,
  longContextInputUsdPerMtok: null,
  longContextCachedInputUsdPerMtok: null,
  longContextCacheWriteUsdPerMtok: null,
  longContextOutputUsdPerMtok: null,
};

export class MemoryUsageStore implements UsageStore {
  readonly records: (UsageRecordRow & { userId: string })[] = [];
  failNext: Partial<Record<keyof UsageStore, number>> = {};
  priceLookups = 0;
  price: PriceRow | null = TEST_PRICE;

  constructor(private readonly userId: string) {}

  private maybeFail(method: keyof UsageStore) {
    const n = this.failNext[method] ?? 0;
    if (n > 0) {
      this.failNext[method] = n - 1;
      throw new Error(`fake ${method} failure`);
    }
  }

  async insert(row: UsageRecordRow) {
    this.maybeFail("insert");
    this.records.push({ ...structuredClone(row), userId: this.userId });
  }

  async priceFor() {
    this.maybeFail("priceFor");
    this.priceLookups++;
    return this.price;
  }

  async lastCallAt(provider: AiProvider) {
    this.maybeFail("lastCallAt");
    const own = this.records.filter((r) => r.provider === provider).map((r) => r.occurredAt);
    return own.length ? own.sort().at(-1)! : null;
  }

  forJob(jobId: string) {
    return this.records.filter((r) => r.aiJobId === jobId);
  }
}

// ---------------- scripted provider ----------------

export type ScriptedResponse =
  /** `delayMs`: answers after this many real ms and ignores the abort signal (a call the step left running). */
  | { json: unknown; usage?: Partial<NormalizedUsage>; delayMs?: number }
  | { error: AiErrorCode; retryAfterMs?: number; quotaResetsAt?: Date; usage?: Partial<NormalizedUsage> }
  | { errorAfterChunks: AiErrorCode; json: unknown; chunks: number }
  /** Never answers until the call's signal aborts (then: error event). */
  | { hang: true }
  /** The adapter itself throws a non-provider error (an SDK defect / unknown failure inside the call). */
  | { throwRaw: true };

const REPORTED: NormalizedUsage = {
  inputTokens: 1_000,
  cachedInputTokens: 0,
  cacheWriteTokens: 0,
  outputTokens: 200,
  reasoningTokens: null,
  usageSource: "provider_reported",
};

/** One provider adapter whose calls consume `responses` in order (shared across jobs). */
export function createScriptedAdapter(provider: AiProvider, responses: ScriptedResponse[], now: () => number) {
  const queue = [...responses];
  const calls: ProviderCallRequest[] = [];
  const err = (code: AiErrorCode, extra: { retryAfterMs?: number; quotaResetsAt?: Date } = {}) =>
    new ProviderError(code, {
      provider,
      retryAfter: extra.retryAfterMs !== undefined ? new Date(now() + extra.retryAfterMs) : undefined,
      quotaResetsAt: extra.quotaResetsAt,
    });
  const abortCode = (signal?: AbortSignal): AiErrorCode => (signal?.reason === "canceled" ? "canceled" : "timeout");

  async function* stream(call: ProviderCallRequest): AsyncGenerator<LlmStreamEvent> {
    calls.push(call);
    const response = queue.shift();
    if (!response) throw new Error("scripted adapter: no response left");
    if ("throwRaw" in response) throw new TypeError("unexpected SDK failure");
    if ("hang" in response) {
      await new Promise<void>((resolve) => {
        if (call.signal?.aborted) return resolve();
        call.signal?.addEventListener("abort", () => resolve(), { once: true });
      });
      yield { type: "error", error: err(abortCode(call.signal)), usage: UNAVAILABLE_USAGE };
      return;
    }
    if ("error" in response) {
      const usage = response.usage ? { ...REPORTED, ...response.usage } : UNAVAILABLE_USAGE;
      yield { type: "error", error: err(response.error, response).with({ usage }), usage };
      return;
    }
    const text = JSON.stringify(response.json);
    if ("delayMs" in response && response.delayMs) await new Promise((r) => setTimeout(r, response.delayMs));
    if ("errorAfterChunks" in response) {
      for (let i = 0; i < response.chunks; i++) yield { type: "delta", text: text.slice(i, i + 1) };
      const usage = { ...REPORTED, outputTokens: response.chunks };
      yield { type: "error", error: err(response.errorAfterChunks).with({ beforeFirstToken: response.chunks === 0, usage }), usage };
      return;
    }
    yield { type: "delta", text };
    const result: AiCallResult = { text, model: call.model, usage: { ...REPORTED, ...response.usage }, latencyMs: 5 };
    yield { type: "done", result };
  }

  const adapter: ProviderAdapter = {
    id: provider,
    stream,
    async complete(call) {
      for await (const event of stream(call)) {
        if (event.type === "done") return event.result;
        if (event.type === "error") throw event.error;
      }
      throw new ProviderError("provider_unavailable", { provider, unclassified: true });
    },
    verify: async () => ({ ok: true, usage: REPORTED }),
  };
  return { adapter, calls, remaining: () => queue.length };
}

/** RunnerDeps.createLlm over the real createLlm + a scripted adapter. */
export function scriptedLlmFactory(adapter: ProviderAdapter, now: () => number) {
  return (input: LlmFactoryInput): Llm =>
    createLlm({ ...input, logger: silentAiLogger, now, adapters: { [input.provider]: adapter } });
}

// ---------------- misc ----------------

/** A controllable clock: `advance(ms)` moves time forward (wall clock for the runner). */
export function fakeClock(start = new Date("2026-10-28T00:00:00.000Z")) {
  let t = start.getTime();
  return {
    now: () => new Date(t),
    ms: () => t,
    advance: (ms: number) => {
      t += ms;
    },
  };
}

export function memoryScope(
  store: MemoryJobStore,
  usage: MemoryUsageStore,
  keys: { keySource: KeySource; keyStatus: KeyStatusReporter },
): UserScope {
  return { store, usage, keySource: keys.keySource, keyStatus: keys.keyStatus, db: {} as AiWriterSupabaseClient };
}
