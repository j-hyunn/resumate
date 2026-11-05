/**
 * 33 런 가드 (UQ-334). S-10 새 프로젝트 · S-44 새 산출물의 "추가 중" 표시(이동 줄 문구)는 **행 ID 상태**를 따라야 한다.
 *
 * 왜 소스를 읽는 테스트인가: `replaceUrl`은 `window.history.replaceState`로 URL만 바꾸므로(Next 내비게이션이
 * 아니다) 첫 저장 뒤에도 컴포넌트는 마운트된 채이고 `data.project_id` / `data.project_deliverable_id`는 계속
 * `null`이다. 분기를 서버 prop이나 URL 기준으로 "정리"하면 행이 생긴 뒤에도 "새 … 추가"가 영구히
 * 남는다. 이 저장소에는 컴포넌트 렌더 테스트 설비가 없어(vitest `environment: "node"`, `*.test.ts`만) 같은
 * 저장소의 소스 가드 관례(`src/lib/data/mock-isolation.test.ts`)를 따른다.
 */
import { readFileSync } from "node:fs"
import { join } from "node:path"
import { describe, expect, it } from "vitest"
import { CRUMB_CURRENT, FIRST_SAVE_TOAST, firstSaveToast } from "./new-row-notice"

const read = (p: string) => readFileSync(join(process.cwd(), "src/components/career", p), "utf8")
const PROJECT = read("project-page/project-page.tsx")
const DELIVERABLE = read("deliverable/deliverable-page.tsx")

const PAGES = [
  { name: "S-10 project-page", src: PROJECT, flag: "const isNew = !projectId", serverProp: "data.project_id", kind: "project" as const },
  { name: "S-44 deliverable-page", src: DELIVERABLE, flag: "const isNew = !id", serverProp: "data.project_deliverable_id", kind: "deliverable" as const },
]

describe("새 행 표시", () => {
  it.each(PAGES)("$name: 분기는 행 ID 상태에서 나온다", ({ src, flag }) => {
    expect(src).toContain(flag)
  })

  it.each(PAGES)("$name: 분기를 서버 prop이나 URL로 되돌리지 않았다", ({ src, serverProp }) => {
    const decl = src.match(/const isNew = [^\n]*/g) ?? []
    expect(decl).toHaveLength(1)
    expect(decl[0]).not.toContain(serverProp)
    expect(decl[0]).not.toMatch(/location|pathname|searchParams|usePathname/)
  })

  it.each(PAGES)("$name: 새 행 안내 배너를 그리지 않는다 (사용자 결정 2026-11-05)", ({ src }) => {
    expect(src).not.toContain("NewRowNotice")
    expect(src).not.toContain("아직 추가되지 않았어요")
  })

  it.each(PAGES)("$name: 이동 줄 현재 위치도 isNew로 갈린다", ({ src, kind }) => {
    expect(src).toContain(`current={isNew ? CRUMB_CURRENT.${kind}.new : CRUMB_CURRENT.${kind}.existing}`)
  })

  it.each(PAGES)("$name: 새 행 첫 포커스는 머리 상자를 스크롤하지 않는다 (UQ-333)", ({ src, serverProp }) => {
    // autoFocus·plain focus()는 낮은 창에서 머리 상자를 내려 안내를 밀어낸다
    expect(src).not.toMatch(/autoFocus=/)
    expect(src).toMatch(new RegExp(`if \\(!${serverProp.replace(".", "\\.")}\\) (return )?titleRef\\.current\\?\\.focus\\(\\{ preventScroll: true \\}\\)`))
  })

  it("이동 줄 문구: 새 행은 '추가', 기존 행은 '상세'이고 서로 다르다", () => {
    for (const kind of ["project", "deliverable"] as const) {
      const { new: added, existing } = CRUMB_CURRENT[kind]
      expect(added).toContain("추가")
      expect(existing).toContain("상세")
      expect(added).not.toBe(existing)
    }
  })
})

describe("OD-C3 첫 저장 토스트", () => {
  it("문구는 UX v5.13 C-03 그대로", () => {
    expect(FIRST_SAVE_TOAST.project).toBe("프로젝트를 커리어에 추가했어요")
    expect(FIRST_SAVE_TOAST.deliverable).toBe("산출물을 추가했어요")
  })

  it("행을 만든 저장에서만, 패널 첫 메시지 저장이 아닐 때만", () => {
    for (const kind of ["project", "deliverable"] as const) {
      expect(firstSaveToast(kind, { wasNew: true, fromPanel: false })).toBe(FIRST_SAVE_TOAST[kind])
      expect(firstSaveToast(kind, { wasNew: false, fromPanel: false })).toBeNull()
      expect(firstSaveToast(kind, { wasNew: true, fromPanel: true })).toBeNull()
    }
  })

  it.each([
    { name: "S-10", src: PROJECT, wasNew: "const wasNew = !projectId", kind: "project" },
    { name: "S-44", src: DELIVERABLE, wasNew: "const wasNew = !id", kind: "deliverable" },
  ])("$name: wasNew는 행 ID 상태에서 나오고 토스트는 firstSaveToast를 거친다", ({ src, wasNew, kind }) => {
    expect(src).toContain(wasNew)
    expect(src).toContain(`firstSaveToast("${kind}", { wasNew, fromPanel: Boolean(`)
    // the panel's first-message save is marked so the page doesn't toast twice
    expect(src).toMatch(/savePage: \(\) => doSave(Ref\.current)?\((false, )?\{ fromPanel: true \}\)/)
  })
})

describe("OD-P2 채우기 토스트에 되돌리기 없음", () => {
  it.each([
    { name: "S-10", src: PROJECT },
    { name: "S-44", src: DELIVERABLE },
  ])("$name", ({ src }) => {
    expect(src).not.toContain("되돌리기")
    expect(src).not.toMatch(/action:\s*\{\s*label:/)
  })
})
