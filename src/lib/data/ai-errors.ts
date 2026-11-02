/**
 * Generated-column rules of ai_jobs (04 §2.9.1), client-safe: error_code → error_category /
 * failure_cause. The mock computes them the same way the DB generated columns will.
 */
import type { AiErrorCategory, AiErrorCode, AiFailureCause, AiGateRefusalCode, AiJobType } from "@/types/db"

export function errorCategoryOf(code: AiErrorCode): AiErrorCategory {
  switch (code) {
    case "rate_limited":
    case "daily_quota_exhausted":
      return "provider_limit"
    case "billing_required":
    case "key_invalid":
    case "key_missing":
    case "model_not_available":
      return "user_account"
    case "provider_unavailable":
      return "transient"
    case "input_too_long":
    case "safety_blocked":
    case "insufficient_data":
    case "not_a_jd":
      return "input"
    default:
      return "system"
  }
}

export function failureCauseOf(code: AiErrorCode): AiFailureCause | null {
  switch (code) {
    case "rate_limited":
    case "daily_quota_exhausted":
    case "billing_required":
    case "key_invalid":
    case "model_not_available":
    case "provider_unavailable":
      return code
    case "input_too_long":
    case "safety_blocked":
      return "input_rejected"
    default:
      return null
  }
}

/** The 7 F-AI-08 causes in display order */
export const FAILURE_CAUSES: readonly AiFailureCause[] = [
  "rate_limited",
  "daily_quota_exhausted",
  "billing_required",
  "key_invalid",
  "model_not_available",
  "provider_unavailable",
  "input_rejected",
]

/** Representative error_code for a cause (mock injection, previews) */
export function codeForCause(cause: AiFailureCause): AiErrorCode {
  return cause === "input_rejected" ? "input_too_long" : cause
}

/** Gemini free tier: daily quota resets at Pacific midnight = KST 16:00 (02 C-20 [가정], DST ignored) */
export function nextQuotaReset(now = Date.now()): string {
  const kst = new Date(now + 9 * 3_600_000)
  const reset = Date.UTC(kst.getUTCFullYear(), kst.getUTCMonth(), kst.getUTCDate(), 16, 0, 0) - 9 * 3_600_000
  return new Date(reset > now ? reset : reset + 86_400_000).toISOString()
}

/** error_code-specific timestamps of a failed job (mock + `?state=` previews): retry_after = now + 2:30 */
export function failureTimestamps(code: AiErrorCode, now = Date.now()) {
  return {
    quota_resets_at: code === "daily_quota_exhausted" ? nextQuotaReset(now) : null,
    retry_after: code === "rate_limited" || code === "provider_unavailable" ? new Date(now + 150_000).toISOString() : null,
  }
}

/** Input-caused failures (R-69): no "다시 시도" — fix the input, then run again */
export function isInputCausedFailure(code: AiErrorCode | null | undefined): boolean {
  return code === "input_too_long" || code === "safety_blocked" || code === "not_a_jd" || code === "insufficient_data"
}

/** Async job types retried on the same row (POST /api/ai-jobs/{id}/retry, 04 §2.9.1 경우 (1)) */
export const SAME_ROW_RETRY_JOB_TYPES: readonly AiJobType[] = ["insight", "interview_questions", "interview_evaluation"]

/** Request-path failures that wait for retry_after (A14): chat turn, document stream, JD extraction */
export function isRequestPathWait(code: AiErrorCode | null | undefined): boolean {
  return code === "rate_limited" || code === "provider_unavailable"
}

/**
 * Server-side refusal of an AI start / retry (FL-08 키 확인이 먼저, UQ-320). Actions wrapped with
 * `withAiGuard` return this instead of throwing, and **nothing was changed** on the server.
 *
 * - `rejected`: an ai_jobs error_code kept for older callers (C-20 copy): key_missing / key_invalid …
 * - `refusal` (v5.3): the exact 04 §2.11.7 code when the path has one — ① new job start
 *   ai_not_connected / ai_consent_required / key_invalid, ② same-row retry ai_job_not_retryable /
 *   key_missing / key_invalid / ai_consent_required / ai_connection_changed. Paths ④⑤ (chat turn,
 *   documents, JD extraction) only give `rejected` (consent folds into key_missing — re-read
 *   readiness: `consent_required` tells the consent cause apart).
 */
export interface AiRejected {
  rejected: AiErrorCode
  refusal?: AiGateRefusalCode | null
}

/** error_code shown for a refusal code (compat value of AiRejected.rejected) */
export function refusalErrorCode(code: AiGateRefusalCode): AiErrorCode {
  switch (code) {
    case "key_invalid":
      return "key_invalid"
    case "ai_connection_changed":
      return "provider_unavailable"
    case "ai_job_not_retryable":
      return "schema_invalid"
    default:
      // ai_not_connected / ai_consent_required / key_missing
      return "key_missing"
  }
}

export function isAiRejected(value: unknown): value is AiRejected {
  return typeof value === "object" && value !== null && "rejected" in value
}
