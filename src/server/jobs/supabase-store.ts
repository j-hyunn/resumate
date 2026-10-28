import { StoredAiJobProgressSchema } from "@/lib/contracts/ai";
import type { AiErrorCode, AiJobStatus, AiJobType, AiProvider, ConnectionTier, ModelTier } from "@/lib/contracts/enums";
import { AppError } from "@/lib/contracts/errors";
import type { Json, TablesUpdate } from "@/server/db/database.types";
import { mapDbError } from "@/server/db/errors";
import type { AiWriterSupabaseClient } from "@/server/db/types";
import { META_KEY, type JobMeta, type JobPatch, type JobRecord, type JobStore, type JsonObject, type NewJob } from "./types";

/**
 * JobStore on ai_jobs through the app_ai_writer client (DM-13: AI writes go
 * through app_ai_writer; RLS scopes rows to the token's `sub`).
 *
 * Every runner write is conditional on `status in (queued, running)` AND
 * `run_generation = gen` (QA-S3-05), so a late runner of an older generation,
 * or one whose job the stalled sweep already failed, changes nothing. The DB
 * status guard (`invalid_ai_job_transition`) is the backstop; it is "lost" here.
 */

const ACTIVE: AiJobStatus[] = ["queued", "running"];

/** Explicit columns everywhere (QA-S3-08). */
const COLUMNS =
  "id, user_id, job_type, status, progress, params, application_project_id, target_type, target_id, provider, model_tier, connection_tier, run_generation, retry_count, retry_wait_total_ms, next_run_at, retry_after, quota_resets_at, error_code, input_hash, cancel_requested_at, heartbeat_at, started_at, finished_at, created_at, updated_at, step_outputs";

type Row = {
  id: string;
  user_id: string;
  job_type: string;
  status: string;
  progress: Json | null;
  params: Json;
  application_project_id: string | null;
  target_type: string | null;
  target_id: string | null;
  provider: string;
  model_tier: string;
  connection_tier: string;
  run_generation: number;
  retry_count: number;
  retry_wait_total_ms: number;
  next_run_at: string | null;
  retry_after: string | null;
  quota_resets_at: string | null;
  error_code: string | null;
  input_hash: string | null;
  cancel_requested_at: string | null;
  heartbeat_at: string | null;
  started_at: string | null;
  finished_at: string | null;
  created_at: string;
  updated_at: string;
  step_outputs: Json;
};

function asObject(value: Json | null | undefined): JsonObject {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as JsonObject) : {};
}

function parseMeta(value: unknown, runGeneration: number, waitTotal: number): JobMeta {
  const m = value && typeof value === "object" ? (value as Partial<JobMeta>) : {};
  return {
    runBase: typeof m.runBase === "number" ? m.runBase : runGeneration,
    waitBase: typeof m.waitBase === "number" ? m.waitBase : waitTotal,
    retries: m.retries && typeof m.retries === "object" ? m.retries : {},
  };
}

export function toJobRecord(row: Row): JobRecord {
  const progress = StoredAiJobProgressSchema.safeParse(row.progress);
  const { [META_KEY]: meta, ...stepOutputs } = asObject(row.step_outputs);
  return {
    id: row.id,
    userId: row.user_id,
    jobType: row.job_type as AiJobType,
    status: row.status as AiJobStatus,
    progress: progress.success ? progress.data : { stage: null, done: 0, total: 0 },
    params: asObject(row.params),
    applicationProjectId: row.application_project_id,
    targetType: row.target_type,
    targetId: row.target_id,
    provider: row.provider as AiProvider,
    modelTier: row.model_tier as ModelTier,
    connectionTier: row.connection_tier as ConnectionTier,
    runGeneration: row.run_generation,
    retryCount: row.retry_count,
    retryWaitTotalMs: row.retry_wait_total_ms,
    nextRunAt: row.next_run_at,
    retryAfter: row.retry_after,
    quotaResetsAt: row.quota_resets_at,
    errorCode: row.error_code as AiErrorCode | null,
    inputHash: row.input_hash,
    cancelRequestedAt: row.cancel_requested_at,
    heartbeatAt: row.heartbeat_at,
    startedAt: row.started_at,
    finishedAt: row.finished_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    stepOutputs,
    meta: parseMeta(meta, row.run_generation, row.retry_wait_total_ms),
  };
}

