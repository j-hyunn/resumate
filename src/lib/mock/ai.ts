/**
 * Fake AI — async job mode (03 C-6, v4 BYOK). Server only.
 *
 * Jobs advance with wall-clock time: each read recomputes `status` / `progress` from
 * `params.mock_started_at` and `params.mock_duration_ms` (no timers; the client polls).
 *
 * v4:
 * - every job is pinned to the active provider / tier at start (`provider`, `connection_tier`).
 *   No active key → createMockJob throws `MockAiError("key_missing")` (screens show C-18 first).
 * - free tier (D-37): duration × 2 (sequential path); done/total stages show the unit count.
 * - `params.mock_rate_wait`: a "공급자 요청 한도로 잠시 기다리는 중 (n초)" window between 35% and
 *   50% of the run (`progress.waiting_retry_until`), then it continues (not a failure).
 * - failure injection `params.mock_fail` = any `AiErrorCode` (7 causes via error_code, system,
 *   input): fails at ~60% with error_category / failure_cause derived like the generated columns,
 *   `quota_resets_at` (daily quota) and `retry_after` (rate_limited / provider_unavailable).
 * - the active key deleted mid-run → `key_missing` (ST-AI-KEY-MISSING).
 * - key_invalid failure marks the key row invalid (RPC mark_provider_key_invalid).
 * - each finished job writes ai_usage_records rows (tokens + estimated cost, also on failure).
 *
 * Sync mode (AI-01, AI-11, key check) is `mockSyncCall`; streaming lives in ai-stream.ts.
 */
import type {
  AiErrorCode,
  AiGateRefusalCode,
  AiJob,
  AiJobProgress,
  AiJobType,
  AiProgressStage,
  AiUsageFeature,
  ConnectionTier,
} from "@/types/db"
import { refusalErrorCode } from "@/lib/data/ai-errors"
import { consentRequired } from "./consent"
import { regradeTargetIds } from "./grading"
import { errorCategoryOf, failureCauseOf, failureTimestamps, nextQuotaReset } from "@/lib/data/ai-errors"
import { newId, USER_ID } from "./ids"
import type { MockDb } from "./fixtures"
import { MOCK_MODELS, PRICE_TABLE_VERSION } from "./ai-providers"
import { currentPeriodMonth } from "./time"

export interface MockJobOptions {
  job_type: AiJobType
  application_project_id?: string | null
  target_type?: string | null
  target_id?: string | null
  /** total simulated duration (paid tier); free tier doubles it */
  duration_ms?: number
  /** number of units for done/total stages (requirement batches, questions, answers) */
  units?: number
  /** inject a failure (error_code) */
  fail?: AiErrorCode | null
  /** the injected failure happened in `prepare` (요건 추출 실패, Q53-9): the job ends on its first read, nothing saved */
  fail_at_prepare?: boolean
  /** simulate a rate-limit auto-retry wait window */
  rate_wait?: boolean
  /** gate path (04 §2.11.7): "start" ① new job (default) / "request" ⑤ request-scoped (JD extraction) */
  path?: AiGatePath
  params?: Record<string, unknown>
}

/**
 * Gate paths of 04 §2.11.7: "start" = ① new job start (HTTP 409 codes), "request" = ④⑤ chat turn /
 * request-scoped work (consent folds into key_missing). Path ② (same-row retry) is retryGate().
 */
export type AiGatePath = "start" | "request"

export class MockAiError extends Error {
  /** `refusal`: the exact §2.11.7 code (paths ① / ②); `error_code` stays the C-20 compat code */
  public readonly refusal: AiGateRefusalCode | null
  constructor(
    public readonly error_code: AiErrorCode,
    refusal: AiGateRefusalCode | null = null,
  ) {
    super(`mock ai failure: ${refusal ?? error_code}`)
    this.refusal = refusal
  }
  static refuse(code: AiGateRefusalCode): MockAiError {
    return new MockAiError(refusalErrorCode(code), code)
  }
  get error_category() {
    return errorCategoryOf(this.error_code)
  }
}

const DEFAULT_DURATION: Partial<Record<AiJobType, number>> = {
  insight: 12_000,
  interview_questions: 9_000,
  interview_evaluation: 10_000,
  career_description: 8_000,
  cover_letter: 8_000,
  draft_source_ranking: 3_000,
  jd_extraction: 4_000,
  writing_chat_turn: 4_000,
  key_verification: 2_000,
}

