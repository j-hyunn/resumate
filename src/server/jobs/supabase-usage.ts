import type { AiProvider } from "@/lib/contracts/enums";
import type { TablesInsert } from "@/server/db/database.types";
import { mapDbError } from "@/server/db/errors";
import type { AiWriterSupabaseClient } from "@/server/db/types";
import type { PriceRow, UsageRecordRow, UsageStore } from "./types";

/**
 * UsageStore on ai_usage_records / ai_price_tables through the app_ai_writer
 * client (DM §5: app_ai_writer inserts and reads its own user's records,
 * reads every price row). period_month is computed by the insert trigger.
 */

/** period_month is not sent (no insert grant): its default + insert trigger compute it. */
export function toUsageInsert(row: UsageRecordRow): TablesInsert<"ai_usage_records"> {
  return {
    occurred_at: row.occurredAt,
    feature: row.feature,
    job_type: row.jobType,
    ai_job_id: row.aiJobId,
    call_key: row.callKey,
    application_project_id: row.applicationProjectId,
    provider: row.provider,
    model: row.model,
    model_tier: row.modelTier,
    connection_tier: row.connectionTier,
    input_tokens: row.usage.inputTokens,
    cached_input_tokens: row.usage.cachedInputTokens,
    cache_write_tokens: row.usage.cacheWriteTokens,
    output_tokens: row.usage.outputTokens,
    reasoning_tokens: row.usage.reasoningTokens,
    usage_source: row.usage.usageSource,
    outcome: row.outcome,
    error_code: row.errorCode,
    price_table_version: row.priceTableVersion,
    estimated_cost_usd: row.estimatedCostUsd,
  };
}

export function createSupabaseUsageStore(db: AiWriterSupabaseClient): UsageStore {
  return {
    async insert(row) {
      const { error } = await db.from("ai_usage_records").insert(toUsageInsert(row));
      if (!error) return;
      // S5 / FL-06: the project was deleted while its job ran. The call still used the user's tokens, so the
      // record is kept without the project reference (same end state as the FK's on delete set null).
      if (error.code === "23503" && row.applicationProjectId !== null) {
        const retry = await db.from("ai_usage_records").insert(toUsageInsert({ ...row, applicationProjectId: null }));
        if (!retry.error) return;
        throw mapDbError(retry.error);
      }
      throw mapDbError(error);
    },

    async priceFor(provider, model, onDate): Promise<PriceRow | null> {
      // Same rule as private.price_for (not exposed through PostgREST): latest version in effect.
      const { data, error } = await db
        .from("ai_price_tables")
        .select(
          "version, input_usd_per_mtok, cached_input_usd_per_mtok, cache_write_usd_per_mtok, output_usd_per_mtok, long_context_threshold_tokens, long_context_input_usd_per_mtok, long_context_cached_input_usd_per_mtok, long_context_cache_write_usd_per_mtok, long_context_output_usd_per_mtok",
        )
        .eq("provider", provider)
        .eq("model", model)
        .lte("effective_from", onDate)
        .order("effective_from", { ascending: false })
        .order("version", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (error) throw mapDbError(error);
      if (!data) return null;
      const num = (v: number | string | null) => (v === null ? null : Number(v));
      return {
        version: data.version,
        inputUsdPerMtok: Number(data.input_usd_per_mtok),
        cachedInputUsdPerMtok: num(data.cached_input_usd_per_mtok),
        cacheWriteUsdPerMtok: num(data.cache_write_usd_per_mtok),
        outputUsdPerMtok: Number(data.output_usd_per_mtok),
        longContextThresholdTokens: data.long_context_threshold_tokens,
        longContextInputUsdPerMtok: num(data.long_context_input_usd_per_mtok),
        longContextCachedInputUsdPerMtok: num(data.long_context_cached_input_usd_per_mtok),
        longContextCacheWriteUsdPerMtok: num(data.long_context_cache_write_usd_per_mtok),
        longContextOutputUsdPerMtok: num(data.long_context_output_usd_per_mtok),
      };
    },

    async lastCallAt(provider: AiProvider) {
      const { data, error } = await db
        .from("ai_usage_records")
        .select("occurred_at")
        .eq("provider", provider)
        .order("occurred_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (error) throw mapDbError(error);
      return data?.occurred_at ?? null;
    },
  };
}
