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

/** One bucket's token + cost figures (DM 2.9.5 v4.12: 비용 열 2개 + 합계). */
function totalsOf(raw: unknown) {
  const t = obj(raw);
  return {
    inputTokens: num(t.input_tokens),
    cachedInputTokens: num(t.cached_input_tokens),
    cacheWriteTokens: num(t.cache_write_tokens),
    outputTokens: num(t.output_tokens),
    inputCostUsd: num(t.input_cost_usd),
    outputCostUsd: num(t.output_cost_usd),
    estimatedCostUsd: num(t.estimated_cost_usd),
    calls: num(t.calls),
    failedCalls: num(t.failed_calls),
  };
}

function versionsOf(raw: unknown) {
  return arr(raw).map((v) => ({ version: String(v.version ?? ""), sourceCheckedAt: String(v.source_checked_at ?? "") }));
}

/**
 * (v4.12, SD-A10) 응답 교체: `providers[]` 교차 집계. The 7행 묶음
 * (`career_description` + `cover_letter`) is NOT done here — it is a screen
 * constant (AI C-13.1, DM 2.9.5), so `byFeature` keeps the stored values.
 */
export function toAiUsageSummary(raw: unknown): AiUsageSummary {
  const r = obj(raw);
  const prev = r.previous_month === undefined || r.previous_month === null ? null : obj(r.previous_month);
  const mapped = {
    periodMonth: String(r.period_month ?? ""),
    asOf: String(r.as_of ?? ""),
    totals: totalsOf(r.totals),
    providers: arr(r.providers).map((p) => ({
      provider: p.provider,
      connectionTiers: Array.isArray(p.connection_tiers) ? p.connection_tiers : [],
      totals: totalsOf(p.totals),
      byFeature: arr(p.by_feature).map((f) => ({ feature: f.feature, ...totalsOf(f) })),
      priceTableVersions: versionsOf(p.price_table_versions),
    })),
    priceTableVersions: versionsOf(r.price_table_versions),
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

/** S-42 "가격표 보기": rows of `versions`, or of the latest effective version. */
export async function loadPriceTables(supabase: UserSupabaseClient, versions?: string[]) {
  let want = versions ?? [];
  if (want.length === 0) {
    const latest = await supabase
      .from("ai_price_tables")
      .select("version")
      .lte("effective_from", new Date().toISOString().slice(0, 10))
      .order("effective_from", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (latest.error) throw mapDbError(latest.error);
    if (!latest.data) return [];
    want = [latest.data.version];
  }
  const { data, error } = await supabase.from("ai_price_tables").select("*").in("version", want).order("provider").order("model");
  if (error) throw mapDbError(error);
  return data ?? [];
}
