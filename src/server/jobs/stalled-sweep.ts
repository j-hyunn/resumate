import "server-only";
import { timingSafeEqual } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import { AppError } from "@/lib/contracts/errors";
import type { Database } from "@/server/db/database.types";
import { mapDbError } from "@/server/db/errors";
import { getServerEnv } from "@/server/env";
import { STALLED_AFTER_MS } from "./constants";

/**
 * Cron sweep of stalled AI jobs across ALL users (C-6 heartbeat, plan "멈춤 감지").
 *
 * Why the service role (the only place in the app that uses it):
 * the app_ai_writer token is scoped to one user (`sub`) by RLS, and the cron
 * must see every user's jobs. The service role is used for exactly one call,
 * `sweep_stalled_ai_jobs` (security definer, execute granted to service_role
 * only), which in one transaction fails stalled jobs and releases their
 * reservations (plus leaked reservations of missing/failed/canceled jobs).
 * No table is read or written directly with this key.
 */

export function isCronAuthorized(authorization: string | null, secret: string): boolean {
  if (!authorization) return false;
  const expected = Buffer.from(`Bearer ${secret}`);
  const given = Buffer.from(authorization);
  return expected.length === given.length && timingSafeEqual(expected, given);
}

export async function sweepStalledJobs(now = new Date()): Promise<{ failed: number; stalledBefore: string }> {
  const env = getServerEnv();
  if (!env.SUPABASE_SERVICE_ROLE_KEY) {
    throw new AppError("internal_error", undefined, { status: 500, cause: new Error("SUPABASE_SERVICE_ROLE_KEY missing") });
  }
  const admin = createClient<Database>(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    global: { headers: { "X-Client-Info": "resumate-cron-stalled-jobs" } },
  });
  const stalledBefore = new Date(now.getTime() - STALLED_AFTER_MS).toISOString();
  const { data, error } = await admin.rpc("sweep_stalled_ai_jobs", { p_stalled_before: stalledBefore });
  if (error) throw mapDbError(error);
  return { failed: data, stalledBefore };
}
