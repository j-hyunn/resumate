import type { AliasEntry, AliasMap } from "../context-pack/aliases";
import { WHOLE_SOURCE_FIELD } from "../evidence-rules";

/**
 * Aliases (PRJ-3, REQ-2, DET-5, S12 …) are per-call ids (C-1, C-2): they mean
 * nothing to the user and point at a different row once the data changes. They
 * may appear only in structural keys (`ref`, `requirement_ref(s)`, evidence),
 * never in stored prose (QA-S6-04, C-3 "별칭 참조도 UUID로").
 *
 * `replaceAliasesInText` swaps each alias token in prose for the entity's
 * display label (project name, requirement content …) or removes it when the
 * alias is unknown. An optional `.field` suffix (`DET-5.action`) goes with it.
 * Tokens that literally occur in the user's own data (e.g. "S3" in an AWS
 * project, a ticket id "REQ-1") are left alone.
 */

export const ALIAS_TOKEN_PATTERN = /\b(?:PROFILE|(?:EXP|EDU|PRJ|DET|ACH|SKL|REQ|ANS|NOTE|M)-\d+|S\d+)\b(?:\.[a-z_]+\b)?/g;
const BARE_TOKEN = /^[^.]+/;

/** Label length in prose. */
export const ALIAS_LABEL_MAX = 40;

/** Alias-shaped tokens that occur in the source texts themselves (exempt from replacement). */
export function literalAliasTokens(texts: readonly string[]): Set<string> {
  const out = new Set<string>();
  for (const text of texts) for (const m of text.matchAll(ALIAS_TOKEN_PATTERN)) out.add(bare(m[0]));
  return out;
}

function bare(token: string): string {
  return BARE_TOKEN.exec(token)?.[0] ?? token;
}

function clip(text: string): string {
  const t = text.replace(/\s+/g, " ").trim();
  return t.length > ALIAS_LABEL_MAX ? `${t.slice(0, ALIAS_LABEL_MAX - 1)}…` : t;
}

/** How an entity is named in prose. Null = no usable name (the token is removed). */
export function aliasDisplayLabel(entry: AliasEntry): string | null {
  const f = entry.fields;
  const pick = (...values: Array<string | null | undefined>) => values.find((v) => v && v.trim() !== "")?.trim() ?? null;
  switch (entry.sourceType) {
    case "profile":
      return "프로필";
    case "skill": {
      const name = pick(f.name, entry.label);
      return name ? clip(name) : null;
    }
    case "project":
      return quoted(pick(f.name, entry.label));
    case "project_detail":
      return quoted(pick(f.title, entry.label));
    case "jd_requirement":
    case "jd_sentence":
      return quoted(pick(f[WHOLE_SOURCE_FIELD], entry.label));
    default:
      return quoted(pick(entry.label));
  }
}

function quoted(value: string | null): string | null {
  return value ? `'${clip(value)}'` : null;
}

export type AliasTextStats = { replaced: number; removed: number };

export function replaceAliasesInText(
  text: string,
  aliases: AliasMap,
  literal: ReadonlySet<string> = new Set(),
): { text: string; stats: AliasTextStats } {
  const stats: AliasTextStats = { replaced: 0, removed: 0 };
  let changed = false;
  const out = text.replace(ALIAS_TOKEN_PATTERN, (token) => {
    const alias = bare(token);
    if (literal.has(alias)) return token;
    changed = true;
    const entry = aliases.get(alias);
    const label = entry ? aliasDisplayLabel(entry) : null;
    if (label) {
      stats.replaced++;
      return label;
    }
    stats.removed++;
    return "";
  });
  if (!changed) return { text, stats };
  const tidy = out
    .replace(/\(\s*[,·]?\s*\)/g, "")
    .replace(/[ \t]{2,}/g, " ")
    .replace(/\s+([,.)·])/g, "$1")
    .replace(/,\s*,/g, ",")
    .trim();
  return { text: tidy, stats };
}
