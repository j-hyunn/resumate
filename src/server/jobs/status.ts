import { AI_ERROR_MESSAGES, errorCategoryOf, failureCauseOf, isManuallyRetryable, type AiJobRetryPreview, type AiJobStatusResponse } from "@/lib/contracts/ai";
import type { ActiveConnection, ProviderContextSource } from "./provider-context";
import { REQUEST_SCOPED_JOB_TYPES } from "./runner";
import { insightJobPartial } from "@/server/services/insight/partial";
import type { JobRecord } from "./types";

/** Feature partial results for `useAiJob().partial` (S6: AI-02 stage-1 verdicts). Null when the feature has none. */
export function jobPartial(job: JobRecord): unknown {
  if (job.jobType === "insight") return insightJobPartial(job);
  return null;
}

function canRetryJob(job: JobRecord): boolean {
  return job.status === "failed" && job.errorCode !== null && isManuallyRetryable(job.errorCode);
}

/**
 * Retry badge (UX C-20 / S-40, decisions "A1 세부"): every retry runs on the
 * active provider (C-11.4); a same-row retry starts over when the active
 * provider or tier differs from the job's. Null unless the button applies.
 */
export function retryPreviewOf(job: JobRecord, active: ActiveConnection | null): AiJobRetryPreview | null {
  if (!canRetryJob(job)) return null;
  if (!active) return { provider: null, fromScratch: false };
  const sameRow = !REQUEST_SCOPED_JOB_TYPES.has(job.jobType);
  return {
    provider: active.provider,
    fromScratch: sameRow && (active.provider !== job.provider || active.connectionTier !== job.connectionTier),
  };
}

/** Reads the active connection only when the preview needs it (failed + retryable). Display only: errors → null. */
export async function loadActiveForPreview(job: JobRecord, source: ProviderContextSource, userId: string): Promise<ActiveConnection | null> {
  if (!canRetryJob(job)) return null;
  try {
    return await source.peekActive(userId);
  } catch {
    return null;
  }
}

/**
 * ai_jobs row → `useAiJob` response (+ v4 fields, S3a plan API 8).
 * `step_outputs`, params, and hashes stay server-side; `partial` is filled per
 * feature from its own result tables.
 */
export function toAiJobStatusResponse(
  job: JobRecord,
  partial: unknown = jobPartial(job),
  active: ActiveConnection | null = null,
): AiJobStatusResponse {
  const ended = job.status === "failed" || job.status === "canceled";
  const code = ended ? job.errorCode : null;
  const category = code ? errorCategoryOf(code) : null;
  const failureCause = code ? failureCauseOf(code) : null;
  const waiting = job.status === "queued" ? (job.progress.waiting_retry_until ?? null) : null;
  return {
    jobId: job.id,
    jobType: job.jobType,
    status: job.status,
    progress: { stage: job.progress.stage, done: job.progress.done, total: job.progress.total },
    partial,
    error: code && category ? { code, category, failureCause, message: AI_ERROR_MESSAGES[code] } : null,
    errorCategory: category,
    failureCause,
    retryAfter: job.status === "failed" ? job.retryAfter : null,
    quotaResetsAt: job.status === "failed" ? job.quotaResetsAt : null,
    waitingRetryUntil: waiting,
    provider: job.provider,
    modelTier: job.modelTier,
    connectionTier: job.connectionTier,
    retryCount: job.retryCount,
    cancelRequested: job.cancelRequestedAt !== null,
    canRetry: canRetryJob(job),
    retry: retryPreviewOf(job, active),
    updatedAt: job.updatedAt,
  };
}
