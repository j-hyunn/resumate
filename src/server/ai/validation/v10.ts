import { normalizeFactAlias, charLength, type DeliverableChatContext } from "../context-pack/deliverable-chat";
import {
  isWritingKind,
  slotsFor,
  REQUIRED_DELIVERABLE_SLOT,
  type ComposeStyle,
  type DeliverableSlot,
  type WritingKind,
} from "../context-pack/deliverable-slots";
import type { Ai13BlockOutput, Ai13ComposeOutput, Ai13ExtractOutput } from "../schemas/AI-13";
import type { SensitiveCategory } from "../schemas/AI-12";
import {
  PROJECT_SOURCE_FIELDS,
  type DeliverableClarification,
  type DraftBlockBasis,
  type FactActor,
  type ProjectSourceField,
  type StoredBlock,
  type StoredFact,
} from "../schemas/deliverable-draft";
import { deliverableMarkdown } from "../schemas/deliverable-markdown";
import { normalizeForMatch, originalSpan } from "./normalize";
import { extractNumbers } from "./numbers";
import {
  checkQuotes,
  checkSources,
  checkTextNumbers,
  detectSensitive,
  findUnsupportedNames,
  isActorAmbiguous,
  normalizeMessageAlias,
  uncoveredRatio,
  V9E_MAX_UNCOVERED_RATIO,
} from "./v9";
import { PERSONAL_ACTOR_PATTERN, TEAM_SUBJECT_PATTERN } from "./v9-lexicon";

/**
 * AI-13 server validation (AI spec v4.6 AI-13), pure functions. Results carry
 * counts, check ids, and positions — never text (C-7).
 *
 * 사실 정리 (facts): V-9a (user sources, not delegation) · V-9b (quote is a
 * substring) · V-9g (sensitive fact text → drop + count; v4.9: text only, C-7 판정) · V-9c (numbers) · V-9d (names)
 * · V-9e (> 40% uncovered → needs_review), per fact. V-9f becomes the actor
 * mark: a team-subject fact is stored with `actor = team` (kept, not dropped).
 * C-14: ≤ 10 facts per turn, ≤ 60 per chat, text ≤ 300.
 *
 * 초안 블록 (V-10), per content unit (paragraph / quote / code = 1, each list
 * item, each table row):
 * | V-10a | ≥ 1 source; every F-n a usable fact; body quotes inside the body sent; project fields non-empty | drop |
 * | V-10b | numbers in the unit are in its source texts (period: server-computed months) | drop |
 * | V-10c | English tokens, skill words, company names, URLs are in its source texts | drop |
 * | V-10d | a self-action sentence needs a self fact or a first-person body / description quote | needs_review |
 * | V-10e | > 50% of content words outside the source texts | needs_review |
 * | V-10f | sensitive information in the unit text (v4.9 C-7 판정; quotes not checked) | drop + sensitive count |
 * | V-10g | type / heading depth ≤ 3 / no HTML or images / unit text ≤ 1,500 / draft ≤ 8,000 | clean, cut, or drop |
 * | V-10h | basis = new only with an F-n source, else current_body (re-derived) | — |
 */

// ---------------------------------------------------------------------------
// constants
// ---------------------------------------------------------------------------

/** C-14: 턴당 사실 ≤ 10개. */
export const MAX_FACTS_PER_TURN = 10;
/** C-14: 사실 `text` ≤ 300자. */
export const FACT_TEXT_MAX = 300;
/** DM 2.5.0 clarification note ≤ 200 (RPC). */
export const CLARIFICATION_NOTE_MAX = 200;
/** [가정] AI-13 V-10e: longer texts have more connective sentences than STAR fields (V-9e 40%). */
export const V10E_MAX_UNCOVERED_RATIO = 0.5;
/** [가정] AI-13: more than 30% of content units dropped → one regeneration. */
export const V10_REGENERATE_DROP_RATIO = 0.3;
/** C-14: 블록 텍스트 ≤ 1,500자 (per content unit). */
export const BLOCK_TEXT_MAX = 1500;
/** C-14 / DM 2.5.0: 초안 본문 ≤ 8,000자 (code points, = RPC char_length). */
export const DRAFT_VALUE_MAX = 8000;
/** RPC: heading text ≤ 500, no newline. */
export const HEADING_TEXT_MAX = 200;
/** V-10g: heading depth ≤ 3. */
export const HEADING_MAX_LEVEL = 3;
/** RPC: table cells ≤ 20 (each ≤ 1,000). */
export const TABLE_CELL_MAX = 500;
/** RPC: body quotes ≤ 1,000 chars, ≤ 20 per source list. */
const BODY_QUOTE_MAX = 1000;

