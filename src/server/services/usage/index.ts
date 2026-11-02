import { AiUsageSummarySchema, type AiUsageSummary, type GetAiUsageSummaryInput } from "@/lib/contracts/ai";
import { AppError } from "@/lib/contracts/errors";
import { mapDbError } from "@/server/db/errors";
import type { UserSupabaseClient } from "@/server/db/types";

/**
 * Usage meter (F-AI-07, C-13): RPC `get_ai_usage_summary` (DM §2.9.5,
 * security invoker — own rows only) mapped to camelCase. Costs are estimates;
 * free-tier rows are paid-equivalent (screens say "청구되지 않을 수 있음").
 */

type Obj = Record<string, unknown>;

function obj(value: unknown): Obj {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Obj) : {};
}
function arr(value: unknown): Obj[] {
  return Array.isArray(value) ? value.map(obj) : [];
}
/** jsonb numerics may arrive as numbers or numeric strings. */
function num(value: unknown): number {
  const n = typeof value === "string" ? Number(value) : value;
  return typeof n === "number" && Number.isFinite(n) ? n : 0;
}

export function toAiUsageSummary(raw: unknown): AiUsageSummary {
  const r = obj(raw);
  const t = obj(r.totals);
  const prev = r.previous_month === undefined || r.previous_month === null ? null : obj(r.previous_month);
  const mapped = {
    periodMonth: String(r.period_month ?? ""),
    asOf: String(r.as_of ?? ""),
    totals: {
      inputTokens: num(t.input_tokens),
      cachedInputTokens: num(t.cached_input_tokens),
      cacheWriteTokens: num(t.cache_write_tokens),
      outputTokens: num(t.output_tokens),
      estimatedCostUsd: num(t.estimated_cost_usd),
      calls: num(t.calls),
      failedCalls: num(t.failed_calls),
    },
    byFeature: arr(r.by_feature).map((f) => ({
      feature: f.feature,
      inputTokens: num(f.input_tokens),
      outputTokens: num(f.output_tokens),
      estimatedCostUsd: num(f.estimated_cost_usd),
      calls: num(f.calls),
    })),
    byProvider: arr(r.by_provider).map((p) => ({
      provider: p.provider,
      connectionTier: p.connection_tier,
      inputTokens: num(p.input_tokens),
      outputTokens: num(p.output_tokens),
      estimatedCostUsd: num(p.estimated_cost_usd),
      calls: num(p.calls),
    })),
    priceTableVersions: arr(r.price_table_versions).map((v) => ({
      version: String(v.version ?? ""),
      sourceCheckedAt: String(v.source_checked_at ?? ""),
    })),
    previousMonth: prev
      ? {
          periodMonth: String(prev.period_month ?? ""),
          estimatedCostUsd: num(prev.estimated_cost_usd),
          inputTokens: num(prev.input_tokens),
          outputTokens: num(prev.output_tokens),
        }
      : null,
  };
  const parsed = AiUsageSummarySchema.safeParse(mapped);
  if (!parsed.success) throw new AppError("internal_error", undefined, { status: 500, cause: parsed.error });
  return parsed.data;
}

export async function getAiUsageSummary(supabase: UserSupabaseClient, input: GetAiUsageSummaryInput = {}): Promise<AiUsageSummary> {
  const { data, error } = await supabase.rpc("get_ai_usage_summary", {
    ...(input.periodMonth ? { p_period_month: input.periodMonth } : {}),
    ...(input.includePrevious ? { p_include_previous: true } : {}),
  });
  if (error) throw mapDbError(error);
  return toAiUsageSummary(data);
}
