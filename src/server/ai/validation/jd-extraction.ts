import type { Ai01Output, RequirementCategory, RequirementImportance } from "../schemas/AI-01";
import { AI01_KEYWORDS_MAX, AI01_OUTPUT_SCHEMA_VERSION } from "../schemas/AI-01";

/**
 * AI-01 server validation (AI spec AI-01 "처리 방식: 서버 검증", S5 plan
 * "계약 — AI" 3). Pure function: the model's output → what may be stored.
 *
 * - every `source_sids` entry must be a sentence id of this JD (C-2); unknown
 *   ids are dropped, and a requirement left with none is dropped (the spec's
 *   "원문에 없는 요건 생성 → source_sids 검증으로 차단");
 * - requirements with the same (normalized) text are merged;
 * - company_name / position_title / seniority / tech_keywords without a valid
 *   sid lose their value; other_sids are filtered the same way;
 * - (v4.15, CF-2·CF-A5) `deadline` runs its own checks 1~5 (see
 *   `validateDeadline`): failing one drops the value only (extraction still
 *   succeeds). An output without the `deadline` key (schema_version 1, stored
 *   before v4.15) is read as "no deadline" — never an error.
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

export type Ai01NormalizedDeadline = {
  /** ISO `YYYY-MM-DD`, a real calendar date. */
  value: string;
  source_sids: string[];
  /**
   * Checks 1~3 passed, and check 4 (기준일 ~ 기준일 + 366일) too, so
   * `apply_jd_extraction` may write `application_projects.deadline` when it is
   * empty. False = keep in `extraction.deadline` only (past / far future).
   */
  usable: boolean;
};

export type Ai01NormalizedOutput = {
  schema_version: typeof AI01_OUTPUT_SCHEMA_VERSION;
  detected_language: string | null;
  is_likely_jd: boolean;
  company_name: { value: string; source_sids: string[] } | null;
  position_title: { value: string; source_sids: string[] } | null;
  seniority: { min_years: number | null; max_years: number | null; label: string; source_sids: string[] } | null;
  /** null = no deadline, or a check 1~3 failure (value dropped). */
  deadline: Ai01NormalizedDeadline | null;
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
  /** `deadline` present but dropped by checks 1~3. */
  deadline_dropped: number;
  /** Checks 1~3 passed but out of the 기준일 ~ +366일 window (check 4). */
  deadline_out_of_range: number;
  tech_keywords_dropped: number;
  tech_keywords_merged: number;
  other_sids_dropped: number;
};

export type JdValidationResult = { value: Ai01NormalizedOutput; report: Ai01ValidationReport };

/** (v4.15, CF-A5) 기준일 + 366일까지만 쓴다 — 연도 오독을 걸러낸다. */
export const DEADLINE_MAX_DAYS_AHEAD = 366;

export type DeadlineCheck = "format" | "sid" | "quote" | "range";

export type DeadlineOutcome =
  | { ok: true; value: string; source_sids: string[]; usable: boolean; failed: "range" | null }
  | { ok: false; failed: Exclude<DeadlineCheck, "range"> };

const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;

/** Check 1: `YYYY-MM-DD` and a real calendar date (2026-02-30 / 2026-13-01 / 0000 fail). */
export function isCalendarDate(value: string): boolean {
  const m = ISO_DATE.exec(value);
  if (!m) return false;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  if (y < 1000 || mo < 1 || mo > 12 || d < 1 || d > 31) return false;
  const date = new Date(Date.UTC(y, mo - 1, d));
  return date.getUTCFullYear() === y && date.getUTCMonth() === mo - 1 && date.getUTCDate() === d;
}

function dayDiff(from: string, to: string): number {
  const a = Date.parse(`${from}T00:00:00Z`);
  const b = Date.parse(`${to}T00:00:00Z`);
  return Math.round((b - a) / 86_400_000);
}

/**
 * Check 3: the cited sentences must spell out year, month and day. The year is
 * 4 digits (`2026`) or 2 digits carrying a dot or apostrophe (`26.`, `'26`,
 * read as 20YY `[가정]`), and must equal the value's year. Month and day are
 * the plain numbers (leading zeros optional). 요일 표기는 보지 않는다(검사 5).
 */