// ---------------------------------------------------------------------------
// facts (정리)
// ---------------------------------------------------------------------------

export type FactCheck = "V-9a" | "V-9a.delegation" | "V-9b" | "V-9c" | "V-9d" | "V-9g" | "type" | "length" | "limit";
export const FACT_CHECKS: readonly FactCheck[] = ["V-9a", "V-9a.delegation", "V-9b", "V-9c", "V-9d", "V-9g", "type", "length", "limit"];

/** One validated fact for `add_facts` (UUID sources; the RPC assigns the id). */
export type FactChange = {
  slot: DeliverableSlot;
  text: string;
  actor: FactActor;
  source_message_ids: string[];
  source_quotes: string[];
  review: "ok" | "needs_review";
};

export type FactsReport = {
  proposed: number;
  added: number;
  needs_review: number;
  rejected: number;
  /** Facts marked actor = team by the server (V-9f → actor). */
  team_marked: number;
  unchanged: number;
  sensitive_added: number;
  by_check: Record<FactCheck, number>;
};

export type FactRejection = { check: FactCheck; target: string };

export type FactsResult = {
  facts: FactChange[];
  /** undefined = unchanged. */
  writingKind: WritingKind | undefined;
  /** null = unchanged; an array replaces the list. */
  clarifications: DeliverableClarification[] | null;
  sensitiveAdd: number;
  intent: "compose_draft" | null;
  style: ComposeStyle | null;
  report: FactsReport;
  rejections: FactRejection[];
};

const ALIAS_IN_TEXT = /\b[MF]-?\d+(?:에서|에게|에|의|을|를|이|가|은|는|와|과|처럼)?(?![\w가-힣])/g;

function cleanNote(note: string | null): string | null {
  if (!note) return null;
  const text = note.replace(ALIAS_IN_TEXT, "").replace(/\s+/g, " ").trim();
  if (!text || detectSensitive(text).length > 0) return null;
  const chars = Array.from(text);
  return chars.length > CLARIFICATION_NOTE_MAX ? `${chars.slice(0, CLARIFICATION_NOTE_MAX - 1).join("")}…` : text;
}

function normText(text: string): string {
  return normalizeForMatch(text).text;
}

function clarKey(c: DeliverableClarification): string {
  return `${c.kind}|${c.slot ?? ""}`;
}

