import { AI_ERROR_MESSAGES, errorCategoryOf, failureCauseOf, isManuallyRetryable, type AiJobRetryPreview, type AiJobStatusResponse } from "@/lib/contracts/ai";
import type { ActiveConnection, ProviderContextSource } from "./provider-context";
import { REQUEST_SCOPED_JOB_TYPES } from "./runner";
import { insightJobPartial } from "@/server/services/insight/partial";
import { isQuestionsPrepareStale, loadGradingDecisions, type GradingDb } from "@/server/services/interview/grading";
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

/**
 * Q53-5: a failed `interview_evaluation` with no re-grade target can't be retried on the same row
 * (`retry_ai_job` refuses), so the status response offers no retry. QA-W0-04: same for a questions job
 * whose JD was edited after `prepare`. Display only: errors → false, and the retry route still refuses.
 */
export async function loadRetryBlocked(job: JobRecord, db: GradingDb): Promise<boolean> {
  if (!canRetryJob(job)) return false;
  if (job.jobType === "interview_questions") {
    try {
      return await isQuestionsPrepareStale(db, job); // QA-W0-04
    } catch {
      return false;
    }
  }
  if (job.jobType !== "interview_evaluation" || !job.targetId) return false;
  try {
    const decision = (await loadGradingDecisions(db, [job.targetId])).get(job.targetId);
    return decision?.regradeTargetCount === 0;
  } catch {
    return false;
  }
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
  retryBlocked = false,
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
    canRetry: canRetryJob(job) && !retryBlocked,
    retry: retryBlocked ? null : retryPreviewOf(job, active),
    updatedAt: job.updatedAt,
  };
}
