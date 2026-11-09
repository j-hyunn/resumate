import { randomUUID } from "node:crypto";
import { failureCauseOf } from "@/lib/contracts/ai";
import type { ExtractJdPreviewResult } from "@/lib/contracts/application";
import type { AiErrorCode, AiProvider, ConnectionTier } from "@/lib/contracts/enums";
import { AppError } from "@/lib/contracts/errors";
import { splitJdSentences, type JdSentence } from "@/server/ai/context-pack/jd";
import { AiError, finalRetryAfter, isAiError, isProviderError } from "@/server/ai/errors";
import { sha256Hex } from "@/server/ai/hash";
import type { Llm } from "@/server/ai/llm";
import { resolveModel } from "@/server/ai/providers/models";
import { isKeyFailureCause, type KeySource, type KeyStatusReporter, type ProviderContextSource } from "@/server/jobs/provider-context";
import { decideRetry } from "@/server/jobs/retry";
import type { JobRecord, JobStore, LlmFactoryInput, UsageStore } from "@/server/jobs/types";
import { createPriceCache, createUsageRecorder } from "@/server/jobs/usage-recorder";
import { JD_EXTRACTION_STAGE, JD_EXTRACTION_TIER, type JdExtractionTiming, type Log } from "./extraction";
import { normalizeJdRawText } from "./raw-text";

/**
 * A2 (R15, CF-A17 ★ / DM 2.6.2 / 11.10 #5a): 요건 미리 보기 —
 * `POST /api/job-descriptions/extract-preview`, synchronous.
 *
 * S-14 단계 1 ends with [다음], which runs AI-01 **before** any row exists, so
 * 단계 2 can show the company, the position, the deadline and how many
 * requirements were found. The result is kept **on the server**, in one
 * `ai_jobs` row with `target_type = 'jd_preview'`, `target_id` null and
 * `application_project_id` null, and the response carries only a summary.
 * `create_application_project` then takes `p_preview_job_id`, recomputes the
 * hash from its own `p_raw_text` and reads the requirements out of that row's
 * `output` — so the screen can never submit requirements of its own as
 * `origin = 'ai'` (the same property as CF-S1). Do not change this shape.
 *
 * Differences from `ensureJdExtracted` (the 생성 뒤 extraction):
 *   - there is no `job_descriptions` row, so no `begin` / `apply` / `fail`;
 *     the validated result is written to `ai_jobs.output` and the job completes.
 *   - `params = {raw_text_hash, sentence_count}` is what the create RPC checks
 *     against (it recomputes the hash itself, db notes ②-3).
 *   - the Q53-1 connection gate answers **409 and builds no job row** at all
 *     (`key_invalid` / `ai_consent_required`), because a row with no target is
 *     not retryable and must not show up in the usage meter for nothing.
 *   - it is **not** on the generic retry path: a failure is final for this
 *     request; the user presses [다음] again, or creates the 자기소개서 without
 *     a preview and runs the ordinary extraction (D-30).
 *
 * One `ai_usage_records` row per provider call, `feature = 'jd_extraction'`,
 * `application_project_id` null until the create RPC links the job.
 *
 * C-7 / NFR-PRV-09: logs carry ids, codes and counts — never the JD text.
 */

export const JD_PREVIEW_TARGET_TYPE = "jd_preview";

export type JdPreviewExtractor = (
  input: { sentences: readonly JdSentence[]; companyName: string | null; positionTitle: string | null; today: string | null },
  deps: { llm: Llm; signal: AbortSignal; callKey: string; jobId: string },
) => Promise<{ payload: unknown; summary: Omit<ExtractJdPreviewResult, "previewJobId">; model: string; promptVersion: string }>;