export function validateFactsOutput(output: Ai13ExtractOutput, ctx: DeliverableChatContext): FactsResult {
  const byCheck = Object.fromEntries(FACT_CHECKS.map((c) => [c, 0])) as Record<FactCheck, number>;
  const report: FactsReport = { proposed: 0, added: 0, needs_review: 0, rejected: 0, team_marked: 0, unchanged: 0, sensitive_added: 0, by_check: byCheck };
  const rejections: FactRejection[] = [];
  const sensitiveKeys = new Set<string>();
  const countSensitive = (alias: string, category: SensitiveCategory) => {
    if (ctx.pendingAliases.has(alias)) sensitiveKeys.add(`${alias}|${category}`);
  };
  const reject = (check: FactCheck, target: string) => {
    report.rejected++;
    byCheck[check]++;
    rejections.push({ check, target });
  };

  const known = new Set(ctx.draft.facts.map((f) => normText(f.text)));
  const room = Math.max(0, 60 - ctx.draft.facts.length);
  const facts: FactChange[] = [];

  output.facts.forEach((f, i) => {
    report.proposed++;
    const target = `facts.${i}.${f.slot}`;
    if (i >= MAX_FACTS_PER_TURN || facts.length >= room) return reject("limit", target);
    const text = f.text.replace(/\s+/g, " ").trim();
    if (!text) return reject("type", target);
    if (charLength(text) > FACT_TEXT_MAX) return reject("length", target);

    const a = checkSources(f.source_message_ids, ctx.messages);
    if (!a.ok) return reject(a.check, target);
    const b = checkQuotes(f.source_quotes, a.sources);
    if (!b.ok) return reject("V-9b", target);
    // V-9g on the fact text only (v4.9 RQ-6): a quote the fact did not carry over stores nothing sensitive.
    const sensitive = detectSensitive(text);
    if (sensitive.length > 0) {
      for (const s of a.sources) for (const c of sensitive) countSensitive(s.alias, c);
      return reject("V-9g", target);
    }
    if (!checkTextNumbers(text, b.quotes)) return reject("V-9c", target);
    if (findUnsupportedNames(text, a.sources.map((s) => s.content)).length > 0) return reject("V-9d", target);

    const key = normText(text);
    if (known.has(key)) {
      report.unchanged++;
      return;
    }
    known.add(key);
    // V-9f → actor: a team subject with no first-person marker is the team's, whatever the model said.
    const teamOnly = isActorAmbiguous(text, b.quotes);
    const actor: FactActor = teamOnly ? "team" : f.actor;
    if (teamOnly && f.actor !== "team") report.team_marked++;
    const review = uncoveredRatio(text, b.quotes) > V9E_MAX_UNCOVERED_RATIO ? "needs_review" : "ok";
    facts.push({ slot: f.slot, text, actor, source_message_ids: a.sources.map((s) => s.id), source_quotes: b.quotes, review });
  });

  // Clarifications: keep unresolved old ones, add the model's new ones, and the server's own actor_ambiguous.
  const okFacts = facts.filter((f) => f.review === "ok");
  const resolved = (c: DeliverableClarification): boolean => {
    if (c.kind === "actor_ambiguous") return okFacts.some((f) => f.slot === REQUIRED_DELIVERABLE_SLOT && f.actor === "self");
    // [가정] number_vague is settled once a fact with a number arrives in that slot.
    return okFacts.some((f) => (c.slot === null || f.slot === c.slot) && extractNumbers(f.text).length > 0);
  };
  const incoming: DeliverableClarification[] = output.clarifications.map((c) => ({
    kind: c.kind,
    slot: c.kind === "actor_ambiguous" ? (c.slot ?? REQUIRED_DELIVERABLE_SLOT) : c.slot,
    note: cleanNote(c.note),
  }));
  if (facts.some((f) => f.slot === REQUIRED_DELIVERABLE_SLOT && f.actor === "team") && !okFacts.some((f) => f.slot === REQUIRED_DELIVERABLE_SLOT && f.actor === "self")) {
    incoming.push({ kind: "actor_ambiguous", slot: REQUIRED_DELIVERABLE_SLOT, note: null });
  }
  const next: DeliverableClarification[] = [];
  const seen = new Set<string>();
  for (const c of ctx.draft.clarifications) {
    if (resolved(c) || seen.has(clarKey(c))) continue;
    seen.add(clarKey(c));
    next.push(c);
  }
  for (const c of incoming) {
    if (seen.has(clarKey(c)) || resolved(c)) continue;
    seen.add(clarKey(c));
    next.push(c);
  }
  const same = next.map(clarKey).join("\n") === ctx.draft.clarifications.map(clarKey).join("\n");

  for (const flag of output.sensitive_flags) {
    const msg = ctx.messages.get(normalizeMessageAlias(flag.message_id));
    if (msg && msg.role === "user") countSensitive(msg.alias, flag.category);
  }

  const kind = output.writing_kind && isWritingKind(output.writing_kind) && output.writing_kind !== ctx.draft.writing_kind ? output.writing_kind : undefined;
  report.added = facts.length;
  report.needs_review = facts.filter((f) => f.review === "needs_review").length;
  report.sensitive_added = sensitiveKeys.size;
  return {
    facts,
    writingKind: kind,
    clarifications: same ? null : next.slice(0, 50),
    sensitiveAdd: sensitiveKeys.size,
    intent: output.intent,
    style: output.style,
    report,
    rejections,
  };
}