/**
 * Stage plan per job type (03 C-6 v4.3 "진행 단계 값"): insight prepare → match → synthesize →
 * (synthesize_regen) → validate; questions prepare → generate → complete; grading prepare →
 * evaluate → summarize → score → complete.
 */
export function stagePlan(jobType: AiJobType, units = 2, opts?: { regen?: boolean; summaryOnly?: boolean }): AiJobProgress[] {
  const counted = (stage: AiProgressStage, n: number) =>
    Array.from({ length: n + 1 }, (_, i) => ({ stage, done: i, total: n }))
  switch (jobType) {
    case "insight":
      return [
        { stage: "prepare" },
        ...counted("match", units),
        { stage: "synthesize" },
        ...(opts?.regen ? [{ stage: "synthesize_regen" as const }] : []),
        { stage: "validate" },
      ]
    case "interview_questions":
      return [{ stage: "prepare" }, ...counted("generate", units), { stage: "complete", done: units, total: units }]
    case "interview_evaluation":
      // Q53-5 "종합 평가 다시 정리": no answer is called, `evaluate` is not shown
      if (opts?.summaryOnly) return [{ stage: "prepare" }, { stage: "summarize" }, { stage: "score" }, { stage: "complete" }]
      return [{ stage: "prepare" }, ...counted("evaluate", units), { stage: "summarize" }, { stage: "score" }, { stage: "complete" }]
    case "career_description":
      return [{ stage: "generate" }, { stage: "validate" }]
    case "cover_letter":
      return [{ stage: "rank" }, { stage: "generate" }, { stage: "adjust_length" }, { stage: "validate" }]
    case "draft_source_ranking":
      return [{ stage: "rank" }]
    case "writing_chat_turn":
      return [{ stage: "extract" }, { stage: "reply" }]
    default:
      return [{ stage: "generate" }]
  }
}

/** Active provider key of the fixture user, or null (AI 잠금) */
export function activeKey(db: MockDb) {
  const provider = db.profiles[0]?.active_ai_provider ?? null
  return provider ? (db.ai_provider_keys.find((k) => k.provider === provider) ?? null) : null
}

/** Next Gemini free-tier reset: Pacific midnight = KST 16:00 (17:00 outside US DST) [가정] */
export { nextQuotaReset, failureTimestamps }

/**
 * Server-side gate for every AI-starting data function (FL-08 "키 확인이 먼저", UQ-320):
 * call it **before** mutating anything. `needs_check` runs (R-41). Codes per 04 §2.11.7:
 * - "start" (①): no key → ai_not_connected, invalid → key_invalid, consent → ai_consent_required
 * - "request" (④⑤): no key → key_missing, invalid → key_invalid, consent → key_missing
 * (MockAiError.error_code keeps the C-20 compat code; `refusal` carries the ① code).
 */
export function assertAiRunnable(db: MockDb, path: AiGatePath = "start") {
  const key = activeKey(db)
  const start = path === "start"
  if (!key) throw start ? MockAiError.refuse("ai_not_connected") : new MockAiError("key_missing")
  if (key.status === "invalid") throw start ? MockAiError.refuse("key_invalid") : new MockAiError("key_invalid")
  if (consentRequired(db, key.provider, key.connection_tier))
    throw start ? MockAiError.refuse("ai_consent_required") : new MockAiError("key_missing")
  return key
}

/**
 * Gate of path ② same-row retry (04 §2.11.7 order, after "not found" / "in progress"):
 * ai_job_not_retryable → key_missing → key_invalid → ai_consent_required → ai_connection_changed.
 * `mock_controls.next_retry_refusal` forces one refusal (dev / gallery), consumed once.
 */
