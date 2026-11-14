import { describe, expect, it } from "vitest"
import type { AiUsageSummary } from "@/lib/contracts/ai"
import { usageRowsOf } from "./usage-rows"

type Provider = AiUsageSummary["providers"][number]
type Feature = Provider["byFeature"][number]

const bucket = (feature: Feature["feature"], over: Partial<Feature> = {}): Feature => ({
  feature,
  inputTokens: 1000,
  cachedInputTokens: 200,
  cacheWriteTokens: 50,
  outputTokens: 300,
  inputCostUsd: 0.001,
  outputCostUsd: 0.002,
  estimatedCostUsd: 0.003,
  calls: 1,
  failedCalls: 0,
  ...over,
})

const provider = (byFeature: Feature[]): Provider => ({
  provider: "gemini",
  connectionTiers: ["free"],
  totals: { ...bucket("insight"), feature: undefined } as unknown as Provider["totals"],
  byFeature,
  priceTableVersions: [],
})

describe("usageRowsOf (S-42 5행)", () => {
  it("always returns the 5 display rows in the fixed order, zero when there is no record", () => {
    const rows = usageRowsOf(undefined)
    expect(rows.map((r) => r.label)).toEqual([
      "프로젝트/산출물 작성 AI 채팅",
      "채용 공고 분석(이전)",
      "인사이트",
      "자기소개서 작성 AI 채팅",
      "연결 확인",
    ])
    expect(rows.every((r) => r.calls === 0 && r.inputCost === 0 && r.outputCost === 0)).toBe(true)
  })

  it("folds career_description + cover_letter into one row and sums the stored cost columns", () => {
    const rows = usageRowsOf(provider([bucket("career_description"), bucket("cover_letter", { inputCostUsd: 0.0105, calls: 2 })]))
    const row = rows.find((r) => r.label === "자기소개서 작성 AI 채팅")!
    expect(row.calls).toBe(3)
    expect(row.inputCost).toBeCloseTo(0.0115, 6)
    expect(row.outputCost).toBeCloseTo(0.004, 6)
  })

  it("input tokens include cache read + cache write; output tokens are output only", () => {
    const row = usageRowsOf(provider([bucket("insight")])).find((r) => r.label === "인사이트")!
    expect(row.inputTokens).toBe(1250)
    expect(row.outputTokens).toBe(300)
  })
})
