import { describe, expect, it } from "vitest"
import { getPathMatch } from "next/dist/shared/lib/router/utils/path-match"
import { prepareDestination } from "next/dist/shared/lib/router/utils/prepare-destination"
import { CAREER_LEGACY_REDIRECTS } from "./legacy-redirects"
import { routes } from "./routes"

/** What Next's `redirects()` does with a path: the first matching rule's Location (path + query). */
function redirectOf(pathname: string): string | null {
  for (const rule of CAREER_LEGACY_REDIRECTS) {
    const params = getPathMatch(rule.source, { strict: true, removeUnnamedParams: true })(pathname)
    if (!params) continue
    const { parsedDestination } = prepareDestination({ destination: rule.destination, params, query: {}, appendParamsToQuery: false })
    const search = new URLSearchParams(parsedDestination.query as Record<string, string>).toString()
    return `${parsedDestination.pathname}${search ? `?${search}` : ""}`
  }
  return null
}

const read = (url: string) => new URL(url, "http://localhost").searchParams

describe("retired S-09 · S-34 addresses → S-08 (UQ-428)", () => {
  it("new → the add modal", () => {
    expect(read(redirectOf("/career/experiences/new")!).get("new")).toBe("experience")
    expect(read(redirectOf("/career/educations/new")!).get("new")).toBe("education")
    expect(redirectOf("/career/experiences/new")).toBe(routes.careerNew("experience"))
  })

  it("an id → that item selected, same as routes.careerItem", () => {
    const id = "5b0c7f9e-1111-4c2a-9a55-0123456789ab"
    expect(read(redirectOf(`/career/experiences/${id}`)!).get("item")).toBe(`experience:${id}`)
    expect(read(redirectOf(`/career/educations/${id}`)!).get("item")).toBe(`education:${id}`)
    expect(read(routes.careerItem("experience", id)).get("item")).toBe(`experience:${id}`)
  })

  it("an id can't add query keys", () => {
    const url = redirectOf("/career/experiences/x%26edit%3Dcontent")!
    const q = read(url)
    // the id stays inside the one `item` value (encoded or not), never a new key
    expect(q.get("item")?.startsWith("experience:x")).toBe(true)
    expect([...q.keys()]).toEqual(["item"])
    expect(q.has("edit")).toBe(false)
    expect(read(routes.careerItem("education", "y&edit=content")).has("edit")).toBe(false)
  })

  it("other career paths are untouched", () => {
    expect(redirectOf("/career")).toBeNull()
    expect(redirectOf("/career/projects/p1")).toBeNull()
    expect(redirectOf("/career/experiences/a/b")).toBeNull()
  })
})