export function retryGate(db: MockDb, job: AiJob) {
  const forced = db.mock_controls.next_retry_refusal
  if (forced) {
    db.mock_controls.next_retry_refusal = null
    throw MockAiError.refuse(forced)
  }
  const retryable =
    (job.job_type === "insight" || job.job_type === "interview_questions" || job.job_type === "interview_evaluation") &&
    job.status === "failed" &&
    !!job.error_code &&
    errorCategoryOf(job.error_code) !== "input" &&
    // Q53-5 (04 §2.7.1): a grading job with no 다시 채점 대상 never reopens on the same row — a provider
    // change would reopen every answer (R-63). "종합 평가 다시 정리" is a new job instead.
    !(job.job_type === "interview_evaluation" && job.target_id && regradeTargetIds(db, job.target_id).length === 0)
  if (!retryable) throw MockAiError.refuse("ai_job_not_retryable")
  const key = activeKey(db)
  if (!key) throw MockAiError.refuse("key_missing")
  if (key.status === "invalid") throw MockAiError.refuse("key_invalid")
  if (consentRequired(db, key.provider, key.connection_tier)) throw MockAiError.refuse("ai_consent_required")
  return key
}

export function createMockJob(db: MockDb, opts: MockJobOptions): AiJob {
  const key = assertAiRunnable(db, opts.path ?? "start")
  const now = new Date().toISOString()
  const plan = stagePlan(opts.job_type, opts.units, { regen: opts.params?.mock_regen === true, summaryOnly: opts.params?.mock_summary_only === true })
  const tier: ConnectionTier = key.connection_tier
  const base = opts.duration_ms ?? DEFAULT_DURATION[opts.job_type] ?? 8_000
  const job: AiJob = {
    id: newId(),
    user_id: USER_ID,
    created_at: now,
    updated_at: now,
    job_type: opts.job_type,
    application_project_id: opts.application_project_id ?? null,
    target_type: opts.target_type ?? null,
    target_id: opts.target_id ?? null,
    status: "queued",
    progress: plan[0] ?? null,
    params: {
      ...opts.params,
      mock_started_at: Date.now(),
      // free tier runs the sequential path: 2× the paid target (03 C-12)
      mock_duration_ms: tier === "free" ? base * 2 : base,
      mock_units: opts.units ?? 2,
      mock_fail: opts.fail ?? null,
      mock_fail_at_prepare: opts.fail_at_prepare ?? false,
      mock_rate_wait: opts.rate_wait ?? false,
    },
    provider: key.provider,
    model_tier: "default",
    connection_tier: tier,
    retry_count: 0,
    next_run_at: null,
    retry_wait_total_ms: 0,
    error_code: null,
    error_category: null,
    failure_cause: null,
    quota_resets_at: null,
    retry_after: null,
    input_hash: null,
    prompt_version: "mock.v1",
    model: MOCK_MODELS[key.provider].default,
    usage: null,
    output: null,
    step_outputs: {},
    run_generation: 1,
    heartbeat_at: now,
    cancel_requested_at: null,
    started_at: now,
    finished_at: null,
  }
  db.ai_jobs.push(job)
  return job
}

function fail(db: MockDb, job: AiJob, code: AiErrorCode, progress: AiJobProgress | null) {
  const now = new Date().toISOString()
  Object.assign(job, {
    status: code === "canceled" ? "canceled" : "failed",
    progress,
    error_code: code,
    error_category: errorCategoryOf(code),
    failure_cause: failureCauseOf(code),
    ...failureTimestamps(code),
    finished_at: now,
    updated_at: now,
  })
  // RPC mark_provider_key_invalid: key_invalid → status invalid; billing/daily → last_failure_* only
  const key = db.ai_provider_keys.find((k) => k.provider === job.provider)
  const cause = failureCauseOf(code)
  if (key && cause) {
    key.last_failure_cause = cause
    key.last_failure_at = now
    if (code === "key_invalid") key.status = "invalid"
    key.updated_at = now
  }
}

/**
 * Recompute a running job from elapsed time (mutates the stored row).
 * Returns true if the job reached a terminal state on this call.
 */
