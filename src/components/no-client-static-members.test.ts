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

function resolveImport(spec: string, from: string): string | null {
  const base = spec.startsWith("@/") ? join(ROOT, spec.slice(2)) : spec.startsWith(".") ? join(from, "..", spec) : null
  if (!base) return null
  for (const ext of [".tsx", ".ts", "/index.tsx", "/index.ts"]) {
    try {
      if (statSync(base + ext).isFile()) return base + ext
    } catch {}
  }
  return null
}

/** 이 파일이 `"use client"` 모듈에서 가져오는 값 이름들 (`import type`은 지워지므로 뺀다) */
function clientImports(file: string, src: string): Array<{ names: string[]; target: string }> {
  const out: Array<{ names: string[]; target: string }> = []
  for (const m of src.matchAll(/import\s*(type\s*)?\{([^}]*)\}\s*from\s*["']([^"']+)["']/g)) {
    if (m[1]) continue
    const target = resolveImport(m[3], file)
    if (!target || !isClient(readFileSync(target, "utf8"))) continue
    const names = m[2]
      .split(",")
      .map((n) => n.trim())
      .filter((n) => n && !n.startsWith("type "))
      .map((n) => n.split(/\s+as\s+/).pop()!.trim())
    out.push({ names, target })
  }
  return out
}

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

  it("서버·공용 파일은 'use client' 모듈의 import를 <X.Y>로 렌더하지 않는다", () => {
    const hits: string[] = []
    for (const f of files) {
      const src = readFileSync(f, "utf8")
      if (isClient(src) || !f.endsWith(".tsx")) continue
      for (const { names, target } of clientImports(f, src)) {
        for (const n of names) if (new RegExp(`<${n}\\.[A-Za-z]`).test(src)) hits.push(`${relative(ROOT, f)}  <${n}.…> from ${relative(ROOT, target)}`)
      }
    }
    expect(hits).toEqual([])
  })

  /**
   * 같은 경계의 이웃 유형: 서버·공용(지시문 없는) 파일이 `"use client"` 모듈에서 **컴포넌트가 아닌 값**(함수·상수)을
   * 가져오면, 그 파일이 서버에서 평가될 때 실제 값이 아니라 클라이언트 참조를 받는다. 지금 아는 예외는 아래 목록뿐이고,
   * 그 파일들은 **클라이언트 컴포넌트에서만** 불린다(2026-11-10 전수 점검). 서버에서 부르게 되면 깨지므로, 예외를 늘리지
   * 말고 그 값을 지시문 없는 모듈로 옮겨라.
   */
  const KNOWN_CLIENT_VALUE_IMPORTS: Record<string, string[]> = {
    // aiErrorTitle은 common/ai-error-notice.tsx("use client")에 있다. ai-format.ts를 부르는 곳은 S-24 AI 연결 탭의
    // 클라이언트 컴포넌트 3개(ai-usage-panel·key-connect-flow·provider-row)뿐이다.
    "components/account/ai-format.ts": ["aiErrorTitle"],
  }

  it("서버·공용 파일은 'use client' 모듈에서 컴포넌트가 아닌 값을 가져오지 않는다 (알려진 예외만)", () => {
    const hits: string[] = []
    for (const f of files) {
      const src = readFileSync(f, "utf8")
      if (isClient(src)) continue
      const rel = relative(ROOT, f)
      for (const { names, target } of clientImports(f, src)) {
        for (const n of names) {
          if (/^[A-Z][a-z]/.test(n) && !new RegExp(`(?<![<\\w])${n}\\s*\\(`).test(src)) continue // 컴포넌트(JSX로만 씀)
          if (KNOWN_CLIENT_VALUE_IMPORTS[rel]?.includes(n)) continue
          hits.push(`${rel}  ${n} from ${relative(ROOT, target)}`)
        }
      }
    }
    expect(hits).toEqual([])
  })

  it("알려진 예외 파일은 지금도 클라이언트 컴포넌트에서만 불린다", () => {
    for (const rel of Object.keys(KNOWN_CLIENT_VALUE_IMPORTS)) {
      const spec = "@/" + rel.replace(/\.tsx?$/, "")
      const importers = files.filter((f) => readFileSync(f, "utf8").includes(spec) || readFileSync(f, "utf8").includes(`./${rel.split("/").pop()!.replace(/\.tsx?$/, "")}"`))
      for (const f of importers) expect(isClient(readFileSync(f, "utf8")), `${relative(ROOT, f)} imports ${rel} but is not a client component`).toBe(true)
    }
  })

  it("S-13 페이지는 런처 버튼을 이름 붙은 export로 쓴다", () => {
    const page = readFileSync(join(ROOT, "app/(dashboard)/(gated)/applications/page.tsx"), "utf8")
    expect(page).not.toMatch(/<AddApplicationLauncher\./)
    expect(page).toMatch(/<AddApplicationLauncherButton\s*\/>/)
  })
})
