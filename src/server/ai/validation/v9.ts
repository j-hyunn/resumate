import type {
  AchievementOutput,
  Ai12ExtractOutput,
  ClarificationOutput,
  DetailPatch,
  ProjectPatch,
  SensitiveCategory,
  SkillOutput,
} from "../schemas/AI-12";
import {
  DRAFT_PATCH_MAX_QUOTE_LENGTH,
  emptyDraftChanges,
  hasValue,
  isProtected,
  type AchievementField,
  type AffiliationType,
  type Clarification,
  type DetailField,
  type DraftField,
  type DraftChanges,
  type DraftPatchField,
  type FieldRef,
  type PatchFieldObject,
  type ProjectField,
  type StructuredDraft,
} from "../schemas/structured-draft";
import { normalizeForMatch, originalSpan } from "./normalize";
import { extractNumbers } from "./numbers";
import {
  DELEGATION_PATTERN,
  KOREAN_SUFFIXES,
  NATIVE_COUNTERS,
  NATIVE_COUNT_WORDS,
  NOT_A_NAME,
  ORG_SUFFIXES,
  PERSONAL_ACTOR_PATTERN,
  SENSITIVE_PATTERNS,
  SKILL_DICTIONARY,
  STOPWORDS,
  TEAM_SUBJECT_PATTERN,
  THIRD_PARTY_NAME_PATTERN,
} from "./v9-lexicon";

/**
 * AI-12 V-9 (발화 추적, 날조 0건 장치) — AI spec AI-12 "서버 검증 V-9".
 * Every value the extract call proposes must trace to what the user said:
 *
 * | # | check | on failure |
 * |---|-------|------------|
 * | V-9a | sources are this chat's `role = 'user'` messages | reject |
 * | V-9b | each quote is a substring of a cited message (normalized) | reject |
 * | V-9c | every number (with unit) / month in the value is in the quotes | reject |
 * | V-9d | English tokens, dictionary skills, company names are in the cited messages | reject |
 * | V-9e | ≤ 40% of the value's content words are missing from the quotes | needs_review |
 * | V-9f | `action` whose subject is the team | actor_ambiguous + situation candidate |
 * | V-9g | sensitive information | reject + sensitive count |
 * | V-9h | augment: target column already filled / unknown DET-n | reject (RPC enforces too) |
 *
 * Pure functions only. Results carry counts and field paths, never text (C-7).
 */

/** [가정] AI-12 V-9e: share of content words missing from the quotes above which a value needs review. */
export const V9E_MAX_UNCOVERED_RATIO = 0.4;

/** Length limits from the target columns (DM 2.3); name/role have no DB limit, 100 is [가정]. */
export const FIELD_MAX_LENGTH: Readonly<Record<string, number>> = {
  name: 100,
  role: 100,
  summary: 200,
  title: 100,
  situation: 2000,
  task: 2000,
  action: 2000,
  result: 2000,
  learnings: 2000,
  metric_name: 200,
  unit: 50,
  skill: 50,
};

/** team_size is a smallint; anything outside this range is not a team. */
export const TEAM_SIZE_MAX = 10_000;

export type V9Check =
  | "V-9a"
  | "V-9a.delegation"
  | "V-9b"
  | "V-9c"
  | "V-9d"
  | "V-9g"
  | "V-9h"
  | "protected"
  | "target"
  | "type"
  | "length"
  | "ref"
  | "declined";

export const V9_CHECKS: readonly V9Check[] = [
  "V-9a",
  "V-9a.delegation",
  "V-9b",
  "V-9c",
  "V-9d",
  "V-9g",
  "V-9h",
  "protected",
  "target",
  "type",
  "length",
  "ref",
  "declined",
];

export type V9Report = {
  /** Patch items the model proposed (fields, achievements, skills, affiliation). */
  proposed: number;
  /** Items in the outgoing patch. */
  applied: number;
  /** Applied fields marked needs_review (V-9e, V-9f candidates). */
  needs_review: number;
  rejected: number;
  /** Rejections by check. */
  by_check: Record<V9Check, number>;
  /** V-9f actions moved out of `action`. */
  actor_ambiguous: number;
  sensitive_added: number;
  /** Same value already in the draft (no-op). */
  unchanged: number;
};

export type V9Rejection = { check: V9Check; target: string };

export type V9Message = {
  alias: string;
  id: string;
  role: "user" | "assistant";
  sequence: number;
  content: string;
};

export type V9Context = {
  mode: "new_project" | "augment_project";
  /** Messages in this call (status = 'done'), keyed by alias (`M{sequence}`). */
  messages: ReadonlyMap<string, V9Message>;
  /** User messages this extract is for (sequence > last_extracted_sequence). Sensitive counts only count these. */
  pendingAliases: ReadonlySet<string>;
  /** augment_project: target project id and its already filled columns (V-9h). */
  existingProject: { id: string; filled: ReadonlySet<ProjectField> } | null;
  /** augment_project: DET-n → existing detail id and its filled columns (V-9h). */
  existingDetails: ReadonlyMap<string, { id: string; filled: ReadonlySet<DetailField> }>;
  /** EXP-n / EDU-n → candidate. */
  candidates: ReadonlyMap<string, { type: AffiliationType; id: string; names: readonly string[] }>;
  draft: StructuredDraft;
  /** writing_chats.experience_id / education_id already set (suggestions are then pointless). */
  affiliationConfirmed: boolean;
  /** Candidate ids the user declined ([아니요]) in this chat, if the runner knows them. Never re-suggested. */
  declinedAffiliationIds: ReadonlySet<string>;
};

