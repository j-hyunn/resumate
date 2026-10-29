import { randomUUID } from "node:crypto";
import { failureCauseOf, type StoredAiJobProgress } from "@/lib/contracts/ai";
import type { AiErrorCode, AiJobType, ModelTier } from "@/lib/contracts/enums";
import { AppError } from "@/lib/contracts/errors";
import { AiError, ProviderError, finalRetryAfter, isAiError, isProviderError } from "@/server/ai/errors";
import type { Llm } from "@/server/ai/llm";
import { resolveModel } from "@/server/ai/providers/models";
import { FREE_TIER_MIN_INTERVAL_MS, HEARTBEAT_INTERVAL_MS, MIN_STEP_TIMEOUT_MS, USAGE_SETTLE_GRACE_MS } from "@/server/jobs/constants";
import { isKeyFailureCause, type KeySource, type KeyStatusReporter, type ProviderContextSource } from "@/server/jobs/provider-context";
import { decideRetry } from "@/server/jobs/retry";
import type { JobPatch, JobRecord, JobStore, LlmFactoryInput, UsageStore } from "@/server/jobs/types";
import { createPriceCache, createUsageRecorder } from "@/server/jobs/usage-recorder";

/**
 * One AI job that runs inside a request (S7: AI-11 sync ranking, AI-03 / AI-04
 * SSE generation). Same lifecycle as the S5 sync extraction and the S4 turn,
 * factored out once for the three S7 paths:
 *
 *   openAiJob: connection gate (active provider, key; F-AI-08 lock) → ai_jobs
 *   insert (one in flight per target; a dead invocation is closed `stalled` and
 *   replaced) → claim → run gate (check_ai_run_allowed, QA-S3b-01).
 *
 *   AiRun: heartbeat (cancel_requested → abort "canceled", job gone → "lost"),
 *   one Llm per call with the usage recorder (C-13: one row per provider call),
 *   immediate / short inline retries per C-11.3 (no next_run_at inside a
 *   request), streaming retried only before the first event reached the client,
 *   finish (complete / failed / canceled), settle, key status report.
 *
 * Client disconnect does NOT abort a run (S7 plan "계약 — API" 2, spec-gaps
 * S5 ③): the user's tokens are already spent and the result is shown on the
 * next visit. Stopping is `POST /api/ai-jobs/{id}/cancel` (heartbeat) or the budget.
 *
 * C-7: logs carry ids, codes, counts only.
 */

export type Log = (event: string, fields: Record<string, string | number | boolean | null>) => void;

export type AiRunDeps = {
  userId: string;
  store: JobStore;
  usage: UsageStore;
  providerContext: ProviderContextSource;
  keySource: KeySource;
  keyStatus: KeyStatusReporter;
  /** check_ai_run_allowed (app_ai_writer); null = allowed (dev-env mode). */
  runGate: ((jobId: string) => Promise<AiErrorCode | null>) | null;
  createLlm: (input: LlmFactoryInput) => Llm;
  now?: () => Date;
  newId?: () => string;
  sleep?: (ms: number, signal: AbortSignal) => Promise<void>;
  log?: Log;
};

export type CallFailure = { code: AiErrorCode; retryAfter: string | null; quotaResetsAt: string | null };

export type OpenJobSpec = {
  jobType: AiJobType;
  targetType: string;
  targetId: string;
  applicationProjectId: string | null;
  modelTier: ModelTier;
  params: Record<string, unknown>;
  inputHash: string | null;
  promptVersion: string | null;
  progress: StoredAiJobProgress;
};

export type OpenJobResult = { kind: "ready"; job: JobRecord } | { kind: "blocked"; code: AiErrorCode; jobId: string | null };

/** In-flight job of the same target without a heartbeat for this long is a dead invocation (maxDuration 60 s). */
export const DEAD_RUN_AFTER_MS = 75_000;

function gateCode(err: unknown): AiErrorCode | null {
  if (err instanceof AppError) {
    if (err.code === "ai_consent_required" || err.code === "key_missing" || err.code === "ai_not_connected") return "key_missing";
    if (err.code === "key_invalid") return "key_invalid";
  }
  return null;
}

export function defaultSleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    if (signal.aborted || ms <= 0) return resolve();
    const timer = setTimeout(done, ms);
    function done() {
      clearTimeout(timer);
      signal.removeEventListener("abort", done);
      resolve();
    }
    signal.addEventListener("abort", done, { once: true });
  });
}

