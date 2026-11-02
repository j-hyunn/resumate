import { AppError, type AiErrorCode } from "@/lib/contracts/errors";
import type { NormalizedUsage, ProviderId } from "./providers/types";

/**
 * AI failure with a C-11.1 `error_code`. The job runner stores `code` in
 * `ai_jobs.error_code`; the DB derives `error_category` and `failure_cause`.
 * The message is Korean and user-facing; it never contains prompt, output,
 * provider error text, or any part of an API key (C-7, NFR-KEY-05).
 */
export class AiError extends AppError {
  declare readonly code: AiErrorCode;
  /**
   * Whether the runner may retry automatically (C-11.3). Defaults to the
   * code's policy; `generateStructured` sets false after spending its V-6 retry.
   */
  readonly retryable: boolean;

  constructor(code: AiErrorCode, options?: { cause?: unknown; message?: string; retryable?: boolean }) {
    super(code, options?.message ?? AI_ERROR_MESSAGES[code], { status: AI_ERROR_STATUS[code], cause: options?.cause });
    this.name = "AiError";
    this.retryable = options?.retryable ?? isRetryableAiErrorCode(code);
  }
}

export type ProviderErrorOptions = {
  provider?: ProviderId | null;
  retryAfter?: Date;
  quotaResetsAt?: Date;
  usage?: NormalizedUsage;
  beforeFirstToken?: boolean;
  unclassified?: boolean;
  retryable?: boolean;
  /**
   * The SDK error, used only to record its class name (`sdkErrorName`). It is
   * NOT kept as `cause`: SDK messages and headers can echo part of the key
   * (e.g. OpenAI "Incorrect API key provided: sk-…abcd"), QA-S3a-05 / NFR-KEY-05.
   */
  cause?: unknown;
};

/**
 * A provider call failure normalized to C-11 (adapters, `createLlm`). The
 * provider's own message, body, and headers are never copied (C-7, NFR-KEY-05):
 * only the classification and the SDK error class name.
 */
export class ProviderError extends AiError {
  readonly provider: ProviderId | null;
  readonly retryAfter?: Date;
  readonly quotaResetsAt?: Date;
  readonly usage?: NormalizedUsage;
  /** Streaming: true when no delta was emitted before the error. `complete` failures are always true. */
  readonly beforeFirstToken: boolean;
  /** Not in the C-11.2 table → classified as provider_unavailable [가정, spec-gaps 2026-10-28]. */
  readonly unclassified: boolean;
  /** Class name of the SDK error that was classified (debugging only; never its message). */
  readonly sdkErrorName: string | null;

  constructor(code: AiErrorCode, options: ProviderErrorOptions & { sdkErrorName?: string | null } = {}) {
    // Deliberately no `cause` (see ProviderErrorOptions.cause).
    super(code, { retryable: options.retryable });
    this.name = "ProviderError";
    this.sdkErrorName = options.sdkErrorName ?? errorName(options.cause);
    this.provider = options.provider ?? null;
    this.retryAfter = options.retryAfter;
    this.quotaResetsAt = options.quotaResetsAt;
    this.usage = options.usage;
    this.beforeFirstToken = options.beforeFirstToken ?? true;
    this.unclassified = options.unclassified ?? false;
  }

  /** Copy with stream position / usage filled in (errors are immutable). */
  with(patch: Pick<ProviderErrorOptions, "beforeFirstToken" | "usage">): ProviderError {
    return new ProviderError(this.code, {
      provider: this.provider,
      retryAfter: this.retryAfter,
      quotaResetsAt: this.quotaResetsAt,
      usage: patch.usage ?? this.usage,
      beforeFirstToken: patch.beforeFirstToken ?? this.beforeFirstToken,
      unclassified: this.unclassified,
      retryable: this.retryable,
      sdkErrorName: this.sdkErrorName,
    });
  }

  /** Safe serialization: classification fields only. */
  toJSON() {
    return {
      name: this.name,
      code: this.code,
      provider: this.provider,
      retryable: this.retryable,
      retryAfter: this.retryAfter?.toISOString() ?? null,
      quotaResetsAt: this.quotaResetsAt?.toISOString() ?? null,
      beforeFirstToken: this.beforeFirstToken,
      unclassified: this.unclassified,
      sdkErrorName: this.sdkErrorName,
    };
  }
}

function errorName(value: unknown): string | null {
  if (value instanceof Error) return value.constructor?.name || value.name || "Error";
  return value === undefined ? null : typeof value;
}

export function isAiError(value: unknown): value is AiError {
  return value instanceof AiError;
}

export function isProviderError(value: unknown): value is ProviderError {
  return value instanceof ProviderError;
}

// ---------- C-11.3 automatic retry policy ----------

export type RetryPolicy = {
  /** Max automatic retries per call. */
  maxRetries: number;
  /** Wait before retry n (0-based); the last value repeats. Ignored when the provider sent a retry time. */
  backoffMs: readonly number[];
  /** Random 0..jitterMs added to the backoff. */
  jitterMs: number;
};

const NO_RETRY: RetryPolicy = Object.freeze({ maxRetries: 0, backoffMs: Object.freeze([]), jitterMs: 0 });

