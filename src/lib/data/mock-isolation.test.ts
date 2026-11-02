/**
 * W5: the real path has no way back to the mock store. Reads the source (no DB, no Next.js) and fails
 * when a store call in src/lib/data isn't behind a preview check, directly or through a helper.
 *
 * Counts as behind a check: the first argument of `previewOr`, the branch of `isPreviewRequest()` that is
 * true, and code after `if (!(await isPreviewRequest())) { …always exits… }`.
 * A helper with an unguarded store call is fine only while it isn't exported and every use is itself behind a check.
 * QA-W5-04: store access is followed through bindings (aliases, namespaces, dynamic imports, re-exports, classes)
 * and through src/lib/mock helpers that call the store, not by a fixed list of names.
 */
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs"
import { dirname, join, relative } from "node:path"
import ts from "typescript"
import { describe, expect, it } from "vitest"

const ROOT = join(process.cwd(), "src")
const DATA_DIR = join(ROOT, "lib/data")
const MOCK_DIR = join(ROOT, "lib/mock")
const STORE_FILE = join(MOCK_DIR, "store.ts")
const FIXTURES_FILE = join(MOCK_DIR, "fixtures.ts")
/** Store exports that read or replace the store. Every other store export must be listed as pure below. */
const STORE_SEEDS = ["getMockDb", "resetMockDb", "mockRequest"]
const STORE_PURE_EXPORTS = ["clone"]
/** Seeds by module; a bare identifier with one of these names and no binding (snippets, globals) also counts. */
const SEED_EXPORTS = new Set([...STORE_SEEDS.map((n) => `${STORE_FILE}#${n}`), `${FIXTURES_FILE}#createFixtures`])
const SEED_NAMES = new Set([...STORE_SEEDS, "createFixtures"])

const isPreviewCheck = (e: ts.Expression): boolean => {
  const text = e.getText().replace(/[()\s]|await/g, "")
  return text === "isPreviewRequest"
}
const unwrapParens = (e: ts.Expression): ts.Expression => (ts.isParenthesizedExpression(e) ? unwrapParens(e.expression) : e)

/** `if (!preview)` / `if (preview)`: a local set from isPreviewRequest() */
function isNamedPreviewFlag(e: ts.Expression): boolean {
  if (!ts.isIdentifier(e)) return false
  let scope: ts.Node | undefined = e
  while (scope) {
    if (ts.isBlock(scope)) {
      for (const st of scope.statements) {
        if (!ts.isVariableStatement(st)) continue
        for (const d of st.declarationList.declarations) {
          if (ts.isIdentifier(d.name) && d.name.text === e.text && d.initializer && isPreviewCheck(d.initializer)) return true
        }
      }
    }
    scope = scope.parent
  }
  return false
}
const isPreviewCondition = (e: ts.Expression) => isPreviewCheck(e) || isNamedPreviewFlag(unwrapParens(e))
const isNotPreviewCondition = (e: ts.Expression) => {
  const inner = unwrapParens(e)
  return ts.isPrefixUnaryExpression(inner) && inner.operator === ts.SyntaxKind.ExclamationToken && isPreviewCondition(inner.operand)
}

function alwaysExits(st: ts.Statement | undefined): boolean {
  if (!st) return false
  if (ts.isReturnStatement(st) || ts.isThrowStatement(st)) return true
  if (ts.isBlock(st)) return st.statements.some(alwaysExits)
  if (ts.isIfStatement(st)) return alwaysExits(st.thenStatement) && alwaysExits(st.elseStatement)
  if (ts.isTryStatement(st)) {
    if (st.finallyBlock && alwaysExits(st.finallyBlock)) return true
    return alwaysExits(st.tryBlock) && (!st.catchClause || alwaysExits(st.catchClause.block))
  }
  return false
}

