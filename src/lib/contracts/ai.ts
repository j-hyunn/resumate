import { z } from "zod";
import {
  AI_ERROR_CODES,
  AI_JOB_STATUSES,
  AI_JOB_TYPES,
  AI_PROVIDERS,
  CONNECTION_TIERS,
  ERROR_CATEGORIES,
  FAILURE_CAUSES,
  MODEL_TIERS,
  USAGE_FEATURES,
  type AiErrorCode,
  type ErrorCategory,
  type FailureCause,
} from "./enums";

/**
 * AI contracts shared by the server (job runner, SSE routes) and the frontend
 * hooks `useAiJob(jobId) → { status, progress, partial, error }` and
 * `useAiStream(request) → { blocks, status, error, cancel }` (UI patterns §1).
 * Source: AI spec C-6, C-11–C-13, DM §2.9 (v4 BYOK) / A.15–A.16.
 */

// ---------- error category / failure cause (mirrors of the ai_jobs generated columns, C-11.1) ----------

const CATEGORY_BY_CODE: Record<AiErrorCode, ErrorCategory> = {
  rate_limited: "provider_limit",
  daily_quota_exhausted: "provider_limit",
  billing_required: "user_account",
  key_invalid: "user_account",
  key_missing: "user_account",
  model_not_available: "user_account",
  provider_unavailable: "transient",
  input_too_long: "input",
  safety_blocked: "input",
  insufficient_data: "input",
  not_a_jd: "input",
  schema_invalid: "system",
  timeout: "system",
  stalled: "system",
  canceled: "system",
};

const FAILURE_CAUSE_BY_CODE: Partial<Record<AiErrorCode, FailureCause>> = {
  rate_limited: "rate_limited",
  daily_quota_exhausted: "daily_quota_exhausted",
  billing_required: "billing_required",
  key_invalid: "key_invalid",
  model_not_available: "model_not_available",
  provider_unavailable: "provider_unavailable",
  input_too_long: "input_rejected",
  safety_blocked: "input_rejected",
};

/** Same mapping as the DB generated column `error_category` (backend-qa compares the two). */
export function errorCategoryOf(code: AiErrorCode): ErrorCategory {
  return CATEGORY_BY_CODE[code];
}

/** Same mapping as the DB generated column `failure_cause`: F-AI-08 cause, null for the other codes. */
export function failureCauseOf(code: AiErrorCode): FailureCause | null {
  return FAILURE_CAUSE_BY_CODE[code] ?? null;
}

/**
 * Whether the "다시 시도" button applies (manual retry, C-6 실패 처리): every
 * failure except the input category (fix the input and start again). Key and
 * billing causes are retryable once the user fixed the connection.
 */
export function isManuallyRetryable(code: AiErrorCode): boolean {
  return errorCategoryOf(code) !== "input" && code !== "canceled";
}

/**
 * Generic Korean message per code (fallback in API bodies and SSE `error`
 * events). Screens choose their own F-AI-08 / ST-AI-FAILED copy by
 * `failureCause` / `category`. BYOK (D-34): there is no service charge, so the
 * old "사용량은 차감되지 않았습니다" line is gone — failed provider calls may
 * still use the user's tokens (C-13).
 */
export const AI_ERROR_MESSAGES: Record<AiErrorCode, string> = {
  rate_limited: "AI 공급자의 분당 요청 한도에 걸렸습니다. 잠시 후 다시 시도해 주세요.",
  daily_quota_exhausted: "AI 공급자의 일일 한도를 모두 사용했습니다. 한도가 초기화된 뒤 다시 시도해 주세요.",
  billing_required: "AI 공급자 계정의 잔액이나 결제 상태를 확인해 주세요.",
  key_invalid: "AI 키가 유효하지 않습니다. 키를 확인해 다시 연결해 주세요.",
  key_missing: "AI 연결이 필요합니다. 키를 등록한 뒤 다시 시도해 주세요.",
  model_not_available: "현재 연결 등급에서는 이 AI 모델을 쓸 수 없습니다.",
  provider_unavailable: "AI 공급자가 일시적으로 응답하지 않습니다. 잠시 후 다시 시도해 주세요.",
  input_too_long: "입력이 너무 길어 AI가 처리할 수 없습니다.",
  safety_blocked: "AI 공급자의 안전 정책으로 요청이 처리되지 않았습니다.",
  insufficient_data: "커리어 데이터가 부족합니다.",
  not_a_jd: "채용 공고가 아닌 것 같습니다. 내용을 확인해 주세요.",
  schema_invalid: "AI 응답을 처리하지 못했습니다. 다시 시도해 주세요.",
  timeout: "AI 작업 시간이 초과되었습니다. 다시 시도해 주세요.",
  stalled: "AI 작업이 중단되었습니다. 다시 시도해 주세요.",
  canceled: "AI 작업을 중단했습니다.",
};

