import type { AiTextBlock } from "../providers/types";
import type { SensitiveCategory } from "../schemas/AI-12";
import {
  currentDraftBody,
  parseDeliverableDraft,
  type DeliverableClarification,
  type DeliverableDraft,
  type ProjectSourceField,
  type StoredFact,
} from "../schemas/deliverable-draft";
import { BODY_HASH_PREFIX, normalizeBodyForHash } from "@/lib/body-hash";
import { sha256Hex } from "../hash";
import { detectSensitive, isDelegationRequest, type V9Message } from "../validation/v9";
import {
  DELIVERABLE_DRAFT_LIMIT,
  REQUIRED_DELIVERABLE_SLOT,
  WRITING_KIND_LABELS,
  canComposeByContent,
  guessWritingKind,
  isUsableFact,
  slotLabel,
  slotsFor,
  type ComposeStyle,
  type DeliverableRequestedAction,
  type DeliverableSlot,
  type WritingKind,
} from "./deliverable-slots";
import { currentMonthInSeoul, formatDuration, formatMonth, monthsInclusive, parseMonth } from "./months";
import type { WritingChatMessageRow } from "./writing-chat";

/**
 * AI-13 입력 컨텍스트 (AI spec v4.6 AI-13 "입력 컨텍스트"). One deliverable,
 * its parent standalone project, and this conversation — no career pack, no
 * sibling bodies, no other project / chat, no JD (날조 경로 차단).
 *
 * | 원천 | 쓰는 호출 |
 * |------|-----------|
 * | messages (`M{sequence}`, done only) | extract, reply (not compose) |
 * | facts (`F{n}`, usable = ok / accepted) | all three |
 * | current body = form_snapshot.body ?? DB body (raw markdown; > 6,000 → head 1,000 + tail 2,000) | reply, compose |
 * | parent project (DB: name, period, role, description ≤ 5,000, skills) `PRJ` | reply, compose |
 * | sibling titles (≤ 20, not a source) | reply, compose |
 *
 * Block order (C-8): <chat> → messages (cache on the last) → call tail.
 */

// ---------- inputs (the runner loads these) ----------

/** v4.6 (PA-3): the S-44 form's unsaved values (turn request `form_snapshot`, never stored or logged). */
export type DeliverableFormSnapshot = { title?: string; body?: string };

export type DeliverableParentProject = {
  id: string;
  name: string;
  /** 'YYYY-MM-DD' or 'YYYY-MM'. */
  startMonth: string | null;
  endMonth: string | null;
  isCurrent: boolean;
  /** 담당 업무 — same rank as `task` (context, not proof of the user's own action). */
  role: string | null;
  /** 프로젝트 내용 (user's own description). */
  description: string | null;
  /** project_skills → skills.name. */
  skills: readonly string[];
};

export type DeliverableChatTurnInput = {
  messages: readonly WritingChatMessageRow[];
  /** writing_chats.structured_draft (deliverable shape). */
  structuredDraft: unknown;
  lastExtractedSequence: number;
  /** project_deliverables row (DB values; the snapshot overrides them). */
  deliverable: { id: string; title: string; body: string };
  formSnapshot?: DeliverableFormSnapshot | null;
  project: DeliverableParentProject;
  /** Titles of the project's other deliverables (this one excluded; capped at 20 here). Not a source. */
  siblingTitles: readonly string[];
  /** Turn request `requested_slot` (validated against DELIVERABLE_SLOTS by the api). */
  requestedSlot: DeliverableSlot | null;
  requestedAction: DeliverableRequestedAction | null;
  style: ComposeStyle | null;
  /** This reply is the last message the chat can take (40). */
  isFinalReply: boolean;
  /** For the ongoing project's month count (defaults to now). */
  now?: Date;
};

// ---------- constants (AI-13, C-14) ----------

/** [가정] C-14: 폼 본문 ≤ 6,000자일 때만 교체 초안 (`replace_allowed`). */
export const REPLACE_ALLOWED_MAX_BODY_CHARS = 6000;
/** [가정] AI-13 입력: 본문 > 6,000자면 앞 1,000자 + 끝 2,000자 + truncated. */
export const BODY_HEAD_CHARS = 1000;
export const BODY_TAIL_CHARS = 2000;
/** AI-13 입력: 부모 description ≤ 5,000자. */
export const PROJECT_DESCRIPTION_MAX_CHARS = 5000;
export const SIBLING_TITLES_MAX = 20;
/** C-14: 대화당 사실 ≤ 60개. */
export const MAX_FACTS_PER_CHAT = 60;