export type JdPreviewDeps = {
  userId: string;
  store: JobStore;
  usage: UsageStore;
  providerContext: ProviderContextSource;
  keySource: KeySource;
  keyStatus: KeyStatusReporter;
  /** check_ai_run_allowed (app_ai_writer); null = allowed / dev-env mode. */
  runGate: ((jobId: string) => Promise<AiErrorCode | null>) | null;
  createLlm: (input: LlmFactoryInput) => Llm;
  extract: JdPreviewExtractor;
  now?: () => Date;
  newId?: () => string;
  sleep?: (ms: number, signal: AbortSignal) => Promise<void>;
  log?: Log;
  timing?: Partial<JdExtractionTiming>;
  /** KST day the deadline window is measured from (CF-A5); never reaches the prompt. */
  today?: () => string;
};

/** Same budget as the 생성 뒤 extraction (C-6 동기, 15 s target / 30 s cap). */
const DEFAULT_TIMING: JdExtractionTiming = {
  budgetMs: 30_000,
  callTimeoutMs: { paid: 25_000, free: 28_000 },
  maxInlineWaitMs: 5_000,
  minCallMs: 3_000,
  heartbeatMs: 10_000,
  staleMs: 45_000,
  usageSettleMs: 2_000,
};

/** Asia/Seoul `YYYY-MM-DD` (CF-A5: the window check's reference day). */
export function kstToday(now: Date): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Seoul", year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
}

/**
 * The Q53-1 gate refusal (409, plan 1-C A2). `key_invalid` and `ai_consent_required` are the two
 * the screen shows as the F-AI-08 lock; `key_missing` means no active provider at all.
 *
 * Note: `check_ai_run_allowed` collapses consent into `key_missing` by convention
 * (`mapRunGate`), so `ai_consent_required` only comes from the provider-context read above.
 */
export type PreviewGateCode = "key_missing" | "key_invalid" | "ai_consent_required";

function gateRefusal(code: PreviewGateCode): AppError {
  if (code === "key_invalid") return new AppError("key_invalid", "AI 키가 유효하지 않습니다. 키를 확인해 다시 연결해 주세요.", { status: 409 });
  if (code === "ai_consent_required") return new AppError("ai_consent_required", "AI 데이터 사용 고지에 다시 동의해 주세요.", { status: 409 });
  return new AppError("key_missing", "AI 연결이 필요합니다. 키를 등록한 뒤 다시 시도해 주세요.", { status: 409 });
}