// ---------------------------------------------------------------------------
// draft blocks (V-10)
// ---------------------------------------------------------------------------

export type V10Check = "V-10a" | "V-10b" | "V-10c" | "V-10d" | "V-10e" | "V-10f" | "V-10g" | "V-10g.length";
export const V10_CHECKS: readonly V10Check[] = ["V-10a", "V-10b", "V-10c", "V-10d", "V-10e", "V-10f", "V-10g", "V-10g.length"];

export type V10Rejection = { check: V10Check; block: number; unit: number | null };

/** What V-10 needs from the call (built by `composeValidationContext`). */
export type ComposeValidationContext = {
  /** Usable facts by alias. */
  facts: ReadonlyMap<string, StoredFact>;
  /** The body exactly as the compose call saw it (head + tail when truncated). */
  bodyText: string;
  projectSources: Readonly<Record<ProjectSourceField, string | null>>;
  kind: WritingKind | null;
};

export function composeValidationContext(ctx: DeliverableChatContext): ComposeValidationContext {
  return { facts: ctx.factAliases, bodyText: ctx.bodyForModel.text, projectSources: ctx.projectSources, kind: ctx.kind };
}

type UnitSources = { source_fact_ids: readonly string[]; source_body_quotes: readonly string[]; source_project_fields: readonly string[] };

type ResolvedSources = {
  factIds: string[];
  facts: StoredFact[];
  bodyQuotes: string[];
  fields: ProjectSourceField[];
  texts: string[];
};

function union(a: UnitSources, b: UnitSources): UnitSources {
  return {
    source_fact_ids: [...a.source_fact_ids, ...b.source_fact_ids],
    source_body_quotes: [...a.source_body_quotes, ...b.source_body_quotes],
    source_project_fields: [...a.source_project_fields, ...b.source_project_fields],
  };
}

/** V-10a: resolves a unit's sources, or null when any is invalid or there are none. */
export function resolveSources(src: UnitSources, vctx: ComposeValidationContext): ResolvedSources | null {
  const out: ResolvedSources = { factIds: [], facts: [], bodyQuotes: [], fields: [], texts: [] };
  for (const raw of src.source_fact_ids) {
    const fact = vctx.facts.get(normalizeFactAlias(raw));
    if (!fact) return null;
    if (!out.factIds.includes(fact.id)) {
      out.factIds.push(fact.id);
      out.facts.push(fact);
      out.texts.push(fact.text, ...fact.source_quotes);
    }
  }
  const body = normalizeForMatch(vctx.bodyText);
  for (const quote of src.source_body_quotes) {
    const q = normText(quote);
    if (!q) return null;
    const at = body.text.indexOf(q);
    if (at < 0) return null;
    const span = originalSpan(vctx.bodyText, body, at, at + q.length);
    if (charLength(span) > BODY_QUOTE_MAX) return null;
    if (!out.bodyQuotes.includes(span)) {
      out.bodyQuotes.push(span);
      out.texts.push(span);
    }
  }
  for (const raw of src.source_project_fields) {
    if (!(PROJECT_SOURCE_FIELDS as readonly string[]).includes(raw)) return null;
    const field = raw as ProjectSourceField;
    const value = vctx.projectSources[field];
    if (!value) return null;
    if (!out.fields.includes(field)) {
      out.fields.push(field);
      out.texts.push(value);
    }
  }
  if (out.factIds.length + out.bodyQuotes.length + out.fields.length === 0) return null;
  // DB limits: fact ids ≤ 40, body quotes ≤ 20, fields ≤ 10.
  if (out.factIds.length > 40 || out.bodyQuotes.length > 20) return null;
  return out;
}

