import { mapDbError } from "@/server/db/errors";
import type { UserSupabaseClient } from "@/server/db/types";

/**
 * L-01 shell counts and small reads the mock data layer computes in place. Rows are read as the user
 * (RLS). No consent gate here: the shell also renders S-25 (A7).
 */

/** Queued / running AI jobs of every type (S-25, S-40 키 삭제 문구). `provider` narrows. */
export async function countRunningJobs(supabase: UserSupabaseClient, provider?: string): Promise<number> {
  let q = supabase.from("ai_jobs").select("id", { count: "exact", head: true }).in("status", ["queued", "running"]);
  if (provider) q = q.eq("provider", provider);
  const { count, error } = await q;
  if (error) throw mapDbError(error);
  return count ?? 0;
}

export type ShellRows = {
  activeChat: boolean;
  /** application-screen jobs in flight (chat turns have their own UI; `jd_extraction` = R17 legacy rows, excluded). */
  runningApplicationJobs: number;
};

export async function loadShellRows(supabase: UserSupabaseClient): Promise<ShellRows> {
  const [chats, jobs] = await Promise.all([
    supabase.from("writing_chats").select("id", { count: "exact", head: true }).eq("status", "active"),
    supabase
      .from("ai_jobs")
      .select("id", { count: "exact", head: true })
      .in("status", ["queued", "running"])
      .not("application_project_id", "is", null)
      .not("job_type", "in", "(jd_extraction,writing_chat_turn)"),
  ]);
  if (chats.error) throw mapDbError(chats.error);
  if (jobs.error) throw mapDbError(jobs.error);
  return { activeChat: (chats.count ?? 0) > 0, runningApplicationJobs: jobs.count ?? 0 };
}

export async function loadPolicyVersions(supabase: Pick<UserSupabaseClient, "from">, now: Date = new Date()) {
  const { data, error } = await supabase
    .from("policy_versions")
    .select("id, policy_type, version, effective_at, requires_reconsent, document_path, created_at")
    .lte("effective_at", now.toISOString())
    .order("effective_at", { ascending: false })
    // R14 (R14-DB-6): same tie-break as private.current_policy_version — two versions can share an
    // effective date (privacy 2026-11-08 / 2026-11-08.1); the higher version string wins.
    .order("version", { ascending: false });
  if (error) throw mapDbError(error);
  return data ?? [];
}

export async function loadConsentRows(supabase: UserSupabaseClient) {
  const { data, error } = await supabase
    .from("consents")
    .select("id, user_id, created_at, consent_type, policy_version, agreed, agreed_at, withdrawn_at, user_agent_hash")
    .order("agreed_at", { ascending: true });
  if (error) throw mapDbError(error);
  return data ?? [];
}

/** Reads the readiness RPC as the user (DM §6). The shape is the RPC's own (snake_case). */
export async function loadDataReadiness(supabase: UserSupabaseClient): Promise<unknown> {
  const { data, error } = await supabase.rpc("get_data_readiness");
  if (error) throw mapDbError(error);
  return data;
}