/** Is this node only reached on a preview request? */
function isGuarded(node: ts.Node): boolean {
  for (let child = node, parent = node.parent; parent; child = parent, parent = parent.parent) {
    if (ts.isCallExpression(parent) && parent.expression.getText() === "previewOr" && parent.arguments[0] === child) return true
    if (ts.isIfStatement(parent)) {
      if (parent.thenStatement === child && isPreviewCondition(parent.expression)) return true
      if (parent.elseStatement === child && isNotPreviewCondition(parent.expression)) return true
    }
    if (ts.isConditionalExpression(parent)) {
      if (parent.whenTrue === child && isPreviewCondition(parent.condition)) return true
      if (parent.whenFalse === child && isNotPreviewCondition(parent.condition)) return true
    }
    if (ts.isBlock(parent) || ts.isSourceFile(parent)) {
      for (const st of parent.statements) {
        if (st === child) break
        if (ts.isIfStatement(st) && isNotPreviewCondition(st.expression) && alwaysExits(st.thenStatement)) return true
      }
    }
  }
  return false
}

interface Fn {
  name: string
  file: string
  node: ts.Node
  /** names other modules import it by (`export function`, `export { a as b }`, `export default`) */
  exportedAs: string[]
}

type Binding = { module: string; imported: string } // imported: name | "*" | "default"

interface ModuleInfo {
  file: string
  sf: ts.SourceFile
  fns: Fn[]
  imports: Map<string, Binding>
  /** `export { x as y } from "m"` → y → (m, x); `export { x as y }` of an import binding too */
  reexports: Map<string, Binding>
  /** `export * from "m"` */
  stars: string[]
  /** top-level statements that run at module load */
  topLevel: ts.Node[]
}

function resolveModule(spec: string, from: string): string | null {
  const base = spec.startsWith("@/") ? join(ROOT, spec.slice(2)) : spec.startsWith(".") ? join(dirname(from), spec) : null
  if (!base) return null
  if (/\.tsx?$/.test(base)) return base
  for (const c of [`${base}.ts`, `${base}.tsx`, join(base, "index.ts")]) if (existsSync(c)) return c
  return `${base}.ts` // snippets: virtual modules
}

const hasExport = (st: ts.Node) => ts.canHaveModifiers(st) && Boolean(ts.getModifiers(st)?.some((m) => m.kind === ts.SyntaxKind.ExportKeyword))
const hasDefault = (st: ts.Node) => ts.canHaveModifiers(st) && Boolean(ts.getModifiers(st)?.some((m) => m.kind === ts.SyntaxKind.DefaultKeyword))

function moduleInfo(sf: ts.SourceFile): ModuleInfo {
  const file = sf.fileName
  const info: ModuleInfo = { file, sf, fns: [], imports: new Map(), reexports: new Map(), stars: [], topLevel: [] }
  const byName = new Map<string, Fn>()
  const localExports: Array<[string, string]> = []
  for (const st of sf.statements) {
    if (ts.isImportDeclaration(st)) {
      const clause = st.importClause
      const mod = ts.isStringLiteral(st.moduleSpecifier) ? resolveModule(st.moduleSpecifier.text, file) : null
      if (!clause || clause.isTypeOnly || !mod) continue
      if (clause.name) info.imports.set(clause.name.text, { module: mod, imported: "default" })
      const nb = clause.namedBindings
      if (nb && ts.isNamespaceImport(nb)) info.imports.set(nb.name.text, { module: mod, imported: "*" })
      if (nb && ts.isNamedImports(nb)) for (const el of nb.elements) if (!el.isTypeOnly) info.imports.set(el.name.text, { module: mod, imported: (el.propertyName ?? el.name).text })
      continue
    }
    if (ts.isExportDeclaration(st)) {
      if (st.isTypeOnly) continue
      const mod = st.moduleSpecifier && ts.isStringLiteral(st.moduleSpecifier) ? resolveModule(st.moduleSpecifier.text, file) : null
      if (!st.exportClause) {
        if (mod) info.stars.push(mod)
        continue
      }
      if (ts.isNamedExports(st.exportClause)) {
        for (const el of st.exportClause.elements) {
          if (el.isTypeOnly) continue
          const local = (el.propertyName ?? el.name).text
          if (mod) info.reexports.set(el.name.text, { module: mod, imported: local })
          else localExports.push([local, el.name.text])
        }
      } else if (mod) {
        info.reexports.set(st.exportClause.name.text, { module: mod, imported: "*" })
      }
      continue
    }
    const exported = hasExport(st)
    const add = (name: string, node: ts.Node) => {
      const fn: Fn = { name, file, node, exportedAs: exported ? [hasDefault(st) ? "default" : name] : [] }
      info.fns.push(fn)
      byName.set(name, fn)
    }
    if ((ts.isFunctionDeclaration(st) || ts.isClassDeclaration(st)) && st.name) add(st.name.text, st)
    else if ((ts.isFunctionDeclaration(st) || ts.isClassDeclaration(st)) && hasDefault(st)) add("default", st)
    else if (ts.isVariableStatement(st)) {
      for (const d of st.declarationList.declarations) if (ts.isIdentifier(d.name)) add(d.name.text, st)
    } else if (ts.isExportAssignment(st)) {
      info.fns.push({ name: "default", file, node: st, exportedAs: ["default"] })
    } else if (!ts.isInterfaceDeclaration(st) && !ts.isTypeAliasDeclaration(st) && !ts.isEnumDeclaration(st) && !ts.isModuleDeclaration(st)) {
      info.topLevel.push(st)
    }
  }
  for (const [local, as] of localExports) {
    const fn = byName.get(local)
    if (fn) fn.exportedAs.push(as)
    else if (info.imports.has(local)) info.reexports.set(as, info.imports.get(local)!)
  }
  return info
}

