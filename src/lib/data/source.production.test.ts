/**
 * A production build: real modules with NODE_ENV=production, only the request headers stubbed.
 * The forged header stands for anything that could arrive at the data layer: `?state=` itself is the
 * proxy's input (proxy-session.test.ts) and never reaches here on its own.
 */
import { NextRequest } from "next/server"
import { beforeEach, describe, expect, it, vi } from "vitest"
import { PREVIEW_REQUEST_HEADER, REQUEST_PATH_HEADER } from "@/lib/contracts/preview"
import { resetServerEnvCache } from "@/server/env"

const readHeader = vi.hoisted(() => vi.fn())
vi.mock("next/headers", () => ({ headers: async () => { readHeader(); return new Headers({ "x-resumate-preview": "1" }) } }))
vi.mock("@supabase/ssr", () => ({ createServerClient: () => ({ auth: { getClaims: async () => ({ data: { claims: { sub: "user" } } }) } }) }))

// Before the imports: `isPreviewEnabled` is decided once, when its module loads (a build inlines it).
vi.stubEnv("NODE_ENV", "production")
const { isPreviewEnabled, readPreviewState, getPreviewState, previewErrorCode } = await import("@/lib/preview-state")
const { isPreviewRequest, previewOr } = await import("./source")
const { updateSession } = await import("@/server/auth/proxy-session")

beforeEach(() => {
  vi.stubEnv("NODE_ENV", "production")
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "http://127.0.0.1:54321")
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY", "anon")
  resetServerEnvCache()
})

describe("production build", () => {
  it("previews are off", () => {
    expect(isPreviewEnabled).toBe(false)
  })

  it("previewOr takes the real branch even with the preview header, and the mock branch is never called", async () => {
    const mock = vi.fn(async () => "mock")
    await expect(previewOr(mock, async () => "real")).resolves.toBe("real")
    expect(mock).not.toHaveBeenCalled()
    await expect(isPreviewRequest()).resolves.toBe(false)
  })

  it("doesn't even read the header", async () => {
    readHeader.mockClear()
    await previewOr(async () => "mock", async () => "real")
    expect(readHeader).not.toHaveBeenCalled()
  })

  it("the screens' ?state= readers answer null", () => {
    expect(readPreviewState({ state: "empty" })).toBeNull()
    expect(readPreviewState(new URLSearchParams("state=empty"))).toBeNull()
    expect(getPreviewState({ state: "ai-failed" })).toBeNull()
    expect(previewErrorCode(getPreviewState({ state: "ai-failed" }))).toBeNull()
  })

  it("the proxy doesn't mark ?state= and strips a forged header", async () => {
    const request = new NextRequest("http://localhost/career?state=empty", { headers: { [PREVIEW_REQUEST_HEADER]: "1" } })
    const response = await updateSession(request)
    expect(response.headers.get(`x-middleware-request-${PREVIEW_REQUEST_HEADER}`)).toBeNull()
    // the same response does forward request headers, so the null above isn't vacuous
    expect(response.headers.get(`x-middleware-request-${REQUEST_PATH_HEADER}`)).toBe("/career?state=empty")
  })

  it("/dev/ is a 404", async () => {
    const response = await updateSession(new NextRequest("http://localhost/dev/states"))
    expect(response.status).toBe(404)
  })
})
