import { randomUUID } from "node:crypto";
import { errorCategoryOf, type StartAiJobResponse } from "@/lib/contracts/ai";
import type { AiErrorCode, AiJobType, UsageReason } from "@/lib/contracts/enums";
import { AppError } from "@/lib/contracts/errors";
import { isAiError, mapSdkError } from "@/server/ai/errors";
import {
  CONTINUE_CLAIM_GRACE_MS,
  HEARTBEAT_INTERVAL_MS,
  INVOCATION_BUDGET_MS,
  LEDGER_SETTLE_TRIES,
  MAX_STEP_ATTEMPTS,
  STALLED_AFTER_MS,
  STEP_TIMEOUT_MS,
} from "./constants";
import type {
  JobRecord,
  JobRef,
  JobStep,
  JobTypeDefinition,
  JsonObject,
  RunOutcome,
  RunnerDeps,
  RunnerTiming,
  UserScope,
} from "./types";

/**
 * ai_jobs lifecycle (AI C-6 비동기 작업, backend-context "AI job runner").
 *
 *   startJob:  [reuse by input_hash] → reserve usage (job id generated here)
 *              → insert ai_jobs `queued` → schedule(runJob)
 *   runJob:    claim queued→running → for each incomplete step: progress +
 *              heartbeat, run with deadline/cancel guards, checkpoint result
 *              → complete_ai_job (succeeded + charge, one transaction)
 *              | failed/canceled + release
 *              (retry a failed step once; yield to a new invocation near the
 *              60 s budget; resume skips checkpointed steps)
 *
 * Ledger rule: every reservation ends charged or released on every exit path —
 * charged only by complete_ai_job (with succeeded), released on every other end —
 * including thrown errors, cancel, timeout, and losing the job to the stalled sweep.
 */

export type StartJobInput = {
  userId: string;
  jobType: AiJobType;
  params?: JsonObject;
  target?: { type: string; id: string } | null;
  applicationProjectId?: string | null;
  inputHash?: string | null;
  promptVersion?: string | null;
  model?: string | null;
  reason?: UsageReason;
  /** "다시 생성" (explicit regenerate): skip input_hash reuse and charge again (C-6 [가정]). */
  regenerate?: boolean;
};

type Failure = { code: AiErrorCode; retryable: boolean } | { lost: true };

const DEFAULT_TIMING: RunnerTiming = {
  invocationBudgetMs: INVOCATION_BUDGET_MS,
  stepTimeoutMs: STEP_TIMEOUT_MS,
  heartbeatIntervalMs: HEARTBEAT_INTERVAL_MS,
};

/** Abort reasons used on the step signal (same convention as src/server/ai/errors `signalReason`). */
const ABORT_CANCELED = "canceled";
const ABORT_TIMEOUT = "timeout";
const ABORT_LOST = "lost";

/** A conditional write matched nothing: another actor or a newer generation owns the job. */
class LostJob extends Error {
  constructor() {
    super("ai job lost");
    this.name = "LostJob";
  }
}

class StepAborted extends Error {
  constructor(readonly reason: string) {
    super(`step aborted: ${reason}`);
    this.name = "StepAborted";
  }
}

/**
 * Maps whatever a step threw to a C-6 code.
 * Unknown errors (bugs, DB errors inside a step) → `model_unavailable`, retried
 * once [가정]: ai_jobs.error_code has no internal code, and the user-facing
 * category "일시적" + retry is the right copy for them.
 */
export function classifyStepError(err: unknown, signal: AbortSignal): Failure {
  if (signal.aborted) {
    const reason = typeof signal.reason === "string" ? signal.reason : ABORT_TIMEOUT;
    if (reason === ABORT_LOST) return { lost: true };
    if (reason === ABORT_CANCELED) return { code: "canceled", retryable: false };
    return { code: "timeout", retryable: true };
  }
  if (isAiError(err)) return { code: err.code, retryable: err.retryable };
  const mapped = mapSdkError(err, signal);
  if (mapped) return { code: mapped.code, retryable: mapped.retryable };
  return { code: "model_unavailable", retryable: true };
}

function resolveUsage(def: JobTypeDefinition<unknown>, params: JsonObject) {
  if (!def.usage) return null;
  const usage = typeof def.usage === "function" ? def.usage(params) : def.usage;
  if (!usage || usage.units <= 0) return null;
  return usage;
}

function isActive(status: string): boolean {
  return status === "queued" || status === "running";
}