export type V9Result = {
  /** Validated changes (UUIDs); `toDraftPatch` makes the RPC ops. */
  changes: DraftChanges;
  flags: { needsReview: FieldRef[]; actorAmbiguous: FieldRef[]; sensitiveAdded: number };
  report: V9Report;
  rejections: V9Rejection[];
};

// ---------------------------------------------------------------------------
// Individual checks (exported for table tests)
// ---------------------------------------------------------------------------

/** Accepts the alias as the model wrote it: "M3", "M-3", "m3". */
export function normalizeMessageAlias(raw: string): string {
  const m = /^\s*m-?(\d+)\s*$/i.exec(raw);
  return m ? `M${Number(m[1])}` : raw.trim();
}

/** V-9a: every source is a user message of this chat; at least one source. */
export function checkSources(
  ids: readonly string[],
  messages: ReadonlyMap<string, V9Message>,
): { ok: true; sources: V9Message[] } | { ok: false; check: "V-9a" | "V-9a.delegation" } {
  if (ids.length === 0) return { ok: false, check: "V-9a" };
  const sources: V9Message[] = [];
  for (const raw of ids) {
    const msg = messages.get(normalizeMessageAlias(raw));
    if (!msg || msg.role !== "user") return { ok: false, check: "V-9a" };
    if (!sources.includes(msg)) sources.push(msg);
  }
  // "알아서 채워 줘" messages are requests, not facts (AI-12 가드레일).
  if (sources.every((s) => isDelegationRequest(s.content))) return { ok: false, check: "V-9a.delegation" };
  return { ok: true, sources };
}

export function isDelegationRequest(text: string): boolean {
  return DELEGATION_PATTERN.test(text);
}

/**
 * V-9b: each quote is a substring of one cited message after whitespace and
 * punctuation normalization (no partial match, unlike V-3). Returns the
 * exact original spans so storage never keeps the model's re-typed text.
 */
export function checkQuotes(
  quotes: readonly string[],
  sources: readonly V9Message[],
): { ok: true; quotes: string[] } | { ok: false } {
  if (quotes.length === 0) return { ok: false };
  const out: string[] = [];
  for (const quote of quotes) {
    const q = normalizeForMatch(quote);
    if (q.text.length === 0) return { ok: false };
    let span: string | null = null;
    for (const src of sources) {
      const s = normalizeForMatch(src.content);
      const at = s.text.indexOf(q.text);
      if (at >= 0) {
        span = originalSpan(src.content, s, at, at + q.text.length);
        break;
      }
    }
    if (span === null || span.length > DRAFT_PATCH_MAX_QUOTE_LENGTH) return { ok: false };
    if (!out.includes(span)) out.push(span);
  }
  return { ok: true, quotes: out };
}

type QuoteNumber = { value: string; unit: string };

const MULTIPLIER_UNITS = new Set(["천", "만", "억", "조"]);
const UNIT_SYNONYMS: Record<string, string> = { 퍼센트: "%", 프로: "%" };

function unitOf(raw: string): string {
  const unit = raw.replace(/^[\d,.]+/, "").trim().toLowerCase();
  return UNIT_SYNONYMS[unit] ?? unit;
}

function canonicalNumber(n: number): string {
  return String(Math.round(n * 1e6) / 1e6);
}

/** Numbers stated in the quotes, with units; includes "23년" → 2023 and native counts ("네 명" → 4명). */
export function quoteNumbers(quotes: readonly string[]): QuoteNumber[] {
  const out: QuoteNumber[] = [];
  for (const quote of quotes) {
    for (const m of extractNumbers(quote)) {
      const unit = unitOf(m.raw);
      const plainUnit = MULTIPLIER_UNITS.has(unit) ? "" : unit;
      for (const v of m.sourceValues) out.push({ value: v, unit: plainUnit });
      const n = Number(m.value);
      if (unit === "년" && n < 100) {
        out.push({ value: canonicalNumber(2000 + n), unit: "년" }, { value: canonicalNumber(1900 + n), unit: "년" });
      }
    }
    const native = new RegExp(`(?:^|[^가-힣])(${Object.keys(NATIVE_COUNT_WORDS).sort((a, b) => b.length - a.length).join("|")})\\s?(${NATIVE_COUNTERS})`, "g");
    let match: RegExpExecArray | null;
    while ((match = native.exec(quote)) !== null) {
      out.push({ value: canonicalNumber(NATIVE_COUNT_WORDS[match[1]]), unit: match[2] });
    }
  }
  return out;
}

