import { describe, expect, it } from "vitest"
import { AppError } from "@/lib/contracts/errors"
import { MockAiError } from "@/lib/mock/ai"
import { isAiRejected } from "./ai-errors"
import { withAiGuard } from "./ai-guard"

describe("withAiGuard", () => {
  it("returns the value when nothing is refused", async () => {
    await expect(withAiGuard(async () => 1)).resolves.toBe(1)
  })

  it("a mock refusal keeps its shape", async () => {
    const r = await withAiGuard(async () => {
      throw MockAiError.refuse("ai_connection_changed")
    })
    expect(r).toEqual({ rejected: "provider_unavailable", refusal: "ai_connection_changed" })
  })

  it.each([
    ["ai_not_connected", "key_missing"],
    ["ai_consent_required", "key_missing"],
    ["key_missing", "key_missing"],
    ["key_invalid", "key_invalid"],
    ["ai_connection_changed", "provider_unavailable"],
    ["ai_job_not_retryable", "schema_invalid"],
  ])("a real 409 %s has the same shape as the mock's", async (code, rejected) => {
    const r = await withAiGuard(async () => {
      throw new AppError(code, "거부", { status: 409 })
    })
    expect(isAiRejected(r)).toBe(true)
    expect(r).toEqual({ rejected, refusal: code })
  })

  it("anything else still throws", async () => {
    await expect(
      withAiGuard(async () => {
        throw new AppError("internal_error")
      }),
    ).rejects.toMatchObject({ code: "internal_error" })
  })
})
