import { randomUUID } from "node:crypto";
import { failureCauseOf } from "@/lib/contracts/ai";
import type { AiErrorCode, AiProvider, ConnectionTier, ModelTier } from "@/lib/contracts/enums";
import { AppError } from "@/lib/contracts/errors";
import type { JdSentence } from "@/server/ai/context-pack/jd";
import { AiError, finalRetryAfter, isAiError, isProviderError } from "@/server/ai/errors";
import type { Llm } from "@/server/ai/llm";
import { resolveModel } from "@/server/ai/providers/models";
import { HEARTBEAT_INTERVAL_MS, MIN_STEP_TIMEOUT_MS, USAGE_SETTLE_GRACE_MS } from "@/server/jobs/constants";
import { isKeyFailureCause, type KeySource, type KeyStatusReporter, type ProviderContextSource } from "@/server/jobs/provider-context";
import { decideRetry } from "@/server/jobs/retry";
import type { JobRecord, JobStore, LlmFactoryInput, UsageStore } from "@/server/jobs/types";
import { createPriceCache, createUsageRecorder } from "@/server/jobs/usage-recorder";

/**
 * AI-01 JD requirement extraction, synchronous (AI C-6 동기, F-AP-01, F-P2-01/02,
 * D-19, D-30; DM §2.6 begin/apply/fail_jd_extraction).
 *
 * `ensureJdExtracted` is THE entry point: the sync route
 * (`POST /api/application-projects/{id}/jd-extraction`) uses it now, and the
 * first step of S6–S8 jobs (insight / drafts / interview) calls it too (D-30:
 * a JD created without a key is extracted first). It always runs its own
 * `jd_extraction` ai_jobs row (usage meter "요건 추출", feature jd_extraction).
 *
 * Order: JD read (user session, RLS) → connection gate (active provider, key,
 * consent; F-AI-08 lock) → ai_jobs insert (target job_description; one in
 * flight per JD) → claim → check_ai_run_allowed → begin_jd_extraction →
 * AI-01 (light tier, retries C-11.3 inside the request) → apply_jd_extraction
 * → complete. Failure → fail_jd_extraction + job failed (error_code,
 * retry_after / quota_resets_at). Every provider call leaves one usage record.
 *
 * The sync path reuses the shape of the S3b key verification (insert → claim →
 * run → close inside the request; no after(), no next_run_at). Waits the
 * policy asks for are taken in the request only when short
 * (`maxInlineWaitMs`), otherwise the run ends with the C-11.3 final
 * `retry_after` [가정, spec-gaps].
 *
 * Project deleted mid-run (FL-06): the job row cascades away, so heartbeat /
 * apply / finish match zero rows → handled exactly like `canceled` (no further
 * provider call, usage recorded with application_project_id null).
 *
 * C-7: logs carry ids, codes, counts — never JD text.
 */

export type Log = (event: string, fields: Record<string, string | number | boolean | null>) => void;

/** What the extraction reads (user session: RLS = ownership). */
export type JdForExtraction = {
  applicationProjectId: string;
  jobDescriptionId: string;
  extractionStatus: "pending" | "running" | "succeeded" | "failed";
  sentences: JdSentence[];
  /** Only user-entered values are passed to the model (AI-01 input). */
  companyName: string | null;
  companyNameSource: "user" | "ai" | null;
  positionTitle: string | null;
  positionTitleSource: "user" | "ai" | null;
};

/** JD persistence used by the extraction (db.ts implements it on Supabase). */
export interface JdExtractionDb {
  /** null = no such project for this user. */
  load(applicationProjectId: string): Promise<JdForExtraction | null>;
  /** app_ai_writer `begin_jd_extraction`. Throws AppError `already_extracted` / `extraction_in_progress` / `not_found`. */
  begin(jobDescriptionId: string, jobId: string): Promise<void>;
  /** app_ai_writer `apply_jd_extraction`. `applied: false` = stale run (ignored). Throws `not_found` when the JD is gone. */
  apply(args: { jobDescriptionId: string; jobId: string; runGeneration: number; payload: unknown; provider: AiProvider; model: string }): Promise<{ applied: boolean }>;
  /** app_ai_writer `fail_jd_extraction` (only for this job's running extraction). */
  fail(jobDescriptionId: string, jobId: string): Promise<boolean>;
}