export function advanceMockJob(job: AiJob, db?: MockDb): boolean {
  if (job.status === "succeeded" || job.status === "failed" || job.status === "canceled") return false
  const params = job.params ?? {}
  const startedAt =
    typeof params.mock_started_at === "number" ? params.mock_started_at : Date.parse(job.started_at ?? job.created_at)
  const duration = typeof params.mock_duration_ms === "number" ? params.mock_duration_ms : 8_000
  const units = typeof params.mock_units === "number" ? params.mock_units : (job.progress?.total ?? 2)
  const injected = (params.mock_fail as AiErrorCode | null) ?? null
  const plan = stagePlan(job.job_type, units, { regen: params.mock_regen === true, summaryOnly: params.mock_summary_only === true })
  const elapsed = Date.now() - startedAt
  const fraction = Math.min(1, elapsed / duration)
  const now = new Date().toISOString()

  if (job.cancel_requested_at) {
    if (db) fail(db, job, "canceled", job.progress)
    else Object.assign(job, { status: "canceled", error_code: "canceled", error_category: "system", finished_at: now, updated_at: now })
    return true
  }
  // path ③ check_ai_run_allowed (04 §2.11.7): key deleted or consent needed → key_missing,
  // key invalid → key_invalid (input preserved, D-36)
  if (db && job.job_type !== "key_verification") {
    const key = db.ai_provider_keys.find((k) => k.provider === job.provider)
    if (!key || consentRequired(db, job.provider, key.connection_tier)) {
      fail(db, job, "key_missing", job.progress)
      return true
    }
    if (key.status === "invalid") {
      fail(db, job, "key_invalid", job.progress)
      return true
    }
  }
  const failAtPrepare = params.mock_fail_at_prepare === true
  if (injected && (failAtPrepare || fraction >= 0.6)) {
    const index = failAtPrepare ? 0 : Math.floor(0.6 * (plan.length - 1))
    if (db) fail(db, job, injected, plan[index])
    else Object.assign(job, { status: "failed", progress: plan[index], error_code: injected, error_category: errorCategoryOf(injected), failure_cause: failureCauseOf(injected), ...failureTimestamps(injected), finished_at: now, updated_at: now })
    return true
  }
  if (fraction >= 1) {
    Object.assign(job, { status: "succeeded", progress: plan[plan.length - 1], finished_at: now, updated_at: now, heartbeat_at: now })
    return true
  }
  const index = Math.min(plan.length - 1, Math.floor(fraction * plan.length))
  // rate-limit auto-retry wait window (C-03 "공급자 요청 한도로 잠시 기다리는 중")
  const waitFrom = 0.35
  const waitTo = 0.5
  const waiting = params.mock_rate_wait === true && fraction >= waitFrom && fraction < waitTo
  const waitingUntil = waiting ? new Date(startedAt + waitTo * duration).toISOString() : null
  Object.assign(job, {
    status: elapsed < 400 ? "queued" : "running",
    progress: { ...plan[index], waiting_retry_until: waitingUntil },
    retry_count: waiting ? Math.max(job.retry_count, 1) : job.retry_count,
    retry_wait_total_ms: waiting ? Math.max(job.retry_wait_total_ms, elapsed - waitFrom * duration) : job.retry_wait_total_ms,
    next_run_at: waitingUntil,
    updated_at: now,
    heartbeat_at: now,
  })
  return false
}

/**
 * Retry a failed job on the same row (04 §2.9.1 경우 (1), A1 변경): with `db` the path ② gate runs
 * first (retryGate, throws before mutating) and the job is re-pinned to the **current** active
 * provider / tier. Different provider or tier → restart from `prepare` (step outputs dropped,
 * `restarted: true`); same → resume from the failed stage.
 */
export function retryMockJob(
  job: AiJob,
  opts?: { fail?: AiErrorCode | null; rate_wait?: boolean },
  db?: MockDb,
): AiJob {
  const key = db ? retryGate(db, job) : null
  const params = job.params ?? {}
  const duration = typeof params.mock_duration_ms === "number" ? params.mock_duration_ms : 8_000
  const now = new Date().toISOString()
  const restarted = !!key && (key.provider !== job.provider || key.connection_tier !== job.connection_tier)
  // a `prepare` failure has no finished step to resume from (S-16 · S-20: `prepare`부터 다시)
  const resumeFrom = !restarted && params.mock_fail_at_prepare !== true && job.error_code && job.error_code !== "canceled" ? 0.6 : 0
  Object.assign(job, {
    status: "queued",
    retry_count: job.retry_count + 1,
    error_code: null,
    error_category: null,
    failure_cause: null,
    quota_resets_at: null,
    retry_after: null,
    finished_at: null,
    cancel_requested_at: null,
    updated_at: now,
    run_generation: job.run_generation + 1,
    // different provider / tier → completed step outputs are dropped (DM-17)
    step_outputs: restarted ? {} : job.step_outputs,
    params: {
      ...params,
      mock_started_at: Date.now() - resumeFrom * duration,
      mock_fail: opts?.fail ?? null,
      mock_fail_at_prepare: false,
      mock_rate_wait: opts?.rate_wait ?? false,
      // MOCK ONLY: the last retry restarted from `prepare` on another provider / tier
      mock_restarted: restarted,
    },
    ...(restarted && key
      ? { provider: key.provider, connection_tier: key.connection_tier, model: MOCK_MODELS[key.provider].default, input_hash: null }
      : {}),
  })
  return job
}

