import type { StoredAiJobProgress } from "@/lib/contracts/ai";
import type {
  AiErrorCode,
  AiJobStatus,
  AiJobType,
  AiProvider,
  ConnectionTier,
  ModelTier,
  UsageFeature,
  UsageOutcome,
  UsageSource,
} from "@/lib/contracts/enums";
import type { AiWriterSupabaseClient } from "@/server/db/types";
import type { KeySource, KeyStatusReporter, ProviderContextSource } from "./provider-context";

/**
 * Job runner types (AI C-6 비동기 작업, C-11.3 재시도, C-12 무료 등급, C-13 사용 기록).
 * The runner depends only on these interfaces; `supabase-store.ts` /
 * `supabase-usage.ts` implement them against the DB, tests use in-memory fakes.
 */

export type JsonObject = Record<string, unknown>;

/**
 * Runner bookkeeping stored under `step_outputs._meta` (survives yield /
 * continue / scheduled retry / manual retry). Stage keys never start with `_`.
 */
export type JobMeta = {
  /** run_generation at the start of the current run (a manual retry starts a new run). */
  runBase: number;
  /**
   * retry_wait_total_ms at the start of the current run. The 120 s cap (C-11.3)
   * applies to `retry_wait_total_ms - waitBase`, so a manual retry gets a fresh
   * budget while the column stays a job-lifetime total.
   */
  waitBase: number;
  /** Automatic retries per call (stage) and cause in the current run: `{ [stage]: { [code]: n } }`. */
  retries: Record<string, Partial<Record<AiErrorCode, number>>>;
};

export const META_KEY = "_meta";

/** The ai_jobs columns the runner reads (camelCase). */
export type JobRecord = {
  id: string;
  userId: string;
  jobType: AiJobType;
  status: AiJobStatus;
  progress: StoredAiJobProgress;
  params: JsonObject;
  applicationProjectId: string | null;
  targetType: string | null;
  targetId: string | null;
  /** Fixed at start (F-AI-03 (2)). */
  provider: AiProvider;
  modelTier: ModelTier;
  connectionTier: ConnectionTier;
  /**
   * Internal run generation (QA-S3-05, spec-gaps 2026-10-28): monotonic, +1 on
   * every automatic and manual retry. Every runner write is conditional on it,
   * so a late runner of an older generation changes nothing.
   */
  runGeneration: number;
  /** Automatic retries in total (C-11.3, DM §2.9.1). */
  retryCount: number;
  retryWaitTotalMs: number;
  nextRunAt: string | null;
  retryAfter: string | null;
  quotaResetsAt: string | null;
  errorCode: AiErrorCode | null;
  inputHash: string | null;
  cancelRequestedAt: string | null;
  heartbeatAt: string | null;
  startedAt: string | null;
  finishedAt: string | null;
  createdAt: string;
  updatedAt: string;
  /** Completed stage → its step result (checkpoint; resume skips these). `_meta` excluded. */
  stepOutputs: Record<string, unknown>;
  meta: JobMeta;
};

export type NewJob = {
  id: string;
  userId: string;
  jobType: AiJobType;
  applicationProjectId: string | null;
  targetType: string | null;
  targetId: string | null;
  provider: AiProvider;
  modelTier: ModelTier;
  connectionTier: ConnectionTier;
  params: JsonObject;
  inputHash: string | null;
  promptVersion: string | null;
  model: string | null;
  progress: StoredAiJobProgress;
  meta: JobMeta;
};

/** Columns the runner may change (app_ai_writer update grant). */
export type JobPatch = Partial<{
  status: AiJobStatus;
  progress: StoredAiJobProgress;
  runGeneration: number;
  retryCount: number;
  retryWaitTotalMs: number;
  nextRunAt: string | null;
  retryAfter: string | null;
  quotaResetsAt: string | null;
  errorCode: AiErrorCode | null;
  heartbeatAt: string | null;
  startedAt: string | null;
  finishedAt: string | null;
  promptVersion: string | null;
  model: string | null;
  usage: JsonObject | null;
  output: unknown;
}>;