/**
 * Connection gate + job row. `inProgress` builds the 409 for a live job on the
 * same target (D-34 동시 실행 1개). Never calls a provider.
 */
export async function openAiJob(deps: AiRunDeps, spec: OpenJobSpec, inProgress: () => AppError): Promise<OpenJobResult> {
  const now = deps.now ?? (() => new Date());
  const log = deps.log ?? (() => {});
  let context;
  try {
    context = await deps.providerContext.forUser(deps.userId);
  } catch (err) {
    const code = gateCode(err);
    if (code) return { kind: "blocked", code, jobId: null };
    throw err;
  }
  if (!context) return { kind: "blocked", code: "key_missing", jobId: null };
  if (context.keyStatus === "invalid") return { kind: "blocked", code: "key_invalid", jobId: null };

  const target = { type: spec.targetType, id: spec.targetId };
  const insert = async (): Promise<string> => {
    const id = (deps.newId ?? randomUUID)();
    await deps.store.insert({
      id,
      userId: deps.userId,
      jobType: spec.jobType,
      applicationProjectId: spec.applicationProjectId,
      targetType: spec.targetType,
      targetId: spec.targetId,
      provider: context.provider,
      modelTier: spec.modelTier,
      connectionTier: context.connectionTier,
      params: spec.params,
      inputHash: spec.inputHash,
      promptVersion: spec.promptVersion,
      model: resolveModel(context.provider, spec.modelTier),
      progress: spec.progress,
      meta: { runBase: 1, waitBase: 0, retries: {} },
    });
    return id;
  };

  let jobId: string;
  try {
    jobId = await insert();
  } catch (err) {
    if (!(err instanceof AppError && err.code === "conflict")) throw err;
    const other = await deps.store.findInFlight({ userId: deps.userId, jobType: spec.jobType, target, inputHash: null, applicationProjectId: null });
    const otherJob = other ? await deps.store.get(other.id) : null;
    const lastBeat = otherJob ? Date.parse(otherJob.heartbeatAt ?? otherJob.createdAt) : NaN;
    if (otherJob && !(now().getTime() - lastBeat > DEAD_RUN_AFTER_MS)) throw inProgress();
    if (otherJob) {
      // A dead invocation (function killed mid-stream): close it and start again.
      log("draft_ai.dead_run_closed", { jobId: otherJob.id });
      await deps.store.finish(otherJob.id, otherJob.runGeneration, { status: "failed", errorCode: "stalled", finishedAt: now().toISOString(), nextRunAt: null });
    }
    try {
      jobId = await insert();
    } catch (again) {
      if (again instanceof AppError && again.code === "conflict") throw inProgress();
      throw again;
    }
  }

  const job = await deps.store.claim(jobId, { now: now().toISOString(), staleBefore: new Date(now().getTime() + 1_000).toISOString() });
  if (!job) throw new AppError("internal_error", undefined, { status: 500 });

  if (deps.runGate) {
    let gate: AiErrorCode | null;
    try {
      gate = await deps.runGate(jobId);
    } catch (err) {
      await finishQuietly(deps, job, "failed", "stalled");
      throw err;
    }
    if (gate) {
      await finishQuietly(deps, job, "failed", gate);
      return { kind: "blocked", code: gate, jobId };
    }
  }
  return { kind: "ready", job };
}

async function finishQuietly(deps: AiRunDeps, job: JobRecord, status: "failed" | "canceled", code: AiErrorCode, times: { retryAfter?: string | null; quotaResetsAt?: string | null } = {}) {
  const at = (deps.now ?? (() => new Date()))().toISOString();
  try {
    return await deps.store.finish(job.id, job.runGeneration, {
      status,
      errorCode: code,
      finishedAt: at,
      heartbeatAt: at,
      nextRunAt: null,
      retryAfter: times.retryAfter ?? null,
      quotaResetsAt: times.quotaResetsAt ?? null,
    });
  } catch {
    (deps.log ?? (() => {}))("draft_ai.close_failed", { jobId: job.id });
    return false;
  }
}

/** Deadline + run abort for one call. Aborts with "canceled" (user / lost) or "timeout". */
function callSignal(parent: AbortSignal, timeoutMs: number): { signal: AbortSignal; clear: () => void } {
  const controller = new AbortController();
  const onParent = () => controller.abort(parent.reason === "timeout" ? "timeout" : "canceled");
  if (parent.aborted) onParent();
  else parent.addEventListener("abort", onParent, { once: true });
  const timer = setTimeout(() => controller.abort("timeout"), Math.max(0, timeoutMs));
  return {
    signal: controller.signal,
    clear: () => {
      clearTimeout(timer);
      parent.removeEventListener("abort", onParent);
    },
  };
}

