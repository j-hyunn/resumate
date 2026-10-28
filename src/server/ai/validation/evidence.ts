import { z } from "zod";
import type { AliasMap } from "../context-pack/aliases";
import {
  CAREER_SUPPORT_SOURCE_TYPES,
  EVIDENCE_RULES,
  EVIDENCE_SOURCE_TYPES,
  WHOLE_SOURCE_FIELD,
  isQuoteRequired,
  isReflectionEvidence,
  type EvidenceSourceType,
} from "../evidence-rules";
import { matchQuote } from "./quote";
import { emptyReport, type ValidationReport } from "./report";

/**
 * Evidence validation V-1, V-2, V-3, V-8, V-7 then item-level V-4
 * (AI spec C-3, C-9; ai-pipeline-impl order). Pure functions.
 */

/** Model output format of one evidence object (C-3). Features embed this in their schemas. */
export const ModelEvidenceSchema = z.object({
  source_type: z.enum(EVIDENCE_SOURCE_TYPES),
  ref: z.string(),
  // C-10.2 canonical schema: every property required, absent = explicit null.
  // `.default(null)` keeps the JSON schema "required + nullable" (io: output)
  // while still accepting a provider that omits the key (Gemini doesn't enforce it).
  field: z.string().nullable().default(null),
  quote: z.string().nullable().default(null),
});
/** Validator input: keys may be absent (treated as null), so this is the schema's input type. */
export type ModelEvidence = z.input<typeof ModelEvidenceSchema>;

export type ValidatedEvidence = {
  source_type: EvidenceSourceType;
  ref: string;
  field: string | null;
  quote: string | null;
  quote_adjusted: boolean;
};

/**
 * C-9 per use: `forbidden` (AI-02, AI-03, and every factual claim) removes
 * learnings evidence; `reflection_only` keeps it but it never counts as
 * factual support (V-8).
 */
export type LearningsPolicy = "forbidden" | "reflection_only";

export type EvidenceContext = {
  aliases: AliasMap;
  learnings: LearningsPolicy;
  /** V-7: allowed aliases (selection scope). null/undefined = no selection rule for this feature. */
  scope?: ReadonlySet<string> | null;
  /** AI-12 only: `writing_chat_message` evidence is valid (stored in structured_draft, not evidence_links). */
  allowWritingChatMessage?: boolean;
};

export type EvidenceRemoval = "v1_ref" | "v2_field" | "v3_quote" | "v8_learnings" | "v7_scope";

export type EvidenceCheck = { ok: true; evidence: ValidatedEvidence } | { ok: false; rule: EvidenceRemoval };

/** One evidence object through V-1 → V-2 → V-3 → V-8 → V-7. */
export function checkEvidence(raw: ModelEvidence, ctx: EvidenceContext): EvidenceCheck {
  const sourceType = raw.source_type;
  const rule = EVIDENCE_RULES[sourceType];

  // V-1: ref exists in this call's alias map, with the claimed source type.
  if (sourceType === "writing_chat_message" && !ctx.allowWritingChatMessage) return { ok: false, rule: "v1_ref" };
  const entry = ctx.aliases.get(raw.ref);
  if (!rule.ref.test(raw.ref) || !entry || entry.sourceType !== sourceType) return { ok: false, rule: "v1_ref" };

  // V-2: field allowed for the source type (field-less sources must not name one).
  const field = raw.field === undefined || raw.field === null || raw.field === "" ? null : raw.field;
  if (rule.fields.length === 0 ? field !== null : field === null || !rule.fields.includes(field)) {
    return { ok: false, rule: "v2_field" };
  }

  // V-3: quote is a substring of the source field (normalized), or a ≥70% partial match.
  const quote = raw.quote === undefined || raw.quote === null || raw.quote.trim() === "" ? null : raw.quote;
  let storedQuote: string | null = null;
  let adjusted = false;
  if (quote === null) {
    if (isQuoteRequired(sourceType, field)) return { ok: false, rule: "v3_quote" };
  } else {
    const sourceText = entry.fields[field ?? WHOLE_SOURCE_FIELD];
    if (!sourceText) return { ok: false, rule: "v3_quote" };
    const match = matchQuote(quote, sourceText);
    if (!match.ok) return { ok: false, rule: "v3_quote" };
    storedQuote = match.quote;
    adjusted = match.adjusted;
  }

  // V-8: learnings only where C-9 allows it.
  const evidence: ValidatedEvidence = { source_type: sourceType, ref: raw.ref, field, quote: storedQuote, quote_adjusted: adjusted };
  if (isReflectionEvidence(evidence) && ctx.learnings === "forbidden") return { ok: false, rule: "v8_learnings" };

  // V-7: within the selected sources.
  if (ctx.scope && !ctx.scope.has(raw.ref)) return { ok: false, rule: "v7_scope" };

  return { ok: true, evidence };
}

/**
 * How a judgment item reacts to having no factual evidence (V-4):
 * - `judgment`   strengths, directions, feedback items → dropped (NFR-AI-01)
 * - `match`      met/partial requirement verdicts → downgraded to no_evidence
 * - `draft_block` draft/answer blocks → kept with `evidence_check_needed`
 * - `reference`  items that may legitimately have none (no_evidence verdicts, JD-only gaps) → kept
 */
export type ItemKind = "judgment" | "match" | "draft_block" | "reference";

