import type { z } from "zod";

/**
 * Error contract shared by Server Actions, Route Handlers, and the frontend.
 * `code` is stable and machine-readable; `message` is Korean, user-facing.
 */

/** AI job error codes — AI spec C-6 `error_code`. */
export const AI_ERROR_CODES = [
  "model_unavailable",
  "rate_limited",
  "schema_invalid",
  "refused",
  "not_a_jd",
  "insufficient_data",
  "input_too_long",
  "timeout",
  "stalled",
  "canceled",
] as const;
export type AiErrorCode = (typeof AI_ERROR_CODES)[number];

/** Generic application error codes. */
export const APP_ERROR_CODES = [
  "unauthenticated",
  "forbidden",
  "not_found",
  "invalid_input",
  "conflict",
  "limit_reached",
  "internal_error",
] as const;
export type GenericErrorCode = (typeof APP_ERROR_CODES)[number];

/**
 * Known codes get autocomplete; slice-specific codes (e.g. RPC `raise` names
 * like `message_limit_reached`) are still allowed as plain strings.
 */
export type ErrorCode = GenericErrorCode | AiErrorCode | (string & {});

export type ErrorBody = { code: ErrorCode; message: string };
export type ErrorResponse = { error: ErrorBody };
export type ActionResult<T> = { data: T } | ErrorResponse;

const DEFAULT_MESSAGES: Record<GenericErrorCode, string> = {
  unauthenticated: "로그인이 필요합니다.",
  forbidden: "접근 권한이 없습니다.",
  not_found: "요청한 항목을 찾을 수 없습니다.",
  invalid_input: "입력값을 확인해 주세요.",
  conflict: "다른 변경과 충돌했습니다. 새로고침 후 다시 시도해 주세요.",
  limit_reached: "사용 한도에 도달했습니다.",
  internal_error: "일시적인 오류가 발생했습니다. 잠시 후 다시 시도해 주세요.",
};

const HTTP_STATUS: Record<GenericErrorCode, number> = {
  unauthenticated: 401,
  forbidden: 403,
  not_found: 404,
  invalid_input: 400,
  conflict: 409,
  limit_reached: 429,
  internal_error: 500,
};

function isGenericCode(code: string): code is GenericErrorCode {
  return (APP_ERROR_CODES as readonly string[]).includes(code);
}

export class AppError extends Error {
  readonly code: ErrorCode;
  /** HTTP status for Route Handlers. Defaults by code; unknown codes → 400. */
  readonly status: number;

  constructor(code: ErrorCode, message?: string, options?: { status?: number; cause?: unknown }) {
    super(message ?? (isGenericCode(code) ? DEFAULT_MESSAGES[code] : DEFAULT_MESSAGES.internal_error), {
      cause: options?.cause,
    });
    this.name = "AppError";
    this.code = code;
    this.status = options?.status ?? (isGenericCode(code) ? HTTP_STATUS[code] : 400);
  }
}

export function isAppError(value: unknown): value is AppError {
  return value instanceof AppError;
}

/**
 * Maps anything thrown to the public error body. Unknown errors become
 * `internal_error` with a generic message, so internals never leak to the client.
 */
export function toErrorBody(err: unknown): ErrorBody {
  if (isAppError(err)) return { code: err.code, message: err.message };
  return { code: "internal_error", message: DEFAULT_MESSAGES.internal_error };
}

export function ok<T>(data: T): { data: T } {
  return { data };
}

export function fail(code: ErrorCode, message?: string): ErrorResponse {
  const err = new AppError(code, message);
  return { error: { code: err.code, message: err.message } };
}

/**
 * `invalid_input` from a zod failure. Field details stay server-side for now;
 * a slice that needs per-field messages extends ErrorBody explicitly.
 */
export function invalid(error?: z.ZodError): ErrorResponse {
  void error;
  return fail("invalid_input");
}

/** Runs a service call and maps thrown errors to ActionResult. */
export async function runAction<T>(fn: () => Promise<T>): Promise<ActionResult<T>> {
  try {
    return ok(await fn());
  } catch (err) {
    return { error: toErrorBody(err) };
  }
}

/** JSON Response for Route Handlers. */
export function errorResponse(err: unknown): Response {
  const status = isAppError(err) ? err.status : 500;
  return Response.json({ error: toErrorBody(err) } satisfies ErrorResponse, { status });
}

export function isErrorResult<T>(result: ActionResult<T>): result is ErrorResponse {
  return "error" in result;
}
