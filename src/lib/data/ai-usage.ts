/**
 * AI 사용량 미터 (v4, 04 §2.9.2–2.9.5): RPC get_ai_usage_summary + price tables. Server only.
 * Replaces the v3 usage ledger (usage.ts: reserve / charge / monthly limits — removed, D-34).
 */
import type { AiPriceTable, AiUsageFeature, AiUsageSummary } from "@/types/db"
import { clone, mockRequest } from "@/lib/mock/store"
import { currentPeriodMonth } from "@/lib/mock/time"
import type { MockDb } from "@/lib/mock/fixtures"
import { isPreviewRequest, previewOr, unwrap } from "./source"
import type { AiUsageSummary as RealAiUsageSummary } from "@/lib/contracts/ai"
import * as usageActions from "@/server/actions/usage"
import { requireUser } from "@/server/auth/session"
import { loadPriceTables } from "@/server/services/usage"

/** S-42 기능별 표: 8 rows, fixed order (Should features excluded) */
export const USAGE_FEATURE_ORDER: readonly AiUsageFeature[] = [
  "jd_extraction",
  "insight",
  "career_description",
  "cover_letter",
  "interview_questions",
  "interview_evaluation",
  "writing_chat",
  "key_verification",
]

function previousMonth(period: string): string {
  const [y, m] = period.split("-").map(Number)
  const d = new Date(Date.UTC(y, m - 2, 1))
  return d.toISOString().slice(0, 10)
}

/**
 * UQ-203 / P-B2 — one definition of "입력 토큰" for S-42 [UI-가정, 04 §2.9.5 is silent]:
 * - `totals.input_tokens` = uncached input only, with `cached_input_tokens` / `cache_write_tokens`
 *   beside it (the 04 RPC columns, kept as-is);
 * - every **displayed** input figure (by_feature / by_provider rows, previous_month, the 합계 카드)
 *   = input + cache read + cache write. Screens use `displayInputTokens(totals)` from labels for the
 *   합계 카드, so the card equals the sum of the table rows.
 */
export function computeAiUsageSummary(db: MockDb, periodMonth = currentPeriodMonth(), includePrevious = false): AiUsageSummary {
  const rows = db.ai_usage_records.filter((r) => r.period_month === periodMonth)
  const sum = (list: typeof rows, f: (r: (typeof rows)[number]) => number) => list.reduce((a, r) => a + f(r), 0)
  const round = (n: number) => Math.round(n * 1_000_000) / 1_000_000
  const byProvider = new Map<string, typeof rows>()
  for (const r of rows) {
    const k = `${r.provider}:${r.connection_tier}`
    byProvider.set(k, [...(byProvider.get(k) ?? []), r])
  }
  const versions = [...new Set(rows.map((r) => r.price_table_version))]
  const summary: AiUsageSummary = {
    period_month: periodMonth,
    as_of: new Date().toISOString(),
    totals: {
      input_tokens: sum(rows, (r) => r.input_tokens),
      cached_input_tokens: sum(rows, (r) => r.cached_input_tokens),
      cache_write_tokens: sum(rows, (r) => r.cache_write_tokens),
      output_tokens: sum(rows, (r) => r.output_tokens),
      estimated_cost_usd: round(sum(rows, (r) => r.estimated_cost_usd)),
      calls: rows.length,
      failed_calls: rows.filter((r) => r.outcome === "failed").length,
    },
    by_feature: USAGE_FEATURE_ORDER.map((feature) => {
      const list = rows.filter((r) => r.feature === feature)
      return {
        feature,
        input_tokens: sum(list, (r) => r.input_tokens + r.cached_input_tokens + r.cache_write_tokens),
        output_tokens: sum(list, (r) => r.output_tokens),
        estimated_cost_usd: round(sum(list, (r) => r.estimated_cost_usd)),
        calls: list.length,
      }
    }),
    by_provider: [...byProvider.values()].map((list) => ({
      provider: list[0].provider,
      connection_tier: list[0].connection_tier,
      input_tokens: sum(list, (r) => r.input_tokens + r.cached_input_tokens + r.cache_write_tokens),
      output_tokens: sum(list, (r) => r.output_tokens),
      estimated_cost_usd: round(sum(list, (r) => r.estimated_cost_usd)),
      calls: list.length,
    })),
    price_table_versions: versions.map((version) => ({
      version,
      source_checked_at: db.ai_price_tables.find((p) => p.version === version)?.source_checked_at ?? "",
    })),
  }
  if (includePrevious) {
    const prev = previousMonth(periodMonth)
    const p = db.ai_usage_records.filter((r) => r.period_month === prev)
    summary.previous_month = {
      period_month: prev,
      estimated_cost_usd: round(sum(p, (r) => r.estimated_cost_usd)),
      input_tokens: sum(p, (r) => r.input_tokens + r.cached_input_tokens + r.cache_write_tokens),
      output_tokens: sum(p, (r) => r.output_tokens),
    }
  }
  return summary
}

