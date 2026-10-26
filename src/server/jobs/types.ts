import type { AiJobProgress } from "@/lib/contracts/ai";
import type { AiErrorCode, AiJobStatus, AiJobType, UsageFeature, UsageReason } from "@/lib/contracts/enums";
import type { AiWriterSupabaseClient } from "@/server/db/types";

/**
 * Job runner types (AI C-6 비동기 작업). The runner depends only on these
 * interfaces; `supabase-store.ts` / `ledger.ts` implement them against the DB,
 * tests use in-memory fakes.
 */

export type JsonObject = Record<string, unknown>;

/**
 * Runner bookkeeping stored under `step_outputs._meta` (survives yield /
 * continue / manual retry). Stage keys never start with `_`.
 */
export type JobMeta = {
  /** Reservation of the CURRENT run generation (null for no-charge job types). Settled by id (QA-S3-01). */
  usageEventId: string | null;
  /** attempt_count at the start of the current run generation (auto-retry budget = attempt_count - runBase). */
  runBase: number;
};

export const META_KEY = "_meta";

/** The ai_jobs columns the runner reads (camelCase). */
export type JobRecord = {
  id: string;
  userId: string;
  jobType: AiJobType;
  status: AiJobStatus;
  progress: AiJobProgress;
  params: JsonObject;
  /**
   * Run generation (QA-S3-05): monotonic, never reset. +1 on each automatic
   * retry and on each manual retry. Every runner write is conditional on it,
   * so a late runner of an older generation changes nothing.
   */
  attemptCount: number;
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
  params: JsonObject;
  inputHash: string | null;
  promptVersion: string | null;
  model: string | null;
  progress: AiJobProgress;
  meta: JobMeta;
};

/** Columns the runner may change (app_ai_writer update grant). */
export type JobPatch = Partial<{
  status: AiJobStatus;
  progress: AiJobProgress;
  attemptCount: number;
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
  inputHash: string;
};

/**
 * ai_jobs access for ONE user (the app_ai_writer client is scoped by `sub`).
 * `gen` = the attempt_count the caller holds; writes match only that generation
 * AND an active status (queued/running).
 */
export interface JobStore {
  get(jobId: string): Promise<JobRecord | null>;
  /** Latest succeeded job with the same input_hash in the same scope (C-6 재사용). */
  findReusable(query: ReusableJobQuery): Promise<{ id: string } | null>;
  /** A queued/running job with the same input_hash in the same scope (QA-S3-03 double start). */
  findInFlight(query: ReusableJobQuery): Promise<{ id: string } | null>;
  /** Inserts a queued job (attempt_count = meta.runBase). Unique in-flight index violation → AppError `conflict`. */
  insert(job: NewJob): Promise<void>;
  /**
   * Atomically moves `queued` → `running` when the job's heartbeat is null or
   * older than `staleBefore` (so two runners can't both claim it).
   * Returns the claimed row, or null when someone else has it / it isn't queued.
   */
  claim(jobId: string, opts: { now: string; staleBefore: string }): Promise<JobRecord | null>;
  /** Update of an active job of generation `gen`. Returns false when nothing matched. */
  update(jobId: string, gen: number, patch: JobPatch): Promise<boolean>;
  /**
   * Writes the whole checkpoint map + meta (no jsonb merge in PostgREST; the
   * claimed runner is the only writer of its generation).
   */
  saveStepOutputs(jobId: string, gen: number, outputs: Record<string, unknown>, meta: JobMeta, patch?: JobPatch): Promise<boolean>;
  /** Heartbeat + cancel check. `current: false` when the job left this generation / active status. */
  heartbeat(jobId: string, gen: number, now: string): Promise<{ current: boolean; cancelRequested: boolean }>;
  /** Terminal failed/canceled transition of generation `gen`. False when not matched (lost). */
  finish(jobId: string, gen: number, patch: JobPatch & { status: "failed" | "canceled" }): Promise<boolean>;
  /**
   * Success + charge of `usageEventId` in ONE transaction (RPC `complete_ai_job`):
   * running AND attempt_count = gen → succeeded (+ progress). False on
   * `invalid_ai_job_transition` (another actor or generation won; usage unchanged).
   * Persist output / usage / model with `update` BEFORE calling this.
   */
  complete(jobId: string, gen: number, usageEventId: string | null, progress: AiJobProgress): Promise<boolean>;
  /**
   * Manual-retry claim: failed AND attempt_count = gen → queued, attempt_count
   * gen + 1, heartbeat_at = now, step_outputs with the new meta. Only the
   * winner (true) may touch the ledger.
   */
  requeueFailed(jobId: string, gen: number, now: string, outputs: Record<string, unknown>, meta: JobMeta): Promise<boolean>;
}

