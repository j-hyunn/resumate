import type { RequirementCategory, RequirementImportance } from "../schemas/AI-01";

/**
 * R-31 게이트 진입 대화의 지원 프로젝트 요건 (AI spec AI-12 입력 "지원 프로젝트
 * 요건 (게이트 진입 시에만)"). The server picks at most `max` requirements:
 * every `importance = 'high'` one first, then those whose career evidence
 * looks weak, each group in sort_order. Deterministic (same rows → same list).
 *
 * The list only steers which topic the reply asks about first (PRD F-AP-06 (2));
 * it is never a source: it goes to the reply call only, never to extract, and
 * V-9 checks patches against the user's messages alone.
 */

export const GATE_REQUIREMENTS_MAX = 8;

/** jd_requirements row fields this needs (DM A.7). */
export type GateRequirementRow = {
  id: string;
  category: RequirementCategory;
  content: string;
  keywords: readonly string[];
  importance: RequirementImportance;
  sort_order: number;
};

export type CareerSignals = {
  /** skills.normalized_name (or name when null) of the user's skills. */
  skillNames: readonly string[];
  /** Project / detail texts (name, summary, role, S/T/A/R) of the user's complete career data. */
  texts: readonly string[];
};

export type GateRequirement = {
  id: string;
  category: RequirementCategory;
  content: string;
  importance: RequirementImportance;
  /** Why it was picked: high importance, or weak evidence in the career data. */
  reason: "high" | "weak_evidence";
};

/** Lowercase, NFKC, no spaces or joiners ("Spring Boot" ≡ "spring-boot" ≡ "springboot"). */
export function signalKey(text: string): string {
  return text.normalize("NFKC").toLowerCase().replace(/[\s._\-/·]+/g, "");
}

/**
 * [가정 S5-7] A requirement has weak evidence when none of its keywords matches
 * a skill name exactly or appears inside a project/detail text (both via
 * signalKey). Keywords shorter than 2 characters only match skills exactly
 * ("C" must not match every text with a "c"). A requirement with no keywords
 * has nothing to match, so it counts as weak.
 */
export function hasWeakEvidence(requirement: Pick<GateRequirementRow, "keywords">, signals: PreparedSignals): boolean {
  for (const raw of requirement.keywords) {
    const k = signalKey(raw);
    if (!k) continue;
    if (signals.skills.has(k)) return false;
    if (k.length >= 2 && signals.texts.some((t) => t.includes(k))) return false;
  }
  return true;
}

export type PreparedSignals = { skills: ReadonlySet<string>; texts: readonly string[] };

export function prepareSignals(signals: CareerSignals): PreparedSignals {
  return {
    skills: new Set(signals.skillNames.map(signalKey).filter(Boolean)),
    texts: signals.texts.map(signalKey).filter(Boolean),
  };
}

export function selectGateRequirements(
  requirements: readonly GateRequirementRow[],
  signals: CareerSignals,
  max: number = GATE_REQUIREMENTS_MAX,
): GateRequirement[] {
  if (max <= 0) return [];
  const ordered = [...requirements].sort((a, b) => a.sort_order - b.sort_order || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  const prepared = prepareSignals(signals);
  const picked: GateRequirement[] = [];
  const take = (r: GateRequirementRow, reason: GateRequirement["reason"]) =>
    picked.push({ id: r.id, category: r.category, content: r.content, importance: r.importance, reason });

  for (const r of ordered) {
    if (picked.length >= max) break;
    if (r.importance === "high") take(r, "high");
  }
  for (const r of ordered) {
    if (picked.length >= max) break;
    if (r.importance !== "high" && hasWeakEvidence(r, prepared)) take(r, "weak_evidence");
  }
  // Show in JD order regardless of the group they were picked in.
  const rank = new Map(ordered.map((r, i) => [r.id, i]));
  return picked.sort((a, b) => (rank.get(a.id) ?? 0) - (rank.get(b.id) ?? 0));
}
