import { beforeEach, describe, expect, it, vi } from "vitest"
import { AppError } from "@/lib/contracts/errors"
import { PREVIEW_REQUEST_HEADER } from "@/lib/contracts/preview"
import { previewMarkerValue } from "@/server/auth/preview-marker"

const header = vi.hoisted(() => ({ value: null as string | null, enabled: true }))
vi.mock("next/headers", () => ({ headers: async () => new Headers(header.value ? { [PREVIEW_REQUEST_HEADER]: header.value } : {}) }))
vi.mock("@/lib/preview-state", () => ({
  get isPreviewEnabled() {
    return header.enabled
  },
}))

const { previewOr, refusalOf, unwrap } = await import("./source")

beforeEach(() => {
  header.value = null
  header.enabled = true
})

describe("previewOr", () => {
  const run = () => previewOr(async () => "mock", async () => "real")

  it("a preview request (the proxy's marker) stays on the mock branch, reads and writes alike", async () => {
    header.value = previewMarkerValue()
    await expect(run()).resolves.toBe("mock")
  })

  it("QA-W5-03: a client-sent header is never trusted (paths the proxy skips keep it)", async () => {
    for (const forged of ["1", "true", previewMarkerValue().slice(1), `${previewMarkerValue()}x`, " "]) {
      header.value = forged
      await expect(run()).resolves.toBe("real")
    }
  })

  it("a plain request goes to the real branch", async () => {
    await expect(run()).resolves.toBe("real")
  })

  it("production ignores the header even if it arrives", async () => {
    header.value = previewMarkerValue()
    header.enabled = false
    await expect(run()).resolves.toBe("real")
  })
})

describe("ActionResult mapping", () => {
  it("unwrap returns data and rethrows code, message and details", () => {
    expect(unwrap({ data: 1 })).toBe(1)
    try {
      unwrap({ error: { code: "jd_has_results", message: "메시지", details: { cause: "x" } } })
      expect.unreachable()
    } catch (err) {
      expect(err).toBeInstanceOf(AppError)
      expect(err).toMatchObject({ code: "jd_has_results", message: "메시지", details: { cause: "x" } })
    }
  })

  it("refusalOf turns listed codes into { refused }, and only those", () => {
    const codes = ["jd_has_results"] as const
    expect(refusalOf({ data: 1 }, codes)).toEqual({ data: 1 })
    expect(refusalOf({ error: { code: "jd_has_results", message: "m", details: { cause: "x" } } }, codes)).toEqual({ refused: "jd_has_results", details: { cause: "x" } })
    expect(() => refusalOf({ error: { code: "not_found", message: "m" } }, codes)).toThrow(AppError)
  })
})