function collectIdentifiers(root: ts.Node, visit: (id: ts.Identifier) => void) {
  const walk = (n: ts.Node) => {
    if (ts.isIdentifier(n)) visit(n)
    ts.forEachChild(n, walk)
  }
  walk(root)
}

function collectDynamicImports(root: ts.Node, visit: (call: ts.CallExpression, spec: string) => void) {
  const walk = (n: ts.Node) => {
    if (ts.isCallExpression(n) && n.expression.kind === ts.SyntaxKind.ImportKeyword && n.arguments[0] && ts.isStringLiteralLike(n.arguments[0])) visit(n, n.arguments[0].text)
    if (ts.isCallExpression(n) && ts.isIdentifier(n.expression) && n.expression.text === "require" && n.arguments[0] && ts.isStringLiteralLike(n.arguments[0])) visit(n, n.arguments[0].text)
    ts.forEachChild(n, walk)
  }
  walk(root)
}

function parse(file: string) {
  return ts.createSourceFile(file, readFileSync(file, "utf8"), ts.ScriptTarget.Latest, true, ts.ScriptKind.TS)
}

function walkFiles(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name)
    if (statSync(path).isDirectory()) walkFiles(path, out)
    else if (/\.tsx?$/.test(name) && !/\.test\.tsx?$/.test(name)) out.push(path)
  }
  return out
}

/**
 * Follows store access through bindings, not names: aliases (`mockRequest as read`), namespaces
 * (`store.mockRequest()`), dynamic `import()` / `require`, re-exports (`export { h }`, `export … from`,
 * `export *`), classes (static methods), default exports, and src/lib/mock helpers that call the store
 * (their callers in src/lib/data must be behind a check). Returns the taint check and leak list.
 */