export type ReserveInput = {
  feature: UsageFeature;
  units: number;
  reason: UsageReason;
  jobId: string;
};

/**
 * Usage ledger (D-17): reserve → charge | release, per reservation id
 * (QA-S3-01). Charging happens only inside `JobStore.complete` (same
 * transaction as succeeded).
 */
export interface Ledger {
  /** Returns the usage_event id. Throws `usage_limit_reached` / `usage_limit_missing`. NOT idempotent. */
  reserve(input: ReserveInput): Promise<string>;
  /** reserved → released for ONE reservation (idempotent when already released). */
  release(usageEventId: string): Promise<void>;
  /** Releases every leftover `reserved` row of a job — only the manual-retry winner, before reserving anew. */
  releaseJob(jobId: string): Promise<void>;
}

/**
 * What a step receives (agreed with ai-pipeline-engineer, S3 plan
 * "인터페이스 합의"). `ai` is whatever the runner deps create (the Anthropic
 * AiClient in production, a fake in tests).
 */
export type StepContext<TAi = unknown> = {
  jobId: string;
  userId: string;
  jobType: AiJobType;
  stage: string;
  params: JsonObject;
  /** Results of completed stages (this run and earlier runs). */
  previous: Readonly<Record<string, unknown>>;
  ai: TAi;
  /** app_ai_writer client for this user (reads allowed columns, writes AI result tables). */
  db: AiWriterSupabaseClient;
  /**
   * Aborted with reason `"canceled"` (user cancel) or `"timeout"` (step
   * deadline / invocation budget). Pass it to model calls.
   */
  signal: AbortSignal;
  /** Updates ai_jobs.progress `{ stage, done, total }` (+ heartbeat). */
  reportProgress: (done: number, total: number) => Promise<void>;
  /** 1 for the first try of this step in this run, 2 for the automatic retry. */
  attempt: number;
};

export type JobStep<TAi = unknown> = {
  /** C-6 progress stage key (`match`, `generate`, …). Unique within the job type. */
  stage: string;
  /** Initial `progress.total` for this stage (default 1). */
  total?: number;
  /** Step deadline; default STEP_TIMEOUT_MS. Must stay under the invocation budget. */
  timeoutMs?: number;
  /** Returns a JSON-serializable result (stored as the stage checkpoint). */
  run: (ctx: StepContext<TAi>) => Promise<unknown>;
};

export type JobTypeDefinition<TAi = unknown> = {
  jobType: AiJobType;
  steps: JobStep<TAi>[];
  /** Usage to reserve at start (D-17). Omit for no-charge jobs (AI-01, AI-11, 채점 …). */
  usage?: { feature: UsageFeature; units: number } | ((params: JsonObject) => { feature: UsageFeature; units: number } | null);
  /** Optional final value stored in ai_jobs.output (draft_source_ranking only, DM A.15). */
  output?: (previous: Readonly<Record<string, unknown>>) => unknown;
};

/** The per-user handles the runner needs. */
export type UserScope<TAi = unknown> = {
  store: JobStore;
  ledger: Ledger;
  db: AiWriterSupabaseClient;
  ai: TAi;
};

export type JobRef = { jobId: string; userId: string };

export type RunnerDeps<TAi = unknown> = {
  forUser: (userId: string) => UserScope<TAi>;
  /** Registry lookup. */
  getDefinition: (jobType: AiJobType) => JobTypeDefinition<TAi> | undefined;
  /** Schedules work after the response (`after()` in production; immediate in tests). */
  schedule: (task: () => Promise<void>) => void;
  /** Continues a yielded job in a NEW invocation (self-invoke). */
  continueJob: (ref: JobRef) => Promise<void>;
  now?: () => Date;
  /** Logger for job metadata only (C-7: never prompt or output text). */
  log?: (event: string, fields: Record<string, string | number | boolean | null>) => void;
  timing?: Partial<RunnerTiming>;
};

export type RunnerTiming = {
  /** Wall-clock budget of one invocation (T-14: under 60 s). */
  invocationBudgetMs: number;
  stepTimeoutMs: number;
  heartbeatIntervalMs: number;
};

export type RunOutcome =
  | "not_claimed"
  | "succeeded"
  | "failed"
  | "canceled"
  | "yielded"
  | "lost"; // another actor (stalled sweep) finished the job first
