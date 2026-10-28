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

/**
 * C-12 free-tier call spacing per user and provider [가정: 무료 Gemini 분당 한도 기준 약 6초].
 * Before each step of a free-tier job the runner checks the user's last call to
 * the provider and, if it was closer than this, schedules the step via next_run_at.
 */
export const FREE_TIER_MIN_INTERVAL_MS = 6_000;

/** Due jobs the cron wakes per run (B-4 safety net); each is continued in its own invocation. */
export const CRON_DUE_JOBS_LIMIT = 50;

/** Tries for complete_ai_job (network blips); after that the job fails as `stalled`. */
export const COMPLETE_TRIES = 2;

/**
 * QA-S3a-03: at the end of an invocation, wait at most this long for provider
 * calls abandoned by an aborted step and their ai_usage_records inserts.
 */
export const USAGE_SETTLE_GRACE_MS = 3_000;