export type ItemInput = {
  /** item_key for storage (block_id or path key like `strengths.0`). */
  key: string;
  kind: ItemKind;
  evidence: readonly ModelEvidence[];
  /** Generated text of the item, for the C-9 expression check. */
  text?: string;
  /** Per-item overrides (e.g. AI-04 reflection blocks allow learnings). */
  learnings?: LearningsPolicy;
  scope?: ReadonlySet<string> | null;
  /** Which source types count as support. Default: career sources (JD alone never supports a claim about the user). */
  supportSourceTypes?: ReadonlySet<EvidenceSourceType>;
};

export type ItemAction = "keep" | "drop" | "downgrade" | "flag";

export type ItemOutcome = {
  key: string;
  action: ItemAction;
  evidence: ValidatedEvidence[];
  /** `evidence_check_needed` for draft blocks (stored in block flags, AI-03 저장). */
  flags: string[];
};

export const EVIDENCE_CHECK_NEEDED = "evidence_check_needed";

/**
 * [가정] C-9 표현 검사: in a reflection-only block, assertive achievement
 * wording or numbers need a check. Rule-based; tune with the eval set.
 */
const ASSERTIVE_ACHIEVEMENT = /(달성|증가|감소|개선|단축|향상|절감|성장|확보|기여)(했|하였|시켰|됐|되었)|\d/;

export function validateItem(item: ItemInput, ctx: EvidenceContext): { outcome: ItemOutcome; report: ValidationReport } {
  const report = emptyReport();
  report.items_total = 1;
  const itemCtx: EvidenceContext = {
    ...ctx,
    learnings: item.learnings ?? ctx.learnings,
    scope: item.scope !== undefined ? item.scope : ctx.scope,
  };
  const kept: ValidatedEvidence[] = [];
  const seen = new Set<string>();
  for (const raw of item.evidence) {
    report.evidence_total++;
    const check = checkEvidence(raw, itemCtx);
    if (!check.ok) {
      report[`evidence_removed_${check.rule}`]++;
      continue;
    }
    // Duplicates (same ref + field) collapse to one; not counted as removals.
    const dedupeKey = `${check.evidence.ref}|${check.evidence.field ?? ""}|${check.evidence.quote ?? ""}`;
    if (seen.has(dedupeKey)) continue;
    seen.add(dedupeKey);
    if (check.evidence.quote_adjusted) report.quotes_adjusted++;
    kept.push(check.evidence);
  }
  report.evidence_kept = kept.length;

  const supportTypes = item.supportSourceTypes ?? CAREER_SUPPORT_SOURCE_TYPES;
  const factual = kept.filter((e) => supportTypes.has(e.source_type) && !isReflectionEvidence(e)).length;
  const reflections = kept.filter(isReflectionEvidence).length;

  let action: ItemAction = "keep";
  const flags: string[] = [];
  if (factual === 0) {
    const reflectionBlock = item.kind === "draft_block" && reflections > 0 && itemCtx.learnings === "reflection_only";
    if (reflectionBlock) {
      // Learnings may carry a reflection sentence alone (C-9 허용 용도); assertive claims still need a check.
      if (item.text && ASSERTIVE_ACHIEVEMENT.test(item.text)) action = "flag";
    } else if (item.kind === "judgment") action = "drop";
    else if (item.kind === "match") action = "downgrade";
    else if (item.kind === "draft_block") action = "flag";
  }
  if (action === "drop") report.items_dropped++;
  if (action === "downgrade") report.items_downgraded++;
  if (action === "flag") {
    report.items_flagged++;
    flags.push(EVIDENCE_CHECK_NEEDED);
  }
  return { outcome: { key: item.key, action, evidence: action === "drop" ? [] : kept, flags }, report };
}

/**
 * V-7 scope from a selection (AI-03 포함 항목, AI-04 사용한 경력·프로젝트): the
 * selected experiences/educations/projects, their descendant details,
 * achievements and the skills of included projects, plus always-allowed
 * sources (profile, JD, notes, answers). `detailRefs` (AI-04) narrows details
 * to the listed ones (and their achievements).
 */
export function buildSelectionScope(
  aliases: AliasMap,
  selection: { refs: readonly string[]; detailRefs?: readonly string[] | null },
): Set<string> {
  const selected = new Set(selection.refs);
  const detailFilter = selection.detailRefs && selection.detailRefs.length ? new Set(selection.detailRefs) : null;
  const scope = new Set<string>();
  const alwaysAllowed: ReadonlySet<EvidenceSourceType> = new Set<EvidenceSourceType>([
    "profile",
    "jd_sentence",
    "jd_requirement",
    "user_note",
    "interview_answer",
  ]);
  const entries = [...aliases.values()];
  const byAlias = new Map(entries.map((e) => [e.alias, e]));
  const inScope = (alias: string, seen = new Set<string>()): boolean => {
    if (selected.has(alias)) return true;
    if (seen.has(alias)) return false;
    seen.add(alias);
    const entry = byAlias.get(alias);
    if (!entry) return false;
    if (entry.sourceType === "project_detail" && detailFilter && !detailFilter.has(alias)) return false;
    return entry.parents.some((p) => inScope(p, seen));
  };
  for (const entry of entries) {
    if (alwaysAllowed.has(entry.sourceType) || (entry.sourceType !== "skill" && inScope(entry.alias))) scope.add(entry.alias);
  }
  // Skills have no parent link in the alias map; they are in scope when any in-scope project lists them.
  for (const entry of entries) {
    if (entry.sourceType === "skill" && entry.parents.some((p) => scope.has(p))) scope.add(entry.alias);
  }
  return scope;
}