// ---------- focus ----------

export type DeliverableFocusReason = "kind_unknown" | "requested" | "requested_reinforce" | "from_project" | "clarification" | "order" | "optional_offer";

export type DeliverableFocusSlot = {
  slot: DeliverableSlot | "kind";
  reason: DeliverableFocusReason;
  clarification?: DeliverableClarification["kind"];
};

export type DeliverableFocusPlan = {
  slots: DeliverableFocusSlot[];
  upcoming: DeliverableFocusSlot[];
  /** Slots of the kind with at least one fact (any review state). */
  filledSlots: DeliverableSlot[];
  /** 본인 기여 has a fact. */
  contributionFilled: boolean;
  /** AI-13 "초안 제안 시점": contribution + another slot, or a non-empty body → the reply may suggest a draft once. */
  composeSuggested: boolean;
};

// ---------- context ----------

export type BodyForModel = { text: string; truncated: boolean };

export type DeliverableChatContext = {
  input: DeliverableChatTurnInput;
  draft: DeliverableDraft;
  /** Form title (snapshot ?? DB). */
  title: string;
  /** Form body (snapshot ?? DB), raw markdown — the draft's `base_body_hash` and `replace_allowed` come from it. */
  formBody: string;
  valueSource: "form_snapshot" | "db";
  /** draft.writing_kind ?? title guess. */
  kind: WritingKind | null;
  /** What the model sees of the body (V-10a body quotes must be inside it). */
  bodyForModel: BodyForModel;
  replaceAllowed: boolean;
  baseBodyHash: string;
  /** Usable facts by alias (`F{index+1}` over draft.facts). */
  factAliases: ReadonlyMap<string, StoredFact>;
  usableFactCount: number;
  /** Text of each project source field as the model sees it (null = empty → not citable). */
  projectSources: Readonly<Record<ProjectSourceField, string | null>>;
  /** Server-computed duration numbers allowed by PRJ.period (V-10b, like V-5). */
  periodNumbers: number[];
  messages: ReadonlyMap<string, V9Message>;
  pendingAliases: ReadonlySet<string>;
  pendingUserSequences: number[];
  processThroughSequence: number | null;
  focus: DeliverableFocusPlan;
  draftCount: number;
  draftLimitReached: boolean;
  /** Draft allowed by content (≥ 2 usable facts or a non-empty body) — re-check after this turn's facts are stored. */
  canComposeByContent: boolean;
  sensitiveNotice: SensitiveCategory[];
  delegationRequested: boolean;
  /** The latest user message (or requested_action) asks for a draft. */
  composeRequested: "requested_action" | "text" | null;
  lastMessage: boolean;
  sharedBlocks: AiTextBlock[];
  messageAliasById: ReadonlyMap<string, string>;
};

/**
 * [가정] Free-text draft request ("초안 써 줘", "본문 만들어 줘"): the runner
 * starts the draft turn (extract first) instead of the parallel question turn.
 * The extract's `intent` confirms it; a delegation request never counts.
 */
export const COMPOSE_REQUEST_PATTERN =
  /(?:초안|본문|글|문서).{0,12}(?:써|쓰|만들|작성|정리해|짜\s?줘|뽑아)|(?:다시|새로)\s?(?:써|만들어|작성해)\s?(?:줘|주세요|줄래)|더\s?짧게\s?(?:정리|써|줄여)/;

export function isComposeRequest(text: string): boolean {
  return COMPOSE_REQUEST_PATTERN.test(text) && !isDelegationRequest(text);
}

export function factAlias(index: number): string {
  return `F${index + 1}`;
}

/** "F3", "F-3", "f3" → "F3". */
export function normalizeFactAlias(raw: string): string {
  const m = /^\s*f-?(\d+)\s*$/i.exec(raw);
  return m ? `F${Number(m[1])}` : raw.trim();
}

