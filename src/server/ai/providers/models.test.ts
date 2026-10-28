import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { allMappedModels } from "./models";

/**
 * QA-S3a-06: every mapped model (C-10.1) must have a price row in every seeded
 * `ai_price_tables` version, or calls are recorded unpriced. Reads the seed
 * migrations (no DB needed): the seed cross-joins a `base (provider, model, …)`
 * list with a `versions (version, effective_from)` list.
 */
const MIGRATIONS = join(process.cwd(), "supabase", "migrations");

function seededRows(): { versions: string[]; rows: Set<string> } {
  const files = readdirSync(MIGRATIONS).filter((f) => f.endsWith(".sql"));
  const versions: string[] = [];
  const rows = new Set<string>();
  for (const file of files) {
    const sql = readFileSync(join(MIGRATIONS, file), "utf8");
    if (!/insert\s+into\s+public\.ai_price_tables/i.test(sql)) continue;
    expect(sql, `${file}: seed must cross join versions × base`).toMatch(/from\s+versions\s+\w*\s*cross\s+join\s+base/i);
    const base = /\bbase\s*\([^)]*\)\s*as\s*\(([\s\S]*?)\)\s*,\s*versions/i.exec(sql)?.[1] ?? "";
    const pairs = [...base.matchAll(/\(\s*'(openai|gemini|anthropic)'\s*,\s*'([^']+)'/g)].map((m) => `${m[1]}/${m[2]}`);
    const vers = [...(/\bversions\s*\([^)]*\)\s*as\s*\(([\s\S]*?)\n\s*\)/i.exec(sql)?.[1] ?? "").matchAll(/'(v\d{4}-\d{2}-\d{2})'/g)].map((m) => m[1]);
    for (const v of vers) {
      versions.push(v);
      for (const p of pairs) rows.add(`${v}|${p}`);
    }
  }
  return { versions, rows };
}

describe("MODEL_MAP ↔ ai_price_tables seed (QA-S3a-06)", () => {
  it("every mapped model is priced in every seeded version", () => {
    const { versions, rows } = seededRows();
    expect(versions.length).toBeGreaterThanOrEqual(3);
    const missing = versions.flatMap((v) => allMappedModels().filter((m) => !rows.has(`${v}|${m.provider}/${m.model}`)).map((m) => `${v} ${m.provider}/${m.model}`));
    expect(missing).toEqual([]);
  });
});
