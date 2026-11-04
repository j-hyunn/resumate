import { isCompetency, isExperienceType, isProjectType, MAX_COMPETENCIES, type ClassificationField } from "../classification";
import type { Ai12ExtractOutput, ClarificationOutput, ClassificationSuggestions, SensitiveCategory, StarPatch } from "../schemas/AI-12";
import {
  CLASSIFICATION_REASON_MAX,
  DRAFT_PATCH_MAX_QUOTE_LENGTH,
  STAR_FIELD_MAX_LENGTH,
  emptyDraftChanges,
  hasValue,
  isPending,
  isProtected,
  type Clarification,
  type ClassificationChange,
  type DraftChanges,
  type FieldRef,
  type PeriodChange,
  type PeriodField,
  type StarChange,
  type StarField,
  type StarOp,
  type StarReviewReason,
  type StructuredDraft,
} from "../schemas/structured-draft";
import { normalizeForMatch, originalSpan } from "./normalize";
import { extractNumbers } from "./numbers";
import {
  CONTACT_PATTERN,
  DELEGATION_PATTERN,
  KOREAN_SUFFIXES,
  NATIVE_COUNTERS,
  NATIVE_COUNT_WORDS,
  NOT_A_NAME,
  NOT_A_NAME_ENDINGS,
  ORG_SUFFIXES,
  PERSONAL_ACTOR_PATTERN,
  SKILL_DICTIONARY,
  STOPWORDS,
  TEAM_SUBJECT_PATTERN,
  THIRD_PARTY_NAME_PATTERN,
  detectPersonalCategories,
} from "./v9-lexicon";

/**
 * AI-12 V-9 (발화 추적, 날조 0건 장치) — AI spec v4.5 AI-12 "서버 검증 V-9",
 * one project, one STAR (CR-2):
 *
 * | # | check | on failure |
 * |---|-------|------------|
 * | V-9a | sources are this chat's `role = 'user'` messages; not only delegation requests | reject |
 * | V-9b | each quote is a substring of a cited message (normalized) | reject |
 * | V-9c | every number (with unit) / month in the value is in the quotes (+ the field's existing text, v4.9) | reject |
 * | V-9d | English tokens, dictionary skills, company names are in the cited messages (+ existing text) | reject |
 * | V-9e | ≤ 40% of the value's content words are missing from the quotes (+ existing text) | needs_review |
 * | V-9f | `action` whose subject is the team | actor_ambiguous (+ situation candidate) |
 * | V-9g | sensitive information in the value (not the quotes, v4.9 RQ-6) | reject + sensitive count |
 * | V-9h | v4.9 (RQ-5): STAR `set` allowed on a filled field = merged proposal; `append` still accepted (old drafts); period only when the project column is empty | reject |
 * | V-9i | classification: key list, ≤ 3 distinct competencies, target empty, user sources, situation + action present | drop (classification is not a claim) |
 * | V-9j | v4.9 (RQ-5): a merged `set` keeps every number (with unit) and V-9d name of the existing text | needs_review |
 *
 * "Existing text" of a STAR field (v4.9) = the form value + the pending
 * proposal not in the form yet (+ this turn's earlier patch of the field).
 * Plus C-14: ≤ 10 patches per turn, STAR value on apply ≤ 2,000 chars (a set
 * replaces, so its own length; an append adds to the current value).
 *
 * v4.6 (PA-3): "the project" is the form as the user sees it (`form_snapshot`
 * applied by buildWritingChatContext, else DB values). A pending proposal whose
 * text is already in the form (filled, not saved) is treated as part of the
 * current value: the next STAR patch for that field starts a new object
 * (`new_object: true`, DM 2.5 DA-10), and it no longer counts toward C-14 twice.
 * Pure functions only. Results carry counts and field paths, never text (C-7).
 */

/** [가정] AI-12 V-9e: share of content words missing from the quotes above which a value needs review. */
export const V9E_MAX_UNCOVERED_RATIO = 0.4;