const HTML_TAG = /<\/?[A-Za-z][^<>]*>/g;
const MD_IMAGE = /!\[[^\]]*\]\([^)]*\)/g;
const URL_PATTERN = /\bhttps?:\/\/[^\s)>\]]+|\bwww\.[^\s)>\]]+/gi;

/** V-10g text cleanup: HTML tags and images removed, whitespace trimmed. */
export function cleanText(text: string, singleLine = false): string {
  let t = text.replace(MD_IMAGE, "").replace(HTML_TAG, "");
  if (singleLine) t = t.replace(/\s*[\r\n]+\s*/g, " ");
  return t.trim();
}

/** Cuts to `max` code points, at the last sentence end when there is one in the second half. */
export function cutText(text: string, max: number): string {
  const chars = Array.from(text);
  if (chars.length <= max) return text;
  const head = chars.slice(0, max).join("");
  const ends = [...head.matchAll(/(?:다\.|요\.|[.!?。])(?=\s|$)|\n/g)].map((m) => m.index! + m[0].length);
  const cut = ends.filter((e) => e >= max / 2).pop();
  return (cut ? head.slice(0, cut) : head).trim();
}

function urlsSupported(text: string, sources: readonly string[]): boolean {
  const joined = normText(sources.join("\n"));
  return [...text.matchAll(URL_PATTERN)].every((m) => joined.includes(normText(m[0])));
}

type UnitOutcome = { ok: true; review: "ok" | "needs_review"; sources: ResolvedSources } | { ok: false; check: V10Check; sensitive: number };

/** V-10a → V-10f → V-10b → V-10c → V-10d / V-10e for one content unit. */
export function checkUnit(text: string, src: UnitSources, vctx: ComposeValidationContext): UnitOutcome {
  const sources = resolveSources(src, vctx);
  if (!sources) return { ok: false, check: "V-10a", sensitive: 0 };
  const sensitive = detectSensitive(text);
  if (sensitive.length > 0) return { ok: false, check: "V-10f", sensitive: 1 };
  if (!checkTextNumbers(text, sources.texts)) return { ok: false, check: "V-10b", sensitive: 0 };
  if (findUnsupportedNames(text, sources.texts).length > 0 || !urlsSupported(text, sources.texts)) return { ok: false, check: "V-10c", sensitive: 0 };
  let review: "ok" | "needs_review" = "ok";
  if (!selfActionSupported(text, sources, vctx)) review = "needs_review";
  if (uncoveredRatio(text, sources.texts) > V10E_MAX_UNCOVERED_RATIO) review = "needs_review";
  return { ok: true, review, sources };
}

/**
 * V-10d: a sentence that says the user acted ("제가", "직접", "본인이" …) needs
 * a `self` fact, a first-person body quote, or a cited first-person parent
 * description. [가정] Also: a unit sourced only from `team` facts that does not
 * name the team as subject would read as the user's own action → needs_review.
 */
export function selfActionSupported(text: string, sources: ResolvedSources, vctx: ComposeValidationContext): boolean {
  const selfEvidence =
    sources.facts.some((f) => f.actor === "self") ||
    sources.bodyQuotes.some((q) => PERSONAL_ACTOR_PATTERN.test(q)) ||
    (sources.fields.includes("PRJ.description") && PERSONAL_ACTOR_PATTERN.test(vctx.projectSources["PRJ.description"] ?? ""));
  if (PERSONAL_ACTOR_PATTERN.test(text) && !selfEvidence) return false;
  const teamOnly = sources.facts.length > 0 && sources.facts.every((f) => f.actor === "team") && sources.bodyQuotes.length === 0;
  if (teamOnly && !TEAM_SUBJECT_PATTERN.test(` ${text}`) && !selfEvidence) return false;
  return true;
}