export type ReusableJobQuery = {
  userId: string;
  applicationProjectId: string | null;
  jobType: AiJobType;
  provider: AiProvider;
  inputHash: string;
};

export type InFlightQuery = {
  userId: string;
  jobType: AiJobType;
  target: { type: string; id: string } | null;
  /** Used only when there is no target (no DB uniqueness then): same input in flight. */
  inputHash: string | null;
  applicationProjectId: string | null;
};

export type ClaimOptions = {
  now: string;
  /** Claim only when heartbeat_at is null or older than this. */
  staleBefore: string;
  /** Claim even before next_run_at (cancel of a waiting job). Default: only when next_run_at is null or due. */
  ignoreNextRunAt?: boolean;
};

/**
 * ai_jobs access for ONE user (the app_ai_writer client is scoped by `sub`).
 * `gen` = the run_generation the caller holds; writes match only that
 * generation AND an active status (queued/running).
 */
export interface JobStore {
  get(jobId: string): Promise<JobRecord | null>;
  /** Latest succeeded job with the same provider + input_hash in the same scope (C-6 재사용). */
  findReusable(query: ReusableJobQuery): Promise<{ id: string } | null>;
  /** The queued/running job of the same type on the same target (D-34 동시 실행 1개). */
  findInFlight(query: InFlightQuery): Promise<{ id: string } | null>;
  /** Inserts a queued job (run_generation = meta.runBase). In-flight unique violation → AppError `conflict`. */
  insert(job: NewJob): Promise<void>;
  /**
   * Atomically moves `queued` → `running` (and clears next_run_at) when the
   * heartbeat is stale enough and the job is due. Returns the claimed row, or
   * null when someone else has it / it isn't queued / it isn't due yet.
   */
  claim(jobId: string, opts: ClaimOptions): Promise<JobRecord | null>;
  /** Update of an active job of generation `gen`. Returns false when nothing matched. */
  update(jobId: string, gen: number, patch: JobPatch): Promise<boolean>;
  /** Writes the whole checkpoint map + meta (+ patch) for generation `gen`. */
  saveStepOutputs(jobId: string, gen: number, outputs: Record<string, unknown>, meta: JobMeta, patch?: JobPatch): Promise<boolean>;
  /** Heartbeat + cancel check. `current: false` when the job left this generation / active status. */
  heartbeat(jobId: string, gen: number, now: string): Promise<{ current: boolean; cancelRequested: boolean }>;
  /** Terminal failed/canceled transition of generation `gen`. False when not matched (lost). */
  finish(jobId: string, gen: number, patch: JobPatch & { status: "failed" | "canceled" }): Promise<boolean>;
  /**
   * running AND run_generation = gen → succeeded (RPC `complete_ai_job`). False
   * on `invalid_ai_job_transition` (another actor or generation won).
   * Persist output / model with `update` BEFORE calling this.
   */
  complete(jobId: string, gen: number, progress: StoredAiJobProgress): Promise<boolean>;
  /**
   * Manual-retry claim: failed AND run_generation = gen → queued,
   * run_generation gen + 1, heartbeat_at = now, step_outputs with the new meta.
   * The DB guard clears error_code / finished_at / retry_after / quota_resets_at.
   * In-flight unique violation (another job on the target started meanwhile) → AppError `conflict`.
   */
  requeueFailed(jobId: string, gen: number, now: string, outputs: Record<string, unknown>, meta: JobMeta): Promise<boolean>;
}

// ---------------- usage records (C-13) ----------------

/** Provider-normalized token usage (same shape as the ai-pipeline `NormalizedUsage`). */
export type NormalizedUsage = {
  inputTokens: number;
  cachedInputTokens: number;
  cacheWriteTokens: number;
  /** Includes reasoning tokens. */
  outputTokens: number;
  reasoningTokens: number | null;
  usageSource: UsageSource;
};

