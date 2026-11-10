/**
 * 회귀 가드 — 2026-11-10 운영 장애(S-13 `/applications` 전체가 React #130으로 깨짐).
 *
 * 원인: `"use client"` 파일이 `AddApplicationLauncher.Button = LauncherButton`처럼 컴포넌트에 정적 속성을 달았고,
 * 서버 컴포넌트인 페이지가 `<AddApplicationLauncher.Button />`을 렌더했다. 서버 컴포넌트가 받는 것은
 * 클라이언트 참조(프록시)라 정적 속성이 실리지 않아 `undefined`가 됐다.
 *
 * 왜 자동 검사가 못 잡았나: TypeScript는 정적 속성을 정상 타입으로 보고(typecheck 통과), 번들러도
 * 빌드를 통과시키며(build 통과), 단위 테스트는 RSC 경계를 지나지 않는다. 오류는 런타임에만 난다.
 * 그래서 소스 규칙으로 막는다: **`"use client"` 파일의 컴포넌트에 정적 속성을 달지 않는다** — 하위 조각은
 * 이름 붙은 export로 둔다.
 */
import { readdirSync, readFileSync, statSync } from "node:fs"
import { join, relative } from "node:path"
import { describe, expect, it } from "vitest"

const ROOT = join(__dirname, "..")

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    if (name === "node_modules" || name.startsWith(".")) continue
    const p = join(dir, name)
    if (statSync(p).isDirectory()) walk(p, out)
    else if (/\.(tsx|ts)$/.test(name) && !/\.test\.tsx?$/.test(name)) out.push(p)
  }
  return out
}

const files = walk(ROOT)
const isClient = (src: string) => /^\s*(?:\/\/[^\n]*\n|\/\*[\s\S]*?\*\/\s*)*["']use client["']/.test(src)

describe("RSC 경계 — 클라이언트 컴포넌트의 정적 속성 금지 (React #130 회귀 가드)", () => {
  it("'use client' 파일은 컴포넌트에 정적 속성을 달지 않는다 (Foo.Bar = …)", () => {
    const hits: string[] = []
    for (const f of files) {
      const src = readFileSync(f, "utf8")
      if (!isClient(src)) continue
      src.split("\n").forEach((line, i) => {
        // `Foo.Bar = …` / `Foo.displayName = …`는 허용하지 않는다 — displayName은 함수 이름으로 충분하다
        if (/^[A-Z][A-Za-z0-9]*\.[A-Za-z][A-Za-z0-9]*\s*=(?!=)/.test(line)) hits.push(`${relative(ROOT, f)}:${i + 1}  ${line.trim()}`)
      })
      if (/Object\.assign\(\s*[A-Z][A-Za-z0-9]*\s*,/.test(src)) hits.push(`${relative(ROOT, f)}  Object.assign(Component, …)`)
    }
    expect(hits).toEqual([])
  })

  it("S-13 페이지는 런처 버튼을 이름 붙은 export로 쓴다", () => {
    const page = readFileSync(join(ROOT, "app/(dashboard)/(gated)/applications/page.tsx"), "utf8")
    expect(page).not.toMatch(/<AddApplicationLauncher\./)
    expect(page).toMatch(/<AddApplicationLauncherButton\s*\/>/)
  })
})
