/**
 * S-42 기능별 표 (UX v5.17 SD-A11·A12 · v5.19 RM-A2 · v5.21 JR-Q5, design-system 5.11.2). Pure helper (client-safe,
 * unit-tested): 고른 공급자의 `providers[].byFeature`(저장 값)를 `USAGE_FEATURE_DISPLAY_GROUPS`로 접는다 — 기본 4행 +
 * 과거 AI-01 기록이 있는 달에만 맨 아래 "JD 요건 추출(종료)".
 */
import type { AiUsageSummary } from "@/lib/contracts/ai"
import { visibleUsageGroups } from "@/lib/data/usage-display"

export interface UsageRow {
  label: string
  /** 기본 순서 */
  order: number
  /** retired feature row (always last) */
  legacy: boolean
  inputCost: number
  outputCost: number
  calls: number
  /** = input + cache read + cache write (UX S-42 `[가정]`) */
  inputTokens: number
  outputTokens: number
}

/** 그 공급자의 `byFeature`를 표시 행으로 접는다. 매핑에 없는 값은 표에 보이지 않는다 (UX S-42 `[가정]`) */
export function usageRowsOf(provider: AiUsageSummary["providers"][number] | undefined): UsageRow[] {
  const has = (features: readonly string[]) => (provider?.byFeature ?? []).some((f) => features.includes(f.feature) && f.calls > 0)
  return visibleUsageGroups(has).map((g, order) => {
    const list = provider?.byFeature.filter((f) => g.features.includes(f.feature)) ?? []
    const sum = (pick: (f: (typeof list)[number]) => number) => list.reduce((a, f) => a + pick(f), 0)
    return {
      label: g.label,
      order,
      legacy: g.legacy === true,
      // 저장 컬럼을 그대로 더한다 (화면이 토큰에서 역산하지 않는다)
      inputCost: Math.round(sum((f) => f.inputCostUsd) * 1_000_000) / 1_000_000,
      outputCost: Math.round(sum((f) => f.outputCostUsd) * 1_000_000) / 1_000_000,
      calls: sum((f) => f.calls),
      inputTokens: sum((f) => f.inputTokens + f.cachedInputTokens + f.cacheWriteTokens),
      outputTokens: sum((f) => f.outputTokens),
    }
  })
}
