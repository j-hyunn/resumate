import type { AliasMap } from "../context-pack/aliases";
import { isActionResultEvidence, isCareerSupportEvidence, isReflectionEvidence } from "../evidence-rules";
import type {
  Ai02Gap,
  Ai02Match,
  Ai02MatchOutput,
  Ai02Strength,
  Ai02SynthesisOutput,
  InsightActionType,
  InsightGapKind,
  InsightMatchStatus,
} from "../schemas/AI-02";
import { checkEvidence, validateItem, type EvidenceContext, type ModelEvidence, type ValidatedEvidence } from "./evidence";
import { replaceAliasesInText } from "./alias-text";
import { findUnsupportedNumbers, guardNumbers } from "./numbers";
import { emptyReport, mergeReports, type ValidationReport } from "./report";

/**
 * AI-02 server validation (AI spec AI-02 "실패 유형·가드레일", C-3, C-9).
 * Pure functions; the pipeline (pipelines/AI-02.ts) wires them to calls.
 *
 * Stage 1 (per batch, right after the call):
 *   requirement_ref in the batch (else the verdict is dropped) → one verdict
 *   per requirement (duplicates dropped, missing ones filled as no_evidence
 *   [가정 S6-2]) → V-1/V-2/V-3/V-8 per evidence (learnings forbidden, C-9) →
 *   V-4 (met/partial with no career evidence → no_evidence) → met rule (no
 *   detail action/result and no achievement → partial) → V-5 replacement in
 *   rationale / missing_aspect (no regeneration at this stage, see notes).
 *
 * Stage 2 (finalize, after the synthesize call and its V-5 regeneration):
 *   strengths (V-4 drop; requirement_refs must reach a met/partial verdict;
 *   ≤ 3), gaps (refs must reach a partial/no_evidence verdict; gap_kind
 *   recomputed; actions: reframe/prepare_answer need career evidence),
 *   positioning (V-4 → null), priorities (PRJ must exist; ≤ 5, re-ranked),
 *   then V-5 replacement in every generated text.
 */

export const INSIGHT_MAX_STRENGTHS = 3;
export const INSIGHT_MAX_PRIORITIES = 5;

/** Shown when V-4 turns a met/partial verdict into no_evidence (the model's reason cited evidence that failed validation). */
export const NO_EVIDENCE_RATIONALE = "입력된 데이터에서 이 요건을 뒷받침하는 근거를 찾지 못했습니다.";
/** Missing aspect set when the met rule downgrades and the model gave none. */
export const MET_DOWNGRADE_MISSING_ASPECT = "본인이 한 행동·결과 또는 성과로 확인되는 서술";

/** AI-02 counters on top of the common validation_report (counts only, C-7). */
export const AI02_REPORT_EXTRA_KEYS = [
  "requirements_total",
  "matches_dropped_unknown_ref",
  "matches_dropped_duplicate",
  "matches_filled_missing",
  "met_downgraded_partial",
  "evidence_lost_on_restore",
  "strengths_dropped_no_match",
  "strengths_truncated",
  "strengths_same_evidence",
  "gaps_dropped_no_requirement",
  "gap_kind_corrected",
  "actions_dropped",
  "positioning_dropped",
  "priorities_dropped",
  "priorities_truncated",
  "requirement_refs_dropped",
  "synthesis_regenerated",
  "aliases_replaced",
  "aliases_removed",
] as const;
export type Ai02ReportExtraKey = (typeof AI02_REPORT_EXTRA_KEYS)[number];
export type Ai02ValidationReport = ValidationReport & Record<Ai02ReportExtraKey, number>;

export function emptyAi02Report(): Ai02ValidationReport {
  const extra = Object.fromEntries(AI02_REPORT_EXTRA_KEYS.map((k) => [k, 0])) as Record<Ai02ReportExtraKey, number>;
  return { ...emptyReport(), ...extra };
}

export function mergeAi02Reports(...reports: ReadonlyArray<Partial<Record<string, number>>>): Ai02ValidationReport {
  const out = emptyAi02Report();
  const base = mergeReports(...(reports as ReadonlyArray<Partial<ValidationReport>>));
  Object.assign(out, base);
  for (const report of reports) for (const key of AI02_REPORT_EXTRA_KEYS) out[key] += report[key] ?? 0;
  return out;
}

const LEARNINGS_FORBIDDEN = "forbidden" as const; // C-9: AI-02 allows no learnings evidence at all.