/** Message for unknown failures (`internal_error`). */
export const AI_INTERNAL_ERROR_MESSAGE = "AI 작업을 완료하지 못했습니다. 잠시 후 다시 시도해 주세요.";

// ---------- enums as zod ----------

export const AiJobTypeSchema = z.enum(AI_JOB_TYPES);
export const AiJobStatusSchema = z.enum(AI_JOB_STATUSES);
export const AiErrorCodeSchema = z.enum(AI_ERROR_CODES);
export const ErrorCategorySchema = z.enum(ERROR_CATEGORIES);
export const FailureCauseSchema = z.enum(FAILURE_CAUSES);
export const UsageFeatureSchema = z.enum(USAGE_FEATURES);
export const AiProviderSchema = z.enum(AI_PROVIDERS);
export const ModelTierSchema = z.enum(MODEL_TIERS);
export const ConnectionTierSchema = z.enum(CONNECTION_TIERS);

/** Route params: job ids are uuids (same rule as S2 ids). */
export const AiJobIdSchema = z.guid();

// ---------- async job (C-6 비동기 작업) ----------

/**
 * Stored ai_jobs.progress `{ stage, done, total, waiting_retry_until? }` (DM §2.9.1).
 * `stage` is a C-6 stage key (null before the first step). `waiting_retry_until`
 * (ISO time) is set while a C-11.3 retry waits (C-12 "한도 대기 중 n초").
 */
export const StoredAiJobProgressSchema = z.object({
  stage: z.string().nullable(),
  done: z.number().int().min(0),
  total: z.number().int().min(0),
  waiting_retry_until: z.string().nullable().optional(),
});
export type StoredAiJobProgress = z.infer<typeof StoredAiJobProgressSchema>;

/** Progress as the `useAiJob` hook sees it (`waitingRetryUntil` is a top-level field of the status). */
export const AiJobProgressSchema = z.object({
  stage: z.string().nullable(),
  done: z.number().int().min(0),
  total: z.number().int().min(0),
});
export type AiJobProgress = z.infer<typeof AiJobProgressSchema>;

export const AiJobErrorSchema = z.object({
  code: AiErrorCodeSchema,
  category: ErrorCategorySchema,
  /** F-AI-08 cause (screens pick the cause copy by it); null for system / key_missing codes. */
  failureCause: FailureCauseSchema.nullable(),
  message: z.string(),
});
export type AiJobError = z.infer<typeof AiJobErrorSchema>;

/**
 * `GET /api/ai-jobs/{id}` response — the `useAiJob` shape (`status`,
 * `progress`, `partial`, `error`) plus ids and the v4 fields (S3a plan API 8).
 * - `partial`: results of completed stages a screen may show early (null until features fill it).
 * - `errorCategory` / `failureCause`: same as `error.category` / `error.failureCause`, null without an error.
 * - `retryAfter`: final rate_limited / provider_unavailable failure → "이 시각 이후 다시 시도".
 * - `quotaResetsAt`: daily_quota_exhausted → provider quota reset time (UTC; screens show KST).
 * - `waitingRetryUntil`: queued and waiting for an automatic retry (C-12 "한도 대기 중 n초"), else null.
 * - `provider` / `modelTier` / `connectionTier`: the current run's values — fixed while it runs
 *   (F-AI-03 (2)); a same-row manual retry replaces them with the active ones (C-11.4, A1 R2).
 * - `retryCount`: automatic retries so far (C-11.3).
 * - `canRetry`: failed and the "다시 시도" button applies (not the input category).
 * - `retry`: badge preview for that button (UX C-20 / S-40), null unless `canRetry`.
 */
/**
 * Retry badge preview (UX C-20 / S-40, decisions "A1 세부"): which provider "다시 시도" will use.
 * - `provider`: the ACTIVE provider now (C-11.4: every retry runs on it); null = no active
 *   provider / key (the button leads to "AI 연결 필요").
 * - `fromScratch`: a same-row retry (insight / interview_questions / interview_evaluation)
 *   whose active provider or connection tier differs from the job's → "{provider}로 처음부터
 *   다시 해요". Always false for request-scoped jobs (their retry is a new job anyway) and
 *   when `provider` is null.
 * Display only; the retry request re-checks everything.
 */
export const AiJobRetryPreviewSchema = z.object({
  provider: AiProviderSchema.nullable(),
  fromScratch: z.boolean(),
});
export type AiJobRetryPreview = z.infer<typeof AiJobRetryPreviewSchema>;

