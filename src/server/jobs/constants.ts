/**
 * Job runner timing (AI C-6, T-14). Named constants so QA and ops can find them.
 */

/** One function invocation stays under 60 s (C-6). The route exports maxDuration = 60; we stop starting steps before this. */
export const INVOCATION_BUDGET_MS = 55_000;

/** Default deadline of one step (one model call or a small batch). Aborts with reason "timeout". */
export const STEP_TIMEOUT_MS = 45_000;

/** How often a running step refreshes heartbeat_at and checks cancel_requested_at. */
export const HEARTBEAT_INTERVAL_MS = 10_000;

/** [가정] running/queued jobs whose heartbeat is older than this are `failed / stalled` (S3 plan: 2분). */
export const STALLED_AFTER_MS = 2 * 60_000;

/**
 * A yielded job waits this long for its self-invoked continuation before a
 * status poll may claim it instead (fallback when the self-invoke was lost).
 */
export const CONTINUE_CLAIM_GRACE_MS = 10_000;

/** Total tries of one step per run: first try + one automatic retry (C-6 실패 처리). */
export const MAX_STEP_ATTEMPTS = 2;

/** Tries for complete_ai_job / release_usage_for_job (network blips); after that the stalled sweep is the safety net. */
export const LEDGER_SETTLE_TRIES = 2;