function gateCode(err: unknown): PreviewGateCode | null {
  if (err instanceof AppError) {
    if (err.code === "ai_consent_required") return "ai_consent_required";
    if (err.code === "key_missing" || err.code === "ai_not_connected") return "key_missing";
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

function callSignal(parent: AbortSignal, timeoutMs: number): { signal: AbortSignal; clear: () => void } {
  const controller = new AbortController();
  const onParent = () => controller.abort(parent.reason === "canceled" ? "canceled" : "timeout");
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
  return new AiError("stalled", { retryable: false });
}

/** An AI failure of the preview: the screen shows C-11 copy and offers [다음] again. */
function aiFailure(code: AiErrorCode, times: { retryAfter?: Date | null; quotaResetsAt?: Date | null } = {}): AppError {
  const details: Record<string, unknown> = {};
  if (times.retryAfter) details.retryAfter = times.retryAfter.toISOString();
  if (times.quotaResetsAt) details.quotaResetsAt = times.quotaResetsAt.toISOString();
  const message =
    code === "not_a_jd"
      ? "채용 공고로 보이지 않아요. 공고 본문을 붙여 넣었는지 확인해 주세요."
      : "공고 요건을 미리 보지 못했어요. 그대로 만들고 요건 정리하기를 눌러도 돼요.";
  return new AppError(code, message, { status: code === "not_a_jd" ? 422 : 502, ...(Object.keys(details).length > 0 ? { details } : {}) });
}

/**
 * Runs AI-01 on a raw text that has no row yet and returns the 단계 2 summary.
 *
 * Throws AppError: 409 `key_invalid` / `ai_consent_required` / `key_missing` (no job row made),
 * 422 `not_a_jd`, 502 for every other C-11 failure (the job row ends `failed`).
 */
export async function extractJdPreview(deps: JdPreviewDeps, rawText: string, options: { signal?: AbortSignal } = {}): Promise<ExtractJdPreviewResult> {
  const now = deps.now ?? (() => new Date());
  const log = deps.log ?? (() => {});
  const timing: JdExtractionTiming = { ...DEFAULT_TIMING, ...deps.timing };
  const sleep = deps.sleep ?? defaultSleep;
  const startedAt = now().getTime();

  // A3: one normalized string — the same code the create RPC's hash is recomputed against.
  const normalized = normalizeJdRawText(rawText);
  const sentences = splitJdSentences(normalized);
  const rawTextHash = sha256Hex(normalized);

  // The connection is read before anything is written and fixed into the job (F-AI-03 (2)).
  let context: { provider: AiProvider; connectionTier: ConnectionTier; keyStatus: string } | null;
  try {
    context = await deps.providerContext.forUser(deps.userId);
  } catch (err) {
    const code = gateCode(err);
    if (code) throw gateRefusal(code);
    throw err;
  }
  if (!context) throw gateRefusal("key_missing");
  if (context.keyStatus === "invalid") throw gateRefusal("key_invalid");

  const jobId = (deps.newId ?? randomUUID)();
  const model = resolveModel(context.provider, JD_EXTRACTION_TIER);
  await deps.store.insert({
    id: jobId,
    userId: deps.userId,
    jobType: "jd_extraction",
    // DM 2.6.2: both null until `create_application_project` links the row.
    applicationProjectId: null,
    targetType: JD_PREVIEW_TARGET_TYPE,
    targetId: null,
    provider: context.provider,
    modelTier: JD_EXTRACTION_TIER,
    connectionTier: context.connectionTier,
    // What the create RPC checks the submitted raw text against (it recomputes the hash itself).
    params: { raw_text_hash: rawTextHash, sentence_count: sentences.length },
    inputHash: null,
    promptVersion: null,
    model,
    progress: { stage: JD_EXTRACTION_STAGE, done: 0, total: 1 },
    meta: { runBase: 1, waitBase: 0, retries: {} },
  });
  const job = await deps.store.claim(jobId, { now: now().toISOString(), staleBefore: new Date(now().getTime() + 1_000).toISOString() });
  if (!job) throw new AppError("internal_error", undefined, { status: 500 });
  const gen = job.runGeneration;

  const close = async (status: "failed" | "canceled", code: AiErrorCode, times: { retryAfter?: Date | null; quotaResetsAt?: Date | null } = {}) => {
    const at = now().toISOString();
    try {
      await deps.store.finish(jobId, gen, {
        status,
        errorCode: code,
        finishedAt: at,
        heartbeatAt: at,
        // Never scheduled: the preview is not on the retry path (plan 1-C A2).
        nextRunAt: null,
        retryAfter: times.retryAfter?.toISOString() ?? null,
        quotaResetsAt: times.quotaResetsAt?.toISOString() ?? null,
      });
    } catch {
      log("jd_preview.close_failed", { jobId });
    }
  };

  // QA-S3b-01: key deleted / consent withdrawn between the read above and now. The row exists by
  // now, so it is closed `failed` with the gate code (it stays out of the create RPC's reach
  // because only a `succeeded` preview is applied).
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
      throw gateRefusal(gate === "key_invalid" ? "key_invalid" : "key_missing");
    }
  }

  log("jd_preview.started", { jobId, provider: job.provider, connectionTier: job.connectionTier, sentences: sentences.length });

  const runAbort = new AbortController();
  const onCallerAbort = () => runAbort.abort("canceled");
  if (options.signal?.aborted) onCallerAbort();
  else options.signal?.addEventListener("abort", onCallerAbort, { once: true });
  const beat = setInterval(() => {
    void deps.store
      .heartbeat(jobId, gen, now().toISOString())
      .then((h) => {
        if (!h.current) runAbort.abort("lost");
        else if (h.cancelRequested) runAbort.abort("canceled");
      })
      .catch(() => log("jd_preview.heartbeat_failed", { jobId }));
  }, timing.heartbeatMs);

  const llms: Llm[] = [];
  const onCall = createUsageRecorder({ store: deps.usage, job: job as JobRecord, priceFor: createPriceCache(deps.usage), now, log });
  const deadline = startedAt + timing.budgetMs;
  const remaining = () => deadline - now().getTime();
  const keyErrors: AiError[] = [];
  const retriesByCode: Partial<Record<AiErrorCode, number>> = {};
  const today = (deps.today ?? (() => kstToday(now())))();

  type Outcome =
    | { ok: true; payload: unknown; summary: Omit<ExtractJdPreviewResult, "previewJobId">; model: string; promptVersion: string }
    | { ok: false; error: AiError; retries: number; quotaResetsAt: Date | null };
  let outcome: Outcome;
  try {
    for (;;) {
      if (runAbort.signal.aborted) {
        outcome = { ok: false, error: new AiError("canceled"), retries: 0, quotaResetsAt: null };
        break;
      }
      const room = remaining();
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
        // CF-A6: 단계 1 has no user-entered company / position, and a `JobPosting` value is never
        // handed to the model — both go in as null.
        const result = await deps.extract({ sentences, companyName: null, positionTitle: null, today }, { llm, signal: call.signal, callKey: "jd_extraction", jobId });
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
          log("jd_preview.retry", { jobId, code: err.code, waitMs: 0 });
          continue;
        }
        if (canRetry && decision.kind === "retry_at" && decision.waitMs <= timing.maxInlineWaitMs && remaining() - decision.waitMs >= timing.minCallMs) {
          retriesByCode[err.code] = retries + 1;
          log("jd_preview.retry", { jobId, code: err.code, waitMs: decision.waitMs });
          await sleep(decision.waitMs, runAbort.signal);
          continue;
        }
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
    options.signal?.removeEventListener("abort", onCallerAbort);
  }

  let thrownError: AppError | null = null;
  let result: ExtractJdPreviewResult | null = null;
  if (outcome.ok) {
    try {
      // CF-A17: the validated result lives on the job row only — never in the response body.
      await deps.store.update(jobId, gen, { promptVersion: outcome.promptVersion, model: outcome.model, output: outcome.payload, heartbeatAt: now().toISOString() });
      const completed = await deps.store.complete(jobId, gen, { stage: JD_EXTRACTION_STAGE, done: 1, total: 1 });
      if (!completed) {
        log("jd_preview.complete_failed", { jobId });
        thrownError = aiFailure("stalled");
      } else {
        result = { previewJobId: jobId, ...outcome.summary };
      }
    } catch {
      log("jd_preview.store_failed", { jobId });
      await close("failed", "stalled");
      thrownError = aiFailure("stalled");
    }
  } else {
    const canceled = outcome.error.code === "canceled";
    const retryAfter = canceled ? null : finalRetryAfter(outcome.error, outcome.retries, now().getTime());
    await close(canceled ? "canceled" : "failed", outcome.error.code, { retryAfter, quotaResetsAt: outcome.quotaResetsAt });
    thrownError = aiFailure(outcome.error.code, { retryAfter, quotaResetsAt: outcome.quotaResetsAt });
  }

  // Exactly one usage record per provider call, also for calls cut by the deadline (QA-S3a-03).
  await Promise.all(llms.map((l) => l.settle(timing.usageSettleMs).catch(() => undefined)));
  try {
    if (keyErrors.some((e) => e.code === "key_invalid")) await deps.keyStatus.markInvalid(jobId);
    else if (result) await deps.keyStatus.recordSuccess(jobId);
    else if (!outcome.ok) {
      const cause = failureCauseOf(outcome.error.code);
      if (isKeyFailureCause(cause) && cause !== "key_invalid") await deps.keyStatus.recordFailure(jobId, cause);
    }
  } catch {
    log("jd_preview.key_status_report_failed", { jobId });
  }
  log("jd_preview.finished", { jobId, result: result ? "succeeded" : (thrownError?.code ?? "failed"), calls: llms.length });
  if (result) return result;
  throw thrownError ?? aiFailure("stalled");
}