export function createJobRunner<TAi>(deps: RunnerDeps<TAi>) {
  const now = deps.now ?? (() => new Date());
  const timing: RunnerTiming = { ...DEFAULT_TIMING, ...deps.timing };
  const iso = () => now().toISOString();
  const log = deps.log ?? (() => {});

  function definitionOf(jobType: AiJobType): JobTypeDefinition<TAi> {
    const def = deps.getDefinition(jobType);
    if (!def) throw new AppError("internal_error", undefined, { status: 500, cause: new Error(`unknown job type ${jobType}`) });
    return def;
  }

  /** Releases ONE reservation (QA-S3-01), retried on blips. Null = no-charge job. */
  async function release(scope: UserScope<TAi>, jobId: string, usageEventId: string | null): Promise<boolean> {
    if (!usageEventId) return true;
    for (let i = 1; i <= LEDGER_SETTLE_TRIES; i++) {
      try {
        await scope.ledger.release(usageEventId);
        return true;
      } catch {
        // retry below; the error body may contain DB internals, so it isn't logged
      }
    }
    // Stays `reserved`: the stalled sweep releases leftovers of failed/canceled/missing jobs.
    log("ai_job.ledger_release_failed", { jobId });
    return false;
  }

  // ---------------- start / retry ----------------

  async function startJob(input: StartJobInput): Promise<StartAiJobResponse> {
    const def = definitionOf(input.jobType);
    const scope = deps.forUser(input.userId);
    const params = input.params ?? {};
    const applicationProjectId = input.applicationProjectId ?? null;
    const scopeQuery = input.inputHash
      ? { userId: input.userId, applicationProjectId, jobType: input.jobType, inputHash: input.inputHash }
      : null;

    if (scopeQuery) {
      // Same input already running (double click, resubmit): follow that job, no new usage (QA-S3-03).
      const inFlight = await scope.store.findInFlight(scopeQuery);
      if (inFlight) return { jobId: inFlight.id, reused: false, inProgress: true };
      if (!input.regenerate) {
        const reusable = await scope.store.findReusable(scopeQuery);
        if (reusable) return { jobId: reusable.id, reused: true, inProgress: false };
      }
    }

    // The id exists before the row so the reservation can point at it, and a
    // limit_reached leaves no job row behind.
    const jobId = randomUUID();
    const usage = resolveUsage(def as JobTypeDefinition<unknown>, params);
    const usageEventId = usage
      ? await scope.ledger.reserve({
          feature: usage.feature,
          units: usage.units,
          reason: input.reason ?? (input.regenerate ? "explicit_regenerate" : "initial"),
          jobId,
        })
      : null;

    try {
      await scope.store.insert({
        id: jobId,
        userId: input.userId,
        jobType: input.jobType,
        applicationProjectId,
        targetType: input.target?.type ?? null,
        targetId: input.target?.id ?? null,
        params,
        inputHash: input.inputHash ?? null,
        promptVersion: input.promptVersion ?? null,
        model: input.model ?? null,
        progress: { stage: def.steps[0]?.stage ?? null, done: 0, total: def.steps[0]?.total ?? 1 },
        meta: { usageEventId, runBase: 1 },
      });
    } catch (err) {
      await release(scope, jobId, usageEventId);
      // Lost the double-start race on the unique in-flight index: follow the winner.
      if (scopeQuery && err instanceof AppError && err.code === "conflict") {
        const inFlight = await scope.store.findInFlight(scopeQuery);
        if (inFlight) return { jobId: inFlight.id, reused: false, inProgress: true };
      }
      throw err;
    }

    log("ai_job.created", { jobId, jobType: input.jobType });
    scheduleRun({ jobId, userId: input.userId });
    return { jobId, reused: false, inProgress: false };
  }

  /**
   * Manual retry (재시도 버튼) of a failed job (decisions QA-S3-01):
   * 1. claim failed → queued (attempt_count = seen, conditional) — only the
   *    winner touches the ledger; losers return the job's current state.
   * 2. winner releases leftover reservations of the job, then reserves anew.
   * 3. checkpoints are kept, so it resumes from the failed step (C-6).
   */
  async function retryJob(ref: JobRef): Promise<StartAiJobResponse> {
    const scope = deps.forUser(ref.userId);
    const job = await scope.store.get(ref.jobId);
    if (!job) throw new AppError("not_found");
    const notRetryable = () => new AppError("ai_job_not_retryable", "다시 시도할 수 없는 작업입니다.", { status: 409 });
    const followCurrent = async (): Promise<StartAiJobResponse> => {
      const current = await scope.store.get(ref.jobId);
      if (current && isActive(current.status)) return { jobId: current.id, reused: false, inProgress: true };
      throw notRetryable();
    };
    if (isActive(job.status)) return { jobId: job.id, reused: false, inProgress: true };
    if (job.status !== "failed" || !job.errorCode || errorCategoryOf(job.errorCode) === "input") throw notRetryable();

    const def = definitionOf(job.jobType);
    const usage = resolveUsage(def as JobTypeDefinition<unknown>, job.params);
    const gen = job.attemptCount + 1;
    const won = await scope.store.requeueFailed(job.id, job.attemptCount, iso(), job.stepOutputs, { usageEventId: null, runBase: gen });
    if (!won) return followCurrent();

    const revert = async () => {
      try {
        await scope.store.finish(job.id, gen, { status: "failed", errorCode: job.errorCode, finishedAt: iso() });
      } catch {
        log("ai_job.retry_revert_failed", { jobId: job.id });
      }
    };

    let usageEventId: string | null = null;
    if (usage) {
      try {
        // Leftovers of earlier runs must not linger next to the new reservation.
        await scope.ledger.releaseJob(job.id);
        usageEventId = await scope.ledger.reserve({ feature: usage.feature, units: usage.units, reason: "initial", jobId: job.id });
      } catch (err) {
        await revert();
        throw err;
      }
      let saved = false;
      try {
        saved = await scope.store.saveStepOutputs(job.id, gen, job.stepOutputs, { usageEventId, runBase: gen });
      } catch (err) {
        await release(scope, job.id, usageEventId);
        await revert();
        throw err;
      }
      if (!saved) {
        // Canceled in between: our reservation is ours alone to release.
        await release(scope, job.id, usageEventId);
        return followCurrent();
      }
    }
    log("ai_job.retried", { jobId: job.id, attempt: gen });
    scheduleRun(ref);
    return { jobId: job.id, reused: false, inProgress: false };
  }

  function scheduleRun(ref: JobRef, opts?: { staleBefore?: Date }): void {
    deps.schedule(async () => {
      try {
        await runJob(ref, opts);
      } catch {
        log("ai_job.run_crashed", { jobId: ref.jobId });
      }
    });
  }

  // ---------------- run ----------------

  /**
   * Claims and runs a queued job. `staleBefore`: claim only if the heartbeat
   * is older (default: now + 1 s, i.e. any queued job — the direct runner).
   */
  async function runJob(ref: JobRef, opts?: { staleBefore?: Date }): Promise<RunOutcome> {
    const invocationStart = now().getTime();
    const scope = deps.forUser(ref.userId);
    const { store } = scope;

    const staleBefore = (opts?.staleBefore ?? new Date(now().getTime() + 1_000)).toISOString();
    let job: JobRecord | null;
    try {
      job = await store.claim(ref.jobId, { now: iso(), staleBefore });
    } catch {
      // Still queued: a poll or the stalled sweep picks it up.
      log("ai_job.claim_error", { jobId: ref.jobId });
      return "not_claimed";
    }
    if (!job) return "not_claimed";
    const claimed = job;
    const meta = claimed.meta;
    /** This run's generation; every write matches it (QA-S3-05). */
    let gen = claimed.attemptCount;

    const lost = async (): Promise<RunOutcome> => {
      // Another actor/generation owns the job now. Our reservation is ours only.
      await release(scope, claimed.id, meta.usageEventId);
      log("ai_job.lost", { jobId: claimed.id });
      return "lost";
    };
    const write = async (done: Promise<boolean>) => {
      if (!(await done)) throw new LostJob();
    };
    const finish = async (status: "failed" | "canceled", code: AiErrorCode): Promise<RunOutcome> => {
      let ok = false;
      try {
        ok = await store.finish(claimed.id, gen, { status, errorCode: code, finishedAt: iso(), heartbeatAt: iso() });
      } catch {
        log("ai_job.finish_error", { jobId: claimed.id, status });
      }
      // Release our reservation whether or not we won; by id, so it can't touch a newer run's.
      await release(scope, claimed.id, meta.usageEventId);
      log(`ai_job.${status}`, { jobId: claimed.id, jobType: claimed.jobType, errorCode: code });
      return ok ? status : "lost";
    };

    try {
      const def = deps.getDefinition(claimed.jobType);
      if (!def || def.steps.length === 0) return await finish("failed", "model_unavailable");
      if (claimed.cancelRequestedAt) return await finish("canceled", "canceled");
      if (resolveUsage(def as JobTypeDefinition<unknown>, claimed.params) && !meta.usageEventId) {
        // A charging job without its reservation (crashed retry): never run it free.
        return await finish("failed", "model_unavailable");
      }

      const outputs: Record<string, unknown> = { ...claimed.stepOutputs };
      let ranThisInvocation = 0;
      let i = 0;
      while (i < def.steps.length) {
        const step = def.steps[i]!;
        if (Object.prototype.hasOwnProperty.call(outputs, step.stage)) {
          i++;
          continue;
        }

        const stepTimeout = step.timeoutMs ?? timing.stepTimeoutMs;
        const elapsed = now().getTime() - invocationStart;
        if (ranThisInvocation > 0 && elapsed + stepTimeout > timing.invocationBudgetMs) {
          await write(store.update(claimed.id, gen, { status: "queued", heartbeatAt: iso() }));
          return await continueLater(claimed);
        }

        const total = step.total ?? 1;
        await write(store.update(claimed.id, gen, { progress: { stage: step.stage, done: 0, total }, heartbeatAt: iso() }));
        ranThisInvocation++;

        const attempt = gen - meta.runBase + 1;
        const result = await runStepGuarded(scope, claimed, gen, step, outputs, attempt, stepTimeout);
        if (result.ok) {
          outputs[step.stage] = result.value ?? null;
          await write(
            store.saveStepOutputs(claimed.id, gen, outputs, meta, {
              progress: { stage: step.stage, done: total, total },
              heartbeatAt: iso(),
            }),
          );
          i++;
          continue;
        }

        const failure = result.failure;
        if ("lost" in failure) return await lost();
        if (failure.code === "canceled") return await finish("canceled", "canceled");
        if (failure.retryable && attempt < MAX_STEP_ATTEMPTS) {
          await write(store.update(claimed.id, gen, { attemptCount: gen + 1, heartbeatAt: iso() }));
          gen += 1;
          log("ai_job.retry", { jobId: claimed.id, stage: step.stage, errorCode: failure.code });
          continue; // same step; the budget check above may yield first
        }
        return await finish("failed", failure.code);
      }

      // All steps done: persist the final output first, then succeeded + charge
      // of THIS run's reservation in one transaction (complete_ai_job).
      const last = def.steps[def.steps.length - 1]!;
      const output = def.output?.(outputs);
      if (output !== undefined) await write(store.update(claimed.id, gen, { output, heartbeatAt: iso() }));
      const finalProgress = { stage: last.stage, done: last.total ?? 1, total: last.total ?? 1 };

      let completed: boolean | undefined;
      for (let t = 1; t <= LEDGER_SETTLE_TRIES && completed === undefined; t++) {
        try {
          completed = await store.complete(claimed.id, gen, meta.usageEventId, finalProgress);
        } catch {
          log("ai_job.complete_error", { jobId: claimed.id, try: t });
        }
      }
      if (completed === undefined) {
        // Couldn't complete: fail + release. If a lost response had actually
        // completed it, the status guard keeps it succeeded and the release is refused (charged stays).
        return await finish("failed", "model_unavailable");
      }
      if (!completed) return await lost(); // sweep / cancel / newer generation won; usage unchanged
      log("ai_job.succeeded", { jobId: claimed.id, jobType: claimed.jobType });
      return "succeeded";
    } catch (err) {
      if (err instanceof LostJob) return await lost();
      // Infrastructure failure (DB write) outside a step: fail + release.
      log("ai_job.runner_error", { jobId: claimed.id });
      return await finish("failed", "model_unavailable");
    }
  }

  async function continueLater(job: JobRecord): Promise<RunOutcome> {
    log("ai_job.yielded", { jobId: job.id });
    try {
      await deps.continueJob({ jobId: job.id, userId: job.userId });
    } catch {
      // Fallback: a status poll claims it after CONTINUE_CLAIM_GRACE_MS, or the sweep fails it.
      log("ai_job.continue_failed", { jobId: job.id });
    }
    return "yielded";
  }

  async function runStepGuarded(
    scope: UserScope<TAi>,
    job: JobRecord,
    gen: number,
    step: JobStep<TAi>,
    outputs: Record<string, unknown>,
    attempt: number,
    stepTimeout: number,
  ): Promise<{ ok: true; value: unknown } | { ok: false; failure: Failure }> {
    const controller = new AbortController();
    const deadline = setTimeout(() => controller.abort(ABORT_TIMEOUT), stepTimeout);
    let beating = false;
    const beat = setInterval(() => {
      if (beating) return;
      beating = true;
      scope.store
        .heartbeat(job.id, gen, iso())
        .then((hb) => {
          if (!hb.current) controller.abort(ABORT_LOST);
          else if (hb.cancelRequested) controller.abort(ABORT_CANCELED);
        })
        .catch(() => log("ai_job.heartbeat_error", { jobId: job.id }))
        .finally(() => {
          beating = false;
        });
    }, timing.heartbeatIntervalMs);

    const aborted = new Promise<never>((_, reject) => {
      controller.signal.addEventListener("abort", () => reject(new StepAborted(String(controller.signal.reason))), { once: true });
    });
    aborted.catch(() => {});

    try {
      const running = step.run({
        jobId: job.id,
        userId: job.userId,
        jobType: job.jobType,
        stage: step.stage,
        params: job.params,
        previous: { ...outputs },
        ai: scope.ai,
        db: scope.db,
        signal: controller.signal,
        attempt,
        reportProgress: async (done, total) => {
          const ok = await scope.store.update(job.id, gen, { progress: { stage: step.stage, done, total }, heartbeatAt: iso() });
          if (!ok) controller.abort(ABORT_LOST);
        },
      });
      // A step that ignores the signal must not hold the runner: race it.
      running.catch(() => {});
      const value = await Promise.race([running, aborted]);
      return { ok: true, value };
    } catch (err) {
      return { ok: false, failure: classifyStepError(err, controller.signal) };
    } finally {
      clearTimeout(deadline);
      clearInterval(beat);
    }
  }

  // ---------------- stalled ----------------

  /** True when an active job's heartbeat (or creation, if never claimed) is older than STALLED_AFTER_MS. */
  function isStalled(job: Pick<JobRecord, "status" | "heartbeatAt" | "createdAt">): boolean {
    if (!isActive(job.status)) return false;
    const last = Date.parse(job.heartbeatAt ?? job.createdAt);
    return now().getTime() - last > STALLED_AFTER_MS;
  }

  /**
   * Lazy stalled detection on status reads (the cron sweep covers users who
   * never come back). Returns the job as it is after the check.
   */
  async function markStalledIfNeeded(scope: UserScope<TAi>, job: JobRecord): Promise<JobRecord> {
    if (!isStalled(job)) return job;
    // Conditional on the generation we read (QA-S3-05): a retry that started
    // meanwhile is a newer generation and isn't touched.
    const won = await scope.store.finish(job.id, job.attemptCount, {
      status: "failed",
      errorCode: "stalled",
      finishedAt: iso(),
    });
    if (won) {
      await release(scope, job.id, job.meta.usageEventId);
      log("ai_job.stalled", { jobId: job.id, jobType: job.jobType });
    }
    return (await scope.store.get(job.id)) ?? job;
  }

  /**
   * Status-poll fallback for a yielded job whose continuation never arrived:
   * queued with a heartbeat older than CONTINUE_CLAIM_GRACE_MS → run it here.
   */
  function resumeIfWaiting(job: JobRecord): boolean {
    if (job.status !== "queued") return false;
    const waited = now().getTime() - Date.parse(job.heartbeatAt ?? job.createdAt);
    if (waited <= CONTINUE_CLAIM_GRACE_MS) return false;
    scheduleRun({ jobId: job.id, userId: job.userId }, { staleBefore: new Date(now().getTime() - CONTINUE_CLAIM_GRACE_MS) });
    return true;
  }

  /**
   * Status read for `GET /api/ai-jobs/{id}` (the app_ai_writer token's `sub`
   * is the signed-in user, so RLS limits this to the user's own jobs).
   * Side effects: lazy stalled detection and the continuation fallback.
   */
  async function getStatus(ref: JobRef): Promise<JobRecord> {
    const scope = deps.forUser(ref.userId);
    const job = await scope.store.get(ref.jobId);
    if (!job) throw new AppError("not_found");
    const checked = await markStalledIfNeeded(scope, job);
    resumeIfWaiting(checked);
    return checked;
  }

  /**
   * After the user's cancel RPC: a queued job has no runner to notice the
   * request, so claim it here and finish it as canceled (+ release).
   * A running job is stopped by its own heartbeat check.
   */
  async function settleCancelIfQueued(ref: JobRef): Promise<JobRecord | null> {
    const scope = deps.forUser(ref.userId);
    const job = await scope.store.get(ref.jobId);
    if (job?.status === "queued" && job.cancelRequestedAt) await runJob(ref);
    return scope.store.get(ref.jobId);
  }

  return {
    startJob,
    retryJob,
    runJob,
    scheduleRun,
    getStatus,
    settleCancelIfQueued,
    markStalledIfNeeded,
    resumeIfWaiting,
    isStalled,
  };
}

export type JobRunner<TAi = unknown> = ReturnType<typeof createJobRunner<TAi>>;
