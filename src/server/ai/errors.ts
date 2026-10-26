import Anthropic from "@anthropic-ai/sdk";
import { AppError, type AiErrorCode } from "@/lib/contracts/errors";

/**
 * AI failure with a C-6 `error_code`. The job runner stores `code` in
 * `ai_jobs.error_code`; the DB derives `error_category`.
 * The message is Korean and user-facing; it never contains prompt or output text (C-7).
 */
export class AiError extends AppError {
  declare readonly code: AiErrorCode;
  /** Whether the runner may retry the step once (C-6 실패 처리). */
  readonly retryable: boolean;

  constructor(code: AiErrorCode, options?: { cause?: unknown; message?: string; retryable?: boolean }) {
    super(code, options?.message ?? AI_ERROR_MESSAGES[code], { status: AI_ERROR_STATUS[code], cause: options?.cause });
    this.name = "AiError";
    this.retryable = options?.retryable ?? isRetryableAiErrorCode(code);
  }
}

export function isAiError(value: unknown): value is AiError {
  return value instanceof AiError;
}

/**
 * C-6 "일시적" category plus timeout: one automatic retry, then failed.
 * `refused` is never retried automatically (C-6: a refusal fails and the user
 * is offered a retry), whether or not server-side refusal fallbacks are on.
 */
export function retryableAiErrorCodes(): ReadonlySet<AiErrorCode> {
  return new Set<AiErrorCode>(["model_unavailable", "rate_limited", "schema_invalid", "timeout"]);
}

const RETRYABLE_AI_ERRORS = retryableAiErrorCodes();

export function isRetryableAiErrorCode(code: AiErrorCode): boolean {
  return RETRYABLE_AI_ERRORS.has(code);
}

const AI_ERROR_MESSAGES: Record<AiErrorCode, string> = {
  model_unavailable: "AI 모델이 일시적으로 응답하지 않습니다. 잠시 후 다시 시도해 주세요.",
  rate_limited: "요청이 많아 잠시 처리할 수 없습니다. 잠시 후 다시 시도해 주세요.",
  schema_invalid: "AI 응답을 처리하지 못했습니다. 다시 시도해 주세요.",
  refused: "AI가 이 요청을 처리하지 못했습니다. 다시 시도해 주세요.",
  not_a_jd: "채용 공고가 아닌 것 같습니다. 내용을 확인해 주세요.",
  insufficient_data: "커리어 데이터가 부족합니다.",
  input_too_long: "입력이 너무 깁니다.",
  timeout: "응답 시간이 초과되었습니다. 다시 시도해 주세요.",
  stalled: "작업이 중단되었습니다. 다시 시도해 주세요.",
  canceled: "작업이 취소되었습니다.",
};

const AI_ERROR_STATUS: Record<AiErrorCode, number> = {
  model_unavailable: 503,
  rate_limited: 429,
  schema_invalid: 502,
  refused: 502,
  not_a_jd: 422,
  insufficient_data: 422,
  input_too_long: 413,
  timeout: 504,
  stalled: 504,
  canceled: 499,
};

/**
 * SDK error → C-6 error_code (ai-pipeline-impl "Calling the model").
 * Order: most specific first. Unknown errors are rethrown as-is by callers
 * (they become `internal_error`), except network errors which are transient.
 */
export function mapSdkError(err: unknown, signal?: AbortSignal): AiError | null {
  if (isAiError(err)) return err;
  if (err instanceof Anthropic.APIUserAbortError) {
    // Abort from our side: a cancel request or the step deadline.
    return new AiError(signalReason(signal) === "canceled" ? "canceled" : "timeout", { cause: err });
  }
  if (err instanceof Anthropic.APIConnectionTimeoutError) return new AiError("timeout", { cause: err });
  if (err instanceof Anthropic.RateLimitError) return new AiError("rate_limited", { cause: err });
  if (err instanceof Anthropic.BadRequestError) {
    // 400 for an oversized prompt is the only input problem we can't catch earlier.
    return isContextTooLong(err) ? new AiError("input_too_long", { cause: err }) : null;
  }
  if (err instanceof Anthropic.InternalServerError) return new AiError("model_unavailable", { cause: err });
  if (err instanceof Anthropic.APIConnectionError) return new AiError("model_unavailable", { cause: err });
  if (err instanceof Anthropic.APIError && typeof err.status === "number" && err.status >= 500) {
    return new AiError("model_unavailable", { cause: err });
  }
  return null;
}

/** Callers abort with `controller.abort("canceled")` for user cancel; anything else is a deadline. */
export function signalReason(signal?: AbortSignal): "canceled" | "timeout" | null {
  if (!signal?.aborted) return null;
  return signal.reason === "canceled" ? "canceled" : "timeout";
}

function isContextTooLong(err: InstanceType<typeof Anthropic.BadRequestError>): boolean {
  // The API reports prompt length problems as invalid_request_error; match the
  // error type field, never log the message (it can echo input sizes only, but keep C-7 strict).
  const body = err.error as { error?: { message?: unknown } } | undefined;
  const message = typeof body?.error?.message === "string" ? body.error.message : "";
  return /prompt is too long|too many tokens|context window/i.test(message);
}
