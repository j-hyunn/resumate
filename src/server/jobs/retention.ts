import "server-only";
import { AppError } from "@/lib/contracts/errors";
import type { ServiceRoleClient } from "./service-role";

/**
 * Retention cron (NFR-PRV-06, DM §4.4, D-DM-08 / D-DM-09). Calls the purge
 * RPCs (security definer, service_role only) one after another. Each call
 * deletes at most RETENTION_BATCH_LIMIT rows; a full batch is followed by
 * another, up to RETENTION_MAX_BATCHES_PER_RUN, and what's left goes to the
 * next run. Counts only — no ids or content are returned or logged.
 */

export const RETENTION_PURGES = [
  // Unlinked AI writing chats, 90 days after last activity (D-DM-08 [가정]).
  { key: "unlinkedWritingChats", rpc: "purge_unlinked_writing_chats" },
  // Finished ai_jobs older than 90 days (in-flight jobs are kept).
  { key: "aiJobs", rpc: "purge_old_ai_jobs" },
  // ai_usage_records older than 13 KST months (D-DM-09 [가정]).
  { key: "aiUsageRecords", rpc: "purge_old_ai_usage_records" },
  // account_deletion_logs older than 3 years.
  { key: "accountDeletionLogs", rpc: "purge_old_account_deletion_logs" },
] as const;

/** Rows per RPC call (the RPCs' own default; 1 … 50,000 allowed). */
export const RETENTION_BATCH_LIMIT = 5000;
/** Calls per purge per run while a call comes back full. The rest waits for the next run. */
export const RETENTION_MAX_BATCHES_PER_RUN = 4;

export type RetentionKey = (typeof RETENTION_PURGES)[number]["key"];
export type RetentionResult = {
  /** Rows deleted this run (for a failed purge: what earlier batches deleted). */
  deleted: Record<RetentionKey, number>;
  /** Purges whose last call was full: rows may remain for the next run. */
  hasMore: RetentionKey[];
  failed: RetentionKey[];
};

/**
 * Runs every purge even if an earlier one fails (one table's problem must not
 * stop the others), then throws `internal_error` if any failed so the cron
 * run shows as failed.
 */
export async function runRetentionCron(admin: ServiceRoleClient, now = new Date(), log: (event: string, fields: Record<string, unknown>) => void = () => {}): Promise<RetentionResult> {
  const deleted = {} as Record<RetentionKey, number>;
  const hasMore: RetentionKey[] = [];
  const failed: RetentionKey[] = [];
  for (const purge of RETENTION_PURGES) {
    let total = 0;
    let full = false;
    let ok = true;
    for (let batch = 0; batch < RETENTION_MAX_BATCHES_PER_RUN; batch++) {
      const { data, error } = await admin.rpc(purge.rpc, { p_now: now.toISOString(), p_limit: RETENTION_BATCH_LIMIT });
      if (error || typeof data !== "number") {
        ok = false;
        break;
      }
      total += data;
      full = data >= RETENTION_BATCH_LIMIT;
      if (!full) break;
    }
    deleted[purge.key] = total;
    if (!ok) failed.push(purge.key);
    else if (full) hasMore.push(purge.key);
  }
  const result = { deleted, hasMore, failed };
  log("cron.retention", result);
  if (failed.length > 0) {
    throw new AppError("internal_error", undefined, { status: 500, cause: new Error(`retention purge failed: ${failed.join(",")}`) });
  }
  return result;
}