export function toStepOutputsJson(outputs: Record<string, unknown>, meta: JobMeta): NonNullable<Json> {
  return { ...outputs, [META_KEY]: meta } as NonNullable<Json>;
}

export function toUpdateRow(patch: JobPatch): TablesUpdate<"ai_jobs"> {
  const row: TablesUpdate<"ai_jobs"> = {};
  if (patch.status !== undefined) row.status = patch.status;
  if (patch.progress !== undefined) row.progress = patch.progress as Json;
  if (patch.runGeneration !== undefined) row.run_generation = patch.runGeneration;
  if (patch.retryCount !== undefined) row.retry_count = patch.retryCount;
  if (patch.retryWaitTotalMs !== undefined) row.retry_wait_total_ms = patch.retryWaitTotalMs;
  if (patch.nextRunAt !== undefined) row.next_run_at = patch.nextRunAt;
  if (patch.retryAfter !== undefined) row.retry_after = patch.retryAfter;
  if (patch.quotaResetsAt !== undefined) row.quota_resets_at = patch.quotaResetsAt;
  if (patch.errorCode !== undefined) row.error_code = patch.errorCode;
  if (patch.heartbeatAt !== undefined) row.heartbeat_at = patch.heartbeatAt;
  if (patch.startedAt !== undefined) row.started_at = patch.startedAt;
  if (patch.finishedAt !== undefined) row.finished_at = patch.finishedAt;
  if (patch.promptVersion !== undefined) row.prompt_version = patch.promptVersion;
  if (patch.model !== undefined) row.model = patch.model;
  if (patch.usage !== undefined) row.usage = patch.usage as Json;
  if (patch.output !== undefined) row.output = patch.output as Json;
  return row;
}

type PgError = { code?: string | null; message?: string | null };

function isTransitionError(error: PgError): boolean {
  return error.code === "P0001" && error.message === "invalid_ai_job_transition";
}