function analyze(sources: ts.SourceFile[]) {
  const modules = new Map(sources.map((sf) => [sf.fileName, moduleInfo(sf)]))
  const taintedFns = new Set<Fn>()

  const isTaintedExport = (file: string, name: string, seen = new Set<string>()): boolean => {
    const key = `${file}#${name}`
    if (SEED_EXPORTS.has(key)) return true
    if (seen.has(key)) return false
    seen.add(key)
    const m = modules.get(file)
    if (!m) return false
    if (m.fns.some((f) => f.exportedAs.includes(name) && taintedFns.has(f))) return true
    const re = m.reexports.get(name)
    if (re) return re.imported === "*" ? moduleHasTaint(re.module, seen) : isTaintedExport(re.module, re.imported, seen)
    return m.stars.some((s) => isTaintedExport(s, name, seen))
  }
  const exportNames = (file: string): string[] => {
    const m = modules.get(file)
    const own = m ? [...m.fns.flatMap((f) => f.exportedAs), ...m.reexports.keys()] : []
    const seeds = [...SEED_EXPORTS].filter((k) => k.startsWith(`${file}#`)).map((k) => k.slice(file.length + 1))
    return [...own, ...seeds]
  }
  const moduleHasTaint = (file: string, seen = new Set<string>()): boolean =>
    exportNames(file).some((n) => isTaintedExport(file, n, seen)) || Boolean(modules.get(file)?.stars.some((s) => moduleHasTaint(s, seen)))

  /** Is this identifier a use that reaches the store? */
  const reachesStore = (m: ModuleInfo, id: ts.Identifier): boolean => {
    const p = id.parent
    if (ts.isPropertyAccessExpression(p) && p.name === id) return false
    if ((ts.isVariableDeclaration(p) || ts.isFunctionDeclaration(p) || ts.isClassDeclaration(p) || ts.isParameter(p) || ts.isBindingElement(p)) && p.name === id) return false
    if ((ts.isPropertyAssignment(p) || ts.isMethodDeclaration(p) || ts.isPropertyDeclaration(p)) && p.name === id) return false
    const local = m.fns.find((f) => f.name === id.text)
    if (local) return taintedFns.has(local)
    const b = m.imports.get(id.text)
    if (b) {
      if (b.imported !== "*") return isTaintedExport(b.module, b.imported)
      if (ts.isPropertyAccessExpression(p) && p.expression === id) return isTaintedExport(b.module, p.name.text)
      if (ts.isElementAccessExpression(p) && p.expression === id && ts.isStringLiteralLike(p.argumentExpression)) return isTaintedExport(b.module, p.argumentExpression.text)
      return moduleHasTaint(b.module) // the whole namespace escapes
    }
    return SEED_NAMES.has(id.text)
  }
  const unguardedUse = (m: ModuleInfo, root: ts.Node): boolean => {
    let hit = false
    collectIdentifiers(root, (id) => {
      if (!hit && reachesStore(m, id) && !isGuarded(id)) hit = true
    })
    collectDynamicImports(root, (call, spec) => {
      const mod = resolveModule(spec, m.file)
      if (!hit && mod && moduleHasTaint(mod) && !isGuarded(call)) hit = true
    })
    return hit
  }

  for (let changed = true; changed; ) {
    changed = false
    for (const m of modules.values()) {
      for (const fn of m.fns) {
        if (taintedFns.has(fn) || !unguardedUse(m, fn.node)) continue
        taintedFns.add(fn)
        changed = true
      }
    }
  }

  const leaks = new Set<string>()
  for (const m of modules.values()) {
    if (m.file.startsWith(MOCK_DIR + "/")) continue // mock helpers may touch the store; their callers may not
    const rel = relative(ROOT, m.file)
    for (const name of exportNames(m.file)) if (isTaintedExport(m.file, name)) leaks.add(`${rel}: ${name}`)
    for (const s of m.stars) if (moduleHasTaint(s)) leaks.add(`${rel}: export * from ${relative(ROOT, s)}`)
    if (m.topLevel.some((st) => unguardedUse(m, st))) leaks.add(`${rel}: <module>`)
  }
  return { leaks: [...leaks].sort(), isTaintedExport, moduleHasTaint }
}

/** Exported functions that can reach the store on a plain request. */
function auditSources(sources: ts.SourceFile[]): string[] {
  return analyze(sources).leaks
}

function parseSnippet(code: string, file = "snippet.ts") {
  return ts.createSourceFile(join(ROOT, file), code, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS)
}