function toFailure(err: unknown, signal: AbortSignal): AiError {
  if (isProviderError(err)) return err;
  if (signal.aborted) return new AiError(signal.reason === "canceled" ? "canceled" : "timeout");
  if (isAiError(err)) return err;
  // Not a provider error (our bug, DB error): no retry (QA-S3a-02).
  return new AiError("stalled", { retryable: false });
}

/** The error event a streaming pipeline yields (src/server/ai/streaming/events.ts). */
type PipelineErrorEvent = {
  type: "error";
  code: AiErrorCode | "internal_error";
  retryable: boolean;
  retryAfter: string | null;
  quotaResetsAt: string | null;
};

export type StreamEventLike = { type: string };

export type AiRunTiming = {
  /** Calls (and inline retry waits) end by start + this. */
  budgetMs: number;
  heartbeatMs: number;
  minCallMs: number;
  /** Retry waits taken inside the request only up to this (else final failure with retry_after). */
  maxInlineWaitMs: number;
  usageSettleMs: number;
  /** C-12 free-tier minimum spacing per user and provider. */
  freeTierSpacingMs: number;
};

export const DEFAULT_RUN_TIMING: AiRunTiming = {
  budgetMs: 50_000,
  heartbeatMs: HEARTBEAT_INTERVAL_MS,
  minCallMs: MIN_STEP_TIMEOUT_MS,
  maxInlineWaitMs: 5_000,
  usageSettleMs: USAGE_SETTLE_GRACE_MS,
  freeTierSpacingMs: FREE_TIER_MIN_INTERVAL_MS,
};

export class AiRun {
  readonly job: JobRecord;
  private readonly deps: AiRunDeps;
  private readonly timing: AiRunTiming;
  private readonly abort = new AbortController();
  private readonly beat: ReturnType<typeof setInterval>;
  private readonly llms: Llm[] = [];
  private readonly onCall: LlmFactoryInput["onCall"];
  /** End of this run's last provider call (C-12 spacing). */
  private lastCallEndMs: number | null = null;
  private readonly keyErrors: AiError[] = [];
  private readonly deadline: number;
  private finalCode: AiErrorCode | null = null;
  private succeeded = false;
  private keyReportSkipped = false;
  lost = false;

  constructor(deps: AiRunDeps, job: JobRecord, timing: Partial<AiRunTiming> = {}, startedAt?: number) {
    this.deps = deps;
    this.job = job;
    this.timing = { ...DEFAULT_RUN_TIMING, ...timing };
    this.deadline = (startedAt ?? this.now().getTime()) + this.timing.budgetMs;
    const record = createUsageRecorder({ store: deps.usage, job, priceFor: createPriceCache(deps.usage), now: () => this.now(), log: this.log });
    this.onCall = async (r: Parameters<typeof record>[0]) => {
      this.lastCallEndMs = (r.occurredAt ?? this.now()).getTime();
      await record(r);
    };
    this.beat = setInterval(() => {
      void deps.store
        .heartbeat(job.id, job.runGeneration, this.now().toISOString())
        .then((h) => {
          if (!h.current) {
            this.lost = true;
            this.abort.abort("lost");
          } else if (h.cancelRequested) {
            this.abort.abort("canceled");
          }
        })
        .catch(() => this.log("draft_ai.heartbeat_failed", { jobId: job.id }));
    }, this.timing.heartbeatMs);
  }

  get signal(): AbortSignal {
    return this.abort.signal;
  }

  private now(): Date {
    return (this.deps.now ?? (() => new Date()))();
  }

  private get log(): Log {
    return this.deps.log ?? (() => {});
  }

  remaining(): number {
    return this.deadline - this.now().getTime();
  }

