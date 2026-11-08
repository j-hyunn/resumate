/**
 * AI 사용량 미터 (v4, 04 §2.9.2–2.9.5): RPC get_ai_usage_summary + price tables. Server only.
 * Replaces the v3 usage ledger (usage.ts: reserve / charge / monthly limits — removed, D-34).
 */
import type { AiPriceTable } from "@/types/db"
import { clone, mockRequest } from "@/lib/mock/store"
import { currentPeriodMonth } from "@/lib/mock/time"
import type { MockDb } from "@/lib/mock/fixtures"
import { isPreviewRequest, previewOr, unwrap } from "./source"
import type { AiUsageSummary as RealAiUsageSummary } from "@/lib/contracts/ai"
import * as usageActions from "@/server/actions/usage"
import { requireUser } from "@/server/auth/session"
import { loadPriceTables } from "@/server/services/usage"

export { USAGE_FEATURE_DISPLAY_GROUPS } from "./usage-display"

function previousMonth(period: string): string {
  const [y, m] = period.split("-").map(Number)
  const d = new Date(Date.UTC(y, m - 2, 1))
  return d.toISOString().slice(0, 10)
}

/**
 * **(v4.12, SD-A10) 새 응답 모양** — `providers[]` 교차 집계 그대로 (DM 2.9.5).
 * S-24 ② 사용량 블록(`AiUsageByProvider`)이 이 함수를 쓴다. 7행 묶음은 쓰는 쪽에서
 * `USAGE_FEATURE_DISPLAY_GROUPS`로 접는다. (UI 42: 레거시 `getAiUsageSummary()`·화면 타입 삭제)
 */
export async function getAiUsageSummaryV412(periodMonth?: string, includePrevious = false): Promise<RealAiUsageSummary> {
  return previewOr(
    async () => computeUsageSummaryV412(await mockRequest(), periodMonth ?? currentPeriodMonth(), includePrevious),
    async () => unwrap(await usageActions.getAiUsageSummary({ periodMonth, includePrevious })),
  )
}

/** `?state=` 미리보기용 `providers[]` 집계 (mock 행의 비용 두 열은 토큰 × 가격표 단가, UI 42). */
export function computeUsageSummaryV412(db: MockDb, periodMonth: string, includePrevious = false): RealAiUsageSummary {
  type Row = MockDb["ai_usage_records"][number] & { input_cost_usd?: number; output_cost_usd?: number }
  const rows = db.ai_usage_records.filter((r) => r.period_month === periodMonth) as Row[]
  const round = (n: number) => Math.round(n * 1_000_000) / 1_000_000
  const totalsOf = (list: Row[]) => {
    const sum = (pick: (r: Row) => number) => list.reduce((a, r) => a + pick(r), 0)
    return {
      inputTokens: sum((r) => r.input_tokens),
      cachedInputTokens: sum((r) => r.cached_input_tokens),
      cacheWriteTokens: sum((r) => r.cache_write_tokens),
      outputTokens: sum((r) => r.output_tokens),
      inputCostUsd: round(sum((r) => r.input_cost_usd ?? 0)),
      outputCostUsd: round(sum((r) => r.output_cost_usd ?? 0)),
      estimatedCostUsd: round(sum((r) => r.estimated_cost_usd)),
      calls: list.length,
      failedCalls: list.filter((r) => r.outcome === "failed").length,
    }
  }
  const versionsOf = (list: Row[]) =>
    [...new Set(list.map((r) => r.price_table_version))].map((version) => ({
      version,
      sourceCheckedAt: db.ai_price_tables.find((p) => p.version === version)?.source_checked_at ?? "",
    }))
  const providers = [...new Set(rows.map((r) => r.provider))].map((provider) => {
    const list = rows.filter((r) => r.provider === provider)
    return {
      provider,
      connectionTiers: [...new Set(list.map((r) => r.connection_tier))],
      totals: totalsOf(list),
      byFeature: [...new Set(list.map((r) => r.feature))].map((feature) => ({
        feature,
        ...totalsOf(list.filter((r) => r.feature === feature)),
      })),
      priceTableVersions: versionsOf(list),
    }
  })
  const prevRows = includePrevious
    ? (db.ai_usage_records.filter((r) => r.period_month === previousMonth(periodMonth)) as Row[])
    : []
  return {
    periodMonth,
    asOf: new Date().toISOString(),
    totals: totalsOf(rows),
    providers,
    priceTableVersions: versionsOf(rows),
    previousMonth: includePrevious
      ? {
          periodMonth: previousMonth(periodMonth),
          estimatedCostUsd: totalsOf(prevRows).estimatedCostUsd,
          inputTokens: totalsOf(prevRows).inputTokens,
          outputTokens: totalsOf(prevRows).outputTokens,
        }
      : null,
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
