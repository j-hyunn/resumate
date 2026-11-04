import { createElement } from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { describe, expect, it, vi } from "vitest"
import type { CareerTree } from "@/lib/data/career"
import type { Education } from "@/types/db"
import { educationName } from "./education-name"

/**
 * UQ-736: S-08 empty state (ED-1) and the education display name (ED-2) on the career screen.
 * Server-rendered markup only (no DOM in this Vitest setup) — enough to catch a second "커리어 추가"
 * button coming back (UQ-723) or the list row falling back to institution_name.
 */

vi.mock("next/navigation", () => ({ useSearchParams: () => new URLSearchParams() }))
vi.mock("./actions", () => ({ deleteCareerItemAction: vi.fn() }))
vi.mock("./add-career-dialog", () => ({ AddCareerDialog: () => null }))

const { CareerOverview } = await import("./career-overview")

const T = "2026-10-01T00:00:00Z"
const education = (program_name: string | null, institution_name: string | null): Education =>
  ({
    id: "00000000-0000-4000-8000-0000000000e1",
    user_id: "00000000-0000-4000-8000-000000000001",
    status: "complete",
    program_name,
    institution_name,
    education_type: "course",
    start_month: "2024-03-01",
    end_month: "2024-08-01",
    enrollment_status: "completed",
    description: null,
    created_at: T,
    updated_at: T,
  }) as Education

const tree = (educations: Education[]): CareerTree =>
  ({
    years: educations.length ? [{ year: 2024, entries: educations.map((e) => ({ kind: "education", education: e, projects: [], collapsed: true })), other_projects: [] }] : [],
    undated_projects: [],
    undated_entries: [],
    counts: { complete_experiences: 0, complete_educations: educations.length, complete_projects: 0, complete_project_details: 0 },
    hints: { details_without_result: 0, projects_without_detail: 0 },
    skill_count: 0,
    profile: {},
    active_writing_chats: [],
    is_empty: educations.length === 0,
  }) as unknown as CareerTree

const render = (t: CareerTree) => renderToStaticMarkup(createElement(CareerOverview, { tree: t }))
const count = (html: string, text: string) => html.split(text).length - 1

describe("educationName (ED-2)", () => {
  it("교육 명 when present, trimmed", () => {
    expect(educationName({ program_name: "  클라우드 백엔드 부트캠프 ", institution_name: "코드스쿨" })).toBe("클라우드 백엔드 부트캠프")
  })
  it("falls back to 운영 기관 when 교육 명 is null, empty or blank", () => {
    expect(educationName({ program_name: null, institution_name: "코드스쿨" })).toBe("코드스쿨")
    expect(educationName({ program_name: "", institution_name: "코드스쿨" })).toBe("코드스쿨")
    expect(educationName({ program_name: "   ", institution_name: " 코드스쿨 " })).toBe("코드스쿨")
  })
  it("null when both are empty (screen shows 이름 없는 교육)", () => {
    expect(educationName({ program_name: null, institution_name: null })).toBeNull()
    expect(educationName({ program_name: " ", institution_name: "" })).toBeNull()
  })
})

describe("S-08 empty career (ED-1)", () => {
  const html = render(tree([]))

  it("has exactly one 커리어 추가 button, under the list heading", () => {
    expect(count(html, "커리어 추가")).toBe(1)
    expect(html.indexOf(">커리어</h2>")).toBeLessThan(html.indexOf("커리어 추가"))
  })

  it("shows both column guides without buttons", () => {
    expect(html).toContain("아직 추가한 커리어가 없어요")
    expect(html).toContain("커리어를 정리해 두면 자기소개서마다 인사이트·서류·면접에 바로 쓸 수 있어요")
    const detail = html.slice(html.indexOf('data-empty-guide="detail"'))
    expect(detail).not.toContain("<button")
  })

  it("centers both guides against the full column height on wide screens (UQ-737)", () => {
    for (const guide of ["list", "detail"]) {
      const tag = html.match(new RegExp(`<[^>]*data-empty-guide="${guide}"[^>]*>`))?.[0] ?? ""
      expect(tag).toContain("lg:absolute")
      expect(tag).toContain("lg:inset-0")
    }
  })
})

describe("S-08 list row for an education (ED-2)", () => {
  it("is named by 교육 명, not 운영 기관", () => {
    const html = render(tree([education("클라우드 백엔드 부트캠프", "코드스쿨")]))
    expect(html).toContain("클라우드 백엔드 부트캠프")
    expect(html).not.toContain("아직 추가한 커리어가 없어요")
  })
  it("shows 이름 없는 교육 when both names are empty", () => {
    expect(render(tree([education(" ", null)]))).toContain("이름 없는 교육")
  })
})