describe("mock store isolation (W5)", () => {
  // src/lib/data (every level) + src/lib/mock: mock helpers that call the store taint their callers.
  const sourceFiles = [...walkFiles(DATA_DIR), ...walkFiles(MOCK_DIR)].map(parse)

  it("no exported function in src/lib/data reaches the store on a plain request", () => {
    expect(auditSources(sourceFiles)).toEqual([])
  })

  it("every store export is classified (seed or pure), and the guard backstop covers each seed", () => {
    const store = moduleInfo(parse(STORE_FILE))
    expect(store.fns.flatMap((f) => f.exportedAs).sort()).toEqual([...STORE_SEEDS, ...STORE_PURE_EXPORTS].sort())
    const source = readFileSync(STORE_FILE, "utf8")
    // getMockDb is the production backstop; resetMockDb has its own (QA-W5-04); mockRequest goes through getMockDb
    expect(source.match(/process\.env\.NODE_ENV === "production"/g)?.length ?? 0).toBeGreaterThanOrEqual(2)
    const reset = store.fns.find((f) => f.name === "resetMockDb")!.node.getText()
    expect(reset).toMatch(/NODE_ENV === "production"/)
  })

  it("src/lib/mock helpers that call the store are seen as store access (QA-W5-04)", () => {
    const { isTaintedExport } = analyze(sourceFiles)
    const turn = join(MOCK_DIR, "writing-chat-turn.ts")
    for (const name of ["planMockTurn", "readPlannedTurn", "applyPlannedTurn", "markAsked"]) expect([name, isTaintedExport(turn, name)]).toEqual([name, true])
  })

  it("QA-W5-04: aliases, namespaces, dynamic imports, re-exports, static methods and mock helpers are caught", () => {
    const run = (...files: Array<[string, string]>) => auditSources(files.map(([file, code]) => parseSnippet(code, file)))
    const D = "lib/data/x.ts"
    const S = `@/lib/mock/store`
    expect(run([D, `import * as store from "${S}"\nexport async function a() { return store.mockRequest() }`])).toEqual(["lib/data/x.ts: a"])
    expect(run([D, `import * as store from "${S}"\nexport async function a() { return store["getMockDb"]() }`])).toEqual(["lib/data/x.ts: a"])
    expect(run([D, `import * as store from "${S}"\nexport async function a(f) { return f(store) }`])).toEqual(["lib/data/x.ts: a"])
    expect(run([D, `import * as store from "${S}"\nexport function a(v) { return store.clone(v) }`])).toEqual([]) // pure export
    expect(run([D, `import { mockRequest as read } from "${S}"\nexport async function a() { return read() }`])).toEqual(["lib/data/x.ts: a"])
    expect(run([D, `export async function a() { const m = await import("${S}"); return m.mockRequest() }`])).toEqual(["lib/data/x.ts: a"])
    expect(run([D, `export async function a() { return previewOr(async () => (await import("${S}")).mockRequest(), real) }`])).toEqual([])
    expect(run([D, `import { getMockDb } from "${S}"\nasync function h() { return getMockDb() }\nexport { h }`])).toEqual(["lib/data/x.ts: h"])
    expect(run([D, `import { getMockDb } from "${S}"\nasync function h() { return getMockDb() }\nexport { h as g }`])).toEqual(["lib/data/x.ts: g"])
    expect(run([D, `export { mockRequest } from "${S}"`])).toEqual(["lib/data/x.ts: mockRequest"])
    expect(run([D, `export * from "${S}"`])).toEqual(expect.arrayContaining(["lib/data/x.ts: export * from lib/mock/store.ts"]))
    expect(run([D, `import { resetMockDb } from "${S}"\nexport class C { static wipe() { resetMockDb() } }`])).toEqual(["lib/data/x.ts: C"])
    expect(run([D, `import { resetMockDb } from "${S}"\nclass C { static wipe() { resetMockDb() } }\nexport const a = () => C.wipe()`])).toEqual(["lib/data/x.ts: a"])
    expect(run([D, `import { getMockDb } from "${S}"\nexport default function () { return getMockDb() }`])).toEqual(["lib/data/x.ts: default"])
    expect(run([D, `import { getMockDb } from "${S}"\ngetMockDb()`])).toEqual(["lib/data/x.ts: <module>"])
    // a lib/mock helper that calls the store, imported (also aliased / via a namespace) into lib/data
    const helper: [string, string] = ["lib/mock/h.ts", `import { mockRequest } from "${S}"\nexport async function planTurn() { const db = await mockRequest(); return db }\nexport function pure() { return 1 }`]
    expect(run(helper, [D, `import { planTurn } from "@/lib/mock/h"\nexport async function a() { return planTurn() }`])).toEqual(["lib/data/x.ts: a"])
    expect(run(helper, [D, `import { planTurn as p } from "../mock/h"\nexport async function a() { return p() }`])).toEqual(["lib/data/x.ts: a"])
    expect(run(helper, [D, `import * as h from "@/lib/mock/h"\nexport async function a() { return h.planTurn() }`])).toEqual(["lib/data/x.ts: a"])
    expect(run(helper, [D, `import { pure } from "@/lib/mock/h"\nexport function a() { return pure() }`])).toEqual([])
    expect(run(helper, [D, `import { planTurn } from "@/lib/mock/h"\nexport const a = () => previewOr(() => planTurn(), real)`])).toEqual([])
    // helper chain inside lib/mock: h2 → h → store
    const chain: [string, string] = ["lib/mock/h2.ts", `import { planTurn } from "./h"\nexport function wrap() { return planTurn() }`]
    expect(run(helper, chain, [D, `import { wrap } from "@/lib/mock/h2"\nexport function a() { return wrap() }`])).toEqual(["lib/data/x.ts: a"])
    // cross-file inside lib/data
    expect(run([D, `import { getMockDb } from "${S}"\nexport function leaky() { return getMockDb() }`], ["lib/data/y.ts", `import { leaky } from "./x"\nexport function b() { return leaky() }`])).toEqual(["lib/data/x.ts: leaky", "lib/data/y.ts: b"])
  })

  it("the audit itself catches each kind of leak and accepts each kind of guard", () => {
    const leak = (body: string) => auditSources([parseSnippet(body)])
    // caught
    expect(leak(`export async function a() { return mockRequest() }`)).toEqual(["snippet.ts: a"])
    expect(leak(`async function h() { return getMockDb() }\nexport async function a() { return h() }`)).toEqual(["snippet.ts: a"])
    expect(leak(`async function h() { return getMockDb() }\nexport const a = () => previewOr(async () => 1, () => h())`)).toEqual(["snippet.ts: a"])
    // the real branch falls through to the store when the guard can skip its return
    expect(leak(`export async function a(x) { if (!(await isPreviewRequest())) { if (x) return 1 }\n return mockRequest() }`)).toEqual(["snippet.ts: a"])
    expect(leak(`export async function a() { if (await isPreviewRequest()) { x() }\n return mockRequest() }`)).toEqual(["snippet.ts: a"])
    // accepted
    expect(leak(`export const a = () => previewOr(() => mockRequest(), real)`)).toEqual([])
    expect(leak(`async function h() { return mockRequest() }\nexport const a = () => previewOr(h, real)`)).toEqual([])
    expect(leak(`export async function a() { if (!(await isPreviewRequest())) return real()\n return mockRequest() }`)).toEqual([])
    expect(leak(`export async function a() { if (!(await isPreviewRequest())) { try { return real() } catch (e) { throw e } }\n return mockRequest() }`)).toEqual([])
    expect(leak(`export async function a() { return (await isPreviewRequest()) ? mockRequest() : real() }`)).toEqual([])
    expect(leak(`export async function a() { const preview = await isPreviewRequest()\n if (!preview) return real()\n return mockRequest() }`)).toEqual([])
  })

  it("nothing outside src/lib/data and src/lib/mock imports the store or the fixtures' values", () => {
    const offenders = walkFiles(ROOT)
      .filter((f) => !f.startsWith(DATA_DIR) && !f.startsWith(join(ROOT, "lib/mock")))
      .filter((f) => /from "@\/lib\/mock\/(store|fixtures)"/.test(readFileSync(f, "utf8").replace(/import type [^\n]*\n/g, "")))
      .map((f) => relative(ROOT, f))
    expect(offenders).toEqual([])
  })

  it("nothing outside src/lib/data and src/lib/mock imports a lib/mock binding that reaches the store", () => {
    const { isTaintedExport, moduleHasTaint } = analyze(sourceFiles)
    const offenders: string[] = []
    for (const f of walkFiles(ROOT).filter((x) => !x.startsWith(DATA_DIR) && !x.startsWith(MOCK_DIR))) {
      const m = moduleInfo(parse(f))
      for (const [local, b] of m.imports) {
        if (!b.module.startsWith(MOCK_DIR + "/")) continue
        if (b.imported === "*" ? moduleHasTaint(b.module) : isTaintedExport(b.module, b.imported)) offenders.push(`${relative(ROOT, f)}: ${local}`)
      }
      collectDynamicImports(m.sf, (_call, spec) => {
        const mod = resolveModule(spec, f)
        if (mod?.startsWith(MOCK_DIR + "/") && moduleHasTaint(mod)) offenders.push(`${relative(ROOT, f)}: import(${spec})`)
      })
    }
    expect(offenders).toEqual([])
  })

  it("the /dev gallery's controls refuse a plain request before touching the store", () => {
    const source = readFileSync(join(DATA_DIR, "mock-controls.ts"), "utf8")
    expect(source).toContain("isPreviewRequest()")
    expect(source).not.toContain("isPreviewEnabled")
  })
})