/** Names / numbers / sensitive in a heading, against everything the call could cite. */
function headingOk(text: string, vctx: ComposeValidationContext): V10Check | null {
  if (detectSensitive(text).length > 0) return "V-10f";
  const all = [
    ...[...vctx.facts.values()].flatMap((f) => [f.text, ...f.source_quotes]),
    vctx.bodyText,
    ...Object.values(vctx.projectSources).filter((v): v is string => !!v),
  ];
  if (!checkTextNumbers(text, all)) return "V-10b";
  if (findUnsupportedNames(text, all).length > 0 || !urlsSupported(text, all)) return "V-10c";
  return null;
}

export type BlockOutcome = {
  /** null = dropped. */
  block: StoredBlock | null;
  /** Content units in the model block (heading = 0). */
  units: number;
  droppedUnits: number;
  sensitive: number;
  rejections: V10Rejection[];
};

function storedSources(s: ResolvedSources | null) {
  return { source_fact_ids: s?.factIds ?? [], source_body_quotes: s?.bodyQuotes ?? [], source_project_fields: s?.fields ?? [] };
}

/**
 * Validates one model block (V-10a–g). Used both per streamed block
 * (`draft_block`) and in the final pass, so the two always agree.
 * `blockId` is the server id (`b{index+1}`).
 */
export function validateDraftBlock(raw: Ai13BlockOutput, index: number, vctx: ComposeValidationContext): BlockOutcome {
  const blockId = `b${index + 1}`;
  const rejections: V10Rejection[] = [];
  const drop = (check: V10Check, unit: number | null) => rejections.push({ check, block: index, unit });
  const blockSrc: UnitSources = { source_fact_ids: raw.source_fact_ids, source_body_quotes: raw.source_body_quotes, source_project_fields: raw.source_project_fields };

  if (raw.type === "heading") {
    const text = cutText(cleanText(raw.text ?? "", true), HEADING_TEXT_MAX);
    if (!text) {
      drop("V-10g", null);
      return { block: null, units: 0, droppedUnits: 0, sensitive: 0, rejections };
    }
    const bad = headingOk(text, vctx);
    if (bad) {
      drop(bad, null);
      return { block: null, units: 0, droppedUnits: 0, sensitive: bad === "V-10f" ? 1 : 0, rejections };
    }
    const level = Math.min(HEADING_MAX_LEVEL, Math.max(1, raw.level ?? 2));
    return {
      block: { block_id: blockId, type: "heading", level, text, items: null, rows: null, basis: null, ...storedSources(null), review: "ok" },
      units: 0,
      droppedUnits: 0,
      sensitive: 0,
      rejections,
    };
  }

  if (raw.type === "paragraph" || raw.type === "quote" || raw.type === "code") {
    const text = cutText(cleanText(raw.text ?? "", false), BLOCK_TEXT_MAX);
    if (!text) {
      drop("V-10g", 0);
      return { block: null, units: 1, droppedUnits: 1, sensitive: 0, rejections };
    }
    const r = checkUnit(text, blockSrc, vctx);
    if (!r.ok) {
      drop(r.check, 0);
      return { block: null, units: 1, droppedUnits: 1, sensitive: r.sensitive, rejections };
    }
    return {
      block: {
        block_id: blockId,
        type: raw.type,
        level: null,
        text,
        items: null,
        rows: null,
        basis: basisOf(r.sources.factIds.length > 0),
        ...storedSources(r.sources),
        review: r.review,
      },
      units: 1,
      droppedUnits: 0,
      sensitive: 0,
      rejections,
    };
  }

  if (raw.type === "bullet_list" || raw.type === "numbered_list") {
    const items = raw.items ?? [];
    const kept: NonNullable<StoredBlock["items"]> = [];
    let review: "ok" | "needs_review" = "ok";
    let anyFact = false;
    let sensitive = 0;
    items.forEach((item, u) => {
      const text = cutText(cleanText(item.text, true), BLOCK_TEXT_MAX);
      if (!text) return drop("V-10g", u);
      const r = checkUnit(text, union(item, blockSrc), vctx);
      if (!r.ok) {
        sensitive += r.sensitive;
        return drop(r.check, u);
      }
      if (r.review === "needs_review") review = "needs_review";
      if (r.sources.factIds.length) anyFact = true;
      kept.push({ text, ...storedSources(r.sources) });
    });
    const units = Math.max(items.length, 1);
    if (kept.length === 0) {
      if (items.length === 0) drop("V-10g", null);
      return { block: null, units, droppedUnits: units, sensitive, rejections };
    }
    return {
      block: { block_id: blockId, type: raw.type, level: null, text: null, items: kept, rows: null, basis: basisOf(anyFact), ...storedSources(null), review },
      units,
      droppedUnits: units - kept.length,
      sensitive,
      rejections,
    };
  }

  // table: the first row is the header, checked against the sources of all rows.
  const rows = raw.rows ?? [];
  const cleanRow = (cells: readonly string[]) => cells.slice(0, 12).map((c) => cutText(cleanText(c, true), TABLE_CELL_MAX));
  const allRowSources = rows.reduce<UnitSources>((acc, r) => union(acc, r), blockSrc);
  type Row = NonNullable<StoredBlock["rows"]>[number];
  let header: Row | null = null;
  const bodyRows: Row[] = [];
  let review: "ok" | "needs_review" = "ok";
  let anyFact = false;
  let sensitive = 0;
  rows.forEach((row, u) => {
    const cells = cleanRow(row.cells);
    if (cells.every((c) => c === "")) return drop("V-10g", u);
    const r = checkUnit(cells.join(" / "), u === 0 ? allRowSources : union(row, blockSrc), vctx);
    if (!r.ok) {
      sensitive += r.sensitive;
      return drop(r.check, u);
    }
    if (r.review === "needs_review") review = "needs_review";
    if (u === 0) {
      header = { cells, ...storedSources(r.sources) };
      return;
    }
    if (r.sources.factIds.length) anyFact = true;
    bodyRows.push({ cells, ...storedSources(r.sources) });
  });
  const units = Math.max(rows.length, 1);
  // No header, or a header alone, is not a table.
  if (!header || bodyRows.length === 0) {
    if (rows.length === 0) drop("V-10g", null);
    return { block: null, units, droppedUnits: units, sensitive, rejections };
  }
  const kept: Row[] = [header, ...bodyRows];
  return {
    block: { block_id: blockId, type: "table", level: null, text: null, items: null, rows: kept, basis: basisOf(anyFact), ...storedSources(null), review },
    units,
    droppedUnits: units - kept.length,
    sensitive,
    rejections,
  };
}

