import { z } from "zod";
import { INSIGHT_GAP_KINDS, INSIGHT_MATCH_STATUSES } from "../schemas/AI-02";

/**
 * Reader of a stored AI-02 result (`insights.result`, **schema_version 2**,
 * DM v4.16 2.7.0) for the features that read the insight instead of the JD
 * raw text (AI spec v4.16 JR-5): AI-04's `<insight>` block and the AI-12 gate
 * gaps. Lenient on purpose: unknown keys are ignored, a malformed element is
 * skipped, and anything that is not schema 2 reads as "no insight" (old
 * schema-1 insights are never an input — JR-Q3 (b)).
 *
 * Only the fields those prompts use are read. Never logged.
 */

export const INSIGHT_READ_SCHEMA_VERSION = 2;

const Str = z.string();
const MatchKeys = z.array(Str).catch([]);

const RequirementMatch = z.object({
  match_key: Str,
  requirement_text: Str,
  status: z.enum(INSIGHT_MATCH_STATUSES),
  missing_aspect: Str.nullable().catch(null),
});
const Strength = z.object({ title: Str, description: Str.catch("") });
const Gap = z.object({
  item_key: Str,
  match_keys: MatchKeys,
  gap_kind: z.enum(INSIGHT_GAP_KINDS),
  description: Str,
});
const Priority = z.object({ rank: z.number(), project_id: Str, reason: Str.catch("") });

/** Keeps the elements that parse, drops the rest (one bad element never hides the insight). */
function listOf<T extends z.ZodType>(item: T) {
  return z
    .array(z.unknown())
    .catch([])
    .transform((list) => list.flatMap((v) => {
      const r = item.safeParse(v);
      return r.success ? [r.data as z.infer<T>] : [];
    }));
}

const InsightResultV2ReadSchema = z.object({
  requirement_matches: listOf(RequirementMatch),
  strengths: listOf(Strength),
  gaps: listOf(Gap),
  strategy: z
    .object({
      positioning: Str.nullable().catch(null),
      project_priorities: listOf(Priority),
    })
    .catch({ positioning: null, project_priorities: [] }),
});

export type InsightResultV2 = z.infer<typeof InsightResultV2ReadSchema>;

/** `insights.schema_version` + `insights.result` → the readable part, or null (not schema 2 / not an object). */
export function readInsightResultV2(schemaVersion: number, result: unknown): InsightResultV2 | null {
  if (schemaVersion !== INSIGHT_READ_SCHEMA_VERSION) return null;
  if (!result || typeof result !== "object") return null;
  const parsed = InsightResultV2ReadSchema.safeParse(result);
  return parsed.success ? parsed.data : null;
}

/** `match_keys` → requirement texts (unknown keys skipped). */
export function requirementTextsOf(result: InsightResultV2, matchKeys: readonly string[]): string[] {
  const byKey = new Map(result.requirement_matches.map((m) => [m.match_key, m.requirement_text]));
  return matchKeys.flatMap((k) => (byKey.has(k) ? [byKey.get(k)!] : []));
}
