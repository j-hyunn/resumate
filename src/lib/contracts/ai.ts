import { z } from "zod";
import {
  AI_ERROR_CODES,
  AI_JOB_STATUSES,
  AI_JOB_TYPES,
  ERROR_CATEGORIES,
  USAGE_FEATURES,
  type AiErrorCode,
  type ErrorCategory,
} from "./enums";

/**
 * AI contracts shared by the server (job runner, SSE routes) and the frontend
 * hooks `useAiJob(jobId) → { status, progress, partial, error }` and
 * `useAiStream(request) → { blocks, status, error, cancel }` (UI patterns §1).
 * Source: AI spec C-6, DM §2.9 / A.15–A.16.
 */

// ---------- error category (mirror of ai_jobs.error_category generated column) ----------

const CATEGORY_BY_CODE: Record<AiErrorCode, ErrorCategory> = {
  model_unavailable: "transient",
  rate_limited: "transient",
  schema_invalid: "transient",
  refused: "transient",
  not_a_jd: "input",
  insufficient_data: "input",
  input_too_long: "input",
  timeout: "timeout",
  stalled: "timeout",
  canceled: "canceled",
};

/** Same mapping as the DB generated column (backend-qa compares the two). */
export function errorCategoryOf(code: AiErrorCode): ErrorCategory {
  return CATEGORY_BY_CODE[code];
}

/**
 * Generic Korean message per category. Screens choose their own ST-AI-FAILED
 * copy by category; this is the fallback in API bodies and SSE `error` events.
 * Failures never charge usage (PRD 6.5), so every failure message says so.
 */
export const AI_ERROR_MESSAGES: Record<ErrorCategory, string> = {
  transient: "AI 응답을 받지 못했습니다. 사용량은 차감되지 않았습니다. 다시 시도해 주세요.",
  input: "입력 내용으로는 AI 작업을 진행할 수 없습니다. 사용량은 차감되지 않았습니다.",
  timeout: "AI 작업 시간이 초과되었습니다. 사용량은 차감되지 않았습니다. 다시 시도해 주세요.",
  canceled: "AI 작업을 중단했습니다. 사용량은 차감되지 않았습니다.",
};

// ---------- enums as zod ----------

export const AiJobTypeSchema = z.enum(AI_JOB_TYPES);
export const AiJobStatusSchema = z.enum(AI_JOB_STATUSES);
export const AiErrorCodeSchema = z.enum(AI_ERROR_CODES);
export const ErrorCategorySchema = z.enum(ERROR_CATEGORIES);
export const UsageFeatureSchema = z.enum(USAGE_FEATURES);

/** Route params: job ids are uuids (same rule as S2 ids). */
export const AiJobIdSchema = z.guid();

// ---------- async job (C-6 비동기 작업) ----------

/** ai_jobs.progress `{ stage, done, total }`. `stage` is a C-6 stage key; null before the first step. */
export const AiJobProgressSchema = z.object({
  stage: z.string().nullable(),
  done: z.number().int().min(0),
  total: z.number().int().min(0),
});
export type AiJobProgress = z.infer<typeof AiJobProgressSchema>;

export const AiJobErrorSchema = z.object({
  code: AiErrorCodeSchema,
  category: ErrorCategorySchema,
  message: z.string(),
});
export type AiJobError = z.infer<typeof AiJobErrorSchema>;

/**
 * `GET /api/ai-jobs/{id}` response — the `useAiJob` shape plus ids.
 * `partial`: results of completed stages a screen may show early (null in S3;
 * features fill it from their own result tables).
 * `canRetry`: failed with a retryable category (transient / timeout).
 */
export const AiJobStatusResponseSchema = z.object({
  jobId: AiJobIdSchema,
  jobType: AiJobTypeSchema,
  status: AiJobStatusSchema,
  progress: AiJobProgressSchema,
  partial: z.unknown().nullable(),
  error: AiJobErrorSchema.nullable(),
  attemptCount: z.number().int().min(0),
  cancelRequested: z.boolean(),
  canRetry: z.boolean(),
  updatedAt: z.string(),
});
export type AiJobStatusResponse = z.infer<typeof AiJobStatusResponseSchema>;

/**
 * What a feature route returns when it starts an async job.
 * `reused`: same input_hash already succeeded (PRD 6.4) — show that result, no usage.
 * `inProgress`: the same input is already queued/running (double start, QA-S3-03) —
 * follow that job, no new usage.
 */
export const StartAiJobResponseSchema = z.object({
  jobId: AiJobIdSchema,
  reused: z.boolean(),
  inProgress: z.boolean(),
});
export type StartAiJobResponse = z.infer<typeof StartAiJobResponseSchema>;

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
  message: z.string(),
  retryable: z.boolean(),
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
export const AI_STREAM_EVENT_TYPES = [
  "block_started",
  "block_delta",
  "block_completed",
  "validated",
  "done",
  "error",
] as const satisfies readonly AiStreamEventType[];

/** Category of an SSE error code; `internal_error` (unknown failure) is shown as transient. */
export function streamErrorCategory(code: AiErrorCode | "internal_error"): ErrorCategory {
  return code === "internal_error" ? "transient" : errorCategoryOf(code);
}

/**
 * Builds an `error` event from a C-6 code (unknown failures → internal_error / transient).
 * `retryable` comes from the server's rule (`isRetryableAiErrorCode` in
 * src/server/ai/errors, which depends on REFUSAL_FALLBACKS_ENABLED) — contracts
 * don't duplicate it.
 */
export function aiErrorEvent(code: AiErrorCode | "internal_error", retryable: boolean): z.infer<typeof ErrorEvent> {
  const category = streamErrorCategory(code);
  return { type: "error", code, category, message: AI_ERROR_MESSAGES[category], retryable };
}

// ---------- usage (D-17, UI "이번 달 {N}회 남음") ----------

export const UsageFeatureSummarySchema = z.object({
  /** null = no monthly limit row for this feature (not reservable, see spec-gaps). */
  limit: z.number().int().nullable(),
  /** reserved + charged units this KST month. */
  used: z.number().int().min(0),
  remaining: z.number().int().nullable(),
});
export type UsageFeatureSummary = z.infer<typeof UsageFeatureSummarySchema>;

export const UsageSummarySchema = z.object({
  /** KST month start, `YYYY-MM-DD`. */
  periodMonth: z.string(),
  features: z.record(UsageFeatureSchema, UsageFeatureSummarySchema),
});
export type UsageSummary = z.infer<typeof UsageSummarySchema>;