function basisOf(hasFact: boolean): DraftBlockBasis {
  // V-10h: `new` only with an F-n source; body / project only → current_body.
  return hasFact ? "new" : "current_body";
}

export type ComposeReport = {
  blocks_total: number;
  blocks_kept: number;
  units_total: number;
  units_dropped: number;
  needs_review: number;
  sensitive_added: number;
  by_check: Record<V10Check, number>;
};

export type ComposeValidation = {
  /** Final blocks (ids b{model index + 1}); empty = no content left. */
  blocks: StoredBlock[];
  value: string;
  droppedUnits: number;
  totalUnits: number;
  /** droppedUnits / totalUnits > 30% → regenerate once. */
  overDropLimit: boolean;
  needsReviewBlockIds: string[];
  missingSlots: DeliverableSlot[];
  writingKind: WritingKind;
  sensitiveAdded: number;
  report: ComposeReport;
  rejections: V10Rejection[];
};

const isContent = (b: StoredBlock) => b.type !== "heading";

/** Removes headings with no content block before the next heading of the same or a higher level. */
export function dropEmptyHeadings(blocks: readonly StoredBlock[]): StoredBlock[] {
  return blocks.filter((b, i) => {
    if (b.type !== "heading") return true;
    for (let j = i + 1; j < blocks.length; j++) {
      const n = blocks[j];
      if (n.type === "heading" && (n.level ?? 2) <= (b.level ?? 2)) return false;
      if (isContent(n)) return true;
    }
    return false;
  });
}

