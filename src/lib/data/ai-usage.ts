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

/**
 * S-42 표시 7행 묶음 (AI C-13.1, DM 2.9.5 — SD-4·SD-A12). **표시 단계 상수**다:
 * RPC·데이터 계층은 저장 값 8개를 그대로 돌려주고, 이 표만 `career_description` +
 * `cover_letter`를 "자기소개서 작성 AI 채팅" 한 행으로 접는다. 묶음 정의의 유일한
 * 원천은 AI 명세 C-13.1 표다.
 */
export const USAGE_FEATURE_DISPLAY_GROUPS: ReadonlyArray<{ label: string; features: readonly AiUsageFeature[] }> = [
  { label: "프로젝트/산출물 작성 AI 채팅", features: ["writing_chat"] },
  { label: "요건 추출", features: ["jd_extraction"] },
  { label: "인사이트", features: ["insight"] },
  { label: "자기소개서 작성 AI 채팅", features: ["career_description", "cover_letter"] },
  { label: "면접 질문", features: ["interview_questions"] },
  { label: "면접 채점", features: ["interview_evaluation"] },
  { label: "연결 확인", features: ["key_verification"] },
]

/** @deprecated S-42 v5.17 전 기능별 표: 8 rows, fixed order (Should features excluded) */
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

/**
 * **(v4.12, SD-A10) 새 응답 모양** — `providers[]` 교차 집계 그대로 (DM 2.9.5).
 * S-42 재구현(resumate-ui)이 이 함수를 쓴다. 7행 묶음은 쓰는 쪽에서
 * `USAGE_FEATURE_DISPLAY_GROUPS`로 접는다.
 */
export async function getAiUsageSummaryV412(periodMonth?: string, includePrevious = false): Promise<RealAiUsageSummary> {
  return previewOr(
    async () => computeUsageSummaryV412(await mockRequest(), periodMonth ?? currentPeriodMonth(), includePrevious),
    async () => unwrap(await usageActions.getAiUsageSummary({ periodMonth, includePrevious })),
  )
}

/**
 * `?state=` 미리보기용 `providers[]` 집계. mock 행(src/lib/mock, UI 소유)에 아직
 * `input_cost_usd`·`output_cost_usd`가 없으면 두 열은 0이고 합계만 저장 값을 쓴다 `[가정]`
 * (UI 요청: fixtures에 두 열 추가).
 */
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

/**
 * @deprecated R13 shim: the 화면 타입(`AiUsageSummary`, 8행 `by_feature` + `by_provider`)을
 * 새 `providers[]` 응답에서 만든다. `by_feature`는 공급자를 가로질러 더하고, `by_provider`는
 * 공급자마다 한 행(등급은 그 달 기록의 첫 등급 — 새 응답은 등급으로 쪼개지 않는다) `[가정]`.
 * S-42가 `getAiUsageSummaryV412`로 옮겨 가면 이 함수와 화면 타입을 함께 지운다.
 */
function toUiUsageSummary(r: RealAiUsageSummary): AiUsageSummary {
  const rows = r.providers.flatMap((p) => p.byFeature)
  const feature = (f: AiUsageFeature) => {
    const list = rows.filter((x) => x.feature === f)
    const sum = (pick: (x: (typeof list)[number]) => number) => list.reduce((a, x) => a + pick(x), 0)
    return {
      feature: f,
      // 화면의 "입력 토큰" = 비캐시 + 캐시 읽기 + 캐시 쓰기 (UQ-203 / P-B2)
      input_tokens: sum((x) => x.inputTokens + x.cachedInputTokens + x.cacheWriteTokens),
      output_tokens: sum((x) => x.outputTokens),
      estimated_cost_usd: sum((x) => x.estimatedCostUsd),
      calls: sum((x) => x.calls),
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
    by_provider: r.providers.map((p) => ({
      provider: p.provider,
      connection_tier: p.connectionTiers[0] ?? "paid",
      input_tokens: p.totals.inputTokens + p.totals.cachedInputTokens + p.totals.cacheWriteTokens,
      output_tokens: p.totals.outputTokens,
      estimated_cost_usd: p.totals.estimatedCostUsd,
      calls: p.totals.calls,
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
