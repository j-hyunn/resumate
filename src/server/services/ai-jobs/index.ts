import { mapDbError } from "@/server/db/errors";
import type { UserSupabaseClient } from "@/server/db/types";

/** User-session cancel request (RPC `request_ai_job_cancel`, owner-checked, idempotent). */
export async function requestCancel(supabase: UserSupabaseClient, jobId: string): Promise<{ status: string; cancelRequestedAt: string | null }> {
  const { data, error } = await supabase.rpc("request_ai_job_cancel", { p_job_id: jobId });
  if (error) throw mapDbError(error);
  const row = (data ?? {}) as { status?: string; cancel_requested_at?: string | null };
  return { status: row.status ?? "queued", cancelRequestedAt: row.cancel_requested_at ?? null };
}

/** Columns the user session may read (`step_outputs`, `params`, `run_generation` have no grant). */
const JOB_VIEW_COLUMNS =
  "id, user_id, created_at, updated_at, job_type, application_project_id, target_type, target_id, status, progress, provider, model_tier, connection_tier, retry_count, next_run_at, retry_wait_total_ms, error_code, error_category, failure_cause, quota_resets_at, retry_after, input_hash, prompt_version, model, usage, output, heartbeat_at, cancel_requested_at, started_at, finished_at, application_projects(name, name_source, created_at)";

export async function loadJobViewRow(supabase: UserSupabaseClient, jobId: string) {
  const { data, error } = await supabase.from("ai_jobs").select(JOB_VIEW_COLUMNS).eq("id", jobId).maybeSingle();
  if (error) throw mapDbError(error);
  return data;
}

/** Latest job for a target; `jobType` narrows. */
export async function loadLatestJobViewRow(supabase: UserSupabaseClient, targetType: string, targetId: string, jobType?: string) {
  let q = supabase.from("ai_jobs").select(JOB_VIEW_COLUMNS).eq("target_type", targetType).eq("target_id", targetId);
  if (jobType) q = q.eq("job_type", jobType);
  const { data, error } = await q.order("created_at", { ascending: false }).limit(1).maybeSingle();
  if (error) throw mapDbError(error);
  return data;
}

/** C-03 watcher: jobs in flight + jobs that ended since `sinceIso` (completion toasts). Chat turns and AI-01 have their own UI. */
export async function loadActiveJobViewRows(supabase: UserSupabaseClient, sinceIso: string) {
  const { data, error } = await supabase
    .from("ai_jobs")
    .select(JOB_VIEW_COLUMNS)
    .not("job_type", "in", "(writing_chat_turn,jd_extraction,key_verification)")
    .or(`status.in.(queued,running),finished_at.gte.${sinceIso}`)
    .order("created_at", { ascending: true });
  if (error) throw mapDbError(error);
  return data ?? [];
}