/**
 * `base_body_hash` (DM 2.5.0, v4.11 OD-P5): "sha256:" + hex of the whitespace-normalized UTF-8 body. The
 * normalization is the shared `normalizeBodyForHash` (src/lib/body-hash.ts) the screen also uses through
 * `computeBodyHash`; this sync variant only swaps the digest primitive for `node:crypto`.
 */
export function bodyHash(body: string): string {
  return `${BODY_HASH_PREFIX}${sha256Hex(normalizeBodyForHash(body))}`;
}

/** Code-point length (matches Postgres char_length used by the RPCs). */
export function charLength(text: string): number {
  return Array.from(text).length;
}

export function bodyForModel(body: string): BodyForModel {
  const chars = Array.from(body);
  if (chars.length <= REPLACE_ALLOWED_MAX_BODY_CHARS) return { text: body, truncated: false };
  return { text: `${chars.slice(0, BODY_HEAD_CHARS).join("")}\n…\n${chars.slice(chars.length - BODY_TAIL_CHARS).join("")}`, truncated: true };
}

const ONGOING = "현재";
const NO_END = "(종료 미입력)";

/** C-1 period text of the parent project + the server-computed numbers (V-10b). */
export function projectPeriod(p: DeliverableParentProject, now: Date = new Date()): { text: string | null; numbers: number[] } {
  const s = parseMonth(p.startMonth);
  if (!s) return { text: null, numbers: [] };
  const e = parseMonth(p.endMonth);
  const endYm = e ?? (p.isCurrent ? currentMonthInSeoul(now) : null);
  let text = `${formatMonth(s)} ~ ${e ? formatMonth(e) : p.isCurrent ? ONGOING : NO_END}`;
  const numbers: number[] = [];
  const months = endYm ? monthsInclusive(s, endYm) : null;
  if (months !== null) {
    text += ` (${months < 12 ? `${months}개월` : `${formatDuration(months)}, ${months}개월`})`;
    numbers.push(months, Math.floor(months / 12), months % 12);
  }
  return { text, numbers };
}

function blank(v: string | null | undefined): boolean {
  return v === null || v === undefined || v.trim() === "";
}

