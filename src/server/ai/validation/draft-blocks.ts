import type { DraftBlockKind } from "@/lib/contracts/enums";
import type { AliasMap } from "../context-pack/aliases";
import { finalizeBlockNumbers, validateTextBlock } from "./block";
import { replaceAliasesInText } from "./alias-text";
import { buildTermCorpus, findUnknownTechTerms, isSituationTaskOnly, SKILL_CHECK_NEEDED } from "./drafts";
import { EVIDENCE_CHECK_NEEDED, type EvidenceContext, type LearningsPolicy, type ModelEvidence, type ValidatedEvidence } from "./evidence";
import type { Placeholder } from "./placeholders";
import { mergeReports, type ValidationReport } from "./report";

/**
 * Draft block check for AI-03 / AI-04 (C-3 V-1..V-5, V-7, V-8, C-5, C-9,
 * AI-03 스킬명 가드, 상황·과제뿐인 본인 주장). Two modes:
 * - `provisional` (block_completed): evidence + flags; numbers not replaced
 *   (V-5 result updates the badge after the whole output, card 응답 모드).
 * - `final`: numbers still unsupported → [수치 확인 필요] + number_check_needed.
 */

/** Stored block (DM A.10 ai_content element; db notes "Block"). */
export type DraftBlock = {
  block_id: string;
  block_kind: DraftBlockKind;
  project_id: string | null;
  text: string;
  requirement_ids: string[];
  placeholders: Placeholder[];
  flags: string[];
  generated_by: "ai" | "server";
  user_modified: false;
  header: Record<string, string | null> | null;
};

/** Evidence chip for screens (C-01): UUID form of one validated evidence. */
export type EvidenceChip = {
  source_type: ValidatedEvidence["source_type"];
  source_id: string;
  source_field: string | null;
  quote: string | null;
  quote_adjusted: boolean;
  source_label: string | null;
  source_locator: Record<string, unknown> | null;
};

export type DraftReport = ValidationReport & Record<string, number>;

export function emptyDraftReport(): DraftReport {
  return mergeReports() as DraftReport;
}

/** Adds counts (common keys and feature keys) into `into`. */
export function addToReport(into: Record<string, number>, ...parts: ReadonlyArray<Partial<Record<string, number>>>): void {
  for (const part of parts) for (const [k, v] of Object.entries(part)) if (typeof v === "number") into[k] = (into[k] ?? 0) + v;
}

export type DraftCheckEnv = {
  aliases: AliasMap;
  ctx: EvidenceContext;
  allowedNumbers: ReadonlySet<string>;
  literalAliasTokens: ReadonlySet<string>;
  /** buildTermCorpus(user data texts) for the skill-name guard. */
  termCorpus: string;
};

export type RawDraftBlock = {
  block_id: string;
  text: string;
  evidence: readonly ModelEvidence[];
  placeholders: ReadonlyArray<{ token: string; hint?: string | null }>;
  requirement_refs?: readonly string[];
};

export type CheckedDraftBlock = {
  block: DraftBlock;
  evidence: ValidatedEvidence[];
  /** V-5 numbers still unsupported (raw text), for the AI-04 correction call. */
  unsupportedNumbers: string[];
  report: DraftReport;
};