/** Sync AI call (AI-01, AI-11, key check): resolves after `ms`, or rejects with an error_code. */
export async function mockSyncCall<T>(result: T, opts?: { ms?: number; fail?: AiErrorCode | null }): Promise<T> {
  await new Promise((resolve) => setTimeout(resolve, opts?.ms ?? 1_500))
  if (opts?.fail) throw new MockAiError(opts.fail)
  return result
}

const FEATURE_OF: Partial<Record<AiJobType, AiUsageFeature>> = {
  jd_extraction: "jd_extraction",
  insight: "insight",
  career_description: "career_description",
  draft_source_ranking: "career_description",
  cover_letter: "cover_letter",
  interview_questions: "interview_questions",
  interview_evaluation: "interview_evaluation",
  writing_chat_turn: "writing_chat",
  key_verification: "key_verification",
}

/** Mock token counts per call (rough AI spec 7장 sizes) */
const TOKENS: Partial<Record<AiUsageFeature, [number, number]>> = {
  jd_extraction: [3_500, 900],
  insight: [11_500, 2_500],
  career_description: [10_500, 5_000],
  cover_letter: [9_000, 2_200],
  interview_questions: [8_000, 2_000],
  interview_evaluation: [11_500, 3_000],
  writing_chat: [4_000, 600],
  key_verification: [20, 5],
}

/**
 * Record ai_usage_records rows (C-13): one row per call. Failed calls are recorded too
 * (provider usually reports tokens; key_invalid / key_missing report none → usage_source unavailable).
 */
export function recordMockUsage(
  db: MockDb,
  input: {
    job_type: AiJobType
    ai_job_id: string | null
    application_project_id: string | null
    provider: AiJob["provider"]
    connection_tier: ConnectionTier
    outcome: "succeeded" | "failed"
    error_code?: AiErrorCode | null
    calls?: number
    call_key?: string
  },
) {
  const feature = FEATURE_OF[input.job_type]
  if (!feature) return
  const model = MOCK_MODELS[input.provider].default
  const price = db.ai_price_tables.find((p) => p.model === model && p.version === PRICE_TABLE_VERSION)
  const [inTok, outTok] = TOKENS[feature] ?? [1_000, 300]
  const noUsage = input.error_code === "key_invalid" || input.error_code === "key_missing" || input.error_code === "billing_required"
  const now = new Date().toISOString()
  for (let i = 0; i < (input.calls ?? 1); i += 1) {
    const input_tokens = noUsage ? 0 : inTok
    const output_tokens = noUsage || input.outcome === "failed" ? 0 : outTok
    const cost = price ? (input_tokens * price.input_usd_per_mtok + output_tokens * price.output_usd_per_mtok) / 1_000_000 : 0
    db.ai_usage_records.push({
      id: newId(),
      user_id: USER_ID,
      created_at: now,
      occurred_at: now,
      period_month: currentPeriodMonth(),
      feature,
      job_type: input.job_type,
      ai_job_id: input.ai_job_id,
      call_key: input.call_key ?? `${feature}.${i + 1}`,
      application_project_id: input.application_project_id,
      provider: input.provider,
      model,
      model_tier: "default",
      connection_tier: input.connection_tier,
      input_tokens,
      cached_input_tokens: 0,
      cache_write_tokens: 0,
      output_tokens,
      reasoning_tokens: null,
      usage_source: noUsage ? "unavailable" : "provider_reported",
      outcome: input.outcome,
      error_code: input.outcome === "failed" ? (input.error_code ?? null) : null,
      price_table_version: PRICE_TABLE_VERSION,
      estimated_cost_usd: Math.round(cost * 1_000_000) / 1_000_000,
    })
  }
}
