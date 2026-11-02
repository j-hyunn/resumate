import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";
import { INVOCATION_BUDGET_MS } from "./constants";

/**
 * QA-W5-05: every function that can run a job step in `after()` gets a duration ceiling above the
 * step budget (58 s). Route Handlers: `export const maxDuration` (route segment config). Pages —
 * where Server Actions run, incl. the `getAiJob` poll that wakes a due retry — via vercel.json
 * `functions` (UI owns the page files). Fluid compute is assumed on (notes).
 */
const ROOT = join(process.cwd(), "src/app");
const files = (dir: string, out: string[] = []): string[] => {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) files(p, out);
    else out.push(p);
  }
  return out;
};
const need = Math.ceil(INVOCATION_BUDGET_MS / 1000) + 1;
const declared = (src: string) => Number(/export const maxDuration\s*=\s*(\d+)/.exec(src)?.[1] ?? NaN);

describe("function duration (QA-W5-05)", () => {
  it("vercel.json gives every page function at least the step budget", () => {
    const config = JSON.parse(readFileSync(join(process.cwd(), "vercel.json"), "utf8")) as { functions?: Record<string, { maxDuration?: number }> };
    expect(config.functions?.["src/app/**/page.tsx"]?.maxDuration).toBeGreaterThanOrEqual(need);
    const pages = files(ROOT).filter((f) => f.endsWith("/page.tsx"));
    expect(pages.length).toBeGreaterThan(20);
    // a page-level export would compete with vercel.json; keep one source of truth
    for (const p of pages) expect([relative(ROOT, p), /export const maxDuration/.test(readFileSync(p, "utf8"))]).toEqual([relative(ROOT, p), false]);
  });

  it("every Route Handler declares maxDuration above the step budget", () => {
    const routes = files(join(ROOT, "api")).filter((f) => f.endsWith("/route.ts"));
    for (const r of routes) expect([relative(ROOT, r), declared(readFileSync(r, "utf8")) >= need]).toEqual([relative(ROOT, r), true]);
  });
});
