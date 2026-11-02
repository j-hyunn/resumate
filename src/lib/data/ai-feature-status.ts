/**
 * C-03 "진행 표시 우선순위" (02 C-03 v5.3, design-system 3.3 v3 `AiFeatureStatus`) for list rows and
 * cards (S-13 기능 진행 칸, S-31 기능 카드, S-39 카드, S-16 머리). Client-safe, pure.
 *
 * ① the feature's job is queued / running → "generating" (even with an earlier result)
 * ② else the latest result exists → "present"
 * ③ else → "none"
 * Failure line (under ② / ③): only a failure that ended **after** the visible result —
 * a failed job → its cause; a result still marked "생성 중" whose job ended or is gone → `stalled`
 * ("시간이 오래 걸려 중단됐어요"); a canceled job → nothing. // [UI-가정] (02: 구현 반영 [가정])
 */
import type { AiErrorCode, AiJob, AiJobProgress, AiJobType, AiProviderName } from "@/types/db"

export type AiFeatureStatusKind = "generating" | "present" | "none"

export interface AiFeatureStatusView {
  kind: AiFeatureStatusKind
  job_type: AiJobType | null
  /** C-03 축약형 while generating */
  progress: AiJobProgress | null
  /**
   * late failure line; `stalled` = the job ended (or is gone) without a result. v5.3 (A3 request 3):
   * `job` carries the failed job row's id and C-20 fields so a screen can offer the **same-row**
   * retry — `aiErrorFromJob(failure.job)` + `retryAiJobAction(failure.job.id)` ("처음부터 다시").
   */
  failure: {
    error_code: AiErrorCode
    provider: AiProviderName | null
    job: Pick<AiJob, "id" | "job_type" | "error_code" | "provider" | "connection_tier" | "retry_after" | "quota_resets_at"> | null
  } | null
}

export type FeatureJob = Pick<
  AiJob,
  "id" | "status" | "job_type" | "progress" | "error_code" | "provider" | "connection_tier" | "retry_after" | "quota_resets_at" | "finished_at" | "created_at"
>

export function resolveAiFeatureStatus(input: {
  /** latest job of this feature on this target (any status), or null */
  job: FeatureJob | null
  /** when the latest finished result was completed (null = no result) */
  resultAt: string | null
  /** a result row still says "생성 중" (insight generating, questions generating …) */
  resultPending?: boolean
  /** job_descriptions.raw_text_edited_at (Q53-2): failures that ended earlier are not shown */
  failuresAfter?: string | null
}): AiFeatureStatusView {
  const { job, resultAt, resultPending, failuresAfter } = input
  const jobType = job?.job_type ?? null
  if (job && (job.status === "queued" || job.status === "running"))
    return { kind: "generating", job_type: jobType, progress: job.progress, failure: null }
  const kind: AiFeatureStatusKind = resultAt ? "present" : "none"
  let failure: AiFeatureStatusView["failure"] = null
  const endedAt = job?.finished_at ?? job?.created_at ?? null
  if (failuresAfter && endedAt !== null && endedAt < failuresAfter) return { kind, job_type: jobType, progress: null, failure: null }
  const later = !resultAt || (endedAt !== null && endedAt > resultAt)
  const ref = job
    ? {
        id: job.id,
        job_type: job.job_type,
        error_code: job.error_code,
        provider: job.provider,
        connection_tier: job.connection_tier,
        retry_after: job.retry_after,
        quota_resets_at: job.quota_resets_at,
      }
    : null
  if (job?.status === "failed" && later) failure = { error_code: job.error_code ?? "stalled", provider: job.provider, job: ref }
  else if (resultPending && job?.status !== "canceled" && (!job || job.status === "succeeded"))
    failure = { error_code: "stalled", provider: job?.provider ?? null, job: null }
  return { kind, job_type: jobType, progress: null, failure }
}