/** Verdict in alias form (internal to one context). */
export type ValidatedMatch = {
  ref: string;
  requirementId: string;
  status: InsightMatchStatus;
  modelStatus: InsightMatchStatus | null;
  rationale: string;
  missingAspect: string | null;
  evidence: ValidatedEvidence[];
};

function isCareerFact(e: ValidatedEvidence): boolean {
  // A10: profile wishes (희망 직무·관심 산업) are context, not a fact.
  return isCareerSupportEvidence(e) && !isReflectionEvidence(e);
}

/** Card 가드레일: `met` needs a detail action/result or an achievement among its evidence. */
export function supportsMet(evidence: readonly ValidatedEvidence[]): boolean {
  return evidence.some(isActionResultEvidence);
}

/**
 * V-4 + met rule on an already validated evidence list. `no_evidence` keeps no
 * evidence (a verdict of "not found" cites nothing; never upgraded).
 */
export function applyMatchRules(
  modelStatus: InsightMatchStatus,
  evidence: ValidatedEvidence[],
  report: Ai02ValidationReport,
): { status: InsightMatchStatus; evidence: ValidatedEvidence[]; downgradedTo: InsightMatchStatus | null } {
  if (modelStatus === "no_evidence") return { status: "no_evidence", evidence: [], downgradedTo: null };
  if (!evidence.some(isCareerFact)) {
    report.items_downgraded++;
    return { status: "no_evidence", evidence: [], downgradedTo: "no_evidence" };
  }
  if (modelStatus === "met" && !supportsMet(evidence)) {
    report.met_downgraded_partial++;
    return { status: "partial", evidence, downgradedTo: "partial" };
  }
  return { status: modelStatus, evidence, downgradedTo: null };
}

/**
 * Stage 1: one batch output → exactly one verdict per batch requirement, in
 * batch order. `batch` = [{ref, requirementId}] of this call.
 */
export function validateMatchBatch(
  output: Ai02MatchOutput,
  batch: ReadonlyArray<{ ref: string; requirementId: string }>,
  aliases: AliasMap,
  guard: TextGuard,
): { matches: ValidatedMatch[]; report: Ai02ValidationReport } {
  const report = emptyAi02Report();
  report.requirements_total = batch.length;
  const ctx: EvidenceContext = { aliases, learnings: LEARNINGS_FORBIDDEN };
  const byRef = new Map<string, Ai02Match>();
  for (const m of output.matches) {
    const ref = m.requirement_ref.trim();
    if (!batch.some((b) => b.ref === ref)) {
      report.matches_dropped_unknown_ref++;
      continue;
    }
    if (byRef.has(ref)) {
      report.matches_dropped_duplicate++;
      continue;
    }
    byRef.set(ref, m);
  }

  const matches: ValidatedMatch[] = [];
  for (const b of batch) {
    const m = byRef.get(b.ref);
    if (!m) {
      // [가정 S6-2] the model skipped this requirement → no_evidence with no evidence.
      report.matches_filled_missing++;
      matches.push({ ref: b.ref, requirementId: b.requirementId, status: "no_evidence", modelStatus: null, rationale: NO_EVIDENCE_RATIONALE, missingAspect: null, evidence: [] });
      continue;
    }
    let evidence: ValidatedEvidence[] = [];
    if (m.status !== "no_evidence") {
      // "reference" = per-evidence checks only; V-4 and the met rule are applyMatchRules (single counter).
      const item = validateItem({ key: b.ref, kind: "reference", evidence: m.evidence }, ctx);
      Object.assign(report, mergeReports(report, item.report));
      evidence = item.outcome.evidence;
    }
    const ruled = applyMatchRules(m.status, evidence, report);
    let rationale = m.rationale.trim();
    let missingAspect = m.missing_aspect?.trim() || null;
    if (ruled.downgradedTo === "no_evidence") rationale = NO_EVIDENCE_RATIONALE;
    if (ruled.downgradedTo === "partial" && !missingAspect) missingAspect = MET_DOWNGRADE_MISSING_ASPECT;
    if (!rationale) rationale = ruled.status === "no_evidence" ? NO_EVIDENCE_RATIONALE : rationale;
    const guardedRationale = cleanText(rationale, guard, aliases, report);
    const guardedMissing = missingAspect === null ? null : cleanText(missingAspect, guard, aliases, report);
    matches.push({
      ref: b.ref,
      requirementId: b.requirementId,
      status: ruled.status,
      modelStatus: m.status,
      rationale: guardedRationale,
      missingAspect: guardedMissing,
      evidence: ruled.evidence,
    });
  }
  return { matches, report };
}