  private makeLlm(tier: ModelTier, signal: AbortSignal): Llm {
    const llm = this.deps.createLlm({
      provider: this.job.provider,
      tier,
      connectionTier: this.job.connectionTier,
      keySource: { forJob: (id: string) => this.deps.keySource.forJob(id, this.job.provider) },
      jobId: this.job.id,
      signal,
      onCall: this.onCall,
    });
    this.llms.push(llm);
    if (this.job.connectionTier !== "free") return llm;
    // C-12 (QA-S7-03): free tier keeps a minimum spacing per user and provider before EVERY call of this
    // run — the first one (vs. the D-30 extraction or the previous question's request, from the persisted
    // usage records) and the ones a pipeline makes on the same Llm (AI-04 generate → adjust).
    const space = (request: { signal?: AbortSignal }) => this.spaceCall(request.signal ?? signal);
    return {
      provider: llm.provider,
      tier: llm.tier,
      connectionTier: llm.connectionTier,
      modelFor: (t) => llm.modelFor(t),
      settle: (ms, grace) => llm.settle(ms, grace),
      async complete(request) {
        await space(request);
        return llm.complete(request);
      },
      async *stream(request) {
        await space(request);
        yield* llm.stream(request);
      },
    };
  }

  /**
   * Waits until the free-tier spacing since the user's last call to this provider has passed
   * (in-request wait, at most FREE_TIER_MIN_INTERVAL_MS). Throws `timeout` when the wait would leave
   * less than a call's minimum — an AI-04 adjust call then keeps the first text (ai ④).
   */
  private async spaceCall(signal: AbortSignal): Promise<void> {
    let last = this.lastCallEndMs;
    try {
      const persisted = await this.deps.usage.lastCallAt(this.job.provider);
      if (persisted) last = Math.max(last ?? 0, Date.parse(persisted));
    } catch {
      this.log("draft_ai.last_call_lookup_failed", { jobId: this.job.id });
    }
    if (last === null) return;
    const wait = Math.min(last + this.timing.freeTierSpacingMs - this.now().getTime(), this.timing.freeTierSpacingMs);
    if (wait <= 0) return;
    if (this.remaining() - wait < this.timing.minCallMs) throw new AiError("timeout");
    this.log("draft_ai.free_tier_spacing", { jobId: this.job.id, waitMs: wait });
    await (this.deps.sleep ?? defaultSleep)(wait, signal);
    if (signal.aborted) throw new AiError(signal.reason === "canceled" ? "canceled" : "timeout");
  }

  private noteKeyError(err: AiError) {
    if (err.code === "key_invalid" || isKeyFailureCause(failureCauseOf(err.code))) this.keyErrors.push(err);
  }

  private failureOf(err: AiError, retries: number, decided?: { quotaResetsAt: Date | null }): CallFailure {
    const retryAfter = finalRetryAfter(err, retries, this.now().getTime());
    const quotaResetsAt = decided?.quotaResetsAt ?? (isProviderError(err) ? (err.quotaResetsAt ?? null) : null);
    return { code: err.code, retryAfter: retryAfter?.toISOString() ?? null, quotaResetsAt: quotaResetsAt?.toISOString() ?? null };
  }

  /** Retry decision shared by `call` and `stream`: "now" / wait ms / null (= final). */
  private async retryStep(err: AiError, retries: number): Promise<{ again: boolean; quotaResetsAt: Date | null }> {
    const decision = decideRetry({ error: err, retriesSoFar: retries, waitUsedMs: 0, now: this.now(), random: () => 0 });
    const canRetry = !this.abort.signal.aborted && err.code !== "canceled";
    if (canRetry && decision.kind === "retry_now" && this.remaining() >= this.timing.minCallMs) return { again: true, quotaResetsAt: null };
    if (
      canRetry &&
      decision.kind === "retry_at" &&
      decision.waitMs <= this.timing.maxInlineWaitMs &&
      this.remaining() - decision.waitMs >= this.timing.minCallMs
    ) {
      await (this.deps.sleep ?? defaultSleep)(decision.waitMs, this.abort.signal);
      return { again: !this.abort.signal.aborted, quotaResetsAt: null };
    }
    return { again: false, quotaResetsAt: decision.kind === "fail" ? decision.quotaResetsAt : null };
  }