/** RPC get_ai_usage_summary(period_month default 이번 달 KST, include_previous default false) */
export async function getAiUsageSummary(periodMonth?: string, includePrevious = false): Promise<AiUsageSummary> {
  return previewOr(
    async () => clone(computeAiUsageSummary(await mockRequest(), periodMonth, includePrevious)),
    async () => toUiUsageSummary(unwrap(await usageActions.getAiUsageSummary({ periodMonth, includePrevious }))),
  )
}

/** Service DTO → the RPC's snake_case. S-42 shows `USAGE_FEATURE_ORDER` as 8 fixed rows, zeros included. */
function toUiUsageSummary(r: RealAiUsageSummary): AiUsageSummary {
  const feature = (f: AiUsageFeature) => {
    const row = r.byFeature.find((x) => x.feature === f)
    return {
      feature: f,
      input_tokens: row?.inputTokens ?? 0,
      output_tokens: row?.outputTokens ?? 0,
      estimated_cost_usd: row?.estimatedCostUsd ?? 0,
      calls: row?.calls ?? 0,
    }
  }
  return {
    period_month: r.periodMonth,
    as_of: r.asOf,
    totals: {
      input_tokens: r.totals.inputTokens,
      cached_input_tokens: r.totals.cachedInputTokens,
      cache_write_tokens: r.totals.cacheWriteTokens,
      output_tokens: r.totals.outputTokens,
      estimated_cost_usd: r.totals.estimatedCostUsd,
      calls: r.totals.calls,
      failed_calls: r.totals.failedCalls,
    },
    by_feature: USAGE_FEATURE_ORDER.map(feature),
    by_provider: r.byProvider.map((p) => ({
      provider: p.provider,
      connection_tier: p.connectionTier,
      input_tokens: p.inputTokens,
      output_tokens: p.outputTokens,
      estimated_cost_usd: p.estimatedCostUsd,
      calls: p.calls,
    })),
    price_table_versions: r.priceTableVersions.map((v) => ({ version: v.version, source_checked_at: v.sourceCheckedAt })),
    ...(r.previousMonth
      ? {
          previous_month: {
            period_month: r.previousMonth.periodMonth,
            estimated_cost_usd: r.previousMonth.estimatedCostUsd,
            input_tokens: r.previousMonth.inputTokens,
            output_tokens: r.previousMonth.outputTokens,
          },
        }
      : {}),
  }
}

/** S-42 "가격표 보기": rows of the given versions (default: latest effective) */
export async function getAiPriceTables(versions?: string[]): Promise<AiPriceTable[]> {
  if (!(await isPreviewRequest())) return (await loadPriceTables((await requireUser()).supabase, versions)) as AiPriceTable[]
  const db = await mockRequest(0)
  const latest = [...db.ai_price_tables].sort((a, b) => b.effective_from.localeCompare(a.effective_from))[0]?.version
  const want = versions?.length ? versions : latest ? [latest] : []
  return clone(db.ai_price_tables.filter((p) => want.includes(p.version)))
}
