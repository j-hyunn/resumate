import { REQUIREMENT_CATEGORIES, REQUIREMENT_IMPORTANCES, type RequirementCategory, type RequirementImportance } from "@/lib/contracts/enums";
import type { InsightRequirement } from "@/lib/contracts/insight";
import type { LegacyRequirementRow } from "./db";

/**
 * R17 requirement resolution for S-16 (plan §5 "읽기").
 * - v2 (`result.schema_version === 2`): the requirement lives in the result itself —
 *   `requirement_matches[].requirement = { content, category, importance, sentence_ids }`, id `M{n}`.
 * - v1 (before R17): `requirement_id` points at a preserved `jd_requirements` row (R17-2).
 */

type Obj = Record<string, unknown>;
const obj = (v: unknown): Obj => (v && typeof v === "object" && !Array.isArray(v) ? (v as Obj) : {});
const strs = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : []);

export const INSIGHT_RESULT_V2 = 2;

/** True for a result written by the R17 pipeline (its own requirement list). */
export function isV2Result(result: unknown): boolean {
  return obj(result).schema_version === INSIGHT_RESULT_V2;
}

/** One v2 requirement (`requirement_matches[n].requirement`) → view; null when malformed. */
export function toV2Requirement(id: string, raw: unknown, index: number): InsightRequirement | null {
  const r = obj(raw);
  const content = typeof r.content === "string" ? r.content : "";
  if (!content) return null;
  const category = (REQUIREMENT_CATEGORIES as readonly string[]).includes(r.category as string) ? (r.category as RequirementCategory) : "required";
  const importance = (REQUIREMENT_IMPORTANCES as readonly string[]).includes(r.importance as string) ? (r.importance as RequirementImportance) : "normal";
  return { id, category, content, importance, sortOrder: index, sentenceIds: strs(r.sentence_ids) };
}

/** The requirements of a v2 result, in result order. */
export function v2Requirements(result: unknown): InsightRequirement[] {
  const matches = obj(result).requirement_matches;
  if (!Array.isArray(matches)) return [];
  return matches.flatMap((raw, n) => {
    const m = obj(raw);
    const id = typeof m.requirement_id === "string" ? m.requirement_id : "";
    const req = id ? toV2Requirement(id, m.requirement, n) : null;
    return req ? [req] : [];
  });
}

/** Legacy rows → view (v1 insights). */
export function legacyRequirements(rows: readonly LegacyRequirementRow[]): InsightRequirement[] {
  return rows.map((r) => ({ id: r.id, category: r.category, content: r.content, importance: r.importance, sortOrder: r.sort_order, sentenceIds: r.source_sids }));
}