/** [가정] C-14 "턴당 패치 ≤ 10개" (period + STAR patches; classification is separate). */
export const MAX_PATCHES_PER_TURN = 10;

/** Separator the merge uses between the current value and appended text (DM 3.3: "줄바꿈 1개"). */
export const APPEND_SEPARATOR_LENGTH = 1;

export type V9Check =
  | "V-9a"
  | "V-9a.delegation"
  | "V-9b"
  | "V-9c"
  | "V-9d"
  | "V-9g"
  | "V-9h"
  | "V-9i"
  | "protected"
  | "type"
  | "length"
  | "limit";

export const V9_CHECKS: readonly V9Check[] = [
  "V-9a",
  "V-9a.delegation",
  "V-9b",
  "V-9c",
  "V-9d",
  "V-9g",
  "V-9h",
  "V-9i",
  "protected",
  "type",
  "length",
  "limit",
];

export type V9Report = {
  /** Patches and classification suggestions the model proposed. */
  proposed: number;
  /** Items in the outgoing patch (period + STAR + classification). */
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
  /** v4.9 (RQ-5): applied `set` patches on a field that had existing text (merged proposals). */
  merged: number;
  /** v4.9 V-9j: merged proposals marked needs_review because an existing number / name is missing. */
  preservation_review: number;
  /** R8 QA-01: legacy `append` patches on existing text turned into merged `set` (existing + new). */
  append_merged: number;
};

export type V9Rejection = { check: V9Check; target: string };

export type V9Message = {
  alias: string;
  id: string;
  role: "user" | "assistant";
  sequence: number;
  content: string;
};

/** The chat's project as it is now: v4.6 = the form snapshot over DB values (re-read every turn). */
export type V9Project = {
  star: Readonly<Record<StarField, string | null>>;
  startMonth: string | null;
  endMonth: string | null;
  isCurrent: boolean;
  projectType: string | null;
  experienceType: string | null;
  competencies: readonly string[];
};

export type V9Context = {
  /** Messages in this call (status = 'done'), keyed by alias (`M{sequence}`). */
  messages: ReadonlyMap<string, V9Message>;
  /** User messages this extract is for (sequence > last_extracted_sequence). Sensitive counts only count these. */
  pendingAliases: ReadonlySet<string>;
  project: V9Project;
  draft: StructuredDraft;
};

export type V9Flags = {
  needsReview: FieldRef[];
  actorAmbiguous: FieldRef[];
  sensitiveAdded: number;
  /** STAR fields whose append was rejected because the merged value would pass 2,000 chars (C-14). */
  lengthFull: StarField[];
};

export type V9Result = {
  /** Validated changes (UUIDs); `toDraftPatch` makes the RPC ops. */
  changes: DraftChanges;
  flags: V9Flags;
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
  const raw = quotes.join("\n").normalize("NFKC");
  const q = norm(raw);
  const missing = tokens.filter((t) => {
    if (q.includes(t)) return false;
    if (t.length >= 3 && (q.includes(t.slice(1)) || q.includes(t.slice(0, -1)))) return false;
    if (nominalStems(t).some((stem) => (stem.length >= 2 ? q.includes(stem) : new RegExp(`(?:^|[^가-힣])${stem}`).test(raw)))) return false;
    return true;
  });
  return missing.length / tokens.length;
}

/**
 * R8 QA-04 (AI spec v4.9 V-9e·V-10e): -음 체 words nominalized with a ㅁ / ㄻ
 * 받침 ("만듦", "맡음", "높임", "줄임", "바꿈", "이끎") → verb stems to look for in
 * the quotes: the word without the ㅁ (ㄻ → ㄹ: 만듦 → 만들, 이끎 → 이끌, 높임 → 높이)
 * and, for ㅁ only, without the last syllable (맡음 → 맡, 줄임 → 줄, 바꿈 → 바). A one-syllable
 * stem must start a word in the quotes.
 */
