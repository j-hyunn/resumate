import { AI_ERROR_MESSAGES, errorCategoryOf, failureCauseOf, isManuallyRetryable, type AiJobStatusResponse } from "@/lib/contracts/ai";
import type { JobRecord } from "./types";

/**
 * ai_jobs row → `useAiJob` response (+ v4 fields, S3a plan API 8).
 * `step_outputs`, params, and hashes stay server-side; `partial` is filled per
 * feature from its own result tables.
 */
export function toAiJobStatusResponse(job: JobRecord, partial: unknown = null): AiJobStatusResponse {
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
    canRetry: job.status === "failed" && code !== null && isManuallyRetryable(code),
    updatedAt: job.updatedAt,
  };
}
