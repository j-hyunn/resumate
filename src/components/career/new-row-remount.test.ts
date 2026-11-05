/**
 * 가드: "+ 프로젝트 추가" · "+ 산출물 추가"가 **방금 만든 행**을 다시 열어 주던 버그(2026-11-05)의 재발 방지.
 *
 * Next 16은 떠난 라우트의 React 트리를 숨겨 두고(`<Activity>`) 같은 주소로 돌아오면 상태를 되살린다. S-10 ·
 * S-44 새 행 페이지는 첫 저장 때 `history.replaceState`로 URL만 바꾸므로(컴포넌트를 마운트된 채 두는 설계,
 * 33 런) 그 트리의 상태 = 방금 만든 행이다. 그래서 두 페이지는 `useNewRowRemount`의 `key`로 감싸고, 행이
 * 생길 때(= URL을 그 행 주소로 바꿀 때) `markRow`로 표시해야 한다.
 *
 * 왜 소스를 읽는 테스트인가: 이 저장소에는 컴포넌트 렌더 테스트 설비가 없다(vitest `environment: "node"`,
 * `*.test.ts`만) — 같은 저장소의 소스 가드 관례(`new-row-notice.test.ts`)를 따른다.
 */
import { readFileSync } from "node:fs"
import { join } from "node:path"
import { describe, expect, it } from "vitest"

const read = (p: string) => readFileSync(join(process.cwd(), "src/components/career", p), "utf8")
const PAGES = [
  { name: "S-10 project-page", src: read("project-page/project-page.tsx"), body: "ProjectPageBody" },
  { name: "S-44 deliverable-page", src: read("deliverable/deliverable-page.tsx"), body: "DeliverablePageBody" },
]

describe("새 행 페이지 재진입", () => {
  it.each(PAGES)("$name: useNewRowRemount의 key로 본문을 감싼다", ({ src, body }) => {
    expect(src).toContain("useNewRowRemount()")
    expect(src).toContain(`<${body} key={key}`)
  })

  it("S-10: replaceUrl 안에서 markRow로 표시한다 (호출 3곳 공통)", () => {
    const src = PAGES[0].src
    expect(src).toMatch(/const replaceUrl = React\.useCallback\(\s*\(id: string, chatId: string \| null\) => \{(\s*\/\/[^\n]*)*\s*markRow\(id\)/)
  })

  it("S-44: replaceUrl을 부르는 곳마다 markRow가 붙어 있다", () => {
    const lines = PAGES[1].src.split("\n")
    const calls = lines.map((l, i) => [l, i] as const).filter(([l]) => /\breplaceUrl\(/.test(l) && !l.includes("function replaceUrl"))
    expect(calls.length).toBeGreaterThan(0)
    for (const [, i] of calls) expect(lines.slice(Math.max(0, i - 2), i + 1).join("\n")).toContain("markRow(")
  })

  it("hook은 행 주소에 머무를 때는 트리를 버리지 않는다", () => {
    const hook = read("new-row-remount.tsx")
    expect(hook).toContain("window.location.pathname.includes(rowId)")
  })
})