  /**
   * One non-streaming logical call with C-11.3 inline retries. Never throws for
   * provider / pipeline failures; returns the final failure instead.
   */
  async call<T>(opts: {
    tier: ModelTier;
    timeoutMs: number;
    callKey: string;
    run: (input: { llm: Llm; signal: AbortSignal; callKey: string; attempt: number }) => Promise<T>;
  }): Promise<{ ok: true; value: T } | { ok: false; failure: CallFailure }> {
    const retries: Partial<Record<AiErrorCode, number>> = {};
    for (let attempt = 1; ; attempt++) {
      if (this.abort.signal.aborted) return { ok: false, failure: { code: "canceled", retryAfter: null, quotaResetsAt: null } };
      const room = this.remaining();
      if (room < this.timing.minCallMs && attempt > 1) return { ok: false, failure: { code: "timeout", retryAfter: null, quotaResetsAt: null } };
      const cs = callSignal(this.abort.signal, Math.min(opts.timeoutMs, Math.max(room, this.timing.minCallMs)));
      try {
        const llm = this.makeLlm(opts.tier, cs.signal);
        const value = await opts.run({ llm, signal: cs.signal, callKey: opts.callKey, attempt });
        return { ok: true, value };
      } catch (thrown) {
        const err = toFailure(thrown, cs.signal);
        this.noteKeyError(err);
        if (!isAiError(thrown)) this.log("draft_ai.unclassified_error", { jobId: this.job.id });
        const n = retries[err.code] ?? 0;
        const step = await this.retryStep(err, n);
        if (step.again) {
          retries[err.code] = n + 1;
          this.log("draft_ai.retry", { jobId: this.job.id, code: err.code });
          continue;
        }
        return { ok: false, failure: this.failureOf(err, n, step) };
      } finally {
        cs.clear();
      }
    }
  }

  /**
   * One streaming logical call. Events other than the terminal ones go to
   * `onEvent` (→ SSE). Retried (C-11.3) only when nothing reached the client
   * yet. Returns the non-terminal `validated` / terminal `done` events of the
   * successful attempt.
   */
  async stream<E extends StreamEventLike>(opts: {
    tier: ModelTier;
    timeoutMs: number;
    callKey: string;
    run: (input: { llm: Llm; signal: AbortSignal; callKey: string; attempt: number }) => AsyncIterable<E>;
    onEvent: (event: E) => void;
    /** Events held back from the client (still collected in `held`). Default: validated + done. */
    hold?: readonly string[];
  }): Promise<{ ok: true; held: E[] } | { ok: false; failure: CallFailure; emitted: boolean }> {
    const hold = opts.hold ?? ["validated", "done"];
    const retries: Partial<Record<AiErrorCode, number>> = {};
    let emittedAny = false;
    for (let attempt = 1; ; attempt++) {
      if (this.abort.signal.aborted) return { ok: false, failure: { code: "canceled", retryAfter: null, quotaResetsAt: null }, emitted: emittedAny };
      const room = this.remaining();
      if (room < this.timing.minCallMs && attempt > 1) return { ok: false, failure: { code: "timeout", retryAfter: null, quotaResetsAt: null }, emitted: emittedAny };
      const cs = callSignal(this.abort.signal, Math.min(opts.timeoutMs, Math.max(room, this.timing.minCallMs)));
      let emitted = false;
      const held: E[] = [];
      let err: AiError | null = null;
      let done = false;
      try {
        const llm = this.makeLlm(opts.tier, cs.signal);
        for await (const event of opts.run({ llm, signal: cs.signal, callKey: opts.callKey, attempt })) {
          if (event.type === "error") {
            const e = event as unknown as PipelineErrorEvent;
            err =
              e.code === "internal_error"
                ? new AiError("stalled", { retryable: false })
                : new ProviderError(e.code, {
                    retryAfter: e.retryAfter ? new Date(e.retryAfter) : undefined,
                    quotaResetsAt: e.quotaResetsAt ? new Date(e.quotaResetsAt) : undefined,
                    beforeFirstToken: !emitted,
                    retryable: e.retryable,
                  });
            break;
          }
          if (hold.includes(event.type)) {
            held.push(event);
            if (event.type === "done") {
              done = true;
              break;
            }
            continue;
          }
          emitted = true;
          emittedAny = true;
          opts.onEvent(event);
        }
        if (!done && !err) err = toFailure(new Error("stream ended without a terminal event"), cs.signal);
      } catch (thrown) {
        err = toFailure(thrown, cs.signal);
        if (!isAiError(thrown)) this.log("draft_ai.unclassified_error", { jobId: this.job.id });
      } finally {
        cs.clear();
      }
      if (done && !err) return { ok: true, held };

      const failure = err!;
      // A cut call reports as canceled when the run was canceled (not as the provider's abort error).
      const final = this.abort.signal.aborted && this.abort.signal.reason !== "timeout" ? new AiError("canceled") : failure;
      this.noteKeyError(final);
      const n = retries[final.code] ?? 0;
      if (!emitted) {
        const step = await this.retryStep(final, n);
        if (step.again) {
          retries[final.code] = n + 1;
          this.log("draft_ai.retry", { jobId: this.job.id, code: final.code });
          continue;
        }
        return { ok: false, failure: this.failureOf(final, n, step), emitted: emittedAny };
      }
      return { ok: false, failure: this.failureOf(final, n), emitted: emittedAny };
    }
  }

