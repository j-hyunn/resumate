import { AiJobProgressSchema } from "@/lib/contracts/ai";
import type { AiErrorCode, AiJobStatus, AiJobType } from "@/lib/contracts/enums";
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
 * `attempt_count = gen` (QA-S3-05), so a late runner of an older generation, or
 * one whose job the stalled sweep already failed, changes nothing. The DB
 * status guard (`invalid_ai_job_transition`) is the backstop; it is "lost" here.
 */

const ACTIVE: AiJobStatus[] = ["queued", "running"];

/** Explicit columns everywhere (QA-S3-08). */
const COLUMNS =
  "id, user_id, job_type, status, progress, params, attempt_count, error_code, input_hash, cancel_requested_at, heartbeat_at, started_at, finished_at, created_at, updated_at, step_outputs";

type Row = {
  id: string;
  user_id: string;
  job_type: string;
  status: string;
  progress: Json | null;
  params: Json;
  attempt_count: number;
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

function parseMeta(value: unknown, attemptCount: number): JobMeta {
  const m = value && typeof value === "object" ? (value as Partial<JobMeta>) : {};
  return {
    usageEventId: typeof m.usageEventId === "string" ? m.usageEventId : null,
    runBase: typeof m.runBase === "number" ? m.runBase : attemptCount,
  };
}

export function toJobRecord(row: Row): JobRecord {
  const progress = AiJobProgressSchema.safeParse(row.progress);
  const { [META_KEY]: meta, ...stepOutputs } = asObject(row.step_outputs);
  return {
    id: row.id,
    userId: row.user_id,
    jobType: row.job_type as AiJobType,
    status: row.status as AiJobStatus,
    progress: progress.success ? progress.data : { stage: null, done: 0, total: 0 },
    params: asObject(row.params),
    attemptCount: row.attempt_count,
    errorCode: row.error_code as AiErrorCode | null,
    inputHash: row.input_hash,
    cancelRequestedAt: row.cancel_requested_at,
    heartbeatAt: row.heartbeat_at,
    startedAt: row.started_at,
    finishedAt: row.finished_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    stepOutputs,
    meta: parseMeta(meta, row.attempt_count),
  };
}

export function toStepOutputsJson(outputs: Record<string, unknown>, meta: JobMeta): NonNullable<Json> {
  return { ...outputs, [META_KEY]: meta } as NonNullable<Json>;
}

export function toUpdateRow(patch: JobPatch): TablesUpdate<"ai_jobs"> {
  const row: TablesUpdate<"ai_jobs"> = {};
  if (patch.status !== undefined) row.status = patch.status;
  if (patch.progress !== undefined) row.progress = patch.progress as Json;
  if (patch.attemptCount !== undefined) row.attempt_count = patch.attemptCount;
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
      .eq("attempt_count", gen)
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
      let query = db.from("ai_jobs").select("id").eq("user_id", q.userId).eq("job_type", q.jobType).eq("input_hash", q.inputHash);
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
      let query = db.from("ai_jobs").select("id").eq("user_id", q.userId).eq("job_type", q.jobType).eq("input_hash", q.inputHash);
      query = q.applicationProjectId === null ? query.is("application_project_id", null) : query.eq("application_project_id", q.applicationProjectId);
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
        attempt_count: job.meta.runBase,
        step_outputs: toStepOutputsJson({}, job.meta),
      });
      if (error) {
        if (error.code === "23505") throw new AppError("conflict", undefined, { cause: error });
        throw mapDbError(error);
      }
    },

    async claim(jobId, opts) {
      const { data, error } = await db
        .from("ai_jobs")
        .update({ status: "running", heartbeat_at: opts.now })
        .eq("id", jobId)
        .eq("status", "queued")
        .or(`heartbeat_at.is.null,heartbeat_at.lt."${opts.staleBefore}"`)
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
        .eq("attempt_count", gen)
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

    async complete(jobId, gen, usageEventId, progress) {
      const { error } = await db.rpc("complete_ai_job", {
        p_job_id: jobId,
        p_attempt_count: gen,
        p_progress: progress as Json,
        // null = no-charge job type (the RPC then only does the transition). Generated type says string.
        p_usage_event_id: usageEventId as string,
      });
      if (error) {
        if (isTransitionError(error)) return false;
        throw mapDbError(error);
      }
      return true;
    },

    requeueFailed(jobId, gen, now, outputs, meta) {
      // The DB guard clears error_code / finished_at / cancel_requested_at on failed → queued.
      return updateWhere(
        jobId,
        gen,
        { status: "queued", attempt_count: gen + 1, heartbeat_at: now, step_outputs: toStepOutputsJson(outputs, meta) },
        ["failed"],
      );
    },
  };
}
