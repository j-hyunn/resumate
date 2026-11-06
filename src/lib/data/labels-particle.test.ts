import { describe, expect, it } from "vitest"
import { directionParticle } from "./labels"
import { AI_PROVIDER_LABELS } from "@/lib/mock/ai-providers"

describe("directionParticle — provider names (UI42-5)", () => {
  it("reads acronyms letter by letter", () => {
    expect(AI_PROVIDER_LABELS.openai).toBe("GPT")
    expect(directionParticle("GPT")).toBe("로")
    expect(directionParticle("Gemini")).toBe("로")
    expect(directionParticle("Claude")).toBe("로")
    expect(directionParticle("CRM")).toBe("으로")
    expect(directionParticle("인사이트")).toBe("로")
  })
})