  /**
   * QA-S7-09: whether the run was stopped from outside — cancel requested (user stop, project / draft
   * delete, career delete with delete_results) or the job row is gone. A failure seen after that is a
   * cancel, not a system error.
   */
  async stoppedFromOutside(): Promise<boolean> {
    if (this.lost || (this.abort.signal.aborted && this.abort.signal.reason !== "timeout")) return true;
    try {
      const job = await this.deps.store.get(this.job.id);
      return !job || job.cancelRequestedAt !== null;
    } catch {
      return false;
    }
  }

  /** Persist meta, then succeeded (complete_ai_job). */
  async succeed(progress: StoredAiJobProgress, patch: JobPatch = {}): Promise<boolean> {
    this.succeeded = true;
    try {
      if (Object.keys(patch).length > 0) await this.deps.store.update(this.job.id, this.job.runGeneration, { ...patch, heartbeatAt: this.now().toISOString() });
      const ok = await this.deps.store.complete(this.job.id, this.job.runGeneration, progress);
      if (!ok) this.log("draft_ai.complete_failed", { jobId: this.job.id, lost: this.lost });
      return ok;
    } catch {
      this.log("draft_ai.complete_failed", { jobId: this.job.id, lost: this.lost });
      return false;
    }
  }

  /** failed (or canceled for `canceled` / lost). */
  async fail(failure: CallFailure, opts: { reportKeyStatus?: boolean } = {}): Promise<void> {
    // A failure reported by someone else (D-30 extraction reports its own key status) isn't reported twice.
    if (opts.reportKeyStatus !== false) this.finalCode = failure.code;
    else this.keyReportSkipped = true;
    if (this.lost) return;
    const canceled = failure.code === "canceled";
    await finishQuietly(this.deps, this.job, canceled ? "canceled" : "failed", failure.code, failure);
  }

  /** Always call once at the end: stops the heartbeat, settles usage (one record per call), reports key status. */
  async close(): Promise<void> {
    clearInterval(this.beat);
    await Promise.all(this.llms.map((l) => l.settle(this.timing.usageSettleMs).catch(() => undefined)));
    try {
      if (this.keyErrors.some((e) => e.code === "key_invalid")) await this.deps.keyStatus.markInvalid(this.job.id);
      else if (this.keyReportSkipped) {
        // nothing: the failing sub-run reported it
      } else if (this.finalCode) {
        const cause = failureCauseOf(this.finalCode);
        if (isKeyFailureCause(cause) && cause !== "key_invalid") await this.deps.keyStatus.recordFailure(this.job.id, cause);
      } else if (this.succeeded) await this.deps.keyStatus.recordSuccess(this.job.id);
    } catch {
      this.log("draft_ai.key_status_report_failed", { jobId: this.job.id });
    }
    this.log("draft_ai.finished", { jobId: this.job.id, jobType: this.job.jobType, result: this.finalCode ?? (this.succeeded ? "ok" : "none"), calls: this.llms.length });
  }

  /** Number of provider-call wrappers created (tests / logs). */
  get callCount(): number {
    return this.llms.length;
  }
}

/** Raise names meaning the row this run writes was deleted or reset meanwhile (QA-S7-09). */
const TARGET_GONE_RAISES = new Set(["draft_not_found", "section_not_found", "invalid_ai_job", "application_project_not_found"]);

export function isTargetGone(err: unknown): boolean {
  const raise = (err as { raise?: unknown } | null)?.raise;
  return typeof raise === "string" && TARGET_GONE_RAISES.has(raise);
}

/** A failure after an outside stop (or with the target gone) is reported as `canceled` (QA-S7-09). */
export async function asCancelIfStopped(run: AiRun, failure: CallFailure, targetGone: boolean): Promise<CallFailure> {
  if (failure.code === "canceled") return failure;
  if (targetGone || (await run.stoppedFromOutside())) return { code: "canceled", retryAfter: null, quotaResetsAt: null };
  return failure;
}