export function deadlineQuoteSupports(value: string, texts: readonly string[]): boolean {
  const m = ISO_DATE.exec(value);
  if (!m) return false;
  const [year, month, day] = [m[1], String(Number(m[2])), String(Number(m[3]))];
  const short = year.slice(2);
  const joined = texts.join(" ");
  const yearOk =
    new RegExp(`(?<!\\d)${year}(?!\\d)`).test(joined) ||
    new RegExp(`(?<![\\d])${short}\\s*[.]`).test(joined) ||
    new RegExp(`['\u2019]\\s*${short}(?!\\d)`).test(joined);
  if (!yearOk) return false;
  const monthOk = new RegExp(`(?<!\\d)0?${month}(?!\\d)`).test(joined);
  const dayOk = new RegExp(`(?<!\\d)0?${day}(?!\\d)`).test(joined);
  return monthOk && dayOk;
}

/**
 * (v4.15, CF-2·CF-A5) `deadline` 검증 1~5. `today` = 추출 기준일(Asia/Seoul,
 * `YYYY-MM-DD`); it is never put in the prompt (AI-01 입력 컨텍스트).
 */
export function validateDeadline(
  raw: { value: string | null; source_sids: readonly string[] } | null | undefined,
  env: { sids: readonly string[]; sentenceText: (sid: string) => string | null; today?: string | null },
): DeadlineOutcome | null {
  if (!raw || !raw.value) return null;
  const value = raw.value.trim();
  if (!isCalendarDate(value)) return { ok: false, failed: "format" };
  if (env.sids.length === 0) return { ok: false, failed: "sid" };
  const texts = env.sids.map((sid) => env.sentenceText(sid)).filter((t): t is string => !!t);
  if (!deadlineQuoteSupports(value, texts)) return { ok: false, failed: "quote" };
  const today = env.today?.trim() || null;
  if (today && isCalendarDate(today)) {
    const diff = dayDiff(today, value);
    if (diff < 0 || diff > DEADLINE_MAX_DAYS_AHEAD) return { ok: true, value, source_sids: [...env.sids], usable: false, failed: "range" };
  }
  return { ok: true, value, source_sids: [...env.sids], usable: true, failed: null };
}

/** Warning shown when the posting's deadline has already passed (AI-01 검증 4). */
export function deadlinePastWarning(value: string): string {
  return `공고의 마감일(${value})이 이미 지났어요`;
}

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

export function validateJdExtraction(
  output: Ai01Output | (Omit<Ai01Output, "schema_version" | "deadline"> & { schema_version: number; deadline?: Ai01Output["deadline"] }),
  sentenceIds: ReadonlySet<string>,
  env: {
    /** sid → sentence text, for the `deadline` quote check (check 3). */
    sentenceText?: (sid: string) => string | null;
    /** 추출 기준일 (Asia/Seoul `YYYY-MM-DD`), check 4. Omitted = range not checked. */
    today?: string | null;
  } = {},
): JdValidationResult {
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
    deadline_dropped: 0,
    deadline_out_of_range: 0,
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

  // (v4.15, CF-2) deadline: sids first (same rule as company_name), then checks 1 / 3 / 4.
  let deadline: Ai01NormalizedDeadline | null = null;
  const deadlineWarnings: string[] = [];
  if (output.deadline && output.deadline.value) {
    const sids = filterSids(output.deadline.source_sids);
    const outcome = validateDeadline(output.deadline, {
      sids,
      sentenceText: env.sentenceText ?? (() => null),
      today: env.today ?? null,
    });
    if (!outcome || !outcome.ok) report.deadline_dropped++;
    else {
      deadline = { value: outcome.value, source_sids: outcome.source_sids, usable: outcome.usable };
      if (!outcome.usable) {
        report.deadline_out_of_range++;
        if (env.today && outcome.value < env.today) deadlineWarnings.push(deadlinePastWarning(outcome.value));
      }
    }
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
  const warnings = [...new Set([...output.warnings.map(cleanText), ...deadlineWarnings].filter(Boolean))];

  return {
    value: {
      schema_version: AI01_OUTPUT_SCHEMA_VERSION,
      detected_language: /^[a-z]{2,3}(?:-[a-z0-9]{2,8})?$/.test(lang) ? lang : null,
      is_likely_jd: output.is_likely_jd,
      company_name,
      position_title,
      seniority,
      deadline,
      requirements,
      tech_keywords,
      other_sids,
      warnings,
    },
    report,
  };
}