export const AiJobStatusResponseSchema = z.object({
  jobId: AiJobIdSchema,
  jobType: AiJobTypeSchema,
  status: AiJobStatusSchema,
  progress: AiJobProgressSchema,
  partial: z.unknown().nullable(),
  error: AiJobErrorSchema.nullable(),
  errorCategory: ErrorCategorySchema.nullable(),
  failureCause: FailureCauseSchema.nullable(),
  retryAfter: z.string().nullable(),
  quotaResetsAt: z.string().nullable(),
  waitingRetryUntil: z.string().nullable(),
  provider: AiProviderSchema,
  modelTier: ModelTierSchema,
  connectionTier: ConnectionTierSchema,
  retryCount: z.number().int().min(0),
  cancelRequested: z.boolean(),
  canRetry: z.boolean(),
  retry: AiJobRetryPreviewSchema.nullable(),
  updatedAt: z.string(),
});
export type AiJobStatusResponse = z.infer<typeof AiJobStatusResponseSchema>;

/**
 * What a feature route returns when it starts an async job.
 * `reused`: same input_hash already succeeded (PRD 6.4) — show that result, no provider call.
 * `inProgress`: a job of the same type on the same target is already queued/running
 * (D-34 동시 실행 1개) — follow that job.
 */
export const StartAiJobResponseSchema = z.object({
  jobId: AiJobIdSchema,
  reused: z.boolean(),
  inProgress: z.boolean(),
});
export type StartAiJobResponse = z.infer<typeof StartAiJobResponseSchema>;

/**
 * `POST /api/ai-jobs/{id}/retry` response (202). `restarted`: the run starts from the first
 * step because the active provider or connection tier differs from the job's (C-11.4, R-63);
 * false when resuming from the failed step, and when following another in-flight job
 * (`inProgress: true`). `reused` is always false.
 */
export const RetryAiJobResponseSchema = StartAiJobResponseSchema.extend({
  restarted: z.boolean(),
});
export type RetryAiJobResponse = z.infer<typeof RetryAiJobResponseSchema>;

/** `POST /api/ai-jobs/{id}/cancel` response. Cancel is a request; the runner stops at the next check. */
export const CancelAiJobResponseSchema = z.object({
  jobId: AiJobIdSchema,
  status: AiJobStatusSchema,
  cancelRequested: z.literal(true),
});
export type CancelAiJobResponse = z.infer<typeof CancelAiJobResponseSchema>;

// ---------- streaming (C-6 스트리밍) ----------

/**
 * SSE events for streaming features (AI-03, AI-04, AI-09). Mirror of
 * `src/server/ai/streaming/events.ts` (ai-pipeline-engineer), same names and
 * fields; `error.category` is added by the SSE layer (UI picks copy by it).
 * Wire: `event: <type>` / `data: <JSON of the rest>`. Exactly one terminal
 * event: `done` (after `validated`) or `error`.
 * AI-12 turn events (`reply_delta`, `reply_done`, `draft_patch`, `draft_flags`,
 * `turn_done`) are added in S4.
 */
export const BlockStartedEvent = z.object({
  type: z.literal("block_started"),
  blockId: z.string(),
  /** JSON path of the block in the feature output (e.g. `sections[0]`). */
  path: z.string(),
});
export const BlockDeltaEvent = z.object({
  type: z.literal("block_delta"),
  blockId: z.string(),
  /** Provisional, unvalidated text; replaced by `block_completed.block`. */
  text: z.string(),
});
export const BlockCompletedEvent = z.object({
  type: z.literal("block_completed"),
  blockId: z.string(),
  /** Block that passed block-level checks (feature output schema item). */
  block: z.unknown(),
});
export const ValidatedEvent = z.object({
  type: z.literal("validated"),
  /** Authoritative final content (storage form, aliases resolved). */
  result: z.unknown(),
  /** C-3 validation report (shape owned by src/server/ai/validation). */
  validationReport: z.unknown(),
});
export const DoneEvent = z.object({
  type: z.literal("done"),
  meta: z.object({
    promptVersion: z.string(),
    model: z.string(),
    /** Stored result row id when the pipeline persisted one (e.g. draft id). */
    resultId: z.string().nullable(),
  }),
});
export const ErrorEvent = z.object({
  type: z.literal("error"),
  code: z.union([AiErrorCodeSchema, z.literal("internal_error")]),
  category: ErrorCategorySchema,
  /** F-AI-08 cause, null for system codes and internal_error. */
  failureCause: FailureCauseSchema.nullable(),
  message: z.string(),
  /** Whether the "다시 시도" button applies (isManuallyRetryable). */
  retryable: z.boolean(),
  /** rate_limited / provider_unavailable: earliest time to try again (ISO), else null. */
  retryAfter: z.string().nullable(),
  /** daily_quota_exhausted: provider quota reset time (ISO), else null. */
  quotaResetsAt: z.string().nullable(),
});