/** "2023년 3월", "23년 3월", "2023.03", "2023-3", "2023/03" → "2023-03". */
export function quoteMonths(quotes: readonly string[]): Set<string> {
  const out = new Set<string>();
  const add = (y: string, m: string) => {
    let year = Number(y);
    if (y.length === 2) year += year >= 70 ? 1900 : 2000;
    const month = Number(m);
    if (month >= 1 && month <= 12) out.add(`${year}-${String(month).padStart(2, "0")}`);
  };
  for (const quote of quotes) {
    for (const m of quote.matchAll(/(?<!\d)(\d{4}|\d{2})\s*년\s*(\d{1,2})\s*월/g)) add(m[1], m[2]);
    for (const m of quote.matchAll(/(?<!\d)(\d{4})\s*[.\-/]\s*(\d{1,2})(?![\d.])/g)) add(m[1], m[2]);
  }
  return out;
}

const MONTH_VALUE = /^(\d{4})-(0[1-9]|1[0-2])$/;

/**
 * V-9c for text values: every number in the value (with its unit) is stated
 * with the same value in the quotes. A unit only fails when every same-value
 * quote number carries a different unit ("30%" vs "30명").
 */
export function checkTextNumbers(value: string, quotes: readonly string[]): boolean {
  const mentions = extractNumbers(value);
  if (mentions.length === 0) return true;
  const allowed = quoteNumbers(quotes);
  return mentions.every((m) => {
    const unit = unitOf(m.raw);
    const same = allowed.filter((q) => q.value === m.value || m.sourceValues.includes(q.value));
    if (same.length === 0) return false;
    if (unit === "" || MULTIPLIER_UNITS.has(unit)) return true;
    return same.some((q) => q.unit === "" || q.unit === unit);
  });
}

/** V-9c for numeric fields (team_size, value_before, value_after). */
export function checkNumberValue(value: number, quotes: readonly string[], allowedUnits?: readonly string[]): boolean {
  const target = canonicalNumber(value);
  return quoteNumbers(quotes).some(
    (q) => q.value === target && (!allowedUnits || q.unit === "" || allowedUnits.includes(q.unit)),
  );
}

/** V-9c for start_month / end_month: the quotes state that year and month. */
export function checkMonthValue(value: string, quotes: readonly string[]): boolean {
  return MONTH_VALUE.test(value) && quoteMonths(quotes).has(value);
}

