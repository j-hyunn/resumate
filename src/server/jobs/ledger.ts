import { mapDbError } from "@/server/db/errors";
import type { AiWriterSupabaseClient } from "@/server/db/types";
import type { Ledger } from "./types";

/**
 * Usage ledger (D-17) on the S3 RPCs. Run as app_ai_writer (the RPCs are
 * security definer and executable by app_ai_writer only); the user is the
 * token's `sub`.
 *
 * - reserve_usage: serialized per user/month/feature; raises usage_limit_reached
 *   / usage_limit_missing (mapped to AppError). NOT idempotent — call once per job start.
 * - release_usage(id): releases ONE reservation (QA-S3-01: settle per id);
 *   already released = success.
 * - release_usage_for_job: every leftover `reserved` row of a job — used only
 *   by the manual-retry winner before it reserves anew.
 * Charging is done by `complete_ai_job` with the succeeded transition
 * (supabase-store.ts `complete`), never here.
 */
export function createSupabaseLedger(db: AiWriterSupabaseClient): Ledger {
  return {
    async reserve({ feature, units, reason, jobId }) {
      const { data, error } = await db.rpc("reserve_usage", {
        p_feature: feature,
        p_units: units,
        p_reason: reason,
        p_ai_job_id: jobId,
      });
      if (error) throw mapDbError(error);
      return data;
    },
    async release(usageEventId) {
      const { error } = await db.rpc("release_usage", { p_usage_event_id: usageEventId });
      if (error) throw mapDbError(error);
    },
    async releaseJob(jobId) {
      const { error } = await db.rpc("release_usage_for_job", { p_ai_job_id: jobId });
      if (error) throw mapDbError(error);
    },
  };
}