/** The AI-01 pipeline (ai-pipeline `extractJdRequirements`), narrowed to what the service needs. */
export type JdExtractor = (
  input: { sentences: readonly JdSentence[]; companyName: string | null; positionTitle: string | null },
  deps: { llm: Llm; signal: AbortSignal; callKey: string; jobId: string },
) => Promise<{ payload: unknown; model: string; promptVersion: string }>;

export type JdExtractionTiming = {
  /** Server timeout of the sync call (C-6 [가정] 30 s): calls + retries end by start + this. */
  budgetMs: number;
  /** One call's cap. */
  callTimeoutMs: Record<ConnectionTier, number>;
  /** Waits the retry policy asks for are taken in the request only up to this. */
  maxInlineWaitMs: number;
  /** A call (or retry) starts only with at least this much time left. */
  minCallMs: number;
  heartbeatMs: number;
  /** An in-flight extraction job without a heartbeat for this long is dead and replaced. */
  staleMs: number;
  usageSettleMs: number;
};

const DEFAULT_TIMING: JdExtractionTiming = {
  budgetMs: 30_000,
  callTimeoutMs: { paid: 25_000, free: 28_000 },
  maxInlineWaitMs: 5_000,
  minCallMs: MIN_STEP_TIMEOUT_MS,
  heartbeatMs: HEARTBEAT_INTERVAL_MS,
  staleMs: 45_000,
  usageSettleMs: USAGE_SETTLE_GRACE_MS,
};

export type JdExtractionDeps = {
  userId: string;
  jds: JdExtractionDb;
  /** app_ai_writer stores of this user. */
  store: JobStore;
  usage: UsageStore;
  providerContext: ProviderContextSource;
  keySource: KeySource;
  keyStatus: KeyStatusReporter;
  /** check_ai_run_allowed (app_ai_writer); null = allowed / dev-env mode. */
  runGate: ((jobId: string) => Promise<AiErrorCode | null>) | null;
  createLlm: (input: LlmFactoryInput) => Llm;
  extract: JdExtractor;
  now?: () => Date;
  newId?: () => string;
  sleep?: (ms: number, signal: AbortSignal) => Promise<void>;
  log?: Log;
  timing?: Partial<JdExtractionTiming>;
};

export type EnsureJdResult =
  | { status: "already_extracted" }
  | { status: "succeeded"; jobId: string }
  | { status: "failed"; jobId: string | null; code: AiErrorCode; retryAfter: string | null; quotaResetsAt: string | null };

export const JD_EXTRACTION_STAGE = "extract";
export const JD_EXTRACTION_TIER: ModelTier = "light";

export const extractionInProgress = () =>
  new AppError("extraction_in_progress", "공고를 분석하고 있어요. 잠시 후 다시 확인해 주세요.", { status: 409 });
export const alreadyExtracted = () => new AppError("already_extracted", "이미 요건을 정리한 공고예요.", { status: 409 });

function gateCode(err: unknown): AiErrorCode | null {
  if (err instanceof AppError) {
    if (err.code === "ai_consent_required" || err.code === "key_missing" || err.code === "ai_not_connected") return "key_missing";
    if (err.code === "key_invalid") return "key_invalid";
  }
  return null;
}

