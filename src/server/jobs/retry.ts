import type { AiErrorCode } from "@/lib/contracts/enums";
import { AiError, finalRetryAfter, isProviderError, RETRY_WAIT_TOTAL_CAP_MS, retryDelayMs, retryPolicy } from "@/server/ai/errors";

/**
 * C-11.3 retry scheduling decision for one failed call (pure; the runner
 * applies it). The policy table, delays, and final `retry_after` come from
 * ai-pipeline (`src/server/ai/errors.ts`) so there is one table.
 *
 * - `retry_now`: no wait (schema_invalid / timeout) → retry in this invocation.
 * - `retry_at`: wait > 0 → the job goes back to `queued` with `next_run_at`
 *   (never sleep in the function); the wait counts toward the per-run 120 s cap.
 * - `fail`: no retry left (policy, cap, not retryable, or a stream cut after the
 *   first token) → final failure with `retry_after` / `quota_resets_at`.
 *
 * Cap rule [가정, S3a notes]: a wait is scheduled only if `waitUsedMs + wait ≤ 120 s`
 * (a provider Retry-After beyond the cap ends the job with that time as retry_after).
 */
export type RetryDecision =
  | { kind: "retry_now" }
  | { kind: "retry_at"; waitMs: number; runAt: Date }
  | { kind: "fail"; retryAfter: Date | null; quotaResetsAt: Date | null };

export type RetryInput = {
  error: AiError;
  /** Automatic retries this call already had for this code (0 on the first failure). */
  retriesSoFar: number;
  /** Retry wait already used in this run (ms). */
  waitUsedMs: number;
  now: Date;
  random?: () => number;
};

export function decideRetry(input: RetryInput): RetryDecision {
  const { error, retriesSoFar, waitUsedMs, now } = input;
  const nowMs = now.getTime();
  const fail = (): RetryDecision => ({
    kind: "fail",
    retryAfter: finalRetryAfter(error, retriesSoFar, nowMs),
    quotaResetsAt: isProviderError(error) && error.code === "daily_quota_exhausted" ? (error.quotaResetsAt ?? null) : null,
  });

  if (!error.retryable) return fail();
  // C-11.3: a stream that already sent tokens is not retried (no duplicate output / tokens).
  if (isProviderError(error) && !error.beforeFirstToken) return fail();
  if (retriesSoFar >= retryPolicy(error.code).maxRetries) return fail();

  const waitMs = retryDelayMs(error, retriesSoFar, { now: nowMs, random: input.random });
  if (waitMs <= 0) return { kind: "retry_now" };
  if (waitUsedMs + waitMs > RETRY_WAIT_TOTAL_CAP_MS) return fail();
  return { kind: "retry_at", waitMs, runAt: new Date(nowMs + waitMs) };
}

/** Retries per code already spent by `stage` in the current run. */
export function retriesFor(retries: Record<string, Partial<Record<AiErrorCode, number>>>, stage: string, code: AiErrorCode): number {
  return retries[stage]?.[code] ?? 0;
}

export function withRetry(
  retries: Record<string, Partial<Record<AiErrorCode, number>>>,
  stage: string,
  code: AiErrorCode,
): Record<string, Partial<Record<AiErrorCode, number>>> {
  return { ...retries, [stage]: { ...retries[stage], [code]: retriesFor(retries, stage, code) + 1 } };
}