export function nominalStems(token: string): string[] {
  // Verb nominals are short (만듦, 이끎, 단축함 is stripped earlier); longer words are nouns (프로그램).
  if (token.length > 3 || !/^[가-힣]+$/.test(token)) return [];
  const last = token.slice(-1);
  const code = last.charCodeAt(0) - 0xac00;
  if (code < 0 || code >= 11172) return [];
  const jong = code % 28;
  if (jong !== 16 && jong !== 10) return []; // ㅁ, ㄻ
  const base = String.fromCharCode(0xac00 + code - jong + (jong === 10 ? 8 : 0));
  // ㄻ → ㄹ already gives the verb stem (만들, 이끌); only ㅁ also tries the stem without the last syllable.
  const out = [token.slice(0, -1) + base, ...(jong === 16 ? [token.slice(0, -1)] : [])].filter((x) => x.length > 0);
  return [...new Set(out)];
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

/**
 * V-9g / V-10f / turn notice: sensitive categories found in a text
 * (NFR-PRV-05, v4.9 RQ-6 C-7 "민감정보 판정"): contact details; the user's or
 * family's own health / religion / union / politics circumstances (see
 * PERSONAL_PHRASES — work-domain words alone never count); a real name with a
 * title. Order: contact, health, religion, union, politics, third_party_name.
 */
export function detectSensitive(text: string): SensitiveCategory[] {
  const found: SensitiveCategory[] = [];
  if (CONTACT_PATTERN.test(text)) found.push("contact");
  found.push(...detectPersonalCategories(text));
  for (const match of text.matchAll(THIRD_PARTY_NAME_PATTERN)) {
    // "정산팀 팀장": a team name; "기획자 선배", "사업부 부장": job / organization nouns (R8).
    if (!NOT_A_NAME.has(match[1]) && !NOT_A_NAME_ENDINGS.includes(match[1].slice(-1))) {
      found.push("third_party_name");
      break;
    }
  }
  return found;
}

// ---------------------------------------------------------------------------
// Whole-output validation
// ---------------------------------------------------------------------------

type ClaimKind = "text" | "month";

type ClaimOk = { ok: true; sourceIds: string[]; quotes: string[]; review: "ok" | "needs_review"; reviewReason?: StarReviewReason | null };
type ClaimFail = { ok: false; check: V9Check; sensitive?: { aliases: string[]; categories: SensitiveCategory[] } };

/**
 * Runs V-9a → V-9b → V-9g → V-9c → V-9d → V-9e on one value. `existing`
 * (v4.9, STAR text only) = the field's existing text: an extra source for
 * V-9c / V-9d / V-9e, never for V-9a / V-9b (sources stay user messages).
 * V-9g looks at the value only (v4.9 RQ-6): a quote the value did not carry
 * over stores nothing sensitive.
 */
function checkClaim(
  value: string,
  kind: ClaimKind,
  rawIds: readonly string[],
  rawQuotes: readonly string[],
  ctx: V9Context,
  existing: readonly string[] = [],
): ClaimOk | ClaimFail {
  const a = checkSources(rawIds, ctx.messages);
  if (!a.ok) return { ok: false, check: a.check };
  const b = checkQuotes(rawQuotes, a.sources);
  if (!b.ok) return { ok: false, check: "V-9b" };
  const sensitive = detectSensitive(value);
  if (sensitive.length > 0) {
    return { ok: false, check: "V-9g", sensitive: { aliases: a.sources.map((s) => s.alias), categories: [...new Set(sensitive)] } };
  }
  const allowed = [...b.quotes, ...existing];
  const numbersOk = kind === "month" ? checkMonthValue(value, b.quotes) : checkTextNumbers(value, allowed);
  if (!numbersOk) return { ok: false, check: "V-9c" };
  if (kind === "text" && findUnsupportedNames(value, [...a.sources.map((s) => s.content), ...existing]).length > 0) {
    return { ok: false, check: "V-9d" };
  }
  const review = kind === "text" && uncoveredRatio(value, allowed) > V9E_MAX_UNCOVERED_RATIO ? "needs_review" : "ok";
  return { ok: true, sourceIds: a.sources.map((s) => s.id), quotes: b.quotes, review, reviewReason: review === "needs_review" ? "content_unverified" : null };
}

/**
 * V-9j (v4.9, RQ-5): a merged proposal keeps the existing text's facts the
 * server can check — every number with its unit (V-9c matching, reversed) and
 * every V-9d name (English tokens, dictionary skills, company names). Actions
 * and wording are not judged here (evaluation set "보존").
 */
export function preservesExisting(value: string, existing: readonly string[]): boolean {
  return existing.every((text) => checkTextNumbers(text, [value]) && findUnsupportedNames(text, [value]).length === 0);
}

function filledText(v: string | null | undefined): boolean {
  return typeof v === "string" && v.trim() !== "";
}

function clarKey(c: Clarification): string {
  return `${c.kind}|${c.field ?? ""}`;
}

/** Normalized containment (V-9b normalization): `needle` is inside `haystack`. */
export function containsNormalized(haystack: string | null | undefined, needle: string | null | undefined): boolean {
  if (!haystack || !needle) return false;
  const n = norm(needle);
  return n.length > 0 && norm(haystack).includes(n);
}

/**
 * v4.6 (PA-3, DM 2.5 DA-10): the pending (unsaved-as-applied) proposal of this
 * STAR field is already in the form value — the user filled it ([반영]) but has
 * not saved. Then the form value already carries it.
 */
export function pendingInForm(field: StarField, project: V9Project, draft: StructuredDraft): boolean {
  const d = draft.star[field];
  return isPending(d) && containsNormalized(project.star[field], d!.value);
}

/**
 * Length the STAR field would have once the pending proposal is filled into the
 * form (AI-12 채우기 규칙): a `set` proposal replaces the field (v4.9 merged
 * proposal — its own length); an `append` (old drafts) is current + separator +
 * proposal. A proposal already in the form is not counted twice.
 */
export function mergedStarLength(field: StarField, project: V9Project, draft: StructuredDraft): number {
  const current = (project.star[field] ?? "").trim().length;
  const d = draft.star[field];
  if (!isPending(d) || pendingInForm(field, project, draft)) return current;
  const pending = (d!.value ?? "").length;
  if (d!.op === "set") return pending;
  return current + (current > 0 && pending > 0 ? APPEND_SEPARATOR_LENGTH : 0) + pending;
}

/**
 * R8 QA-01: the text a STAR field shows once its pending proposal is filled in
 * (AI-12 채우기 규칙): a pending `set` replaces the form value, a pending
 * `append` follows it after one line break; a proposal already in the form adds nothing.
 */
export function filledStarText(field: StarField, project: V9Project, draft: StructuredDraft): string {
  const form = (project.star[field] ?? "").trim();
  const d = draft.star[field];
  if (!isPending(d) || pendingInForm(field, project, draft) || !filledText(d!.value)) return form;
  const pending = d!.value!.trim();
  if (d!.op === "set") return pending;
  return form ? `${form}\n${pending}` : pending;
}

/**
 * v4.9 (RQ-5) "기존 텍스트" of a STAR field, in order: the form value, the
 * pending proposal when it is not in the form yet, and this turn's earlier
 * patch of the same field. Empty parts are left out.
 */
export function existingStarTexts(field: StarField, project: V9Project, draft: StructuredDraft, touched?: StarChange): string[] {
  const out: string[] = [];
  const form = project.star[field];
  if (filledText(form)) out.push(form!.trim());
  const d = draft.star[field];
  if (isPending(d) && !pendingInForm(field, project, draft) && filledText(d!.value)) out.push(d!.value!.trim());
  if (touched && filledText(touched.value)) out.push(touched.value.trim());
  return out;
}

/** Room left for appended text in a STAR field (C-14), separator included. Negative = already over. */
export function remainingStarChars(field: StarField, project: V9Project, draft: StructuredDraft): number {
  const used = mergedStarLength(field, project, draft);
  return STAR_FIELD_MAX_LENGTH - used - (used > 0 ? APPEND_SEPARATOR_LENGTH : 0);
}

export function validateExtractOutput(output: Ai12ExtractOutput, ctx: V9Context): V9Result {
  const changes = emptyDraftChanges();
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
    merged: 0,
    preservation_review: 0,
    append_merged: 0,
  };
  const flags: V9Flags = { needsReview: [], actorAmbiguous: [], sensitiveAdded: 0, lengthFull: [] };
  const newClarifications: Clarification[] = [];
  const sensitiveKeys = new Set<string>();
  /** Fields this turn sets or appends to (V-9f situation candidate, V-9i situation/action presence). */
  const touched = new Map<StarField, StarChange>();
  let patches = 0;

  const reject = (check: V9Check, target: string, sensitive?: ClaimFail["sensitive"]) => {
    report.rejected++;
    byCheck[check]++;
    rejections.push({ check, target });
    if (sensitive) for (const alias of sensitive.aliases) for (const c of sensitive.categories) countSensitive(alias, c);
  };
  const countSensitive = (alias: string, category: SensitiveCategory) => {
    if (ctx.pendingAliases.has(alias)) sensitiveKeys.add(`${alias}|${category}`);
  };
  const projectHas = (field: StarField) => filledText(ctx.project.star[field]);

  // 1. Period (project_patches): only start_month / end_month, op set, project column empty (V-9h).
  for (const p of output.project_patches) {
    report.proposed++;
    const path = `project.${p.field}`;
    if (++patches > MAX_PATCHES_PER_TURN) {
      reject("limit", path);
      continue;
    }
    const current = p.field === "start_month" ? ctx.project.startMonth : ctx.project.endMonth;
    // R-CR-15: an ongoing project takes no end month (CHECK NOT is_current OR end_month IS NULL).
    if (filledText(current) || (p.field === "end_month" && ctx.project.isCurrent)) {
      reject("V-9h", path);
      continue;
    }
    if (isProtected(ctx.draft.project[p.field])) {
      reject("protected", path);
      continue;
    }
    const value = p.value.trim();
    if (!MONTH_VALUE.test(value)) {
      reject("type", path);
      continue;
    }
    const claim = checkClaim(value, "month", p.source_message_ids, p.source_quotes, ctx);
    if (!claim.ok) {
      reject(claim.check, path, claim.sensitive);
      continue;
    }
    const pending = ctx.draft.project[p.field];
    if (isPending(pending) && pending!.value === value) {
      report.unchanged++;
      continue;
    }
    const prior = changes.period.findIndex((c) => c.field === p.field);
    const change: PeriodChange = { field: p.field, value, source_message_ids: claim.sourceIds, source_quotes: claim.quotes, review: claim.review };
    if (prior >= 0) changes.period[prior] = change;
    else changes.period.push(change);
  }

  // 2. STAR patches. `projected` = merged length on apply if everything pending is applied (C-14).
  const projected = new Map<StarField, number>();
  const projectedOf = (field: StarField) => projected.get(field) ?? mergedStarLength(field, ctx.project, ctx.draft);
  /** R8 QA-01: the field's text once everything pending is filled (what a legacy append is added to). */
  const projectedText = new Map<StarField, string>();
  const projectedTextOf = (field: StarField) => projectedText.get(field) ?? filledStarText(field, ctx.project, ctx.draft);
  const putStar = (field: StarField, op: StarOp, value: string, claim: ClaimOk, path: string, existing: readonly string[] = []): boolean => {
    const draftField = ctx.draft.star[field];
    // V-9h (v4.9, RQ-5): a filled field takes `set` = the merged proposal (existing text + new content
    // rewritten as one text); `append` stays valid for old prompts / retries.
    // v4.6: the pending object is already in the form → this patch starts a new object (DA-10).
    const newObject = !touched.has(field) && pendingInForm(field, ctx.project, ctx.draft);
    // Append onto nothing = set (RPC does the same).
    let effective: StarOp = op === "append" && !projectHas(field) && !isPending(draftField) && !touched.has(field) ? "set" : op;
    if (effective === "set" && !touched.has(field) && isPending(draftField) && draftField!.value === value) {
      report.unchanged++;
      return false;
    }
    // The sentence is already in the form value (or in the pending proposal being appended to): nothing new.
    if (
      effective === "append" &&
      (containsNormalized(ctx.project.star[field], value) ||
        (!newObject && isPending(draftField) && containsNormalized(draftField!.value, value)) ||
        containsNormalized(touched.get(field)?.value, value))
    ) {
      report.unchanged++;
      return false;
    }
    // R8 QA-01: a legacy `append` onto existing text becomes a merged `set` (existing + "\n" + new), so the
    // RPC never appends onto a merged proposal (its op would turn into append and the screen would add the
    // form value twice). The appended sentence alone was checked against its quotes (legacy V-9c·d·e).
    let converted = false;
    if (effective === "append") {
      const base = projectedTextOf(field);
      value = base ? `${base}\n${value}` : value;
      existing = existingStarTexts(field, ctx.project, ctx.draft, touched.get(field));
      effective = "set";
      converted = true;
      report.append_merged++;
    }
    const merging = effective === "set" && existing.length > 0;
    // v4.9: a merged value that adds nothing to the existing text (same after normalization, or a part of it) is a no-op.
    if (merging && (existing.some((e) => containsNormalized(e, value)) || containsNormalized(existing.join("\n"), value))) {
      report.unchanged++;
      return false;
    }
    const before = projectedOf(field);
    // A set replaces the field on apply: its own length (a converted append = current + "\n" + new, as before).
    const after = effective === "set" ? value.length : before + (before > 0 ? APPEND_SEPARATOR_LENGTH : 0) + value.length;
    if (after > STAR_FIELD_MAX_LENGTH) {
      reject("length", path);
      if (!flags.lengthFull.includes(field)) flags.lengthFull.push(field);
      return false;
    }
    projected.set(field, after);
    projectedText.set(field, value);
    let review = claim.review;
    let reviewReason: StarReviewReason | null = claim.review === "needs_review" ? (claim.reviewReason ?? null) : null;
    let sourceIds = claim.sourceIds;
    let quotes = claim.quotes;
    if (merging) {
      report.merged++;
      // V-9j: an existing number / name missing from the merged value → the user checks it.
      if (!converted && !preservesExisting(value, existing)) {
        review = "needs_review";
        reviewReason = "existing_missing";
        report.preservation_review++;
      }
      // The merged value carries the replaced proposal's content: keep its sources with the new ones
      // (the RPC replaces the pending object on set). Not when a new object starts (that proposal is in the form).
      const carried = [touched.get(field), newObject || !isPending(draftField) ? undefined : draftField];
      for (const prior of carried) {
        if (!prior) continue;
        // New sources first: toDraftPatch keeps the first 20 (clampSources); the RPC rejects more.
        sourceIds = [...new Set([...sourceIds, ...prior.source_message_ids])];
        quotes = [...new Set([...quotes, ...prior.source_quotes])];
      }
    }
    const change: StarChange = {
      field,
      op: effective,
      value,
      source_message_ids: sourceIds,
      source_quotes: quotes,
      review,
      review_reason: review === "needs_review" ? reviewReason : null,
      ...(newObject ? { new_object: true } : {}),
    };
    changes.star.push(change);
    touched.set(field, change);
    return true;
  };

  for (const s of output.star_patches) {
    report.proposed++;
    const path = `star.${s.field}`;
    if (++patches > MAX_PATCHES_PER_TURN) {
      reject("limit", path);
      continue;
    }
    // A user-owned proposal is protected until it is in the form (then the form value carries it).
    if (isProtected(ctx.draft.star[s.field]) && !pendingInForm(s.field, ctx.project, ctx.draft)) {
      reject("protected", path);
      continue;
    }
    const value = s.value.trim();
    if (value.length === 0) {
      reject("type", path);
      continue;
    }
    if (value.length > STAR_FIELD_MAX_LENGTH) {
      reject("length", path);
      continue;
    }
    // v4.9: a set's sources include the field's existing text (merged proposal); an append's do not.
    const existing = s.op === "set" ? existingStarTexts(s.field, ctx.project, ctx.draft, touched.get(s.field)) : [];
    const claim = checkClaim(value, "text", s.source_message_ids, s.source_quotes, ctx, existing);
    if (!claim.ok) {
      reject(claim.check, path, claim.sensitive);
      continue;
    }
    if (s.field === "action" && isActorAmbiguous(value, claim.quotes)) {
      // V-9f: not the user's own action — ask again; keep it only as a situation candidate
      // when both the proposal and the project have no situation yet.
      report.actor_ambiguous++;
      flags.actorAmbiguous.push({ section: "star", field: "action" });
      newClarifications.push({ kind: "actor_ambiguous", field: "action" });
      const situationTaken =
        projectHas("situation") ||
        hasValue(ctx.draft.star.situation) ||
        touched.has("situation") ||
        output.star_patches.some((o) => o !== s && o.field === "situation");
      if (!situationTaken && !isProtected(ctx.draft.star.situation)) {
        putStar("situation", "set", value, { ...claim, review: "needs_review" }, "star.situation");
      }
      continue;
    }
    putStar(s.field, s.op, value, claim, path, existing);
  }

  // 3. Classification suggestions (V-9i). Not a claim: drops never reject the turn.
  const situationKnown = projectHas("situation") || hasValue(ctx.draft.star.situation) || touched.has("situation");
  const actionKnown = projectHas("action") || hasValue(ctx.draft.star.action) || touched.has("action");
  for (const field of ["project_type", "experience_type", "competencies"] as const) {
    const suggestion = output.classification_suggestions[field];
    if (!suggestion) continue;
    report.proposed++;
    const result = checkClassification(field, suggestion, ctx, situationKnown && actionKnown);
    if ("drop" in result) {
      reject("V-9i", `classification.${field}`);
      continue;
    }
    const pending = ctx.draft.classification[field];
    if (isPending(pending) && JSON.stringify(pending!.value) === JSON.stringify(result.change.value)) {
      report.unchanged++;
      continue;
    }
    changes.classification.push(result.change);
  }

  // 4. Clarifications: keep unresolved old ones, add new ones (model + V-9f).
  for (const c of output.clarifications) {
    const mapped = mapClarification(c);
    if (mapped) newClarifications.push(mapped);
  }
  const okStar = (field: StarField) => changes.star.some((c) => c.field === field && c.review === "ok");
  const resolved = (c: Clarification): boolean => {
    switch (c.kind) {
      case "actor_ambiguous":
        return okStar("action") || projectHas("action");
      case "number_vague":
        // [가정] resolved once a result with a number arrives (or the user fills it in the section).
        return changes.star.some((s) => s.field === "result" && s.review === "ok" && extractNumbers(s.value).length > 0);
      case "period_unclear":
        return changes.period.some((p) => p.field === "start_month") || filledText(ctx.project.startMonth);
    }
  };
  const next: Clarification[] = [];
  const seen = new Set<string>();
  for (const c of ctx.draft.clarifications) {
    if (resolved(c) || seen.has(clarKey(c))) continue;
    seen.add(clarKey(c));
    next.push(c);
  }
  for (const c of newClarifications) {
    if (seen.has(clarKey(c))) continue;
    seen.add(clarKey(c));
    next.push(c);
  }
  if (next.map(clarKey).join("\n") !== ctx.draft.clarifications.map(clarKey).join("\n")) changes.clarifications = next;

  // 5. Sensitive flags: model flags on this turn's user messages + server detections (V-9g rejections).
  for (const f of output.sensitive_flags) {
    const msg = ctx.messages.get(normalizeMessageAlias(f.message_id));
    if (msg && msg.role === "user") countSensitive(msg.alias, f.category);
  }
  changes.sensitive_flags_add = sensitiveKeys.size;
  report.sensitive_added = sensitiveKeys.size;
  flags.sensitiveAdded = sensitiveKeys.size;

  for (const p of changes.period) {
    if (p.review === "needs_review") flags.needsReview.push({ section: "project", field: p.field });
  }
  for (const s of changes.star) {
    if (s.review === "needs_review" && !flags.needsReview.some((r) => r.section === "star" && r.field === s.field)) {
      flags.needsReview.push({ section: "star", field: s.field });
    }
  }
  report.needs_review = flags.needsReview.length;
  report.applied = changes.period.length + changes.star.length + changes.classification.length;

  return { changes, flags, report, rejections };
}

