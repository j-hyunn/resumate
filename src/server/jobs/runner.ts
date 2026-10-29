import { randomUUID } from "node:crypto";
import { errorCategoryOf, failureCauseOf, type StartAiJobResponse, type StoredAiJobProgress } from "@/lib/contracts/ai";
import type { AiErrorCode, AiJobType, AiProvider, ConnectionTier, ModelTier } from "@/lib/contracts/enums";
import { AppError } from "@/lib/contracts/errors";
import { AiError, isAiError, ProviderError } from "@/server/ai/errors";
import { resolveModel } from "@/server/ai/providers/models";
import {
  COMPLETE_TRIES,
  CONTINUE_CLAIM_GRACE_MS,
  FREE_TIER_MIN_INTERVAL_MS,
  HEARTBEAT_INTERVAL_MS,
  INVOCATION_BUDGET_MS,
  STALLED_AFTER_MS,
  STEP_TIMEOUT_MS,
  USAGE_SETTLE_GRACE_MS,
  USAGE_SETTLE_WORST_MS,
  MIN_STEP_TIMEOUT_MS,
} from "./constants";
import { isKeyFailureCause, type KeyFailureCause } from "./provider-context";
import { stepsFor } from "./registry";
import { decideRetry, retriesFor, withRetry } from "./retry";
import { createPriceCache, createUsageRecorder } from "./usage-recorder";
import type {
  ClaimOptions,
  JobMeta,
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
 * ai_jobs lifecycle v4 (AI C-6, C-11.3, C-12, C-13; S3a plan "계약 — API").
 *
 *   startJob:  provider context (fixed into the row) → in-flight / input_hash reuse
 *              → insert ai_jobs `queued` → schedule(runJob)
 *   runJob:    claim queued→running (only when due) → for each incomplete step:
 *              [free tier: call spacing] → progress + heartbeat → run with
 *              deadline/cancel guards (each provider call → onCall → one
 *              ai_usage_records row) → checkpoint
 *              → complete_ai_job | C-11.3 retry (now, or queued + next_run_at
 *              and end the invocation) | failed / canceled
 *              (yield to a new invocation near the 60 s budget)
 *
 * There is no reservation or charge (D-34): every exit path only has to leave
 * the job terminal or correctly scheduled. Usage records are written by the
 * LLM wrapper per call, independent of how the job ends.
 */

export type StartJobInput = {
  userId: string;
  jobType: AiJobType;
  params?: JsonObject;
  /** The job's target (D-34: one in-flight job per user, job type, target). */
  target?: { type: string; id: string } | null;
  applicationProjectId?: string | null;
  /**
   * C-6 v4 same-input reuse key. The hash includes provider and model, which
   * are only fixed here (QA-S3a-07), so pass a function that builds it from
   * the fixed context, e.g. `({ provider, model }) => computeInputHash({ feature, promptVersion, provider, model, ... })`.
   * A plain string is accepted for job types without a provider-dependent hash.
   */
  inputHash?: string | null | ((ctx: InputHashContext) => string | null);
  promptVersion?: string | null;
  /** Default: the model the job's provider + tier map to (C-10.1). */
  model?: string | null;
  /** "다시 생성" (explicit regenerate): skip input_hash reuse. */
  regenerate?: boolean;
};

/** What `StartJobInput.inputHash` gets: the provider context fixed for this job. */
export type InputHashContext = { provider: AiProvider; model: string; modelTier: ModelTier; connectionTier: ConnectionTier };

type Failure = { error: AiError } | { lost: true };

const DEFAULT_TIMING: RunnerTiming = {
  invocationBudgetMs: INVOCATION_BUDGET_MS,
  stepTimeoutMs: STEP_TIMEOUT_MS,
  heartbeatIntervalMs: HEARTBEAT_INTERVAL_MS,
  usageSettleGraceMs: USAGE_SETTLE_GRACE_MS,
  settleWorstMs: USAGE_SETTLE_WORST_MS,
  minStepTimeoutMs: MIN_STEP_TIMEOUT_MS,
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
 * Maps whatever a step threw to a C-11 error (QA-S3a-02, 사용자 확정 2026-10-28):
 * - AiError / ProviderError: as is. Unknown failures INSIDE a provider call
 *   are already `ProviderError("provider_unavailable", { unclassified })` from
 *   the llm wrapper, so they keep C-11.3's 2 retries.
 * - Anything else (our bug, DB error, validator crash): `stalled` (system), no
 *   retry — it isn't the provider, and retrying won't fix it.
 */
export function classifyStepError(err: unknown, signal: AbortSignal): Failure & { unclassified?: boolean } {
  if (signal.aborted) {
    const reason = typeof signal.reason === "string" ? signal.reason : ABORT_TIMEOUT;
    if (reason === ABORT_LOST) return { lost: true };
    if (reason === ABORT_CANCELED) return { error: new AiError("canceled") };
    return { error: new AiError("timeout") };
  }
  if (isAiError(err)) return { error: err, unclassified: err instanceof ProviderError && err.unclassified };
  return { error: new AiError("stalled", { retryable: false }), unclassified: true };
}

function isActive(status: string): boolean {
  return status === "queued" || status === "running";
}

function emptyMeta(runBase: number, waitBase: number): JobMeta {
  return { runBase, waitBase, retries: {} };
}

export function createJobRunner<TLlm>(deps: RunnerDeps<TLlm>) {
  const now = deps.now ?? (() => new Date());
  const random = deps.random ?? Math.random;
  const timing: RunnerTiming = { ...DEFAULT_TIMING, ...deps.timing };
  const iso = () => now().toISOString();
  const log = deps.log ?? (() => {});

  function definitionOf(jobType: AiJobType): JobTypeDefinition<TLlm> {
    const def = deps.getDefinition(jobType);
    if (!def) throw new AppError("internal_error", undefined, { status: 500, cause: new Error(`unknown job type ${jobType}`) });
    return def;
  }

  // ---------------- start / retry ----------------

  async function startJob(input: StartJobInput): Promise<StartAiJobResponse> {
    const def = definitionOf(input.jobType);
    // Never trust the client for the connection: read it here and fix it into the row (F-AI-03 (2)).
    const context = await deps.providerContext.forUser(input.userId);
    if (!context) throw new AppError("ai_not_connected", "AI 연결이 필요합니다. 키를 등록한 뒤 다시 시도해 주세요.", { status: 409 });
    if (context.keyStatus === "invalid") {
      throw new AppError("key_invalid", "AI 키가 유효하지 않습니다. 키를 확인해 다시 연결해 주세요.", { status: 409 });
    }

    const scope = deps.forUser(input.userId);
    const params = input.params ?? {};
    const applicationProjectId = input.applicationProjectId ?? null;
    const target = input.target ?? null;
    const modelTier = def.modelTier ?? "default";
    const model = input.model ?? resolveModel(context.provider, modelTier);
    const inputHash =
      typeof input.inputHash === "function"
        ? input.inputHash({ provider: context.provider, model, modelTier, connectionTier: context.connectionTier })
        : (input.inputHash ?? null);
    const inFlightQuery = { userId: input.userId, jobType: input.jobType, target, inputHash, applicationProjectId };

    // Same type already running on the target (double click, second tab): follow it (D-34).
    const inFlight = await scope.store.findInFlight(inFlightQuery);
    if (inFlight) return { jobId: inFlight.id, reused: false, inProgress: true };
    if (inputHash && !input.regenerate) {
      const reusable = await scope.store.findReusable({
        userId: input.userId,
        applicationProjectId,
        jobType: input.jobType,
        provider: context.provider,
        inputHash,
      });
      // Same input already succeeded with this provider: no call, no usage record (C-6, C-13).
      if (reusable) return { jobId: reusable.id, reused: true, inProgress: false };
    }

    const steps = stepsFor(def, context.connectionTier, params);
    const jobId = randomUUID();
    try {
      await scope.store.insert({
        id: jobId,
        userId: input.userId,
        jobType: input.jobType,
        applicationProjectId,
        targetType: target?.type ?? null,
        targetId: target?.id ?? null,
        provider: context.provider,
        modelTier,
        connectionTier: context.connectionTier,
        params,
        inputHash,
        promptVersion: input.promptVersion ?? null,
        model,
        progress: { stage: steps[0]!.stage, done: 0, total: steps[0]!.total ?? 1 },
        meta: emptyMeta(1, 0),
      });
    } catch (err) {
      // Lost the double-start race on the in-flight unique index: follow the winner.
      if (err instanceof AppError && err.code === "conflict") {
        const winner = await scope.store.findInFlight(inFlightQuery);
        if (winner) return { jobId: winner.id, reused: false, inProgress: true };
      }
      throw err;
    }

    log("ai_job.created", { jobId, jobType: input.jobType, provider: context.provider, connectionTier: context.connectionTier });
    scheduleRun({ jobId, userId: input.userId });
    return { jobId, reused: false, inProgress: false };
  }

  /**
   * Manual retry (재시도 버튼) of a failed job: claim failed → queued
   * (run_generation = seen, conditional) with a fresh run (per-call retry counts
   * and the 120 s wait budget start over). Checkpoints are kept, so it resumes
   * from the failed step (C-6). If another job on the same target started
   * meanwhile, that job is returned (QA-S3-12).
   */
  async function retryJob(ref: JobRef): Promise<StartAiJobResponse> {
    const scope = deps.forUser(ref.userId);
    const job = await scope.store.get(ref.jobId);
    if (!job) throw new AppError("not_found");
    const notRetryable = () => new AppError("ai_job_not_retryable", "다시 시도할 수 없는 작업입니다.", { status: 409 });
    if (isActive(job.status)) return { jobId: job.id, reused: false, inProgress: true };
    if (job.status !== "failed" || !job.errorCode || errorCategoryOf(job.errorCode) === "input") throw notRetryable();
    // QA-S3b-05: a key check is re-run from the connection screen, never requeued (no registry step).
    // S4: a writing chat turn is retried by "다시 보내기" (POST /api/writing-chats/{id}/turns?retry=1), never requeued.
    // S5: a sync JD extraction is retried by calling POST /api/application-projects/{id}/jd-extraction again (new job).
    if (job.jobType === "key_verification" || job.jobType === "writing_chat_turn" || job.jobType === "jd_extraction") throw notRetryable();
    // QA-S3b-01: same gate as a new run, on the job's FIXED provider (F-AI-03 (2)): key present and
    // not invalid, consent current. Never send career data after consent was withdrawn.
    await deps.providerContext.assertJobRunnable(ref.userId, { provider: job.provider, connectionTier: job.connectionTier });

    const gen = job.runGeneration + 1;
    let won: boolean;
    try {
      won = await scope.store.requeueFailed(job.id, job.runGeneration, iso(), job.stepOutputs, emptyMeta(gen, job.retryWaitTotalMs));
    } catch (err) {
      if (err instanceof AppError && err.code === "conflict") {
        const other = job.targetType && job.targetId
          ? await scope.store.findInFlight({
              userId: ref.userId,
              jobType: job.jobType,
              target: { type: job.targetType, id: job.targetId },
              inputHash: null,
              applicationProjectId: job.applicationProjectId,
            })
          : null;
        if (other) return { jobId: other.id, reused: false, inProgress: true };
      }
      throw err;
    }
    if (!won) {
      const current = await scope.store.get(ref.jobId);
      if (current && isActive(current.status)) return { jobId: current.id, reused: false, inProgress: true };
      throw notRetryable();
    }
    log("ai_job.retried", { jobId: job.id, runGeneration: gen });
    scheduleRun(ref);
    return { jobId: job.id, reused: false, inProgress: false };
  }

  function scheduleRun(ref: JobRef, opts?: RunOptions): void {
    deps.schedule(async () => {
      try {
        await runJob(ref, opts);
      } catch {
        log("ai_job.run_crashed", { jobId: ref.jobId });
      }
    });
  }

  // ---------------- run ----------------

  type RunOptions = { staleBefore?: Date; ignoreNextRunAt?: boolean };

  /**
   * Claims and runs a queued, due job. `staleBefore`: claim only if the
   * heartbeat is older (default: now + 1 s, i.e. any queued job).
   */
  async function runJob(ref: JobRef, opts?: RunOptions): Promise<RunOutcome> {
    const invocationStart = now().getTime();
    const scope = deps.forUser(ref.userId);
    const { store } = scope;

    const claimOpts: ClaimOptions = {
      now: iso(),
      staleBefore: (opts?.staleBefore ?? new Date(now().getTime() + 1_000)).toISOString(),
      ignoreNextRunAt: opts?.ignoreNextRunAt ?? false,
    };
    let job: JobRecord | null;
    try {
      job = await store.claim(ref.jobId, claimOpts);
    } catch {
      // Still queued: a poll or the cron picks it up.
      log("ai_job.claim_error", { jobId: ref.jobId });
      return "not_claimed";
    }
    if (!job) return "not_claimed";
    const claimed = job;
    /** This run's generation; every write matches it (QA-S3-05). */
    let gen = claimed.runGeneration;
    let retryCount = claimed.retryCount;
    let waitTotal = claimed.retryWaitTotalMs;
    let meta: JobMeta = claimed.meta;

    /**
     * QA-S3a-03: every Llm this run created (one per step attempt, bound to the
     * step's abort signal). Before the invocation ends, `llm.settle()` waits
     * (bounded) for calls an aborted step left behind and force-records the
     * rest, so after()/waitUntil never cuts an ai_usage_records insert.
     */
    const llms: TLlm[] = [];
    const settleCalls = async () => {
      if (llms.length === 0) return;
      const t = Date.now();
      await Promise.all(llms.map((l) => deps.settleLlm(l, timing.usageSettleGraceMs).catch(() => {})));
      if (Date.now() - t >= timing.usageSettleGraceMs) log("ai_job.usage_settle_timeout", { jobId: claimed.id });
    };

    try {
      return await runClaimed();
    } finally {
      await settleCalls();
    }

    async function runClaimed(): Promise<RunOutcome> {
      const lost = (): RunOutcome => {
        log("ai_job.lost", { jobId: claimed.id });
        return "lost";
      };
      const write = async (done: Promise<boolean>) => {
        if (!(await done)) throw new LostJob();
      };
      const finish = async (
        status: "failed" | "canceled",
        code: AiErrorCode,
        times: { retryAfter?: Date | null; quotaResetsAt?: Date | null } = {},
      ): Promise<RunOutcome> => {
        let ok = false;
        try {
          ok = await store.finish(claimed.id, gen, {
            status,
            errorCode: code,
            finishedAt: iso(),
            heartbeatAt: iso(),
            nextRunAt: null,
            retryAfter: times.retryAfter?.toISOString() ?? null,
            quotaResetsAt: times.quotaResetsAt?.toISOString() ?? null,
          });
        } catch {
          log("ai_job.finish_error", { jobId: claimed.id, status });
        }
        log(`ai_job.${status}`, { jobId: claimed.id, jobType: claimed.jobType, provider: claimed.provider, errorCode: code });
        return ok ? status : "lost";
      };

      try {
        const def = deps.getDefinition(claimed.jobType);
        // Runner-side failures (no definition, DB errors) are `stalled` [가정, S3a notes]: no provider involved.
        if (!def) return await finish("failed", "stalled");
        if (claimed.cancelRequestedAt) return await finish("canceled", "canceled");
        const steps = stepsFor(def, claimed.connectionTier, claimed.params);

        const priceFor = createPriceCache(scope.usage);
        const onCall = createUsageRecorder({ store: scope.usage, job: claimed, priceFor, now, log });
        /** One Llm per step attempt, bound to that attempt's deadline / cancel signal. */
        const llmFor = (signal: AbortSignal): TLlm => {
          const llm = deps.createLlm({
            provider: claimed.provider,
            tier: claimed.modelTier,
            connectionTier: claimed.connectionTier,
            // Bind the job's provider: the envelope key source builds the AAD from it (DM 2.11.2).
            keySource: { forJob: (id: string) => scope.keySource.forJob(id, claimed.provider) },
            jobId: claimed.id,
            signal,
            onCall,
          });
          llms.push(llm);
          return llm;
        };

        const outputs: Record<string, unknown> = { ...claimed.stepOutputs };
        let ranThisInvocation = 0;
        let i = 0;
        while (i < steps.length) {
          const step = steps[i]!;
          if (Object.prototype.hasOwnProperty.call(outputs, step.stage)) {
            i++;
            continue;
          }

          // QA-S3a-11: the step's deadline AND the final usage settle must end inside the budget.
          let stepTimeout = step.timeoutMs ?? timing.stepTimeoutMs;
          const elapsed = now().getTime() - invocationStart;
          const room = timing.invocationBudgetMs - timing.settleWorstMs - elapsed;
          if (stepTimeout > room) {
            if (ranThisInvocation > 0) {
              await write(store.update(claimed.id, gen, { status: "queued", heartbeatAt: iso() }));
              return await continueLater(claimed);
            }
            // First step of this invocation: shorten it instead of yielding forever.
            stepTimeout = Math.max(room, Math.min(timing.minStepTimeoutMs, stepTimeout));
          }

          // C-12: free tier keeps a minimum spacing per user and provider; wait via next_run_at, not here.
          if (claimed.connectionTier === "free") {
            const runAt = await nextFreeTierSlot(scope, claimed);
            if (runAt) {
              await write(store.update(claimed.id, gen, { status: "queued", nextRunAt: runAt.toISOString(), heartbeatAt: iso() }));
              log("ai_job.spaced", { jobId: claimed.id, stage: step.stage });
              return "scheduled";
            }
          }

          // QA-S3b-01: key / consent may have changed since start or while queued.
          if (deps.checkRunAllowed) {
            let blocked: AiErrorCode | null = null;
            try {
              blocked = await deps.checkRunAllowed(claimed);
            } catch {
              log("ai_job.run_gate_error", { jobId: claimed.id });
              blocked = "stalled"; // fail closed: no provider call without a positive answer
            }
            if (blocked) {
              log("ai_job.run_gate_blocked", { jobId: claimed.id, errorCode: blocked });
              return await finish("failed", blocked);
            }
          }

          const total = step.total ?? 1;
          await write(store.update(claimed.id, gen, { progress: { stage: step.stage, done: 0, total }, heartbeatAt: iso() }));
          ranThisInvocation++;

          const attempt = 1 + Object.values(meta.retries[step.stage] ?? {}).reduce((a, n) => a + (n ?? 0), 0);
          const result = await runStepGuarded(scope, claimed, gen, step, outputs, attempt, stepTimeout, llmFor);
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
          if ("lost" in failure) return lost();
          const error = failure.error;
          if (failure.unclassified) log("ai_job.step_error", { jobId: claimed.id, stage: step.stage, unclassified: true });
          if (error.code === "canceled") return await finish("canceled", "canceled");
          if (error.code === "key_invalid") await markKeyInvalid(scope, claimed.id);

          // QA-S3a-04: a cancel requested while the step ran wins over any retry (no new call with the user's key).
          let hb: { current: boolean; cancelRequested: boolean } | null = null;
          try {
            hb = await store.heartbeat(claimed.id, gen, iso());
          } catch {
            log("ai_job.heartbeat_error", { jobId: claimed.id });
          }
          if (hb && !hb.current) return lost();
          if (hb?.cancelRequested) return await finish("canceled", "canceled");

          const decision = decideRetry({
            error,
            retriesSoFar: retriesFor(meta.retries, step.stage, error.code),
            waitUsedMs: waitTotal - meta.waitBase,
            now: now(),
            random,
          });

          if (decision.kind === "fail") {
            // Other key causes update last_failure_* (status kept), DM 2.11.3. key_invalid was handled above.
            const cause = failureCauseOf(error.code);
            if (isKeyFailureCause(cause) && cause !== "key_invalid") await reportKeyFailure(scope, claimed.id, cause);
            return await finish("failed", error.code, decision);
          }

          retryCount += 1;
          meta = { ...meta, retries: withRetry(meta.retries, step.stage, error.code) };
          log("ai_job.retry", { jobId: claimed.id, stage: step.stage, errorCode: error.code, scheduled: decision.kind === "retry_at" });

          if (decision.kind === "retry_now") {
            await write(store.saveStepOutputs(claimed.id, gen, outputs, meta, { runGeneration: gen + 1, retryCount, heartbeatAt: iso() }));
            gen += 1;
            continue; // same step; the budget check above may yield first
          }

          // Wait outside the function (C-11.3): queued + next_run_at; a status poll or the cron wakes it (B-4).
          waitTotal += decision.waitMs;
          const runAt = decision.runAt.toISOString();
          await write(
            store.saveStepOutputs(claimed.id, gen, outputs, meta, {
              status: "queued",
              runGeneration: gen + 1,
              retryCount,
              retryWaitTotalMs: waitTotal,
              nextRunAt: runAt,
              heartbeatAt: iso(),
              progress: { stage: step.stage, done: 0, total, waiting_retry_until: runAt },
            }),
          );
          return "scheduled";
        }

        // All steps done: persist the final output first, then succeeded (complete_ai_job).
        const last = steps[steps.length - 1]!;
        const output = def.output?.(outputs);
        if (output !== undefined) await write(store.update(claimed.id, gen, { output, heartbeatAt: iso() }));
        const finalProgress: StoredAiJobProgress = { stage: last.stage, done: last.total ?? 1, total: last.total ?? 1 };

        let completed: boolean | undefined;
        for (let t = 1; t <= COMPLETE_TRIES && completed === undefined; t++) {
          try {
            completed = await store.complete(claimed.id, gen, finalProgress);
          } catch {
            log("ai_job.complete_error", { jobId: claimed.id, try: t });
          }
        }
        // If a lost response had actually completed it, the status guard keeps it succeeded (finish matches nothing).
        if (completed === undefined) return await finish("failed", "stalled");
        if (!completed) return lost();
        log("ai_job.succeeded", { jobId: claimed.id, jobType: claimed.jobType, provider: claimed.provider });
        // DM 2.11.3: a needs_check key becomes valid after a successful run (no-op otherwise).
        await reportKeySuccess(scope, claimed.id);
        return "succeeded";
      } catch (err) {
        if (err instanceof LostJob) return lost();
        // Infrastructure failure (DB write, bad step list) outside a step.
        log("ai_job.runner_error", { jobId: claimed.id });
        return await finish("failed", "stalled");
      }
    }
  }

  /** Next allowed call time on the free tier, or null when a call may go now (C-12). */
  async function nextFreeTierSlot(scope: UserScope, job: JobRecord): Promise<Date | null> {
    let last: string | null;
    try {
      last = await scope.usage.lastCallAt(job.provider);
    } catch {
      log("ai_job.spacing_lookup_failed", { jobId: job.id });
      return null; // the provider's rate limit (C-11 cause 1) is the backstop
    }
    if (!last) return null;
    const slot = Date.parse(last) + FREE_TIER_MIN_INTERVAL_MS;
    return slot > now().getTime() ? new Date(slot) : null;
  }

  async function markKeyInvalid(scope: UserScope, jobId: string): Promise<void> {
    try {
      await scope.keyStatus.markInvalid(jobId);
    } catch {
      log("ai_job.mark_key_invalid_failed", { jobId });
    }
  }

  async function reportKeyFailure(scope: UserScope, jobId: string, cause: Exclude<KeyFailureCause, "key_invalid">): Promise<void> {
    try {
      await scope.keyStatus.recordFailure(jobId, cause);
    } catch {
      log("ai_job.key_failure_report_failed", { jobId });
    }
  }

  async function reportKeySuccess(scope: UserScope, jobId: string): Promise<void> {
    try {
      await scope.keyStatus.recordSuccess(jobId);
    } catch {
      log("ai_job.key_success_report_failed", { jobId });
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
    scope: UserScope,
    job: JobRecord,
    gen: number,
    step: JobStep<TLlm>,
    outputs: Record<string, unknown>,
    attempt: number,
    stepTimeout: number,
    llmFor: (signal: AbortSignal) => TLlm,
  ): Promise<{ ok: true; value: unknown } | { ok: false; failure: ReturnType<typeof classifyStepError> }> {
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
        llm: llmFor(controller.signal),
        provider: job.provider,
        modelTier: job.modelTier,
        connectionTier: job.connectionTier,
        sequential: job.connectionTier === "free",
        callKeyPrefix: `${job.jobType}.${step.stage}`,
        db: scope.db,
        signal: controller.signal,
        attempt,
        reportProgress: async (done, total) => {
          const ok = await scope.store.update(job.id, gen, { progress: { stage: step.stage, done, total }, heartbeatAt: iso() });
          if (!ok) controller.abort(ABORT_LOST);
        },
      });
      // A step that ignores the signal must not hold the runner: race it. Its
      // provider calls carry the same signal (createLlm `signal`), and their
      // usage records are settled before the invocation ends (QA-S3a-03).
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

  // ---------------- wake-up / stalled ----------------

  /** Queued with next_run_at that has passed (C-11.3 retry wait or C-12 spacing over). */
  function isDue(job: Pick<JobRecord, "status" | "nextRunAt">): boolean {
    return job.status === "queued" && job.nextRunAt !== null && Date.parse(job.nextRunAt) <= now().getTime();
  }

  /**
   * True when an active job's heartbeat (or creation) is older than
   * STALLED_AFTER_MS. A queued job waiting for next_run_at is never stalled:
   * it may wait for the next cron long after next_run_at (B-4).
   */
  function isStalled(job: Pick<JobRecord, "status" | "heartbeatAt" | "createdAt" | "nextRunAt">): boolean {
    if (!isActive(job.status)) return false;
    if (job.status === "queued" && job.nextRunAt !== null) return false;
    const last = Date.parse(job.heartbeatAt ?? job.createdAt);
    return now().getTime() - last > STALLED_AFTER_MS;
  }

  /** Lazy stalled detection on status reads (the cron sweep covers users who never come back). */
  async function markStalledIfNeeded(scope: UserScope, job: JobRecord): Promise<JobRecord> {
    if (!isStalled(job)) return job;
    // Conditional on the generation we read (QA-S3-05): a newer generation isn't touched.
    const won = await scope.store.finish(job.id, job.runGeneration, {
      status: "failed",
      errorCode: "stalled",
      finishedAt: iso(),
      nextRunAt: null,
    });
    if (won) log("ai_job.stalled", { jobId: job.id, jobType: job.jobType });
    return (await scope.store.get(job.id)) ?? job;
  }

  /**
   * Status-poll fallback for a yielded job whose continuation never arrived:
   * queued without next_run_at, heartbeat older than CONTINUE_CLAIM_GRACE_MS → run it here.
   */
  function resumeIfWaiting(job: JobRecord): boolean {
    if (job.status !== "queued" || job.nextRunAt !== null) return false;
    const waited = now().getTime() - Date.parse(job.heartbeatAt ?? job.createdAt);
    if (waited <= CONTINUE_CLAIM_GRACE_MS) return false;
    scheduleRun({ jobId: job.id, userId: job.userId }, { staleBefore: new Date(now().getTime() - CONTINUE_CLAIM_GRACE_MS) });
    return true;
  }

  /**
   * Status read for `GET /api/ai-jobs/{id}` (the app_ai_writer token's `sub`
   * is the signed-in user, so RLS limits this to the user's own jobs).
   * Side effects: wakes a due job (B-4 main path), lazy stalled detection,
   * and the continuation fallback.
   */
  async function getStatus(ref: JobRef): Promise<JobRecord> {
    const scope = deps.forUser(ref.userId);
    const job = await scope.store.get(ref.jobId);
    if (!job) throw new AppError("not_found");
    if (isDue(job)) {
      scheduleRun(ref);
      return job;
    }
    const checked = await markStalledIfNeeded(scope, job);
    resumeIfWaiting(checked);
    return checked;
  }

  /**
   * After the user's cancel RPC: a queued job (waiting to start, or waiting for
   * a scheduled retry) has no runner to notice the request, so claim it here,
   * ignoring next_run_at, and finish it as canceled.
   * A running job is stopped by its own heartbeat check.
   */
  async function settleCancelIfQueued(ref: JobRef): Promise<JobRecord | null> {
    const scope = deps.forUser(ref.userId);
    const job = await scope.store.get(ref.jobId);
    if (job?.status === "queued" && job.cancelRequestedAt) await runJob(ref, { ignoreNextRunAt: true });
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
    isDue,
  };
}

export type JobRunner<TLlm = unknown> = ReturnType<typeof createJobRunner<TLlm>>;
