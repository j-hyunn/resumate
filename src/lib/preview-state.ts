/**
 * `?state=` preview switch (ui-context.md "State preview switch", patterns.md §9).
 * Development only: in production builds every helper returns null.
 *
 * Server pages:   const state = getPreviewState(await searchParams)
 * Client parts:   const state = usePreviewState()   (from "@/components/common/preview-state-client")
 *
 * Each screen documents which values it supports in its area report.
 */

export const PREVIEW_STATES = [
  "empty",
  "loading",
  "error",
  "not-found",
  "unauth",
  "ai-pending",
  "ai-waiting",
  "ai-stream",
  "ai-sync",
  // v4 BYOK: AI 연결 상태 (C-18 / C-19 / ST-AI-KEY-*)
  "ai-locked",
  "key-invalid",
  "key-check",
  "key-missing",
  // C-20 원인 7종 + 시스템·입력 (ST-AI-FAILED 대체)
  "ai-failed-rate-limited",
  "ai-failed-daily-quota",
  // C-20 daily_quota_exhausted with the reset line (OD-B1: only when quota_resets_at is known) — UQ-389
  "ai-failed-daily-quota-reset",
  "ai-failed-billing",
  "ai-failed-key-invalid",
  "ai-failed-model",
  "ai-failed-provider",
  "ai-failed-input-rejected",
  "ai-failed-safety",
  "ai-failed",
  "ai-failed-input",
  "ai-failed-timeout",
  "insufficient",
  "insufficient-no-experience",
  "save-failed",
  "wait-jd",
  "move-failed",
  "ai-outage",
  "return-banner",
  // C-21 데이터 사용 고지·동의 (/dev/states section, S-41 ②)
  "consent",
  // --- v5.3 (기획 v5.3 / DM v4.2) ---------------------------------------------------------
  // C-18 R-67: consent_required → run buttons open C-21 (동의 창형) before any AI run
  "consent-required",
  // C-20 same-row retry on another provider / tier → "{활성 공급자}로 처음부터 다시 해요"
  "retry-other-provider",
  // C-20 retry refusals (409, 04 §2.11.7 ②) — action row only
  "retry-refused-key-missing",
  "retry-refused-consent",
  "retry-refused-key-invalid",
  "retry-connection-changed",
  "retry-not-retryable",
  // C-20 input-caused failure: no retry, "고친 뒤 … 새로 실행해 주세요" (R-69)
  "input-failed",
  // C-20 A14 request path: "{N}초 뒤 다시 보낼 수 있어요" + countdown retry
  "request-wait",
  // C-04 "마무리 중" (validated pending, edit / copy disabled)
  "finalizing",
  // W5: 커리어 폼 저장 충돌 ((v5.20, CL-7) S-19 초안 편집기 폐기로 `stopping`은 뺐다)
  "save-conflict",
  "multi-detail",
  // C-09 hint project_fields (A18)
  "insufficient-project-fields",
  // S-25 (A7): account_deletion_busy / 탈퇴 마무리 상태
  "deletion-busy",
  "deletion-incomplete",
  // --- Q53 (기획 v5.4 / DM v4.3): the /dev/states gallery links every screen-specific value ------
  "q53",
] as const

export type SharedPreviewState = (typeof PREVIEW_STATES)[number]
/** Screen-specific values are allowed too (documented per screen). */
export type PreviewState = SharedPreviewState | (string & {})

export const isPreviewEnabled = process.env.NODE_ENV !== "production"

type SearchParamsLike = Record<string, string | string[] | undefined> | URLSearchParams | null | undefined

export function readPreviewState(params: SearchParamsLike): PreviewState | null {
  if (!isPreviewEnabled || !params) return null
  const raw = params instanceof URLSearchParams ? params.get("state") : params.state
  const value = Array.isArray(raw) ? raw[0] : raw
  return value ? (value as PreviewState) : null
}

/** Server-side helper; pass the awaited `searchParams` of a page. */
export function getPreviewState(searchParams: SearchParamsLike): PreviewState | null {
  return readPreviewState(searchParams)
}

/** A redirect target that keeps the previewed `?state=` (so a moved screen keeps its preview, e.g. U36-1). */
export function withPreviewState(path: string, state: PreviewState | null): string {
  if (!state) return path
  return `${path}${path.includes("?") ? "&" : "?"}state=${encodeURIComponent(state)}`
}

/**
 * `?state=` → the error_code a failed AI run shows (C-20). v4: ai-failed = system schema_invalid,
 * ai-failed-input = not_a_jd, ai-failed-timeout = timeout, ai-failed-<cause> = the 7 causes,
 * key-missing = ST-AI-KEY-MISSING. `limit` was removed (no service limit, D-34).
 */
export function previewErrorCode(
  state: PreviewState | null,
):
  | "rate_limited"
  | "daily_quota_exhausted"
  | "billing_required"
  | "key_invalid"
  | "key_missing"
  | "model_not_available"
  | "provider_unavailable"
  | "input_too_long"
  | "safety_blocked"
  | "schema_invalid"
  | "not_a_jd"
  | "timeout"
  | null {
  switch (state) {
    case "ai-failed-rate-limited":
      return "rate_limited"
    case "ai-failed-daily-quota":
    case "ai-failed-daily-quota-reset":
      return "daily_quota_exhausted"
    case "ai-failed-billing":
      return "billing_required"
    case "ai-failed-key-invalid":
      return "key_invalid"
    case "key-missing":
      return "key_missing"
    case "ai-failed-model":
      return "model_not_available"
    case "ai-failed-provider":
      return "provider_unavailable"
    case "ai-failed-input-rejected":
      return "input_too_long"
    case "ai-failed-safety":
      return "safety_blocked"
    case "ai-failed":
      return "schema_invalid"
    case "ai-failed-input":
      return "not_a_jd"
    case "ai-failed-timeout":
      return "timeout"
    // v5.3: input-caused (no retry) / request-path wait / retry previews use a retryable cause
    case "input-failed":
      return "input_too_long"
    case "request-wait":
      return "rate_limited"
    case "retry-other-provider":
    case "retry-refused-key-missing":
    case "retry-refused-consent":
    case "retry-refused-key-invalid":
    case "retry-connection-changed":
    case "retry-not-retryable":
      return "provider_unavailable"
    default:
      return null
  }
}

/** `?state=` values that override ai_connection (ai-locked / key-invalid / key-check / consent-required) */
export function isConnectionPreview(state: PreviewState | null): boolean {
  return state === "ai-locked" || state === "key-invalid" || state === "key-check" || state === "consent-required"
}

/** v5.3 `?state=retry-*` → the retry refusal code to pass as <AiErrorNotice refusal={…} /> */
export function previewRetryRefusal(
  state: PreviewState | null,
): "key_missing" | "ai_consent_required" | "key_invalid" | "ai_connection_changed" | "ai_job_not_retryable" | null {
  switch (state) {
    case "retry-refused-key-missing":
      return "key_missing"
    case "retry-refused-consent":
      return "ai_consent_required"
    case "retry-refused-key-invalid":
      return "key_invalid"
    case "retry-connection-changed":
      return "ai_connection_changed"
    case "retry-not-retryable":
      return "ai_job_not_retryable"
    default:
      return null
  }
}
