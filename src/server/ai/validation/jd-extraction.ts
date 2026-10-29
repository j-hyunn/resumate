import type { Ai01Output, RequirementCategory, RequirementImportance } from "../schemas/AI-01";
import { AI01_KEYWORDS_MAX } from "../schemas/AI-01";

/**
 * AI-01 server validation (AI spec AI-01 "처리 방식: 서버 검증", S5 plan
 * "계약 — AI" 3). Pure function: the model's output → what may be stored.
 *
 * - every `source_sids` entry must be a sentence id of this JD (C-2); unknown
 *   ids are dropped, and a requirement left with none is dropped (the spec's
 *   "원문에 없는 요건 생성 → source_sids 검증으로 차단");
 * - requirements with the same (normalized) text are merged;
 * - company_name / position_title / seniority / tech_keywords without a valid
 *   sid lose their value; other_sids are filtered the same way.
 *
 * Whether 0 requirements means `not_a_jd` or a schema retry is decided by the
 * pipeline (it needs the call budget). The report holds counts only (C-7).
 */

export type Ai01NormalizedRequirement = {
  category: RequirementCategory;
  text: string;
  keywords: string[];
  importance: RequirementImportance;
  /** ≥ 1, unique, in sentence order. */
  source_sids: string[];
};

export type Ai01NormalizedOutput = {
  schema_version: 1;
  detected_language: string | null;
  is_likely_jd: boolean;
  company_name: { value: string; source_sids: string[] } | null;
  position_title: { value: string; source_sids: string[] } | null;
  seniority: { min_years: number | null; max_years: number | null; label: string; source_sids: string[] } | null;
  requirements: Ai01NormalizedRequirement[];
  tech_keywords: { keyword: string; source_sids: string[] }[];
  other_sids: string[];
  warnings: string[];
};

export type Ai01ValidationReport = {
  requirements_proposed: number;
  requirements_kept: number;
  /** Requirements whose every sid was unknown (or that had none). */
  requirements_dropped_no_sid: number;
  requirements_dropped_empty_text: number;
  requirements_merged: number;
  /** Unknown sid entries removed across all fields. */
  sids_dropped: number;
  company_name_dropped: number;
  position_title_dropped: number;
  seniority_dropped: number;
  tech_keywords_dropped: number;
  tech_keywords_merged: number;
  other_sids_dropped: number;
};

export type JdValidationResult = { value: Ai01NormalizedOutput; report: Ai01ValidationReport };

/** "S-4", "s4", " S04 " → "S4"; anything else → null. */
export function normalizeSid(raw: string): string | null {
  const m = /^\s*[sS]\s*-?\s*0*([1-9][0-9]*)\s*$/.exec(raw);
  return m ? `S${m[1]}` : null;
}

function sidNumber(sid: string): number {
  return Number(sid.slice(1));
}

/** Requirement-text identity for merging: NFKC, case, whitespace, trailing punctuation. */
export function requirementTextKey(text: string): string {
  return text
    .normalize("NFKC")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .replace(/[\s.。·,;:!?…]+$/u, "")
    .trim();
}

function cleanText(text: string): string {
  return text.normalize("NFC").replace(/\s+/g, " ").trim();
}

function mergeKeywords(into: string[], extra: readonly string[]): void {
  const seen = new Set(into.map((k) => k.toLowerCase()));
  for (const raw of extra) {
    const k = cleanText(raw);
    if (!k || seen.has(k.toLowerCase()) || into.length >= AI01_KEYWORDS_MAX) continue;
    seen.add(k.toLowerCase());
    into.push(k);
  }
}