/**
 * What the LLM wrapper reports after EVERY provider call (each retry attempt and
 * failed calls included) through `onCall` — agreed with ai-pipeline-engineer
 * (S3a plan "인터페이스 합의").
 */
export type LlmCallRecord = {
  callKey: string | null;
  /** Model actually called. */
  model: string;
  usage: NormalizedUsage;
  outcome: UsageOutcome;
  errorCode: AiErrorCode | null;
  latencyMs: number;
  /** Call end time when the wrapper reports it; the recorder uses its own clock otherwise. */
  occurredAt?: Date;
};

/** ai_price_tables row (USD per 1M tokens). */
export type PriceRow = {
  version: string;
  inputUsdPerMtok: number;
  cachedInputUsdPerMtok: number | null;
  cacheWriteUsdPerMtok: number | null;
  outputUsdPerMtok: number;
  longContextThresholdTokens: number | null;
  longContextInputUsdPerMtok: number | null;
  longContextCachedInputUsdPerMtok: number | null;
  longContextCacheWriteUsdPerMtok: number | null;
  longContextOutputUsdPerMtok: number | null;
};

/** One ai_usage_records insert (period_month is computed by the DB). */
export type UsageRecordRow = {
  occurredAt: string;
  feature: UsageFeature;
  jobType: AiJobType;
  aiJobId: string | null;
  callKey: string | null;
  applicationProjectId: string | null;
  provider: AiProvider;
  model: string;
  modelTier: ModelTier;
  connectionTier: ConnectionTier;
  usage: NormalizedUsage;
  outcome: UsageOutcome;
  errorCode: AiErrorCode | null;
  priceTableVersion: string;
  estimatedCostUsd: number;
};

/** ai_usage_records / ai_price_tables access for ONE user (app_ai_writer). */
export interface UsageStore {
  insert(row: UsageRecordRow): Promise<void>;
  /** Latest price row with effective_from <= `onDate` (YYYY-MM-DD, KST). */
  priceFor(provider: AiProvider, model: string, onDate: string): Promise<PriceRow | null>;
  /** occurred_at of the user's last call to `provider` (C-12 call spacing). */
  lastCallAt(provider: AiProvider): Promise<string | null>;
}

// ---------------- steps ----------------

/** What the runner hands the LLM factory (ai-pipeline `createLlm`) per step. */
export type LlmFactoryInput = {
  provider: AiProvider;
  tier: ModelTier;
  connectionTier: ConnectionTier;
  keySource: KeySource;
  jobId: string;
  /** The step attempt's deadline / cancel signal, applied to every call (QA-S3a-03). */
  signal: AbortSignal;
  /** Awaited after every provider call: inserts one ai_usage_records row. Never throws. */
  onCall: (record: LlmCallRecord) => Promise<void>;
};

/**
 * What a step receives (agreed with ai-pipeline-engineer). `llm` is whatever
 * `RunnerDeps.createLlm` returns (the provider-neutral `llm` in production, a
 * fake in tests); it records usage through the runner's `onCall`.
 */
export type StepContext<TLlm = unknown> = {
  jobId: string;
  userId: string;
  jobType: AiJobType;
  stage: string;
  params: JsonObject;
  /** Results of completed stages (this run and earlier runs). */
  previous: Readonly<Record<string, unknown>>;
  llm: TLlm;
  provider: AiProvider;
  modelTier: ModelTier;
  connectionTier: ConnectionTier;
  /** True on the free tier (C-12): make calls one after another, never in parallel. */
  sequential: boolean;
  /** `{jobType}.{stage}` — prefix for AiRequest.callKey (e.g. `insight.match.2`). */
  callKeyPrefix: string;
  /** app_ai_writer client for this user (reads allowed columns, writes AI result tables). */
  db: AiWriterSupabaseClient;
  /**
   * Aborted with reason `"canceled"` (user cancel), `"timeout"` (step
   * deadline), or `"lost"`. Pass it to provider calls.
   */
  signal: AbortSignal;
  /** Updates ai_jobs.progress `{ stage, done, total }` (+ heartbeat). */
  reportProgress: (done: number, total: number) => Promise<void>;
  /** 1 for the first try of this step in this run, +1 per automatic retry. */
  attempt: number;
};