export function buildDeliverableChatContext(input: DeliverableChatTurnInput): DeliverableChatContext {
  const draft = parseDeliverableDraft(input.structuredDraft);
  const snapshot = input.formSnapshot ?? null;
  const title = snapshot && typeof snapshot.title === "string" && snapshot.title.trim() !== "" ? snapshot.title : input.deliverable.title;
  const formBody = snapshot && typeof snapshot.body === "string" ? snapshot.body : input.deliverable.body;
  const kind = draft.writing_kind ?? guessWritingKind(title);

  // Messages (status done only), aliases M{sequence}.
  const done = [...input.messages].filter((m) => m.status === "done").sort((a, b) => a.sequence - b.sequence);
  const messages = new Map<string, V9Message>();
  const messageAliasById = new Map<string, string>();
  for (const m of done) {
    const alias = `M${m.sequence}`;
    messages.set(alias, { alias, id: m.id, role: m.role, sequence: m.sequence, content: m.content });
    messageAliasById.set(m.id, alias);
  }
  const pending = done.filter((m) => m.role === "user" && m.sequence > input.lastExtractedSequence);

  // Facts: aliases over the whole list (stable numbering); only usable ones are citable.
  const factAliases = new Map<string, StoredFact>();
  draft.facts.forEach((f, i) => {
    if (isUsableFact(f)) factAliases.set(factAlias(i), f);
  });

  // Project sources as the model sees them.
  const period = projectPeriod(input.project, input.now);
  const description = blank(input.project.description) ? null : Array.from(input.project.description!).slice(0, PROJECT_DESCRIPTION_MAX_CHARS).join("");
  const skills = input.project.skills.filter((s) => s.trim() !== "");
  const projectSources: Record<ProjectSourceField, string | null> = {
    "PRJ.name": blank(input.project.name) ? null : input.project.name,
    "PRJ.period": period.text,
    "PRJ.role": blank(input.project.role) ? null : input.project.role,
    "PRJ.description": description,
    "PRJ.skills": skills.length ? skills.join(", ") : null,
  };

  const usableFactCount = factAliases.size;
  const latestUser = [...done].reverse().find((m) => m.role === "user");
  const delegationRequested = !!latestUser && isDelegationRequest(latestUser.content);
  const composeRequested: DeliverableChatContext["composeRequested"] =
    input.requestedAction === "compose_draft" ? "requested_action" : latestUser && pending.includes(latestUser) && isComposeRequest(latestUser.content) ? "text" : null;

  const focus = computeDeliverableFocus({
    kind,
    facts: draft.facts,
    clarifications: draft.clarifications,
    requestedSlot: input.requestedSlot,
    requestedAction: input.requestedAction,
    formBody,
  });

  const chat = [
    "<chat>",
    `deliverable_title: ${esc(title)}`,
    `writing_kind: ${kind ? `${kind} (${WRITING_KIND_LABELS[kind]})` : "(아직 모름)"}`,
    `project_name: ${esc(input.project.name)}`,
    "</chat>",
  ];
  const sharedBlocks: AiTextBlock[] = [{ text: chat.join("\n") }];
  done.forEach((m, i) => {
    sharedBlocks.push({
      text: `<message id="M${m.sequence}" role="${m.role}">\n${esc(m.content)}\n</message>`,
      ...(i === done.length - 1 ? { cache: true } : {}),
    });
  });

  return {
    input,
    draft,
    title,
    formBody,
    valueSource: snapshot ? "form_snapshot" : "db",
    kind,
    bodyForModel: bodyForModel(formBody),
    replaceAllowed: charLength(formBody) <= REPLACE_ALLOWED_MAX_BODY_CHARS,
    baseBodyHash: bodyHash(formBody),
    factAliases,
    usableFactCount,
    projectSources,
    periodNumbers: period.numbers,
    messages,
    pendingAliases: new Set(pending.map((m) => `M${m.sequence}`)),
    pendingUserSequences: pending.map((m) => m.sequence),
    processThroughSequence: pending.length ? pending[pending.length - 1].sequence : null,
    focus,
    draftCount: draft.draft_count,
    draftLimitReached: draft.draft_count >= DELIVERABLE_DRAFT_LIMIT,
    canComposeByContent: canComposeByContent(usableFactCount, formBody),
    sensitiveNotice: [...new Set(pending.flatMap((m) => detectSensitive(m.content)))],
    delegationRequested,
    composeRequested: delegationRequested ? null : composeRequested,
    lastMessage: input.isFinalReply,
    sharedBlocks,
    messageAliasById,
  };
}

export const MAX_DELIVERABLE_FOCUS = 2;
export const MAX_DELIVERABLE_UPCOMING = 3;

/**
 * AI-13 slot order: kind unknown → ask the kind; requested_slot first (a filled
 * slot is asked as reinforcement); `ask_from_project` → a question based on the
 * parent description; unresolved clarifications; then the kind's slots top to
 * bottom (본인 기여 is required; once it is filled the rest are offered). Which
 * slots the current body already covers is left to the reply (it sees the body).
 */
export function computeDeliverableFocus(input: {
  kind: WritingKind | null;
  facts: readonly { slot: string }[];
  clarifications: readonly DeliverableClarification[];
  requestedSlot: DeliverableSlot | null;
  requestedAction: DeliverableRequestedAction | null;
  formBody: string;
}): DeliverableFocusPlan {
  const kindSlots = slotsFor(input.kind);
  const has = (slot: DeliverableSlot) => input.facts.some((f) => f.slot === slot);
  const filledSlots = kindSlots.filter(has);
  const contributionFilled = has(REQUIRED_DELIVERABLE_SLOT);
  const slots: DeliverableFocusSlot[] = [];
  const push = (s: DeliverableFocusSlot) => {
    if (slots.length < MAX_DELIVERABLE_FOCUS && !slots.some((t) => t.slot === s.slot)) slots.push(s);
  };

  if (!input.kind) push({ slot: "kind", reason: "kind_unknown" });
  if (input.requestedSlot) push({ slot: input.requestedSlot, reason: has(input.requestedSlot) ? "requested_reinforce" : "requested" });
  if (input.requestedAction === "ask_from_project") {
    const target = kindSlots.find((s) => !has(s)) ?? REQUIRED_DELIVERABLE_SLOT;
    push({ slot: target, reason: "from_project" });
  }
  const clar = input.clarifications[0];
  if (clar) push({ slot: clar.kind === "actor_ambiguous" ? REQUIRED_DELIVERABLE_SLOT : (clar.slot ?? REQUIRED_DELIVERABLE_SLOT), reason: "clarification", clarification: clar.kind });

  // Table order, top to bottom; after 본인 기여 is filled the remaining slots are offers.
  const rest: DeliverableFocusSlot[] = kindSlots
    .filter((s) => !has(s))
    .map((s) => ({ slot: s, reason: contributionFilled ? ("optional_offer" as const) : ("order" as const) }));
  for (const s of rest) push(s);

  return {
    slots,
    upcoming: rest.filter((s) => !slots.some((t) => t.slot === s.slot)).slice(0, MAX_DELIVERABLE_UPCOMING),
    filledSlots,
    contributionFilled,
    composeSuggested: (contributionFilled && filledSlots.length >= 2) || !blank(input.formBody),
  };
}

