import { mapDbError } from "@/server/db/errors";
import type { UserSupabaseClient } from "@/server/db/types";

/** User-session cancel request (RPC `request_ai_job_cancel`, owner-checked, idempotent). */
export async function requestCancel(supabase: UserSupabaseClient, jobId: string): Promise<{ status: string; cancelRequestedAt: string | null }> {
  const { data, error } = await supabase.rpc("request_ai_job_cancel", { p_job_id: jobId });
  if (error) throw mapDbError(error);
  const row = (data ?? {}) as { status?: string; cancel_requested_at?: string | null };
  return { status: row.status ?? "queued", cancelRequestedAt: row.cancel_requested_at ?? null };
}
