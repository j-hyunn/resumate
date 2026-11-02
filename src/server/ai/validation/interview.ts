import {
  CULTURE_SOURCE_KINDS,
  JOB_SOURCE_KINDS,
  type InterviewSourceKind,
  type InterviewType,
  type QuestionCount,
} from "../schemas/interview-common";
import { normalizeForMatch } from "./normalize";

/**
 * Pure rule checks of the interview features (AI spec 4.1, AI-05, C-7, C-9).
 * The pipelines (AI-05/06/07) orchestrate; everything here is table-driven
 * and tested on its own.
 */

// ---------- C-7 forbidden topics ----------

/**
 * C-7 / 4.1: personal matters an interview must not ask about. Rule-based
 * [가정]; tuned to avoid common job words ("장애 대응" is an outage, not a
 * disability; "건강한 코드" is not health). Any hit drops the question.
 */
export const FORBIDDEN_TOPIC_PATTERNS: ReadonlyArray<{ topic: string; pattern: RegExp }> = [
  { topic: "age", pattern: /(나이|몇\s*살|연세|연령대?|생년)/ },
  { topic: "marriage_childbirth", pattern: /(결혼|기혼|미혼|출산|임신|육아\s*계획|자녀\s*계획|아이를?\s*(가질|낳))/ },
  { topic: "family", pattern: /(가족|부모님|배우자|형제|자매|자녀|가정\s*환경)/ },
  { topic: "religion", pattern: /(종교|신앙|교회|성당|사찰|기독교|불교|천주교|이슬람)/ },
  { topic: "origin", pattern: /(출신\s*(지역|지|도시)|고향|어디\s*출신|어느\s*지역\s*출신)/ },
  { topic: "politics", pattern: /(정치|정당|투표|선거|지지하는\s*(후보|정당))/ },
  { topic: "health", pattern: /(건강\s*(상태|문제|이상|검진)|지병|병력|질병|투병|아프신|복용\s*중)/ },
];

/** Forbidden topics found in the texts (distinct, table order). */
export function findForbiddenTopics(...texts: ReadonlyArray<string | null | undefined>): string[] {
  const joined = texts.filter(Boolean).join("\n");
  return FORBIDDEN_TOPIC_PATTERNS.filter((t) => t.pattern.test(joined)).map((t) => t.topic);
}

// ---------- 4.1 culture fit: no user facts unless anchored on experience ----------

/** Normalized career proper nouns (InterviewBase.careerTerms) found in the text. */
export function findCareerTerms(text: string, terms: readonly string[]): string[] {
  const norm = normalizeForMatch(text).text;
  return terms.filter((t) => norm.includes(t));
}

// ---------- C-9 reflection quoted as the user's own ----------

/**
 * C-9 / 4.1: learnings may be the material of a culture `experience` question
 * only as the user's reflection ("~를 배웠다고 정리하셨는데"). [가정] wording
 * markers; tune with the eval set.
 */
export const REFLECTION_CITATION = /(배웠다고|배우셨다고|느꼈다고|느끼셨다고|깨달았다고|깨달으셨다고|정리하셨|적어\s*주셨|적으셨|남기셨|회고하셨|회고에서|돌아보셨|라고\s*(하셨|쓰셨))/;

export function citesReflection(text: string): boolean {
  return REFLECTION_CITATION.test(text);
}

// ---------- 4.1 set composition ----------

export type CompositionRule = {
  /** Allowed source kinds for the type. */
  kinds: readonly InterviewSourceKind[];
  min: Partial<Record<InterviewSourceKind, number>>;
  max: Partial<Record<InterviewSourceKind, number>>;
};

/**
 * 4.1 tables as constants.
 * - job: project_deep_dive ≥ 1/2/3, requirement_fit ≥ 1/1/2, gap_probe = 1 (3문항) / ≥ 1.
 * - culture fit: one question per topic (7문항: a topic at most twice);
 *   motivation_career included at 5 and 7.
 */
export function compositionRule(type: InterviewType, count: QuestionCount): CompositionRule {
  if (type === "job") {
    const pdd = count === 3 ? 1 : count === 5 ? 2 : 3;
    const rf = count === 7 ? 2 : 1;
    return {
      kinds: JOB_SOURCE_KINDS,
      min: { project_deep_dive: pdd, requirement_fit: rf, gap_probe: 1 },
      max: count === 3 ? { gap_probe: 1 } : {},
    };
  }
  const perTopic = count === 7 ? 2 : 1;
  const max: Partial<Record<InterviewSourceKind, number>> = {};
  for (const k of CULTURE_SOURCE_KINDS) max[k] = perTopic;
  return { kinds: CULTURE_SOURCE_KINDS, min: count === 3 ? {} : { motivation_career: 1 }, max };
}

export type CompositionCheck = { ok: true } | { ok: false; reason: "kind_not_allowed" | "kind_over_max" | "blocks_minimum" };

/**
 * Whether accepting one more question of `kind` keeps the set completable:
 * the kind is allowed, stays under its max, and the slots left after it can
 * still cover every unmet minimum. Checking at each acceptance turns the set
 * rule into per-question decisions, so a violating question is dropped and
 * regenerated instead of discarding saved questions.
 */
export function canAccept(rule: CompositionRule, counts: Readonly<Partial<Record<InterviewSourceKind, number>>>, total: number, kind: InterviewSourceKind): CompositionCheck {
  if (!rule.kinds.includes(kind)) return { ok: false, reason: "kind_not_allowed" };
  const next = { ...counts, [kind]: (counts[kind] ?? 0) + 1 };
  const max = rule.max[kind];
  if (max !== undefined && (next[kind] ?? 0) > max) return { ok: false, reason: "kind_over_max" };
  const accepted = Object.values(next).reduce((s, n) => s + (n ?? 0), 0);
  const slotsLeft = total - accepted;
  const needed = Object.entries(rule.min).reduce((s, [k, m]) => s + Math.max(0, (m ?? 0) - (next[k as InterviewSourceKind] ?? 0)), 0);
  if (needed > slotsLeft) return { ok: false, reason: "blocks_minimum" };
  return { ok: true };
}

/** Unmet minima (for the regeneration request and the final warning). */
export function missingKinds(rule: CompositionRule, counts: Readonly<Partial<Record<InterviewSourceKind, number>>>): Partial<Record<InterviewSourceKind, number>> {
  const out: Partial<Record<InterviewSourceKind, number>> = {};
  for (const [k, m] of Object.entries(rule.min)) {
    const gap = (m ?? 0) - (counts[k as InterviewSourceKind] ?? 0);
    if (gap > 0) out[k as InterviewSourceKind] = gap;
  }
  return out;
}

/** Kinds that already reached their max (the regeneration request asks to avoid them). */
export function exhaustedKinds(rule: CompositionRule, counts: Readonly<Partial<Record<InterviewSourceKind, number>>>): InterviewSourceKind[] {
  return rule.kinds.filter((k) => rule.max[k] !== undefined && (counts[k] ?? 0) >= (rule.max[k] ?? Infinity));
}

/** Normalized question text for the "세션 내 중복 0건" check. */
export function questionKey(text: string): string {
  return normalizeForMatch(text).text;
}
