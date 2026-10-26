import { UsageFeatureSummarySchema, type UsageFeatureSummary, type UsageSummary } from "@/lib/contracts/ai";
import { USAGE_FEATURES } from "@/lib/contracts/enums";
import { mapDbError } from "@/server/db/errors";
import type { UserSupabaseClient } from "@/server/db/types";

/**
 * Usage summary for the "이번 달 {N}회 남음" hint (D-17, UI patterns §3).
 * RPC `get_usage_summary()` returns only features with a limit row; the rest
 * (chat_message, D-12 미정) come back as `limit: null` — not reservable.
 */

const KST_OFFSET_MS = 9 * 60 * 60 * 1000;

/** KST month start as `YYYY-MM-DD` (same rule as usage_events.period_month). */
export function kstPeriodMonth(now: Date): string {
  const kst = new Date(now.getTime() + KST_OFFSET_MS);
  return `${kst.getUTCFullYear()}-${String(kst.getUTCMonth() + 1).padStart(2, "0")}-01`;
}

export function toUsageSummary(raw: unknown, now: Date): UsageSummary {
  const obj = raw && typeof raw === "object" && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {};
  const features = {} as Record<(typeof USAGE_FEATURES)[number], UsageFeatureSummary>;
  for (const feature of USAGE_FEATURES) {
    const parsed = UsageFeatureSummarySchema.safeParse(obj[feature]);
    features[feature] = parsed.success ? parsed.data : { limit: null, used: 0, remaining: null };
  }
  return { periodMonth: kstPeriodMonth(now), features };
}

export async function getUsageSummary(supabase: UserSupabaseClient, now = new Date()): Promise<UsageSummary> {
  const { data, error } = await supabase.rpc("get_usage_summary");
  if (error) throw mapDbError(error);
  return toUsageSummary(data, now);
}
