import "server-only";
import { timingSafeEqual } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import { AppError } from "@/lib/contracts/errors";
import type { Database } from "@/server/db/database.types";
import { mapDbError } from "@/server/db/errors";
import { getServerEnv } from "@/server/env";
import { CRON_DUE_JOBS_LIMIT, STALLED_AFTER_MS } from "./constants";
import type { JobRef } from "./types";

/**
 * Cron work across ALL users (C-6 heartbeat, B-4 safety net for next_run_at).
 *
 * Why the service role (the only place in the app that uses it): the
 * app_ai_writer token is scoped to one user (`sub`) by RLS, and the cron must
 * see every user's jobs. The service role is used for exactly two security
 * definer RPCs, `sweep_stalled_ai_jobs` and `claim_due_ai_jobs` (read-only),
 * both executable by service_role only. No table is read or written directly
 * with this key, and no job runs with it: each due job is continued as its
 * user (app_ai_writer) in its own invocation via the continue route.
 */

export function isCronAuthorized(authorization: string | null, secret: string): boolean {
  if (!authorization) return false;
  const expected = Buffer.from(`Bearer ${secret}`);
  const given = Buffer.from(authorization);
  return expected.length === given.length && timingSafeEqual(expected, given);
}

function serviceClient() {
  const env = getServerEnv();
  if (!env.SUPABASE_SERVICE_ROLE_KEY) {
    throw new AppError("internal_error", undefined, { status: 500, cause: new Error("SUPABASE_SERVICE_ROLE_KEY missing") });
  }
  return createClient<Database>(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    global: { headers: { "X-Client-Info": "resumate-cron-ai-jobs" } },
  });
}

export type CronResult = { stalled: number; due: number; continued: number };

/**
 * 1. sweep_stalled_ai_jobs(now - STALLED_AFTER_MS) — skips queued jobs waiting on next_run_at.
 * 2. claim_due_ai_jobs(now, limit) — queued jobs whose next_run_at has passed.
 * 3. `continueJob` for each (self-invoke with a continue token → runs as that user).
 */
export async function runAiJobsCron(continueJob: (ref: JobRef) => Promise<void>, now = new Date()): Promise<CronResult> {
  const admin = serviceClient();
  const stalledBefore = new Date(now.getTime() - STALLED_AFTER_MS).toISOString();
  const swept = await admin.rpc("sweep_stalled_ai_jobs", { p_stalled_before: stalledBefore });
  if (swept.error) throw mapDbError(swept.error);

  const due = await admin.rpc("claim_due_ai_jobs", { p_now: now.toISOString(), p_limit: CRON_DUE_JOBS_LIMIT });
  if (due.error) throw mapDbError(due.error);
  const refs: JobRef[] = (due.data ?? []).map((row) => ({ jobId: row.id, userId: row.user_id }));
  const results = await Promise.allSettled(refs.map((ref) => continueJob(ref)));
  return { stalled: swept.data, due: refs.length, continued: results.filter((r) => r.status === "fulfilled").length };
}