/** What the prose of one context is checked against. */
export type TextGuard = {
  /** V-5 allowed numbers. */
  allowedNumbers: ReadonlySet<string>;
  /** Alias-shaped tokens that occur in the user's own data (kept in prose). */
  literalAliasTokens: ReadonlySet<string>;
};

/**
 * Stored prose: V-5 replacement first (aliases are blanked during number
 * extraction), then aliases → display labels (QA-S6-04).
 */
export function cleanText(text: string, guard: TextGuard, aliases: AliasMap, report: Ai02ValidationReport): string {
  const numbersChecked = guardText(text, guard.allowedNumbers, report);
  const { text: out, stats } = replaceAliasesInText(numbersChecked, aliases, guard.literalAliasTokens);
  report.aliases_replaced += stats.replaced;
  report.aliases_removed += stats.removed;
  return out;
}

/** V-5 final step on one text: count and replace. */
export function guardText(text: string, allowed: ReadonlySet<string>, report: ValidationReport): string {
  const bad = findUnsupportedNumbers(text, allowed);
  if (!bad.length) return text;
  report.number_violations += bad.length;
  const guarded = guardNumbers(text, allowed);
  report.numbers_replaced += guarded.replaced;
  return guarded.text;
}

/**
 * Re-checks restored evidence against the current alias map (stage-1 output
 * kept in UUID form across steps). Missing sources or quotes that no longer
 * match are dropped and counted; nothing else is counted (stage 1 already did).
 */
export function recheckEvidence(evidence: readonly ModelEvidence[], aliases: AliasMap, report: Ai02ValidationReport, adjusted: readonly boolean[]): ValidatedEvidence[] {
  const out: ValidatedEvidence[] = [];
  evidence.forEach((raw, i) => {
    const check = checkEvidence(raw, { aliases, learnings: LEARNINGS_FORBIDDEN });
    if (!check.ok) {
      report.evidence_lost_on_restore++;
      return;
    }
    out.push({ ...check.evidence, quote_adjusted: check.evidence.quote_adjusted || (adjusted[i] ?? false) });
  });
  return out;
}

// ---------- stage 2 ----------

export type FinalStrength = { title: string; description: string; requirementRefs: string[]; evidence: ValidatedEvidence[] };
export type FinalAction = { type: InsightActionType; text: string; evidence: ValidatedEvidence[] };
export type FinalGap = { requirementRefs: string[]; gapKind: InsightGapKind; description: string; actions: FinalAction[]; evidence: ValidatedEvidence[] };
export type FinalPriority = { rank: number; ref: string; reason: string; requirementRefs: string[] };
export type FinalSynthesis = {
  strengths: FinalStrength[];
  gaps: FinalGap[];
  positioning: { text: string; evidence: ValidatedEvidence[] } | null;
  priorities: FinalPriority[];
};

