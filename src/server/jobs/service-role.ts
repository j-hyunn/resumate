import "server-only";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { AppError } from "@/lib/contracts/errors";
import type { Database } from "@/server/db/database.types";
import { getServerEnv } from "@/server/env";

/**
 * The ONLY module that creates a service-role Supabase client (backend-context
 * "DB roles": the service role is not used for request paths). Callers and why:
 *
 * - `cron.ts` (S3a): sweep_stalled_ai_jobs / claim_due_ai_jobs — the cron sees
 *   every user's jobs, which no user-scoped token can.
 * - `retention.ts` (S9): purge_* RPCs (NFR-PRV-06, DM §4.4) — cross-user
 *   cleanup, granted to service_role only.
 * - `services/account` via `deleteAuthUser` below (S9, FL-07): only the
 *   Auth admin API can delete an `auth.users` row. Public data is deleted
 *   earlier by the user-session RPC `delete_account`, not with this key.
 * - `keys/app.ts` (R1 A19, DM v4.2 2.11.3): `save_provider_key` /
 *   `record_provider_key_check` are executable by service_role only, with
 *   `p_user_id` = the session user (verified by the Server Action first), so a
 *   browser can't store unverified ciphertext or flip key status itself.
 * - `auth/account-state.ts` (R1 A7, DM v4.2 6.1): `get_account_deletion_state`
 *   (service_role only — users can't read `account_deletion_logs`), called only
 *   when the session user has no `profiles` row.
 *
 * No table is read or written directly with this client — RPCs and the Auth admin API only.
 */

export type ServiceRoleClient = SupabaseClient<Database>;

export function createServiceRoleClient(clientInfo: string): ServiceRoleClient {
  const env = getServerEnv();
  if (!env.SUPABASE_SERVICE_ROLE_KEY) {
    throw new AppError("internal_error", undefined, { status: 500, cause: new Error("SUPABASE_SERVICE_ROLE_KEY missing") });
  }
  return createClient<Database>(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    global: { headers: { "X-Client-Info": clientInfo } },
  });
}

/** Result of an Auth admin delete. `alreadyGone` = the user was deleted by an earlier attempt (idempotent retry). */
export type AuthUserDeleteResult = { alreadyGone: boolean };

/**
 * FL-07 step 4: `auth.admin.deleteUser(userId)` (hard delete). A 404
 * (`user_not_found`) counts as success so a retried deletion passes.
 * Throws an AppError without the Auth message (no PII in errors or logs).
 */
export async function deleteAuthUser(userId: string, client: ServiceRoleClient = createServiceRoleClient("resumate-account-deletion")): Promise<AuthUserDeleteResult> {
  const { error } = await client.auth.admin.deleteUser(userId);
  if (!error) return { alreadyGone: false };
  if (error.status === 404 || error.code === "user_not_found") return { alreadyGone: true };
  throw new AppError("internal_error", undefined, { status: 500, cause: new Error(`auth admin deleteUser failed (status ${error.status ?? "?"}, code ${error.code ?? "?"})`) });
}
