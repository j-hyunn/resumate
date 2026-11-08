import { describe, expect, it } from "vitest"
import { aiErrorTitle, retryTokenNote } from "./ai-error-notice"
import { DISCLOSURE_FACTS, DISCLOSURE_VERSION, usesInputsForTraining } from "@/lib/ai-disclosures"

// Run 36 (decisions 4.12 UI 8·10·11): copy fixed by OD-B1, Q-25, OD-L2 / OD-L2a, R-OD-15
describe("C-20 copy (v5.13)", () => {
  it("daily quota title follows the tier (OD-B1)", () => {
    expect(aiErrorTitle("daily_quota_exhausted", { provider: "Gemini", tier: "free" })).toBe("오늘 Gemini 무료 한도를 다 썼어요")
    expect(aiErrorTitle("daily_quota_exhausted", { provider: "Claude", tier: "paid" })).toBe("오늘 Claude 일일 한도를 다 썼어요")
    expect(aiErrorTitle("daily_quota_exhausted", { provider: "Gemini" })).toBe("오늘 Gemini 무료 한도를 다 썼어요")
  })

  it("token note says 공급자 토큰 (Q-25)", () => {
    expect(retryTokenNote("다시 시도")).toBe("다시 시도하면 공급자 토큰을 다시 써요")
    expect(retryTokenNote("다시 보내기")).toBe("다시 보내면 공급자 토큰을 다시 써요")
    expect(retryTokenNote("다시 생성")).toBe("다시 생성하면 공급자 토큰을 다시 써요")
  })
})

describe("C-21 disclosure facts (AI C-7.1)", () => {
  it("is version v2026-11-05 with concrete retention values", () => {
    expect(DISCLOSURE_VERSION).toBe("v2026-11-05")
    for (const byTier of Object.values(DISCLOSURE_FACTS))
      for (const f of Object.values(byTier)) expect(f.retention).not.toContain("공급자 정책에 따라요")
  })

  it("Claude processing region is global inference, US storage (OD-L2a)", () => {
    expect(DISCLOSURE_FACTS.anthropic.free.country).toContain("global")
    expect(DISCLOSURE_FACTS.anthropic.paid.country).toContain("미국")
  })

  it("free-tier data-use notice is Gemini free only (R-OD-15)", () => {
    expect(usesInputsForTraining("gemini", "free")).toBe(true)
    expect(usesInputsForTraining("gemini", "paid")).toBe(false)
    expect(usesInputsForTraining("openai", "free")).toBe(false)
    expect(usesInputsForTraining("anthropic", "free")).toBe(false)
  })
})