/** C-11.3 table. Same for free and paid tiers. */
const RETRY_POLICIES: Partial<Record<AiErrorCode, RetryPolicy>> = {
  rate_limited: Object.freeze({ maxRetries: 4, backoffMs: Object.freeze([2_000, 4_000, 8_000, 16_000]), jitterMs: 1_000 }),
  provider_unavailable: Object.freeze({ maxRetries: 2, backoffMs: Object.freeze([2_000, 4_000]), jitterMs: 1_000 }),
  schema_invalid: Object.freeze({ maxRetries: 1, backoffMs: Object.freeze([0]), jitterMs: 0 }),
  timeout: Object.freeze({ maxRetries: 1, backoffMs: Object.freeze([0]), jitterMs: 0 }),
};

export function retryPolicy(code: AiErrorCode): RetryPolicy {
  return RETRY_POLICIES[code] ?? NO_RETRY;
}

export function isRetryableAiErrorCode(code: AiErrorCode): boolean {
  return retryPolicy(code).maxRetries > 0;
}

/** C-11.3: retry waits of causes 1 and 6 summed per job. */
export const RETRY_WAIT_TOTAL_CAP_MS = 120_000;
/** C-11.3: `retry_after` on final failure is at least one minute out. */
export const FINAL_RETRY_AFTER_MIN_MS = 60_000;

/**
 * Wait before retry `retryIndex` (0-based). A provider retry time
 * (Retry-After, Gemini RetryInfo) wins over the backoff table.
 */
export function retryDelayMs(error: AiError, retryIndex: number, options: { now?: number; random?: () => number } = {}): number {
  const now = options.now ?? Date.now();
  if (error instanceof ProviderError && error.retryAfter) return Math.max(0, error.retryAfter.getTime() - now);
  const policy = retryPolicy(error.code);
  if (policy.backoffMs.length === 0) return 0;
  const base = policy.backoffMs[Math.min(Math.max(retryIndex, 0), policy.backoffMs.length - 1)];
  const jitter = policy.jitterMs > 0 ? Math.floor((options.random ?? Math.random)() * policy.jitterMs) : 0;
  return base + jitter;
}

/**
 * `ai_jobs.retry_after` when the job finally fails on cause 1 or 6 (C-11.3):
 * rate_limited → now + next wait (min 1 minute); provider_unavailable → now + 1 minute.
 * Other codes → null.
 */
export function finalRetryAfter(error: AiError, retryIndex: number, now: number = Date.now()): Date | null {
  if (error.code === "provider_unavailable") return new Date(now + FINAL_RETRY_AFTER_MIN_MS);
  if (error.code !== "rate_limited") return null;
  const next = retryDelayMs(error, retryIndex, { now, random: () => 0 });
  return new Date(now + Math.max(FINAL_RETRY_AFTER_MIN_MS, next));
}

// ---------- abort convention ----------

/** Callers abort with `controller.abort("canceled")` for a user cancel; any other reason is a deadline. */
export function signalReason(signal?: AbortSignal): "canceled" | "timeout" | null {
  if (!signal?.aborted) return null;
  return signal.reason === "canceled" ? "canceled" : "timeout";
}

// ---------- messages ----------

const AI_ERROR_MESSAGES: Record<AiErrorCode, string> = {
  rate_limited: "AI 공급자의 분당 요청 한도에 걸렸습니다. 잠시 후 다시 시도해 주세요.",
  daily_quota_exhausted: "AI 공급자의 오늘 사용 한도를 모두 썼습니다. 한도가 초기화된 뒤 다시 시도해 주세요.",
  billing_required: "AI 공급자 계정의 잔액이나 결제 상태를 확인해 주세요.",
  key_invalid: "AI 연결 키가 유효하지 않습니다. 키를 다시 등록해 주세요.",
  key_missing: "AI 연결이 필요합니다. 설정에서 AI를 연결해 주세요.",
  model_not_available: "현재 연결 등급에서 이 기능에 필요한 모델을 쓸 수 없습니다.",
  provider_unavailable: "AI 공급자가 일시적으로 응답하지 않습니다. 잠시 후 다시 시도해 주세요.",
  input_too_long: "입력이 너무 깁니다.",
  safety_blocked: "AI 공급자의 안전 정책으로 이 요청을 처리하지 못했습니다. 내용을 바꿔 다시 시도해 주세요.",
  insufficient_data: "커리어 데이터가 부족합니다.",
  not_a_jd: "채용 공고가 아닌 것 같습니다. 내용을 확인해 주세요.",
  schema_invalid: "AI 응답을 처리하지 못했습니다. 다시 시도해 주세요.",
  timeout: "응답 시간이 초과되었습니다. 다시 시도해 주세요.",
  stalled: "작업이 중단되었습니다. 다시 시도해 주세요.",
  canceled: "작업이 취소되었습니다.",
};

const AI_ERROR_STATUS: Record<AiErrorCode, number> = {
  rate_limited: 429,
  daily_quota_exhausted: 429,
  billing_required: 402,
  key_invalid: 401,
  key_missing: 409,
  model_not_available: 422,
  provider_unavailable: 503,
  input_too_long: 413,
  safety_blocked: 422,
  insufficient_data: 422,
  not_a_jd: 422,
  schema_invalid: 502,
  timeout: 504,
  stalled: 504,
  canceled: 499,
};