export const AiStreamEventSchema = z.discriminatedUnion("type", [
  BlockStartedEvent,
  BlockDeltaEvent,
  BlockCompletedEvent,
  ValidatedEvent,
  DoneEvent,
  ErrorEvent,
]);
export type AiStreamEvent = z.infer<typeof AiStreamEventSchema>;
export type AiStreamEventType = AiStreamEvent["type"];
/**
 * Pipeline stream event names (mirror of src/server/ai/streaming/events.ts). S7 adds the AI-04
 * `sources_selected` / `adjusting_length`; their schemas (and the route-level `generation_started`)
 * are in `draft.ts` (`DraftStreamEventSchema`).
 */
export const AI_STREAM_EVENT_TYPES = [
  "block_started",
  "block_delta",
  "block_completed",
  "sources_selected",
  "adjusting_length",
  "validated",
  "done",
  "error",
] as const satisfies readonly (AiStreamEventType | "sources_selected" | "adjusting_length")[];

/** Category of an SSE error code; `internal_error` (unknown failure) is a system failure. */
export function streamErrorCategory(code: AiErrorCode | "internal_error"): ErrorCategory {
  return code === "internal_error" ? "system" : errorCategoryOf(code);
}

/**
 * Builds the one `error` event shape (QA-S3-02) from a C-11 code. Unknown
 * failures → `internal_error` / system, retryable.
 */
export function aiErrorEvent(
  code: AiErrorCode | "internal_error",
  times: { retryAfter?: string | null; quotaResetsAt?: string | null } = {},
): z.infer<typeof ErrorEvent> {
  if (code === "internal_error") {
    return {
      type: "error",
      code,
      category: "system",
      failureCause: null,
      message: AI_INTERNAL_ERROR_MESSAGE,
      retryable: true,
      retryAfter: null,
      quotaResetsAt: null,
    };
  }
  return {
    type: "error",
    code,
    category: errorCategoryOf(code),
    failureCause: failureCauseOf(code),
    message: AI_ERROR_MESSAGES[code],
    retryable: isManuallyRetryable(code),
    retryAfter: times.retryAfter ?? null,
    quotaResetsAt: times.quotaResetsAt ?? null,
  };
}

// ---------- usage meter (F-AI-07, C-13, DM §2.9.5) ----------

/** `getAiUsageSummary` input. `periodMonth` = KST month start `YYYY-MM-01` (default: this month). */
export const GetAiUsageSummaryInputSchema = z.object({
  periodMonth: z
    .string()
    .regex(/^\d{4}-(0[1-9]|1[0-2])-01$/)
    .optional(),
  includePrevious: z.boolean().optional(),
});
export type GetAiUsageSummaryInput = z.infer<typeof GetAiUsageSummaryInputSchema>;

const TokenTotals = {
  inputTokens: z.number().int().min(0),
  outputTokens: z.number().int().min(0),
  estimatedCostUsd: z.number().min(0),
  calls: z.number().int().min(0),
};

/** RPC `get_ai_usage_summary` in camelCase (DM §2.9.5). Costs are USD estimates (free tier: paid-equivalent). */
export const AiUsageSummarySchema = z.object({
  /** KST month start, `YYYY-MM-DD`. */
  periodMonth: z.string(),
  asOf: z.string(),
  totals: z.object({
    ...TokenTotals,
    cachedInputTokens: z.number().int().min(0),
    cacheWriteTokens: z.number().int().min(0),
    failedCalls: z.number().int().min(0),
  }),
  byFeature: z.array(z.object({ feature: UsageFeatureSchema, ...TokenTotals })),
  byProvider: z.array(z.object({ provider: AiProviderSchema, connectionTier: ConnectionTierSchema, ...TokenTotals })),
  priceTableVersions: z.array(z.object({ version: z.string(), sourceCheckedAt: z.string() })),
  /** Only with `includePrevious: true`. */
  previousMonth: z
    .object({
      periodMonth: z.string(),
      estimatedCostUsd: z.number().min(0),
      inputTokens: z.number().int().min(0),
      outputTokens: z.number().int().min(0),
    })
    .nullable(),
});
export type AiUsageSummary = z.infer<typeof AiUsageSummarySchema>;