export function checkDraftBlock(
  raw: RawDraftBlock,
  meta: { blockId: string; kind: DraftBlockKind; projectId: string | null; learnings?: LearningsPolicy; scope?: ReadonlySet<string> | null },
  env: DraftCheckEnv,
  mode: "provisional" | "final",
): CheckedDraftBlock {
  const report = emptyDraftReport();
  const checked = validateTextBlock(
    {
      key: meta.blockId,
      kind: "draft_block",
      text: raw.text,
      evidence: raw.evidence,
      placeholders: raw.placeholders,
      learnings: meta.learnings,
      scope: meta.scope,
    },
    env.ctx,
    env.allowedNumbers,
  );
  addToReport(report, checked.report);
  const flags = [...checked.outcome.flags];

  // 본인 주장인데 근거가 상세 내용의 상황·과제뿐 (AI-03 실패 유형, AI-04 "본인 기여는 action/result/성과로만").
  if (!flags.includes(EVIDENCE_CHECK_NEEDED) && meta.kind !== "role_line" && isSituationTaskOnly(checked.outcome.evidence)) {
    flags.push(EVIDENCE_CHECK_NEEDED);
    addToReport(report, { items_flagged: 1, self_claim_context_only: 1 });
  }

  let text = checked.text;
  if (mode === "final") {
    const n = finalizeBlockNumbers(text, env.allowedNumbers);
    text = n.text;
    flags.push(...n.flags);
    addToReport(report, n.report);
  }
  const scrubbed = replaceAliasesInText(text, env.aliases, env.literalAliasTokens);
  text = scrubbed.text;
  addToReport(report, { aliases_replaced: scrubbed.stats.replaced, aliases_removed: scrubbed.stats.removed });

  if (findUnknownTechTerms(text, env.termCorpus).length) {
    flags.push(SKILL_CHECK_NEEDED);
    addToReport(report, { skill_terms_flagged: 1 });
  }

  const requirementIds: string[] = [];
  for (const ref of raw.requirement_refs ?? []) {
    const id = env.aliases.resolveId(ref.trim(), "jd_requirement");
    if (id === null) addToReport(report, { requirement_refs_dropped: 1 });
    else if (!requirementIds.includes(id)) requirementIds.push(id);
  }

  return {
    block: {
      block_id: meta.blockId,
      block_kind: meta.kind,
      project_id: meta.projectId,
      text,
      requirement_ids: requirementIds,
      placeholders: checked.placeholders,
      flags: [...new Set(flags)],
      generated_by: "ai",
      user_modified: false,
      header: null,
    },
    evidence: checked.outcome.evidence,
    unsupportedNumbers: [...new Set(checked.unsupportedNumbers.map((m) => m.raw))],
    report,
  };
}

/** Prose that isn't a block (rationale, notes): V-5 replacement then alias labels. */
export function cleanProse(text: string, env: Pick<DraftCheckEnv, "aliases" | "allowedNumbers" | "literalAliasTokens">, report: Record<string, number>): string {
  const n = finalizeBlockNumbers(text, env.allowedNumbers);
  addToReport(report, n.report, { number_violations: n.report.numbers_replaced ?? 0 });
  const scrubbed = replaceAliasesInText(n.text, env.aliases, env.literalAliasTokens);
  addToReport(report, { aliases_replaced: scrubbed.stats.replaced, aliases_removed: scrubbed.stats.removed });
  return scrubbed.text;
}

export function toEvidenceChips(evidence: readonly ValidatedEvidence[], aliases: AliasMap): EvidenceChip[] {
  return evidence.map((e) => {
    const entry = aliases.get(e.ref);
    if (!entry) throw new Error("toEvidenceChips: evidence not in alias map");
    return {
      source_type: e.source_type,
      source_id: entry.id,
      source_field: e.field,
      quote: e.quote,
      quote_adjusted: e.quote_adjusted,
      source_label: entry.label,
      source_locator: entry.locator ?? null,
    };
  });
}

/** C-3 storage limit for block ids (db notes: 1~64, [A-Za-z0-9_.:-]). */
export const BLOCK_ID_PATTERN = /^[A-Za-z0-9_.:-]{1,64}$/;

/** Keeps the model's block id when valid and unused; otherwise a server id. Counts renames. */
export function claimBlockId(wanted: string, used: Set<string>, fallback: () => string, report: Record<string, number>): string {
  const id = wanted.trim();
  if (BLOCK_ID_PATTERN.test(id) && !used.has(id)) {
    used.add(id);
    return id;
  }
  let next = fallback();
  while (used.has(next)) next = fallback();
  used.add(next);
  addToReport(report, { block_ids_renamed: 1 });
  return next;
}

export { buildTermCorpus };