const LATIN_TOKEN = /[A-Za-z][A-Za-z0-9]*(?:[.+#\-_/][A-Za-z0-9]+)*[+#]*/g;
const ASCII_UNIT_TOKENS = new Set(["ms", "s", "m", "h", "x", "k", "kb", "mb", "gb", "tb", "tps", "qps", "rps", "rpm"]);

function norm(text: string): string {
  return normalizeForMatch(text).text;
}

function dictionaryEntryFor(normalizedToken: string): readonly string[] | null {
  for (const entry of SKILL_DICTIONARY) if (entry.some((v) => norm(v) === normalizedToken)) return entry;
  return null;
}

function entryInText(entry: readonly string[], normalizedText: string): boolean {
  return entry.some((v) => normalizedText.includes(norm(v)));
}

/** Strips one trailing particle / ending (first match in KOREAN_SUFFIXES order; ≥ 2 chars kept). */
export function stripKoreanSuffix(word: string): string {
  const suffix = KOREAN_SUFFIXES.find((s) => word.endsWith(s) && word.length - s.length >= 2);
  return suffix ? word.slice(0, -suffix.length) : word;
}

function words(text: string): string[] {
  return text
    .normalize("NFKC")
    .split(/[\s,.!?;:·…()\[\]{}"'“”‘’「」『』<>/~\-—–]+/)
    .filter((w) => w.length > 0);
}

/**
 * V-9d: names in the value must appear in the cited messages (case-insensitive):
 * English tokens, skill dictionary words (any spelling of the same entry),
 * and company / product names (Korean words ending in ORG_SUFFIXES).
 * Returns the failing kinds (empty = pass).
 */
export function findUnsupportedNames(value: string, sourceTexts: readonly string[]): string[] {
  const source = norm(sourceTexts.join("\n"));
  const failures: string[] = [];
  for (const match of value.matchAll(LATIN_TOKEN)) {
    const raw = match[0];
    const before = value[match.index! - 1] ?? "";
    if (/\d/.test(before) && ASCII_UNIT_TOKENS.has(raw.toLowerCase())) continue; // 120ms, 3x
    const token = norm(raw);
    if (token.length < 2) continue;
    const entry = dictionaryEntryFor(token);
    if (entry ? !entryInText(entry, source) : !source.includes(token)) failures.push("latin");
  }
  const normalizedValue = norm(value);
  for (const entry of SKILL_DICTIONARY) {
    const korean = entry.filter((v) => /[가-힣]/.test(v));
    if (korean.some((v) => normalizedValue.includes(norm(v))) && !entryInText(entry, source)) failures.push("skill");
  }
  for (const word of words(value)) {
    const stem = stripKoreanSuffix(word);
    const suffix = ORG_SUFFIXES.find((s) => stem.endsWith(s) && stem.length > s.length);
    if (suffix && /^[가-힣]+$/.test(stem) && !source.includes(norm(stem))) failures.push("org");
  }
  return failures;
}

/** V-9e content words: suffix-stripped words of ≥ 2 chars, minus stopwords. */
export function contentWords(text: string): string[] {
  const out: string[] = [];
  for (const word of words(text)) {
    const stem = norm(stripKoreanSuffix(word));
    if (stem.length < 2 || STOPWORDS.has(stem) || /^\d+$/.test(stem)) continue;
    out.push(stem);
  }
  return out;
}

/**
 * V-9e: share of the value's content words not found in the quotes. A word
 * counts as found when it, or it minus one edge syllable (재설계 ↔ 설계), is
 * in the normalized quotes — summaries and re-wordings pass, new claims don't.
 */
export function uncoveredRatio(value: string, quotes: readonly string[]): number {
  const tokens = contentWords(value);
  if (tokens.length === 0) return 0;
  const q = norm(quotes.join("\n"));
  const missing = tokens.filter((t) => {
    if (q.includes(t)) return false;
    if (t.length >= 3 && (q.includes(t.slice(1)) || q.includes(t.slice(0, -1)))) return false;
    return true;
  });
  return missing.length / tokens.length;
}

/**
 * V-9f: the subject of an `action` is the team ("우리 팀이", "저희가") and the
 * quotes never say what the user personally did ("제가", "직접").
 */
export function isActorAmbiguous(value: string, quotes: readonly string[]): boolean {
  const teamSubject = TEAM_SUBJECT_PATTERN.test(value) || quotes.some((q) => TEAM_SUBJECT_PATTERN.test(q));
  if (!teamSubject) return false;
  return !quotes.some((q) => PERSONAL_ACTOR_PATTERN.test(q)) && !PERSONAL_ACTOR_PATTERN.test(value);
}

/** V-9g: sensitive categories found in a text (NFR-PRV-05). */
export function detectSensitive(text: string): SensitiveCategory[] {
  const found: SensitiveCategory[] = [];
  for (const [category, pattern] of Object.entries(SENSITIVE_PATTERNS) as [SensitiveCategory, RegExp][]) {
    if (pattern.test(text)) found.push(category);
  }
  for (const match of text.matchAll(THIRD_PARTY_NAME_PATTERN)) {
    // "정산팀 팀장": a team name, not a person.
    if (!NOT_A_NAME.has(match[1]) && !match[1].endsWith("팀")) {
      found.push("third_party_name");
      break;
    }
  }
  return found;
}

// ---------------------------------------------------------------------------
// Whole-output validation
// ---------------------------------------------------------------------------

type ClaimKind = "text" | "month" | "team_size" | "number";

type ClaimOk = { ok: true; sourceIds: string[]; quotes: string[]; review: "ok" | "needs_review" };
type ClaimFail = { ok: false; check: V9Check; sensitive?: { aliases: string[]; categories: SensitiveCategory[] } };

/**
 * Runs V-9a → V-9b → V-9g → V-9c → V-9d → V-9e on one value.
 * `nameCheck` is off for numeric values.
 */
function checkClaim(
  value: string | number,
  kind: ClaimKind,
  rawIds: readonly string[],
  rawQuotes: readonly string[],
  ctx: V9Context,
  options: { overlap?: boolean; units?: readonly string[] } = {},
): ClaimOk | ClaimFail {
  const a = checkSources(rawIds, ctx.messages);
  if (!a.ok) return { ok: false, check: a.check };
  const b = checkQuotes(rawQuotes, a.sources);
  if (!b.ok) return { ok: false, check: "V-9b" };
  const text = String(value);
  const sensitive = [...detectSensitive(text), ...b.quotes.flatMap(detectSensitive)];
  if (sensitive.length > 0) {
    return { ok: false, check: "V-9g", sensitive: { aliases: a.sources.map((s) => s.alias), categories: [...new Set(sensitive)] } };
  }
  const numbersOk =
    kind === "month"
      ? checkMonthValue(text, b.quotes)
      : kind === "team_size"
        ? checkNumberValue(Number(value), b.quotes, ["명", "인"])
        : kind === "number"
          ? checkNumberValue(Number(value), b.quotes, options.units)
          : checkTextNumbers(text, b.quotes);
  if (!numbersOk) return { ok: false, check: "V-9c" };
  if (kind === "text" && findUnsupportedNames(text, a.sources.map((s) => s.content)).length > 0) {
    return { ok: false, check: "V-9d" };
  }
  const review =
    kind === "text" && options.overlap !== false && uncoveredRatio(text, b.quotes) > V9E_MAX_UNCOVERED_RATIO
      ? "needs_review"
      : "ok";
  return { ok: true, sourceIds: a.sources.map((s) => s.id), quotes: b.quotes, review };
}

type DetailTarget = { detail_key: string | null; existing_detail_id: string | null; label: string };

const DETAIL_KEY = /^D\d{1,3}$/;

function fieldKey(target: "project" | "detail", t: DetailTarget | null, field: string): string {
  return `${target}|${t?.detail_key ?? ""}|${t?.existing_detail_id ?? ""}|${field}`;
}

function sameTarget(a: { detail_key: string | null; existing_detail_id: string | null }, b: DetailTarget): boolean {
  return b.existing_detail_id ? a.existing_detail_id === b.existing_detail_id : a.existing_detail_id === null && a.detail_key === b.detail_key;
}

function clarKey(c: Clarification): string {
  return `${c.kind}|${c.field ?? ""}|${c.detail_key ?? ""}|${c.existing_detail_id ?? ""}`;
}

export function validateExtractOutput(output: Ai12ExtractOutput, ctx: V9Context): V9Result {
  const patch = emptyDraftChanges();
  const rejections: V9Rejection[] = [];
  const byCheck = Object.fromEntries(V9_CHECKS.map((c) => [c, 0])) as Record<V9Check, number>;
  const report: V9Report = {
    proposed: 0,
    applied: 0,
    needs_review: 0,
    rejected: 0,
    by_check: byCheck,
    actor_ambiguous: 0,
    sensitive_added: 0,
    unchanged: 0,
  };
  const needsReview: FieldRef[] = [];
  const actorAmbiguous: FieldRef[] = [];
  const newClarifications: Clarification[] = [];
  const sensitiveKeys = new Set<string>();
  /** Field objects in this patch, keyed by target + field (later set wins, append merges). */
  const fieldIndex = new Map<string, DraftPatchField>();
  const knownDetailKeys = new Set(ctx.draft.details.filter((d) => d.existing_detail_id === null && d.detail_key).map((d) => d.detail_key!));

  const reject = (check: V9Check, target: string, sensitive?: ClaimFail["sensitive"]) => {
    report.rejected++;
    byCheck[check]++;
    rejections.push({ check, target });
    if (sensitive) for (const alias of sensitive.aliases) for (const c of sensitive.categories) countSensitive(alias, c);
  };
  const countSensitive = (alias: string, category: SensitiveCategory) => {
    if (ctx.pendingAliases.has(alias)) sensitiveKeys.add(`${alias}|${category}`);
  };

  const ensureDetailKey = (key: string) => {
    if (!knownDetailKeys.has(key)) {
      knownDetailKeys.add(key);
      patch.new_details.push({ detail_key: key });
    }
  };

  const resolveDetail = (detailKey: string | null, detailRef: string | null): DetailTarget | { error: V9Check } => {
    if ((detailKey === null) === (detailRef === null)) return { error: "target" };
    if (detailRef !== null) {
      const existing = ctx.existingDetails.get(detailRef.trim());
      if (ctx.mode !== "augment_project" || !existing) return { error: "V-9h" };
      return { detail_key: null, existing_detail_id: existing.id, label: detailRef.trim() };
    }
    const key = detailKey!.trim().toUpperCase();
    if (!DETAIL_KEY.test(key)) return { error: "target" };
    return { detail_key: key, existing_detail_id: null, label: key };
  };

  const draftFieldOf = (target: "project" | "detail", t: DetailTarget | null, field: string): DraftField | undefined => {
    if (target === "project") return ctx.draft.project[field as ProjectField];
    const detail = ctx.draft.details.find((d) => sameTarget(d, t!));
    return detail?.fields[field as DetailField];
  };

  const existingFilled = (target: "project" | "detail", t: DetailTarget | null, field: string): boolean => {
    if (ctx.mode !== "augment_project") return false;
    if (target === "project") return !!ctx.existingProject?.filled.has(field as ProjectField);
    if (!t?.existing_detail_id) return false;
    for (const d of ctx.existingDetails.values()) if (d.id === t.existing_detail_id) return d.filled.has(field as DetailField);
    return false;
  };

  /** Puts one validated field into the patch, merging `append` with the current value. */
  const putField = (
    target: "project" | "detail",
    t: DetailTarget | null,
    field: ProjectField | DetailField,
    op: "set" | "append",
    value: string | number,
    claim: ClaimOk,
    path: string,
  ): boolean => {
    const key = fieldKey(target, t, field);
    const pending = fieldIndex.get(key);
    const current = draftFieldOf(target, t, field);
    let next: PatchFieldObject = { value, source_message_ids: claim.sourceIds, source_quotes: claim.quotes, review: claim.review };
    const base = pending ?? (hasValue(current) ? current : undefined);
    if (op === "append" && base && typeof value === "string" && base.value !== null) {
      const merged = `${String(base.value)} ${value}`;
      const max = FIELD_MAX_LENGTH[field];
      if (max && merged.length > max) {
        reject("length", path);
        return false;
      }
      next = {
        value: merged,
        source_message_ids: [...new Set([...base.source_message_ids, ...claim.sourceIds])],
        source_quotes: [...new Set([...base.source_quotes, ...claim.quotes])],
        review: base.review === "needs_review" || claim.review === "needs_review" ? "needs_review" : "ok",
      };
    } else if (!pending && current && current.value === value) {
      report.unchanged++;
      return false;
    }
    const entry: DraftPatchField = {
      target,
      detail_key: t?.detail_key ?? null,
      existing_detail_id: t?.existing_detail_id ?? null,
      field,
      ...next,
    };
    if (target === "detail" && t?.detail_key) ensureDetailKey(t.detail_key);
    fieldIndex.set(key, entry);
    return true;
  };

  // 1. new_details: creating a detail is not a claim; keys only.
  for (const nd of output.new_details) {
    const key = nd.detail_key.trim().toUpperCase();
    if (DETAIL_KEY.test(key)) ensureDetailKey(key);
  }

  // 2. project_patches
  for (const p of output.project_patches) {
    report.proposed++;
    const path = `project.${p.field}`;
    const result = checkProjectPatch(p, ctx);
    if ("check" in result) {
      reject(result.check, path, result.sensitive);
      continue;
    }
    if (isProtected(ctx.draft.project[p.field])) {
      reject("protected", path);
      continue;
    }
    putField("project", null, p.field, p.op, result.value, result.claim, path);
  }

  // 3. detail_patches
  for (const d of output.detail_patches) {
    report.proposed++;
    const target = resolveDetail(d.detail_key, d.detail_ref);
    if ("error" in target) {
      reject(target.error, `detail.?.${d.field}`);
      continue;
    }
    const path = `detail.${target.label}.${d.field}`;
    if (existingFilled("detail", target, d.field)) {
      reject("V-9h", path);
      continue;
    }
    if (isProtected(draftFieldOf("detail", target, d.field))) {
      reject("protected", path);
      continue;
    }
    const value = d.value.trim();
    if (value.length === 0) {
      reject("type", path);
      continue;
    }
    if (value.length > (FIELD_MAX_LENGTH[d.field] ?? 2000)) {
      reject("length", path);
      continue;
    }
    const claim = checkClaim(value, "text", d.source_message_ids, d.source_quotes, ctx);
    if (!claim.ok) {
      reject(claim.check, path, claim.sensitive);
      continue;
    }
    if (d.field === "action" && isActorAmbiguous(value, claim.quotes)) {
      // V-9f: not the user's own action — ask again, keep it only as a situation candidate.
      report.actor_ambiguous++;
      const ref: FieldRef = { target: "detail", detail_key: target.detail_key, existing_detail_id: target.existing_detail_id, field: "action" };
      actorAmbiguous.push(ref);
      newClarifications.push({ kind: "actor_ambiguous", field: "action", detail_key: target.detail_key, existing_detail_id: target.existing_detail_id });
      const situationTaken =
        hasValue(draftFieldOf("detail", target, "situation")) ||
        fieldIndex.has(fieldKey("detail", target, "situation")) ||
        existingFilled("detail", target, "situation") ||
        output.detail_patches.some((o) => o !== d && o.field === "situation" && sameOutputTarget(o, d));
      if (!situationTaken && value.length <= FIELD_MAX_LENGTH.situation) {
        putField("detail", target, "situation", "set", value, { ...claim, review: "needs_review" }, `detail.${target.label}.situation`);
      }
      continue;
    }
    putField("detail", target, d.field, d.op, value, claim, path);
  }

  // 4. achievements (4 fields all V-9c; one bad field rejects the achievement)
  for (const [i, a] of output.achievements.entries()) {
    report.proposed++;
    const target = resolveDetail(a.detail_key, a.detail_ref);
    const path = `achievement.${"error" in target ? "?" : target.label}.${i}`;
    if ("error" in target) {
      reject(target.error, path);
      continue;
    }
    const result = checkAchievement(a, ctx);
    if ("check" in result) {
      reject(result.check, path, result.sensitive);
      continue;
    }
    if (isDuplicateAchievement(ctx.draft, target, result.fields)) {
      report.unchanged++;
      continue;
    }
    if (target.detail_key) ensureDetailKey(target.detail_key);
    patch.achievements.push({ detail_key: target.detail_key, existing_detail_id: target.existing_detail_id, fields: result.fields });
  }

  // 5. skills
  const knownSkills = new Set(ctx.draft.skills.map((s) => norm(s.value)));
  for (const [i, s] of output.skills.entries()) {
    report.proposed++;
    const path = `skill.${i}`;
    const result = checkSkill(s, ctx);
    if ("check" in result) {
      reject(result.check, path, result.sensitive);
      continue;
    }
    const key = norm(result.value);
    if (knownSkills.has(key)) {
      report.unchanged++;
      continue;
    }
    knownSkills.add(key);
    patch.skills.push({ value: result.value, source_message_ids: result.claim.sourceIds, source_quotes: result.claim.quotes });
  }

  // 6. affiliation suggestion (new_project only, and only while nothing is confirmed)
  if (output.affiliation_suggestion) {
    const s = output.affiliation_suggestion;
    if (ctx.mode === "new_project" && !ctx.affiliationConfirmed) {
      report.proposed++;
      const candidate = ctx.candidates.get(s.ref.trim());
      if (!candidate || candidate.type !== s.type) {
        reject("ref", "affiliation");
      } else {
        const a = checkSources(s.source_message_ids, ctx.messages);
        const b = a.ok ? checkQuotes(s.source_quotes, a.sources) : null;
        if (!a.ok) reject(a.check, "affiliation");
        else if (!b || !b.ok) reject("V-9b", "affiliation");
        else if (!candidateNamed(candidate.names, a.sources.map((m) => m.content))) reject("V-9d", "affiliation");
        // Don't repeat a declined suggestion: never for a known decline, and only from a new user message
        // (an old mention, already turned into a suggestion the user may have dismissed, can't bring it back).
        else if (ctx.declinedAffiliationIds.has(candidate.id) || !a.sources.some((m) => ctx.pendingAliases.has(m.alias))) {
          reject("declined", "affiliation");
        }
        else if (ctx.draft.affiliation_suggestion?.id !== candidate.id) {
          patch.affiliation_suggestion = { type: candidate.type, id: candidate.id, source_message_ids: a.sources.map((m) => m.id) };
        } else report.unchanged++;
      }
    }
  }

  // 7. clarifications: keep unresolved old ones, add new ones (model + V-9f).
  for (const c of output.clarifications) {
    const mapped = mapClarification(c, ctx);
    if (mapped) newClarifications.push(mapped);
  }
  const applied = [...fieldIndex.values()];
  const resolved = (c: Clarification): boolean => {
    const okField = (target: "project" | "detail", field: string) =>
      applied.some(
        (f) =>
          f.target === target &&
          f.field === field &&
          f.review === "ok" &&
          (target === "project" || (f.detail_key === c.detail_key && f.existing_detail_id === c.existing_detail_id)),
      );
    switch (c.kind) {
      case "actor_ambiguous":
        return okField("detail", c.field ?? "action");
      case "number_vague":
        return patch.achievements.some((a) => a.detail_key === c.detail_key && a.existing_detail_id === c.existing_detail_id);
      case "period_unclear":
        return okField("project", c.field === "end_month" ? "end_month" : "start_month");
      case "affiliation_unclear":
        return patch.affiliation_suggestion !== null || ctx.affiliationConfirmed;
    }
  };
  const nextClarifications: Clarification[] = [];
  const seen = new Set<string>();
  for (const c of ctx.draft.clarifications) {
    if (resolved(c) || seen.has(clarKey(c))) continue;
    seen.add(clarKey(c));
    nextClarifications.push(c);
  }
  for (const c of newClarifications) {
    if (seen.has(clarKey(c))) continue;
    seen.add(clarKey(c));
    nextClarifications.push(c);
  }
  const before = ctx.draft.clarifications.map(clarKey).join("\n");
  if (nextClarifications.map(clarKey).join("\n") !== before) patch.clarifications = nextClarifications;

  // 8. sensitive flags: model flags on this turn's user messages + server detections (V-9g rejections).
  for (const f of output.sensitive_flags) {
    const msg = ctx.messages.get(normalizeMessageAlias(f.message_id));
    if (msg && msg.role === "user") countSensitive(msg.alias, f.category);
  }
  patch.sensitive_flags_add = sensitiveKeys.size;
  report.sensitive_added = sensitiveKeys.size;

  patch.fields = applied;
  for (const f of applied) {
    if (f.review === "needs_review") {
      report.needs_review++;
      needsReview.push({ target: f.target, detail_key: f.detail_key, existing_detail_id: f.existing_detail_id, field: f.field });
    }
  }
  for (const a of patch.achievements) {
    for (const [field, obj] of Object.entries(a.fields)) {
      if (obj?.review === "needs_review") {
        report.needs_review++;
        needsReview.push({ target: "achievement", detail_key: a.detail_key, existing_detail_id: a.existing_detail_id, field });
      }
    }
  }
  report.applied = applied.length + patch.achievements.length + patch.skills.length + (patch.affiliation_suggestion ? 1 : 0);

  return {
    changes: patch,
    flags: { needsReview, actorAmbiguous, sensitiveAdded: patch.sensitive_flags_add },
    report,
    rejections,
  };
}

function sameOutputTarget(a: DetailPatch, b: DetailPatch): boolean {
  return (a.detail_key ?? null) === (b.detail_key ?? null) && (a.detail_ref ?? null) === (b.detail_ref ?? null);
}

function checkProjectPatch(
  p: ProjectPatch,
  ctx: V9Context,
): { value: string | number; claim: ClaimOk } | { check: V9Check; sensitive?: ClaimFail["sensitive"] } {
  if (ctx.mode === "augment_project" && ctx.existingProject?.filled.has(p.field)) return { check: "V-9h" };
  let value: string | number;
  let kind: ClaimKind;
  if (p.field === "team_size") {
    const n = typeof p.value === "number" ? p.value : /^\s*\d+\s*$/.test(p.value) ? Number(p.value) : NaN;
    if (!Number.isInteger(n) || n < 1 || n > TEAM_SIZE_MAX) return { check: "type" };
    if (p.op !== "set") return { check: "type" };
    value = n;
    kind = "team_size";
  } else if (p.field === "start_month" || p.field === "end_month") {
    const v = String(p.value).trim();
    if (!MONTH_VALUE.test(v) || p.op !== "set") return { check: "type" };
    value = v;
    kind = "month";
  } else {
    if (typeof p.value !== "string" || p.value.trim().length === 0) return { check: "type" };
    value = p.value.trim();
    if (value.length > FIELD_MAX_LENGTH[p.field]) return { check: "length" };
    kind = "text";
  }
  const claim = checkClaim(value, kind, p.source_message_ids, p.source_quotes, ctx);
  if (!claim.ok) return { check: claim.check, sensitive: claim.sensitive };
  return { value, claim };
}

function checkAchievement(
  a: AchievementOutput,
  ctx: V9Context,
): { fields: Partial<Record<AchievementField, PatchFieldObject>> } | { check: V9Check; sensitive?: ClaimFail["sensitive"] } {
  if (a.value_before === null && a.value_after === null) return { check: "type" };
  const fields: Partial<Record<AchievementField, PatchFieldObject>> = {};
  const parts: [AchievementField, string | number, ClaimKind][] = [];
  if (a.metric_name !== null && a.metric_name.trim()) parts.push(["metric_name", a.metric_name.trim(), "text"]);
  if (a.value_before !== null) parts.push(["value_before", a.value_before, "number"]);
  if (a.value_after !== null) parts.push(["value_after", a.value_after, "number"]);
  if (a.unit !== null && a.unit.trim()) parts.push(["unit", a.unit.trim(), "text"]);
  // V-9c "단위 포함": before/after numbers must be stated with the achievement's unit (or without one).
  const unit = a.unit?.trim() ? [unitOf(a.unit.trim())] : undefined;
  for (const [field, value, kind] of parts) {
    if (typeof value === "string" && value.length > (FIELD_MAX_LENGTH[field] ?? 200)) return { check: "length" };
    const claim = checkClaim(value, kind, a.source_message_ids, a.source_quotes, ctx, { overlap: field === "metric_name", units: unit });
    if (!claim.ok) return { check: claim.check, sensitive: claim.sensitive };
    // V-9c: the unit is part of the number — it must be written in the quotes.
    if (field === "unit" && !norm(claim.quotes.join("\n")).includes(norm(String(value)))) return { check: "V-9c" };
    fields[field] = { value, source_message_ids: claim.sourceIds, source_quotes: claim.quotes, review: claim.review };
  }
  return { fields };
}

function isDuplicateAchievement(
  draft: StructuredDraft,
  target: DetailTarget,
  fields: Partial<Record<AchievementField, PatchFieldObject>>,
): boolean {
  const detail = draft.details.find((d) => sameTarget(d, target));
  if (!detail) return false;
  return detail.achievements.some(
    (a) =>
      (a.value_before?.value ?? null) === (fields.value_before?.value ?? null) &&
      (a.value_after?.value ?? null) === (fields.value_after?.value ?? null) &&
      (a.metric_name?.value ?? null) === (fields.metric_name?.value ?? null),
  );
}

function checkSkill(
  s: SkillOutput,
  ctx: V9Context,
): { value: string; claim: ClaimOk } | { check: V9Check; sensitive?: ClaimFail["sensitive"] } {
  const value = s.value.trim();
  if (!value) return { check: "type" };
  if (value.length > FIELD_MAX_LENGTH.skill) return { check: "length" };
  const claim = checkClaim(value, "text", s.source_message_ids, s.source_quotes, ctx, { overlap: false });
  if (!claim.ok) return { check: claim.check, sensitive: claim.sensitive };
  // The skill itself (or another spelling from the dictionary) must be in a cited message.
  const sources = norm(
    s.source_message_ids
      .map((id) => ctx.messages.get(normalizeMessageAlias(id))?.content ?? "")
      .join("\n"),
  );
  const token = norm(value);
  const entry = dictionaryEntryFor(token);
  if (!(entry ? entryInText(entry, sources) : sources.includes(token))) return { check: "V-9d" };
  return { value, claim };
}

function candidateNamed(names: readonly string[], sourceTexts: readonly string[]): boolean {
  const source = norm(sourceTexts.join("\n"));
  return names.some((name) => {
    const n = norm(name);
    return n.length >= 2 && source.includes(n);
  });
}

function mapClarification(c: ClarificationOutput, ctx: V9Context): Clarification | null {
  let detail_key: string | null = null;
  let existing_detail_id: string | null = null;
  if (c.detail_ref) {
    const existing = ctx.existingDetails.get(c.detail_ref.trim());
    if (!existing) return null;
    existing_detail_id = existing.id;
  } else if (c.detail_key) {
    const key = c.detail_key.trim().toUpperCase();
    if (!DETAIL_KEY.test(key)) return null;
    detail_key = key;
  }
  if (c.kind === "actor_ambiguous" && !detail_key && !existing_detail_id) return null;
  return { kind: c.kind, field: c.field, detail_key, existing_detail_id };
}