/** Heading basis: new when its section has a new block (append takes "new blocks and the heading before them"). */
function headingBases(blocks: StoredBlock[]): StoredBlock[] {
  return blocks.map((b, i) => {
    if (b.type !== "heading") return b;
    let hasNew = false;
    for (let j = i + 1; j < blocks.length; j++) {
      const n = blocks[j];
      if (n.type === "heading" && (n.level ?? 2) <= (b.level ?? 2)) break;
      if (isContent(n) && n.basis === "new") hasNew = true;
    }
    return { ...b, basis: hasNew ? "new" : "current_body" };
  });
}

/**
 * Whole-output V-10: per-block checks (same as streaming), empty-heading
 * cleanup, V-10g 8,000-char cap (trailing blocks dropped), heading basis,
 * missing slots limited to the kind's.
 */
export function validateComposeOutput(output: Ai13ComposeOutput, vctx: ComposeValidationContext): ComposeValidation {
  const byCheck = Object.fromEntries(V10_CHECKS.map((c) => [c, 0])) as Record<V10Check, number>;
  const rejections: V10Rejection[] = [];
  let totalUnits = 0;
  let droppedUnits = 0;
  let sensitive = 0;
  let blocks: StoredBlock[] = [];
  output.blocks.forEach((raw, i) => {
    const r = validateDraftBlock(raw, i, vctx);
    totalUnits += r.units;
    droppedUnits += r.droppedUnits;
    sensitive += r.sensitive;
    rejections.push(...r.rejections);
    if (r.block) blocks.push(r.block);
  });
  blocks = dropEmptyHeadings(blocks);

  // V-10g: the assembled value ≤ 8,000 code points — drop trailing content blocks.
  while (blocks.some(isContent) && Array.from(deliverableMarkdown(blocks)).length > DRAFT_VALUE_MAX) {
    const lastContent = blocks.map(isContent).lastIndexOf(true);
    const removed = blocks[lastContent];
    const units = removed.items?.length ?? removed.rows?.length ?? 1;
    droppedUnits += units;
    rejections.push({ check: "V-10g.length", block: Number(removed.block_id.slice(1)) - 1, unit: null });
    blocks = dropEmptyHeadings(blocks.filter((_, k) => k !== lastContent));
  }
  if (!blocks.some(isContent)) blocks = [];
  blocks = headingBases(blocks);

  for (const r of rejections) byCheck[r.check]++;
  const kindSlots = slotsFor(vctx.kind ?? output.writing_kind);
  const missing = [...new Set(output.missing_slots)].filter((s) => kindSlots.length === 0 || kindSlots.includes(s));
  const needsReviewBlockIds = blocks.filter((b) => b.review === "needs_review").map((b) => b.block_id);
  return {
    blocks,
    value: deliverableMarkdown(blocks),
    droppedUnits,
    totalUnits,
    overDropLimit: totalUnits > 0 && droppedUnits / totalUnits > V10_REGENERATE_DROP_RATIO,
    needsReviewBlockIds,
    missingSlots: missing,
    writingKind: vctx.kind ?? output.writing_kind,
    sensitiveAdded: sensitive,
    report: {
      blocks_total: output.blocks.length,
      blocks_kept: blocks.length,
      units_total: totalUnits,
      units_dropped: droppedUnits,
      needs_review: needsReviewBlockIds.length,
      sensitive_added: sensitive,
      by_check: byCheck,
    },
    rejections,
  };
}

/** Check ids only, for the regeneration request ("위반 내용을 검사 번호로만 알려 줌"). */
export function violationSummary(rejections: readonly V10Rejection[]): string {
  const counts = new Map<string, number>();
  for (const r of rejections) counts.set(r.check, (counts.get(r.check) ?? 0) + 1);
  return [...counts].map(([c, n]) => `${c} ${n}건`).join(", ");
}