export function createSupabaseJobStore(db: AiWriterSupabaseClient): JobStore {
  /** Conditional update; returns matched row count. */
  async function updateWhere(jobId: string, gen: number, row: TablesUpdate<"ai_jobs">, statuses: AiJobStatus[] = ACTIVE): Promise<boolean> {
    const { data, error } = await db
      .from("ai_jobs")
      .update(row)
      .eq("id", jobId)
      .eq("run_generation", gen)
      .in("status", statuses)
      .select("id");
    if (error) {
      if (isTransitionError(error)) return false;
      throw mapDbError(error);
    }
    return (data?.length ?? 0) > 0;
  }

  return {
    async get(jobId) {
      const { data, error } = await db.from("ai_jobs").select(COLUMNS).eq("id", jobId).maybeSingle();
      if (error) throw mapDbError(error);
      return data ? toJobRecord(data as Row) : null;
    },

    async findReusable(q) {
      let query = db
        .from("ai_jobs")
        .select("id")
        .eq("user_id", q.userId)
        .eq("job_type", q.jobType)
        .eq("provider", q.provider)
        .eq("input_hash", q.inputHash);
      query = q.applicationProjectId === null ? query.is("application_project_id", null) : query.eq("application_project_id", q.applicationProjectId);
      const { data, error } = await query
        .eq("status", "succeeded")
        .order("finished_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (error) throw mapDbError(error);
      return data ? { id: data.id } : null;
    },

    async findInFlight(q) {
      let query = db.from("ai_jobs").select("id").eq("user_id", q.userId).eq("job_type", q.jobType);
      if (q.target) {
        // Same key as the DB unique index ai_jobs_in_flight_target_key (D-34).
        query = query.eq("target_type", q.target.type).eq("target_id", q.target.id);
      } else if (q.inputHash) {
        // No target → no DB uniqueness; still follow the same input already in flight (double click).
        query = query.eq("input_hash", q.inputHash);
        query = q.applicationProjectId === null ? query.is("application_project_id", null) : query.eq("application_project_id", q.applicationProjectId);
      } else {
        return null;
      }
      const { data, error } = await query
        .in("status", ACTIVE)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (error) throw mapDbError(error);
      return data ? { id: data.id } : null;
    },

    async insert(job: NewJob) {
      const { error } = await db.from("ai_jobs").insert({
        id: job.id,
        user_id: job.userId,
        job_type: job.jobType,
        application_project_id: job.applicationProjectId,
        target_type: job.targetType,
        target_id: job.targetId,
        status: "queued",
        progress: job.progress as Json,
        params: job.params as NonNullable<Json>,
        input_hash: job.inputHash,
        prompt_version: job.promptVersion,
        model: job.model,
        provider: job.provider,
        model_tier: job.modelTier,
        connection_tier: job.connectionTier,
        run_generation: job.meta.runBase,
        step_outputs: toStepOutputsJson({}, job.meta),
      });
      if (error) {
        if (error.code === "23505") throw new AppError("conflict", undefined, { cause: error });
        throw mapDbError(error);
      }
    },

    async claim(jobId, opts) {
      // Due = no next_run_at, or next_run_at has passed (B-4 wake-up); cancel ignores it.
      const stale = `or(heartbeat_at.is.null,heartbeat_at.lt."${opts.staleBefore}")`;
      const due = `or(next_run_at.is.null,next_run_at.lte."${opts.now}")`;
      const { data, error } = await db
        .from("ai_jobs")
        .update({ status: "running", heartbeat_at: opts.now, next_run_at: null })
        .eq("id", jobId)
        .eq("status", "queued")
        .or(opts.ignoreNextRunAt ? stale.slice(3, -1) : `and(${stale},${due})`)
        .select(COLUMNS)
        .maybeSingle();
      if (error) {
        if (isTransitionError(error)) return null;
        throw mapDbError(error);
      }
      return data ? toJobRecord(data as Row) : null;
    },

    update(jobId, gen, patch) {
      return updateWhere(jobId, gen, toUpdateRow(patch));
    },

    saveStepOutputs(jobId, gen, outputs, meta, patch) {
      return updateWhere(jobId, gen, { ...toUpdateRow(patch ?? {}), step_outputs: toStepOutputsJson(outputs, meta) });
    },

    async heartbeat(jobId, gen, now) {
      const { data, error } = await db
        .from("ai_jobs")
        .update({ heartbeat_at: now })
        .eq("id", jobId)
        .eq("run_generation", gen)
        .in("status", ACTIVE)
        .select("cancel_requested_at")
        .maybeSingle();
      if (error) {
        if (isTransitionError(error)) return { current: false, cancelRequested: false };
        throw mapDbError(error);
      }
      if (!data) return { current: false, cancelRequested: false };
      return { current: true, cancelRequested: data.cancel_requested_at !== null };
    },

    finish(jobId, gen, patch) {
      return updateWhere(jobId, gen, toUpdateRow(patch));
    },

    async complete(jobId, gen, progress) {
      const { error } = await db.rpc("complete_ai_job", {
        p_job_id: jobId,
        p_run_generation: gen,
        p_progress: progress as Json,
      });
      if (error) {
        if (isTransitionError(error)) return false;
        throw mapDbError(error);
      }
      return true;
    },

    async requeueFailed(jobId, gen, now, outputs, meta) {
      // The DB guard clears error_code / finished_at / cancel_requested_at / retry_after / quota_resets_at.
      const { data, error } = await db
        .from("ai_jobs")
        .update({ status: "queued", run_generation: gen + 1, heartbeat_at: now, next_run_at: null, step_outputs: toStepOutputsJson(outputs, meta) })
        .eq("id", jobId)
        .eq("run_generation", gen)
        .eq("status", "failed")
        .select("id");
      if (error) {
        if (isTransitionError(error)) return false;
        // Another job on the same target is in flight (ai_jobs_in_flight_target_key).
        if (error.code === "23505") throw new AppError("conflict", undefined, { cause: error });
        throw mapDbError(error);
      }
      return (data?.length ?? 0) > 0;
    },
  };
}