/** Message aliases in a reason, with a following particle ("M2에서 말한" → "말한"). */
const MESSAGE_ALIAS_IN_TEXT = /\bM-?\d+(?:에서|에게|에|의|을|를|이|가|은|는|와|과|처럼)?(?![\w가-힣])/g;

/**
 * V-9i (AI-12 "분류 추천"): ① keys from the CR-17 list (others dropped, element
 * by element for competencies) ② competencies ≤ 3, no duplicates ③ the
 * project's value is empty (competencies: none chosen) and the user has not
 * edited the proposal ④ sources: user messages only (others removed; may be
 * empty) ⑤ situation and action present. `reason` ≤ 100 chars, no aliases,
 * no sensitive text.
 */
function checkClassification(
  field: ClassificationField,
  s: NonNullable<ClassificationSuggestions[ClassificationField]>,
  ctx: V9Context,
  starReady: boolean,
): { change: ClassificationChange } | { drop: true } {
  if (!starReady) return { drop: true };
  if (isProtected(ctx.draft.classification[field])) return { drop: true };
  let value: string | string[];
  if (field === "project_type") {
    if (filledText(ctx.project.projectType) || !isProjectType(s.value)) return { drop: true };
    value = s.value as string;
  } else if (field === "experience_type") {
    if (filledText(ctx.project.experienceType) || !isExperienceType(s.value)) return { drop: true };
    value = s.value as string;
  } else {
    if (ctx.project.competencies.length > 0) return { drop: true };
    const keys = (Array.isArray(s.value) ? s.value : []).filter(isCompetency);
    value = [...new Set(keys)].slice(0, MAX_COMPETENCIES);
    if (value.length === 0) return { drop: true };
  }
  const ids: string[] = [];
  for (const raw of s.source_message_ids) {
    const msg = ctx.messages.get(normalizeMessageAlias(raw));
    if (msg && msg.role === "user" && !ids.includes(msg.id)) ids.push(msg.id);
  }
  return { change: { field, value, source_message_ids: ids, reason: cleanReason(s.reason) } };
}

function cleanReason(reason: string | null): string | null {
  if (!reason) return null;
  const text = reason.replace(MESSAGE_ALIAS_IN_TEXT, "").replace(/\s+/g, " ").trim();
  if (!text || detectSensitive(text).length > 0) return null;
  return text.length > CLASSIFICATION_REASON_MAX ? `${text.slice(0, CLASSIFICATION_REASON_MAX - 1)}…` : text;
}

function mapClarification(c: ClarificationOutput): Clarification | null {
  if (c.kind === "actor_ambiguous") return { kind: c.kind, field: "action" };
  if (c.kind === "number_vague") return { kind: c.kind, field: c.field ?? "result" };
  if (c.kind === "period_unclear") return { kind: c.kind, field: c.field === "end_month" ? "end_month" : "start_month" };
  return null;
}

export type { StarPatch, PeriodField };
