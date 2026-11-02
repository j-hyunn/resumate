import type { AliasMap } from "../context-pack/aliases";
import type { CountBasis } from "@/lib/contracts/enums";
import { buildSelectionScope, type ValidatedEvidence } from "./evidence";

/**
 * S7 document checks shared by AI-03 and AI-04 (pure functions).
 */

// ---------- 스킬명 가드 (AI-03 실패 유형: 키워드 끼워 넣기) ----------

/** Block flag: a tech keyword in the text is not in the user's data. */
export const SKILL_CHECK_NEEDED = "skill_check_needed";

/**
 * Latin-script terms that are generic, not skills (not flagged). [가정] tune
 * with the eval set.
 */
export const GENERIC_LATIN_TERMS: ReadonlySet<string> = new Set(
  [
    "api", "apis", "db", "ui", "ux", "qa", "ci", "cd", "it", "pm", "po", "kpi", "okr", "mvp", "b2b", "b2c", "sla", "slo",
    "ms", "tps", "qps", "rps", "p95", "p99", "kb", "mb", "gb", "tb", "x", "k", "rnd", "r&d", "hr", "faq", "etc", "vs",
  ].map((s) => s.toLowerCase()),
);

const LATIN_TERM = /[A-Za-z][A-Za-z0-9+#]*(?:\.[A-Za-z0-9]+)*/g;

/** Normalized corpus to look terms up in (lowercase, whitespace collapsed). */
export function buildTermCorpus(texts: readonly string[]): string {
  return texts.join("\n").toLowerCase().replace(/\s+/g, " ");
}

/**
 * Latin-script terms (Kafka, Node.js, K8s, C++) in generated text that don't
 * occur anywhere in `corpus` (the user's data the model saw). Korean
 * transliterations aren't caught (rule-based [가정]).
 */
export function findUnknownTechTerms(text: string, corpus: string): string[] {
  const out: string[] = [];
  for (const m of text.matchAll(LATIN_TERM)) {
    const term = m[0].replace(/\.$/, "");
    const key = term.toLowerCase();
    if (key.length < 2 || GENERIC_LATIN_TERMS.has(key) || /^\d/.test(key)) continue;
    if (!corpus.includes(key) && !out.includes(term)) out.push(term);
  }
  return out;
}

// ---------- 본인 주어 + 상황·과제뿐인 근거 (AI-03 실패 유형: 팀 성과를 본인 성과로) ----------

const CONTEXT_ONLY_FIELDS = new Set(["situation", "task"]);

/**
 * True when every career evidence of a claim block is a detail's situation or
 * task (team context), so the user's own contribution isn't backed. JD and
 * reflection evidence are ignored; no career evidence → false (V-4 handles it).
 */
export function isSituationTaskOnly(evidence: readonly ValidatedEvidence[]): boolean {
  const career = evidence.filter((e) => e.source_type !== "jd_sentence" && e.source_type !== "jd_requirement" && e.field !== "learnings");
  return career.length > 0 && career.every((e) => e.source_type === "project_detail" && e.field !== null && CONTEXT_ONLY_FIELDS.has(e.field));
}

// ---------- V-7 범위 (AI-04 sources) ----------

export type SourceScopeItem = {
  projectAlias: string | null;
  /** EXP-n / EDU-n (the project's parent, or the selected experience/education itself). */
  parentAlias: string | null;
  /** Narrows the project's details (AI-04 `detail_refs`); details of other projects are ignored. */
  detailAliases: readonly string[];
};

/**
 * AI-04 V-7 (C-3): each source's project with its details (only `detail_refs`
 * when given), their achievements and the project's skills, plus the parent
 * experience/education itself and its experience-level achievements — but not
 * sibling projects. A source with no project = the whole experience/education.
 * Profile, JD, and notes are always in scope.
 */
export function buildSourceScope(aliases: AliasMap, sources: readonly SourceScopeItem[]): Set<string> {
  const scope = buildSelectionScope(aliases, { refs: [] });
  for (const s of sources) {
    if (s.projectAlias) {
      const details = s.detailAliases.filter((d) => aliases.get(d)?.parents.includes(s.projectAlias as string));
      for (const a of buildSelectionScope(aliases, { refs: [s.projectAlias], detailRefs: details })) scope.add(a);
      if (s.parentAlias) {
        scope.add(s.parentAlias);
        for (const e of aliases.values()) if (e.sourceType === "achievement" && e.parents.includes(s.parentAlias)) scope.add(e.alias);
      }
    } else if (s.parentAlias) {
      for (const a of buildSelectionScope(aliases, { refs: [s.parentAlias] })) scope.add(a);
    }
  }
  return scope;
}

// ---------- 글자 수 (AI-04, 서버가 센다) ----------

/** Paragraphs are joined with one line break when counted (and copied). [가정] */
export const PARAGRAPH_SEPARATOR = "\n";

/**
 * `with_spaces`: every character incl. spaces and line breaks; `without_spaces`:
 * all whitespace removed. Counted in Unicode code points (a Hangul syllable = 1).
 * Placeholder tokens count as written. [가정] (Korean job-site counters vary).
 */
export function countChars(text: string, basis: CountBasis): number {
  const t = basis === "without_spaces" ? text.replace(/\s+/g, "") : text;
  return [...t].length;
}

/** AI-04 글자 수 보정: outside ±10% of the limit → one correction call. */
export const LENGTH_TOLERANCE = 0.1;
/** Target given to the model: 95% of the limit [가정]. */
export const LENGTH_TARGET_RATIO = 0.95;

export function isLengthOutOfRange(count: number, limit: number | null): boolean {
  if (limit === null || limit <= 0) return false;
  return count < limit * (1 - LENGTH_TOLERANCE) || count > limit * (1 + LENGTH_TOLERANCE);
}

export function lengthTarget(limit: number): number {
  return Math.floor(limit * LENGTH_TARGET_RATIO);
}