export function validateJdExtraction(output: Ai01Output, sentenceIds: ReadonlySet<string>): JdValidationResult {
  const report: Ai01ValidationReport = {
    requirements_proposed: output.requirements.length,
    requirements_kept: 0,
    requirements_dropped_no_sid: 0,
    requirements_dropped_empty_text: 0,
    requirements_merged: 0,
    sids_dropped: 0,
    company_name_dropped: 0,
    position_title_dropped: 0,
    seniority_dropped: 0,
    tech_keywords_dropped: 0,
    tech_keywords_merged: 0,
    other_sids_dropped: 0,
  };

  /** Known sids only, unique, sorted by sentence number. Counts every removed entry. */
  const filterSids = (raw: readonly string[]): string[] => {
    const out = new Set<string>();
    for (const r of raw) {
      const sid = normalizeSid(r);
      if (sid && sentenceIds.has(sid)) out.add(sid);
      else report.sids_dropped++;
    }
    return [...out].sort((a, b) => sidNumber(a) - sidNumber(b));
  };

  // Requirements: filter sids → drop empty → merge same text (first one keeps its place and category).
  const requirements: Ai01NormalizedRequirement[] = [];
  const byKey = new Map<string, Ai01NormalizedRequirement>();
  for (const r of output.requirements) {
    const sids = filterSids(r.source_sids);
    const text = cleanText(r.text);
    if (!text) {
      report.requirements_dropped_empty_text++;
      continue;
    }
    if (sids.length === 0) {
      report.requirements_dropped_no_sid++;
      continue;
    }
    const key = requirementTextKey(text);
    const existing = byKey.get(key);
    if (existing) {
      report.requirements_merged++;
      existing.source_sids = [...new Set([...existing.source_sids, ...sids])].sort((a, b) => sidNumber(a) - sidNumber(b));
      mergeKeywords(existing.keywords, r.keywords);
      if (r.importance === "high") existing.importance = "high";
      continue;
    }
    const next: Ai01NormalizedRequirement = { category: r.category, text, keywords: [], importance: r.importance, source_sids: sids };
    mergeKeywords(next.keywords, r.keywords);
    byKey.set(key, next);
    requirements.push(next);
  }
  report.requirements_kept = requirements.length;

  const named = (v: Ai01Output["company_name"], counter: "company_name_dropped" | "position_title_dropped") => {
    if (!v) return null;
    const value = cleanText(v.value);
    const sids = filterSids(v.source_sids);
    if (!value || sids.length === 0) {
      report[counter]++;
      return null;
    }
    return { value, source_sids: sids };
  };
  const company_name = named(output.company_name, "company_name_dropped");
  const position_title = named(output.position_title, "position_title_dropped");

  let seniority: Ai01NormalizedOutput["seniority"] = null;
  if (output.seniority) {
    const s = output.seniority;
    const sids = filterSids(s.source_sids);
    const label = cleanText(s.label);
    const rangeOk = s.min_years === null || s.max_years === null || s.min_years <= s.max_years;
    const hasValue = s.min_years !== null || s.max_years !== null || label !== "";
    if (sids.length === 0 || !rangeOk || !hasValue) report.seniority_dropped++;
    else seniority = { min_years: s.min_years, max_years: s.max_years, label, source_sids: sids };
  }

  const tech_keywords: Ai01NormalizedOutput["tech_keywords"] = [];
  const techByKey = new Map<string, { keyword: string; source_sids: string[] }>();
  for (const t of output.tech_keywords) {
    const keyword = cleanText(t.keyword);
    const sids = filterSids(t.source_sids);
    if (!keyword || sids.length === 0) {
      report.tech_keywords_dropped++;
      continue;
    }
    const key = keyword.toLowerCase();
    const existing = techByKey.get(key);
    if (existing) {
      report.tech_keywords_merged++;
      existing.source_sids = [...new Set([...existing.source_sids, ...sids])].sort((a, b) => sidNumber(a) - sidNumber(b));
      continue;
    }
    const entry = { keyword, source_sids: sids };
    techByKey.set(key, entry);
    tech_keywords.push(entry);
  }

  const before = report.sids_dropped;
  const other_sids = filterSids(output.other_sids);
  report.other_sids_dropped = report.sids_dropped - before;

  const lang = output.detected_language?.trim().toLowerCase() ?? "";
  const warnings = [...new Set(output.warnings.map(cleanText).filter(Boolean))];

  return {
    value: {
      schema_version: 1,
      detected_language: /^[a-z]{2,3}(?:-[a-z0-9]{2,8})?$/.test(lang) ? lang : null,
      is_likely_jd: output.is_likely_jd,
      company_name,
      position_title,
      seniority,
      requirements,
      tech_keywords,
      other_sids,
      warnings,
    },
    report,
  };
}
