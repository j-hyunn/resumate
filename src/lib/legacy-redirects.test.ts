import { describe, expect, it } from "vitest"
import { getPathMatch } from "next/dist/shared/lib/router/utils/path-match"
import { prepareDestination } from "next/dist/shared/lib/router/utils/prepare-destination"
import { LEGACY_REDIRECTS } from "./legacy-redirects"
import { routes } from "./routes"

/** What Next's `redirects()` does with a path: the first matching rule's Location (path + query). */
function redirectOf(pathname: string): string | null {
  for (const rule of LEGACY_REDIRECTS) {
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

describe("자기소개서 관리 옛 주소 → S-46 (v5.20, CF-1·CF-7 — decisions 4.23 UI 4)", () => {
  const ap = "5b0c7f9e-1111-4c2a-9a55-0123456789ab"
  const draft = "7d2e9b1a-3333-4e4c-9c77-23456789abcd"
  const ses = "6c1d8a0f-2222-4d3b-8b66-123456789abc"

  it("S-31 허브 · S-17 · S-19 · 옛 문항 설정 · S-45 → S-46", () => {
    for (const path of [
      `/applications/${ap}`,
      `/applications/${ap}/drafts`,
      `/applications/${ap}/drafts/${draft}`,
      `/applications/${ap}/drafts/${draft}/questions`,
      `/applications/${ap}/career-description`,
      `/applications/${ap}/cover-letter/questions`,
    ]) {
      expect(redirectOf(path)).toBe(routes.coverLetter(ap))
    }
  })

  it("S-15 · S-16 → S-46의 탭", () => {
    expect(redirectOf(`/applications/${ap}/jd`)).toBe(routes.coverLetter(ap, { tab: "jd" }))
    expect(redirectOf(`/applications/${ap}/insight`)).toBe(routes.coverLetter(ap, { tab: "insight" }))
  })

  it("S-14 전체 페이지 → S-13 + 모달", () => {
    expect(redirectOf("/applications/new")).toBe(routes.applicationNew())
    expect(read(redirectOf("/applications/new")!).get("new")).toBe("1")
  })

  it("폐기한 면접 주소 (v5.19, RM-1): 지원 건 하위는 S-46, 전체 목록은 S-13 (MRG-UX-1)", () => {
    expect(redirectOf(`/applications/${ap}/interview`)).toBe(routes.coverLetter(ap))
    expect(redirectOf(`/applications/${ap}/interview/${ses}`)).toBe(routes.coverLetter(ap))
    expect(redirectOf(`/applications/${ap}/interview/${ses}/result`)).toBe(routes.coverLetter(ap))
    expect(redirectOf("/interviews")).toBe(routes.applications())
    expect(redirectOf(`/interviews/${ses}/result`)).toBe(routes.applications())
  })

  it("S-13과 S-46 자신은 그대로", () => {
    expect(redirectOf("/applications")).toBeNull()
    expect(redirectOf(`/applications/${ap}/cover-letter`)).toBeNull()
    expect(redirectOf("/interviewsx")).toBeNull()
  })
})