export type JobStep<TLlm = unknown> = {
  /** C-6 progress stage key (`match`, `generate`, …). Unique within the job type. */
  stage: string;
  /** Initial `progress.total` for this stage (default 1). */
  total?: number;
  /** Step deadline; default STEP_TIMEOUT_MS. Must stay under the invocation budget. */
  timeoutMs?: number;
  /** Returns a JSON-serializable result (stored as the stage checkpoint). */
  run: (ctx: StepContext<TLlm>) => Promise<unknown>;
};

export type JobTypeDefinition<TLlm = unknown> = {
  jobType: AiJobType;
  /** Model tier for every call of this job type (C-10.1; registry value, fixed into ai_jobs.model_tier). Default `default`. */
  modelTier?: ModelTier;
  steps: JobStep<TLlm>[];
  /**
   * Free-tier sequential mode (C-12): the same work as `steps`, unfolded into
   * one provider call per step (e.g. AI-02 match batches, AI-06 one answer per
   * step). Must depend on params only (resume relies on stable stage keys).
   * Omit when `steps` already makes one call at a time.
   */
  freeTierSteps?: (params: JsonObject) => JobStep<TLlm>[];
  /** Optional final value stored in ai_jobs.output (draft_source_ranking only, DM A.15). */
  output?: (previous: Readonly<Record<string, unknown>>) => unknown;
};

/** The per-user handles the runner needs. */
export type UserScope = {
  store: JobStore;
  usage: UsageStore;
  db: AiWriterSupabaseClient;
  keySource: KeySource;
  keyStatus: KeyStatusReporter;
};

export type JobRef = { jobId: string; userId: string };

export type RunnerDeps<TLlm = unknown> = {
  forUser: (userId: string) => UserScope;
  /** Active provider + tier at job start (S3b: ai_provider_keys / profiles). */
  providerContext: ProviderContextSource;
  /** Builds the provider-neutral LLM for one step attempt (ai-pipeline `createLlm`). */
  createLlm: (input: LlmFactoryInput) => TLlm;
  /** Waits (bounded) for the Llm's open calls and their usage records; force-records the rest (`Llm.settle`). */
  settleLlm: (llm: TLlm, timeoutMs: number) => Promise<void>;
  /** Registry lookup. */
  getDefinition: (jobType: AiJobType) => JobTypeDefinition<TLlm> | undefined;
  /** Schedules work after the response (`after()` in production; immediate in tests). */
  schedule: (task: () => Promise<void>) => void;
  /** Continues a yielded job in a NEW invocation (self-invoke). */
  continueJob: (ref: JobRef) => Promise<void>;
  now?: () => Date;
  /** 0 ≤ x < 1, for the retry jitter (C-11.3 "+0~1초 무작위"). */
  random?: () => number;
  /** Logger for job metadata only (C-7: never prompt / output text, never a key). */
  log?: (event: string, fields: Record<string, string | number | boolean | null>) => void;
  timing?: Partial<RunnerTiming>;
};

export type RunnerTiming = {
  /** Wall-clock budget of one invocation (T-14: under 60 s). */
  invocationBudgetMs: number;
  stepTimeoutMs: number;
  heartbeatIntervalMs: number;
  /** Max wait at the end of an invocation for abandoned calls' usage records (QA-S3a-03). */
  usageSettleGraceMs: number;
};

export type RunOutcome =
  | "not_claimed"
  | "succeeded"
  | "failed"
  | "canceled"
  | "yielded"
  | "scheduled" // queued with next_run_at (C-11.3 retry wait or C-12 call spacing)
  | "lost"; // another actor (stalled sweep, cancel, newer generation) owns the job