export function validateSynthesis(
  output: Ai02SynthesisOutput,
  matches: readonly ValidatedMatch[],
  aliases: AliasMap,
  guard: TextGuard,
): { value: FinalSynthesis; report: Ai02ValidationReport } {
  const report = emptyAi02Report();
  const ctx: EvidenceContext = { aliases, learnings: LEARNINGS_FORBIDDEN };
  const statusByRef = new Map(matches.map((m) => [m.ref, m.status]));
  const add = (r: ValidationReport) => Object.assign(report, mergeAi02Reports(report, r));

  const keepRefs = (refs: readonly string[], allowed: (s: InsightMatchStatus) => boolean): string[] => {
    const out: string[] = [];
    for (const raw of refs) {
      const ref = raw.trim();
      const status = statusByRef.get(ref);
      if (!status || !allowed(status)) {
        report.requirement_refs_dropped++;
        continue;
      }
      if (!out.includes(ref)) out.push(ref);
    }
    return out;
  };

  // Strengths: V-4 drop, only met/partial requirements, ≤ 3.
  const strengths: FinalStrength[] = [];
  output.strengths.forEach((s: Ai02Strength, i) => {
    const item = validateItem({ key: `strengths.${i}`, kind: "judgment", evidence: s.evidence }, ctx);
    add(item.report);
    if (item.outcome.action === "drop") return;
    const refs = keepRefs(s.requirement_refs, (st) => st !== "no_evidence");
    if (!refs.length) {
      report.strengths_dropped_no_match++;
      report.items_dropped++;
      return;
    }
    strengths.push({
      title: cleanText(s.title.trim(), guard, aliases, report),
      description: cleanText(s.description.trim(), guard, aliases, report),
      requirementRefs: refs,
      evidence: item.outcome.evidence,
    });
  });
  if (strengths.length > INSIGHT_MAX_STRENGTHS) {
    report.strengths_truncated += strengths.length - INSIGHT_MAX_STRENGTHS;
    strengths.length = INSIGHT_MAX_STRENGTHS;
  }
  // Card 가드레일 "같은 프로젝트를 모든 강점에 반복" → quality signal only.
  if (strengths.length > 1) {
    const sets = strengths.map((s) => [...new Set(s.evidence.filter(isCareerFact).map((e) => e.ref))].sort().join("|"));
    if (sets.every((k) => k === sets[0])) report.strengths_same_evidence = 1;
  }

  // Gaps: refs must point at partial/no_evidence verdicts.
  const gaps: FinalGap[] = [];
  output.gaps.forEach((g: Ai02Gap, i) => {
    const refs = keepRefs(g.requirement_refs, (st) => st !== "met");
    // Gap-level evidence may be JD-only (card example `jd_sentence S12`); the gap is kept either way.
    const item = validateItem({ key: `gaps.${i}`, kind: "reference", evidence: g.evidence }, ctx);
    add(item.report);
    if (!refs.length) {
      report.gaps_dropped_no_requirement++;
      return;
    }
    const gapKind: InsightGapKind = refs.some((r) => statusByRef.get(r) === "no_evidence") ? "no_evidence" : "partial";
    if (gapKind !== g.gap_kind) report.gap_kind_corrected++;
    const actions: FinalAction[] = [];
    g.actions.forEach((a, j) => {
      const kind = a.type === "add_data" ? "reference" : "judgment";
      const act = validateItem({ key: `gaps.${i}.actions.${j}`, kind, evidence: a.evidence }, ctx);
      add(act.report);
      if (act.outcome.action === "drop") {
        report.actions_dropped++;
        return;
      }
      actions.push({ type: a.type, text: cleanText(a.text.trim(), guard, aliases, report), evidence: act.outcome.evidence });
    });
    gaps.push({
      requirementRefs: refs,
      gapKind,
      description: cleanText(g.description.trim(), guard, aliases, report),
      actions,
      evidence: item.outcome.evidence,
    });
  });

  // Positioning: judgment item.
  let positioning: FinalSynthesis["positioning"] = null;
  const pos = output.strategy.positioning.trim();
  if (pos) {
    const item = validateItem({ key: "strategy.positioning", kind: "judgment", evidence: output.strategy.positioning_evidence }, ctx);
    add(item.report);
    if (item.outcome.action === "drop") report.positioning_dropped++;
    else positioning = { text: cleanText(pos, guard, aliases, report), evidence: item.outcome.evidence };
  }

  // Priorities: the PRJ alias must exist; one row per project; model rank order; ≤ 5; ranks 1..n.
  const seen = new Set<string>();
  const priorities = [...output.strategy.project_priorities]
    .map((p, i) => ({ p, i }))
    .sort((a, b) => a.p.rank - b.p.rank || a.i - b.i)
    .flatMap(({ p }) => {
      const ref = p.ref.trim();
      const entry = aliases.get(ref);
      if (!entry || entry.sourceType !== "project" || seen.has(ref)) {
        report.priorities_dropped++;
        return [];
      }
      seen.add(ref);
      return [{ ref, reason: cleanText(p.reason.trim(), guard, aliases, report), requirementRefs: keepRefs(p.requirement_refs, (st) => st !== "no_evidence") }];
    });
  if (priorities.length > INSIGHT_MAX_PRIORITIES) {
    report.priorities_truncated += priorities.length - INSIGHT_MAX_PRIORITIES;
    priorities.length = INSIGHT_MAX_PRIORITIES;
  }

  return {
    value: { strengths, gaps, positioning, priorities: priorities.map((p, i) => ({ rank: i + 1, ...p })) },
    report,
  };
}

/** Every generated text of a synthesis output (V-5 regeneration check). */
export function synthesisTexts(output: Ai02SynthesisOutput): string[] {
  return [
    ...output.strengths.flatMap((s) => [s.title, s.description]),
    ...output.gaps.flatMap((g) => [g.description, ...g.actions.map((a) => a.text)]),
    output.strategy.positioning,
    ...output.strategy.project_priorities.map((p) => p.reason),
  ];
}

/** Unsupported number mentions (raw text, deduplicated) across a synthesis output. */
export function synthesisNumberViolations(output: Ai02SynthesisOutput, allowed: ReadonlySet<string>): string[] {
  const out: string[] = [];
  for (const text of synthesisTexts(output)) for (const m of findUnsupportedNumbers(text, allowed)) if (!out.includes(m.raw)) out.push(m.raw);
  return out;
}