// ---------- rendering (used by the prompts) ----------

/** Data blocks can't close their tags (C-4). Full-width brackets normalize away in V-9b / V-10a. */
export function esc(text: string): string {
  return text.replace(/</g, "＜").replace(/>/g, "＞");
}

/** <facts>: usable facts with aliases (compose, reply) or every fact with its review state (extract). */
export function renderFacts(ctx: DeliverableChatContext, mode: "usable" | "all"): string {
  const out = ["<facts>"];
  ctx.draft.facts.forEach((f, i) => {
    if (mode === "usable" && !isUsableFact(f)) return;
    const label = slotLabel(f.slot, ctx.kind);
    const review = mode === "all" ? ` review=${f.review}` : "";
    out.push(`<fact id="${factAlias(i)}" slot="${f.slot}" (${label}) actor="${f.actor}"${review}>${esc(f.text)}</fact>`);
  });
  if (out.length === 1) out.push("(없음)");
  out.push("</facts>");
  return out.join("\n");
}

/** <current_body>: the form body as raw markdown (C-4 data). */
export function renderCurrentBody(ctx: DeliverableChatContext): string {
  if (blank(ctx.formBody)) return "<current_body>(비어 있음)</current_body>";
  const b = ctx.bodyForModel;
  return `<current_body chars="${charLength(ctx.formBody)}"${b.truncated ? ' truncated="true"' : ""}>\n${esc(b.text)}\n</current_body>`;
}

/** <project ref="PRJ">: the parent standalone project (DB values; `link_url` never). */
export function renderProject(ctx: DeliverableChatContext): string {
  const src = ctx.projectSources;
  const out = ['<project ref="PRJ">'];
  const line = (key: string, field: ProjectSourceField) => {
    const v = src[field];
    out.push(`${key} [${field}]: ${v ? esc(v).replace(/\n/g, "\n  ") : "(비어 있음)"}`);
  };
  line("name", "PRJ.name");
  line("period", "PRJ.period");
  line("role (담당 업무)", "PRJ.role");
  line("description (프로젝트 내용)", "PRJ.description");
  line("skills (사용 기술)", "PRJ.skills");
  out.push("</project>");
  return out.join("\n");
}

/** <sibling_titles>: other deliverables' titles only — never a source. */
export function renderSiblingTitles(ctx: DeliverableChatContext): string | null {
  const titles = ctx.input.siblingTitles.filter((t) => t.trim() !== "").slice(0, SIBLING_TITLES_MAX);
  if (titles.length === 0) return null;
  return ["<sibling_titles>", ...titles.map((t) => `- ${esc(t.replace(/[\r\n]+/g, " "))}`), "</sibling_titles>"].join("\n");
}

export function focusLine(ctx: DeliverableChatContext, s: DeliverableFocusSlot, i: number): string {
  const label = s.slot === "kind" ? "산출물 종류" : slotLabel(s.slot, ctx.kind);
  const clar = s.clarification ? ` 되묻기: ${s.clarification}` : "";
  return `  ${i + 1}) ${s.slot} (${label}) reason=${s.reason}${clar}`;
}

export function hasDraftBody(ctx: DeliverableChatContext): boolean {
  return currentDraftBody(ctx.draft) !== null;
}