function defaultSleep(ms: number, signal: AbortSignal): Promise<void> {
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

function failed(jobId: string | null, code: AiErrorCode, times: { retryAfter?: Date | null; quotaResetsAt?: Date | null } = {}): EnsureJdResult {
  return {
    status: "failed",
    jobId,
    code,
    retryAfter: times.retryAfter?.toISOString() ?? null,
    quotaResetsAt: times.quotaResetsAt?.toISOString() ?? null,
  };
}

/** Deadline + run abort for one call. */
function callSignal(parent: AbortSignal, timeoutMs: number): { signal: AbortSignal; clear: () => void } {
  const controller = new AbortController();
  const onParent = () => controller.abort(parent.reason === "canceled" || parent.reason === "lost" ? "canceled" : "timeout");
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

/** Opens the jd_extraction job (one in flight per JD; a dead one is closed and replaced). */
async function openJob(
  deps: JdExtractionDeps,
  jd: JdForExtraction,
  context: { provider: AiProvider; connectionTier: ConnectionTier },
  timing: JdExtractionTiming,
): Promise<JobRecord> {
  const now = deps.now ?? (() => new Date());
  const target = { type: "job_description", id: jd.jobDescriptionId };
  const insert = async (): Promise<string> => {
    const id = (deps.newId ?? randomUUID)();
    await deps.store.insert({
      id,
      userId: deps.userId,
      jobType: "jd_extraction",
      applicationProjectId: jd.applicationProjectId,
      targetType: target.type,
      targetId: target.id,
      provider: context.provider,
      modelTier: JD_EXTRACTION_TIER,
      connectionTier: context.connectionTier,
      params: {},
      inputHash: null,
      promptVersion: null,
      model: resolveModel(context.provider, JD_EXTRACTION_TIER),
      progress: { stage: JD_EXTRACTION_STAGE, done: 0, total: 1 },
      meta: { runBase: 1, waitBase: 0, retries: {} },
    });
    return id;
  };

  let jobId: string;
  try {
    jobId = await insert();
  } catch (err) {
    if (!(err instanceof AppError && err.code === "conflict")) throw err;
    const other = await deps.store.findInFlight({ userId: deps.userId, jobType: "jd_extraction", target, inputHash: null, applicationProjectId: null });
    const otherJob = other ? await deps.store.get(other.id) : null;
    const lastBeat = otherJob ? Date.parse(otherJob.heartbeatAt ?? otherJob.createdAt) : NaN;
    if (!otherJob || !(now().getTime() - lastBeat > timing.staleMs)) throw extractionInProgress();
    // A dead invocation (function killed mid-call): close it and start again.
    await deps.store.finish(otherJob.id, otherJob.runGeneration, { status: "failed", errorCode: "stalled", finishedAt: now().toISOString(), nextRunAt: null });
    try {
      jobId = await insert();
    } catch (again) {
      if (again instanceof AppError && again.code === "conflict") throw extractionInProgress();
      throw again;
    }
  }

  const claimed = await deps.store.claim(jobId, { now: now().toISOString(), staleBefore: new Date(now().getTime() + 1_000).toISOString() });
  if (!claimed) throw new AppError("internal_error", undefined, { status: 500 });
  return claimed;
}

/**
 * Makes sure the project's JD has extracted requirements (D-30). Returns
 * `already_extracted` without any job when it already has them. Throws
 * AppError for non-AI refusals (not_found, extraction_in_progress); returns
 * `failed` for every C-11 failure (connection gate included).
 */
export async function ensureJdExtracted(deps: JdExtractionDeps, applicationProjectId: string): Promise<EnsureJdResult> {
  const now = deps.now ?? (() => new Date());
  const log = deps.log ?? (() => {});
  const timing: JdExtractionTiming = { ...DEFAULT_TIMING, ...deps.timing };
  const sleep = deps.sleep ?? defaultSleep;
  const startedAt = now().getTime();

  const loaded = await deps.jds.load(applicationProjectId);
  if (!loaded) throw new AppError("not_found");
  const jd: JdForExtraction = loaded;
  if (jd.extractionStatus === "succeeded") return { status: "already_extracted" };

  // Connection read here and fixed into the job (F-AI-03 (2)); never trusted from the client.
  let context;
  try {
    context = await deps.providerContext.forUser(deps.userId);
  } catch (err) {
    const code = gateCode(err);
    if (code) return failed(null, code);
    throw err;
  }
  if (!context) return failed(null, "key_missing");
  if (context.keyStatus === "invalid") return failed(null, "key_invalid");

  const job = await openJob(deps, jd, context, timing);
  const gen = job.runGeneration;
  const jobId = job.id;

  const close = async (status: "failed" | "canceled", code: AiErrorCode, times: { retryAfter?: Date | null; quotaResetsAt?: Date | null } = {}) => {
    const at = now().toISOString();
    try {
      await deps.store.finish(jobId, gen, {
        status,
        errorCode: code,
        finishedAt: at,
        heartbeatAt: at,
        nextRunAt: null,
        retryAfter: times.retryAfter?.toISOString() ?? null,
        quotaResetsAt: times.quotaResetsAt?.toISOString() ?? null,
      });
    } catch {
      log("jd_extraction.close_failed", { jobId });
    }
  };

  // QA-S3b-01: key deleted / consent withdrawn between the read above and now.
  if (deps.runGate) {
    let gate: AiErrorCode | null;
    try {
      gate = await deps.runGate(jobId);
    } catch (err) {
      await close("failed", "stalled");
      throw err;
    }
    if (gate) {
      await close("failed", gate);
      return failed(jobId, gate);
    }
  }

  try {
    await deps.jds.begin(jd.jobDescriptionId, jobId);
  } catch (err) {
    // No provider call happened: the run is canceled, not failed.
    await close("canceled", "canceled");
    if (err instanceof AppError && err.code === "already_extracted") return { status: "already_extracted" };
    throw err;
  }
  log("jd_extraction.started", { jobId, provider: job.provider, connectionTier: job.connectionTier, sentences: jd.sentences.length });

  // ---- run (heartbeat → cancel / lost; deadline) ----
  const runAbort = new AbortController();
  let lost = false;
  const beat = setInterval(() => {
    void deps.store
      .heartbeat(jobId, gen, now().toISOString())
      .then((h) => {
        if (!h.current) {
          lost = true; // project deleted (row cascaded) or another actor closed the job
          runAbort.abort("lost");
        } else if (h.cancelRequested) {
          runAbort.abort("canceled");
        }
      })
      .catch(() => log("jd_extraction.heartbeat_failed", { jobId }));
  }, timing.heartbeatMs);

  const llms: Llm[] = [];
  const onCall = createUsageRecorder({ store: deps.usage, job, priceFor: createPriceCache(deps.usage), now, log });
  const deadline = startedAt + timing.budgetMs;
  const remaining = () => deadline - now().getTime();
  const keyErrors: AiError[] = [];
  const retriesByCode: Partial<Record<AiErrorCode, number>> = {};

  type Outcome = { ok: true; payload: unknown; model: string; promptVersion: string } | { ok: false; error: AiError; retries: number; quotaResetsAt: Date | null };
  let outcome: Outcome;
  try {
    for (;;) {
      const room = remaining();
      if (runAbort.signal.aborted) {
        outcome = { ok: false, error: new AiError("canceled"), retries: 0, quotaResetsAt: null };
        break;
      }
      const call = callSignal(runAbort.signal, Math.min(timing.callTimeoutMs[job.connectionTier], Math.max(room, timing.minCallMs)));
      try {
        const llm = deps.createLlm({
          provider: job.provider,
          tier: JD_EXTRACTION_TIER,
          connectionTier: job.connectionTier,
          keySource: { forJob: (id: string) => deps.keySource.forJob(id, job.provider) },
          jobId,
          signal: call.signal,
          onCall,
        });
        llms.push(llm);
        const result = await deps.extract(
          { sentences: jd.sentences, companyName: jd.companyNameSource === "user" ? jd.companyName : null, positionTitle: jd.positionTitleSource === "user" ? jd.positionTitle : null },
          { llm, signal: call.signal, callKey: "jd_extraction", jobId },
        );
        outcome = { ok: true, ...result };
        break;
      } catch (thrown) {
        const err = toFailure(thrown, call.signal);
        if (err.code === "key_invalid" || isKeyFailureCause(failureCauseOf(err.code))) keyErrors.push(err);
        const retries = retriesByCode[err.code] ?? 0;
        const decision = decideRetry({ error: err, retriesSoFar: retries, waitUsedMs: 0, now: now(), random: () => 0 });
        const canRetry = !runAbort.signal.aborted && err.code !== "canceled";
        if (canRetry && decision.kind === "retry_now" && remaining() >= timing.minCallMs) {
          retriesByCode[err.code] = retries + 1;
          log("jd_extraction.retry", { jobId, code: err.code, waitMs: 0 });
          continue;
        }
        if (canRetry && decision.kind === "retry_at" && decision.waitMs <= timing.maxInlineWaitMs && remaining() - decision.waitMs >= timing.minCallMs) {
          retriesByCode[err.code] = retries + 1;
          log("jd_extraction.retry", { jobId, code: err.code, waitMs: decision.waitMs });
          await sleep(decision.waitMs, runAbort.signal);
          continue;
        }
        if (!isAiError(thrown)) log("jd_extraction.unclassified_error", { jobId });
        outcome = {
          ok: false,
          error: err,
          retries,
          quotaResetsAt: decision.kind === "fail" ? decision.quotaResetsAt : isProviderError(err) ? (err.quotaResetsAt ?? null) : null,
        };
        break;
      } finally {
        call.clear();
      }
    }
  } finally {
    clearInterval(beat);
  }

  let result: EnsureJdResult;
  if (outcome.ok) {
    result = await finishSuccess(outcome);
  } else {
    result = await finishFailure(outcome);
  }

  // Exactly one usage record per provider call, also for calls cut by the deadline (QA-S3a-03).
  await Promise.all(llms.map((l) => l.settle(timing.usageSettleMs).catch(() => undefined)));
  await reportKeyStatus(result);
  log("jd_extraction.finished", { jobId, result: result.status === "failed" ? result.code : result.status, calls: llms.length });
  return result;

  async function finishSuccess(ok: Extract<Outcome, { ok: true }>): Promise<EnsureJdResult> {
    let applied: { applied: boolean };
    try {
      await deps.store.update(jobId, gen, { promptVersion: ok.promptVersion, model: ok.model, heartbeatAt: now().toISOString() });
      applied = await deps.jds.apply({ jobDescriptionId: jd.jobDescriptionId, jobId, runGeneration: gen, payload: ok.payload, provider: job.provider, model: ok.model });
    } catch (err) {
      if (err instanceof AppError && err.code === "not_found") {
        // The project was deleted while the call ran (FL-06): same as cancel.
        await close("canceled", "canceled");
        return failed(jobId, "canceled");
      }
      if (err instanceof AppError && err.code === "user_edited_requirements_exist") {
        // QA-S5-02: never leave the JD `running`. The JD ends `failed` (its last job = this canceled one,
        // shown as lastFailure) and the route answers 409 so the screen can ask before re-extracting (AI-01 저장).
        await deps.jds.fail(jd.jobDescriptionId, jobId).catch(() => false);
        await close("canceled", "canceled");
        throw err;
      }
      log("jd_extraction.apply_failed", { jobId, dbCode: err instanceof AppError ? String(err.code) : "unknown" });
      await deps.jds.fail(jd.jobDescriptionId, jobId).catch(() => false);
      await close("failed", "stalled");
      return failed(jobId, "stalled");
    }
    if (!applied.applied) {
      // A newer run owns the extraction (or the job was closed meanwhile): this one is lost.
      log("jd_extraction.stale_run", { jobId });
      await close("canceled", "canceled");
      return failed(jobId, "canceled");
    }
    const completed = await deps.store.complete(jobId, gen, { stage: JD_EXTRACTION_STAGE, done: 1, total: 1 }).catch(() => false);
    if (!completed) log("jd_extraction.complete_failed", { jobId });
    return { status: "succeeded", jobId };
  }

  async function finishFailure(f: Extract<Outcome, { ok: false }>): Promise<EnsureJdResult> {
    const canceled = f.error.code === "canceled" || lost;
    if (canceled) {
      await deps.jds.fail(jd.jobDescriptionId, jobId).catch(() => false);
      await close("canceled", "canceled");
      return failed(jobId, "canceled");
    }
    const retryAfter = finalRetryAfter(f.error, f.retries, now().getTime());
    try {
      await deps.jds.fail(jd.jobDescriptionId, jobId);
    } catch {
      log("jd_extraction.fail_record_failed", { jobId });
    }
    await close("failed", f.error.code, { retryAfter, quotaResetsAt: f.quotaResetsAt });
    return failed(jobId, f.error.code, { retryAfter, quotaResetsAt: f.quotaResetsAt });
  }

  async function reportKeyStatus(r: EnsureJdResult): Promise<void> {
    try {
      if (keyErrors.some((e) => e.code === "key_invalid")) {
        await deps.keyStatus.markInvalid(jobId);
        return;
      }
      if (r.status === "failed") {
        const cause = failureCauseOf(r.code);
        if (isKeyFailureCause(cause) && cause !== "key_invalid") await deps.keyStatus.recordFailure(jobId, cause);
        return;
      }
      if (r.status === "succeeded") await deps.keyStatus.recordSuccess(jobId);
    } catch {
      log("jd_extraction.key_status_report_failed", { jobId });
    }
  }
}
