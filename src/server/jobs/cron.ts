import "server-only";
import { timingSafeEqual } from "node:crypto";
import { mapDbError } from "@/server/db/errors";
import { CRON_DUE_JOBS_LIMIT, STALLED_AFTER_MS } from "./constants";
import { RETENTION_BATCH_LIMIT, RETENTION_MAX_BATCHES_PER_RUN } from "./retention";
import { createServiceRoleClient } from "./service-role";
import type { JobRef } from "./types";

/**
 * Cron work across ALL users (C-6 heartbeat, B-4 safety net for next_run_at).
 *
 * Why the service role (see service-role.ts for every caller): the
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

export type CronResult = {
  stalled: number;
  due: number;
  continued: number;
  /**
   * R15 D15 (CF-A17, DM 2.6.2): `ai_jobs` rows of a 요건 미리 보기 that was never linked to an
   * application project, whose `output` / `step_outputs` were emptied 24 h after `finished_at`.
   * The rows themselves stay until `purge_old_ai_jobs`'s 90 days (retention cron), and the
   * `ai_usage_records` row keeps its 13 months with `application_project_id` null.
   */
  previewOutputsPurged: number;
};

/**
 * 1. sweep_stalled_ai_jobs(now - STALLED_AFTER_MS) — skips queued jobs waiting on next_run_at.
 * 2. claim_due_ai_jobs(now, limit) — queued jobs whose next_run_at has passed.
 * 3. `continueJob` for each (self-invoke with a continue token → runs as that user).
 * 4. purge_unused_jd_preview_outputs(now, limit) — R15 D15, in batches like the retention cron.
 *    A failure here never fails the run: the next run picks the rows up again (idempotent).
 */
export async function runAiJobsCron(continueJob: (ref: JobRef) => Promise<void>, now = new Date()): Promise<CronResult> {
  const admin = createServiceRoleClient("resumate-cron-ai-jobs");
  const stalledBefore = new Date(now.getTime() - STALLED_AFTER_MS).toISOString();
  const swept = await admin.rpc("sweep_stalled_ai_jobs", { p_stalled_before: stalledBefore });
  if (swept.error) throw mapDbError(swept.error);

  const due = await admin.rpc("claim_due_ai_jobs", { p_now: now.toISOString(), p_limit: CRON_DUE_JOBS_LIMIT });
  if (due.error) throw mapDbError(due.error);
  const refs: JobRef[] = (due.data ?? []).map((row) => ({ jobId: row.id, userId: row.user_id }));
  const results = await Promise.allSettled(refs.map((ref) => continueJob(ref)));
  return {
    stalled: swept.data,
    due: refs.length,
    continued: results.filter((r) => r.status === "fulfilled").length,
    previewOutputsPurged: await purgeUnusedJdPreviewOutputs(admin, now),
  };
}

/**
 * R15 D15: empties the `output` / `step_outputs` of unlinked `jd_preview` jobs older than 24 h.
 * Same batch rule as the retention cron (a full batch is followed by another, the rest waits for
 * the next run). Returns the number of rows emptied; a DB error returns what earlier batches did.
 */
async function purgeUnusedJdPreviewOutputs(admin: ReturnType<typeof createServiceRoleClient>, now: Date): Promise<number> {
  let total = 0;
  for (let batch = 0; batch < RETENTION_MAX_BATCHES_PER_RUN; batch++) {
    const { data, error } = await admin.rpc("purge_unused_jd_preview_outputs", { p_now: now.toISOString(), p_limit: RETENTION_BATCH_LIMIT });
    if (error || typeof data !== "number") break;
    total += data;
    if (data < RETENTION_BATCH_LIMIT) break;
  }
  return total;
}
