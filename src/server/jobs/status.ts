import { AI_ERROR_MESSAGES, errorCategoryOf, type AiJobStatusResponse } from "@/lib/contracts/ai";
import type { JobRecord } from "./types";

/**
 * ai_jobs row → `useAiJob` response. `step_outputs`, params, and hashes stay
 * server-side; `partial` is filled per feature from its own result tables (S5+).
 */
export function toAiJobStatusResponse(job: JobRecord, partial: unknown = null): AiJobStatusResponse {
  const category = job.errorCode ? errorCategoryOf(job.errorCode) : null;
  return {
    jobId: job.id,
    jobType: job.jobType,
    status: job.status,
    progress: job.progress,
    partial,
    error:
      job.errorCode && category && (job.status === "failed" || job.status === "canceled")
        ? { code: job.errorCode, category, message: AI_ERROR_MESSAGES[category] }
        : null,
    attemptCount: job.attemptCount,
    cancelRequested: job.cancelRequestedAt !== null,
    canRetry: job.status === "failed" && category !== null && category !== "input" && category !== "canceled",
    updatedAt: job.updatedAt,
  };
}
