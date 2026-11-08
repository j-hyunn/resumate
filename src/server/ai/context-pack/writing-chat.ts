import {
  COMPETENCY_LABELS,
  EXPERIENCE_TYPE_LABELS,
  PROJECT_TYPE_LABELS,
  isCompetency,
  isExperienceType,
  isProjectType,
} from "../classification";
import type { AiTextBlock } from "../providers/types";
import type { SensitiveCategory } from "../schemas/AI-12";
import {
  CLASSIFICATION_FIELDS,
  DRAFT_PERIOD_FIELDS,
  STAR_FIELDS,
  isDismissedClassification,
  isPending,
  parseStructuredDraft,
  type StarField,
  type StructuredDraft,
} from "../schemas/structured-draft";
import {
  detectSensitive,
  isDelegationRequest,
  pendingInForm,
  remainingStarChars,
  type V9Context,
  type V9Message,
  type V9Project,
} from "../validation/v9";
import type { GateRequirement } from "./gate-requirements";
import { computeFocusSlots, quickChips, type FocusPlan, type GateFeature, type QuickChip, type ReadinessMissing, type RequestedSlot } from "./focus-slots";

/**
 * AI-12 v4.5 입력 컨텍스트 (턴마다). Every chat belongs to one affiliated
 * project (CR-5·CR-6); there are no modes, candidates, or DET-n any more.
 * Builds, from rows the runner loaded:
 * - aliases `M{sequence}` for messages (status = 'done' only);
 * - the V-9 context, the focus plan, and the quick chips;
 * - blocks in C-8 prefix order: <chat> (stable for the chat: project name,
 *   affiliation, desired job) → one block per message (append-only; cache
 *   breakpoint on the last) → call tail (<project_state>, <draft>, <task>/<turn>),
 *   so a project edit between turns does not invalidate the message prefix.
 *
 * Only this conversation, its proposal, and this project go to the model — no
 * other project, no other chat of the same project, no JD (the gate's
 * requirement list goes to the reply call only, R-31). No name or contact (C-7).
 */

export type WritingChatMessageRow = {
  id: string;
  sequence: number;
  role: "user" | "assistant";
  content: string;
  status: "streaming" | "done" | "failed";
};

export type WritingChatProjectInput = {
  id: string;
  name: string;
  /** 'YYYY-MM-DD' or 'YYYY-MM'. */
  startMonth: string | null;
  endMonth: string | null;
  isCurrent: boolean;
  /** The project's experience / education (always one: chats are affiliated-only). */
  parent: { type: "experience" | "education"; name: string | null; status: "complete" | "draft" };
  projectType: string | null;
  experienceType: string | null;
  competencies: readonly string[];
  situation: string | null;
  task: string | null;
  action: string | null;
  result: string | null;
  learnings: string | null;
};

/**
 * v4.6 (PA-3, DM 2.5.1 `form_snapshot`): the S-10 form's unsaved values, sent
 * with every turn request. Never stored or logged; api-engineer validates
 * lengths (`invalid_form_snapshot`). A key that is absent (undefined) falls back
 * to the DB value; an explicit null / "" means the user cleared it in the form.
 */
export type ProjectFormSnapshot = {
  name?: string;
  /** 'YYYY-MM' (or 'YYYY-MM-DD'); null = empty in the form. */
  start_month?: string | null;
  end_month?: string | null;
  is_current?: boolean;
  project_type?: string | null;
  experience_type?: string | null;
  competencies?: readonly string[];
  star?: Partial<Record<StarField, string | null>>;
};

export type WritingChatTurnInput = {
  messages: readonly WritingChatMessageRow[];
  /** writing_chats.structured_draft as stored (jsonb, '{}' allowed). */
  structuredDraft: unknown;
  /** writing_chats.last_extracted_sequence. */
  lastExtractedSequence: number;
  /** writing_chats.project_id, read fresh every turn (DB values; the form snapshot overrides them). */
  project: WritingChatProjectInput;
  /**
   * v4.6 (PA-3): the turn request's `form_snapshot`. When present, its values
   * are "the project's current values" for everything the AI judges (V-9h
   * set/append, empty-field, classification "empty only", period, C-14 room,
   * focus slots). Omitted / null (old screen) → DB values.
   */
  formSnapshot?: ProjectFormSnapshot | null;
  /** return_target.feature + get_data_readiness() `missing` for that feature (recomputed every turn). */
  gate: { feature: GateFeature; missing: readonly ReadinessMissing[] } | null;
  /**
   * R-31: selectGateRequirements() for return_target.application_project_id.
   * Reply call only, and only while `gate` is set; empty / omitted → no block.
   * Never a source: extract and V-9 never see it.
   */
  gateRequirements?: readonly GateRequirement[];
  requestedSlot: RequestedSlot | null;
  /**
   * begin_assistant_message `is_final`: this reply is the last message the
   * chat can take (40) → summarize what is not applied yet, point to "반영"
   * and "새 대화에서 이어 하기" instead of asking.
   */
  isFinalReply: boolean;
};

export type WritingChatContext = {
  input: WritingChatTurnInput;
  /** DB project with the form snapshot applied — what every judgment uses. */
  project: WritingChatProjectInput;
  /** Where the current values came from (log / tests only). */
  valueSource: "form_snapshot" | "db";
  draft: StructuredDraft;
  v9: V9Context;
  focus: FocusPlan;
  /** Chips for this state (before this turn's patch; recompute with `quickChips` after the RPC returns the new draft). */
  chips: QuickChip[];
  /** Room left per STAR field for appended text (C-14), told to the extract call. */
  remainingChars: Readonly<Record<StarField, number>>;
  /** User message sequences this extract should cover (sequence > last_extracted_sequence). */
  pendingUserSequences: number[];
  /** Max pending sequence → mark_writing_chat_extracted on success; null when nothing is pending. */
  processThroughSequence: number | null;
  /** Server-detected sensitive categories in the pending user messages (reply says "기록하지 않을게요"). */
  sensitiveNotice: SensitiveCategory[];
  /** The latest user message asks the AI to make things up (reply declines). */
  delegationRequested: boolean;
  /** This turn's reply is the last message allowed (input.isFinalReply). */
  lastMessage: boolean;
  /** Data blocks shared by extract and reply (C-8 prefix). */
  sharedBlocks: AiTextBlock[];
  /** UUID → alias for rendering sources. */
  messageAliasById: ReadonlyMap<string, string>;
};

/** [가정] C-14: a STAR field with less room than this is "full" (not asked; extract told not to append). */
export const STAR_FULL_THRESHOLD = 20;

export function messageAlias(sequence: number): string {
  return `M${sequence}`;
}

export function projectStar(p: WritingChatProjectInput): Record<StarField, string | null> {
  return { situation: p.situation, task: p.task, action: p.action, result: p.result, learnings: p.learnings };
}

/**
 * v4.6 (PA-3): the project as the form shows it now. Snapshot keys win over DB
 * values; absent keys keep the DB value. Parent / id never come from the form.
 */
export function applyFormSnapshot(project: WritingChatProjectInput, snapshot: ProjectFormSnapshot | null | undefined): WritingChatProjectInput {
  if (!snapshot) return project;
  const pick = <T,>(v: T | undefined, fallback: T): T => (v === undefined ? fallback : v);
  const star = snapshot.star ?? {};
  const name = typeof snapshot.name === "string" && snapshot.name.trim() !== "" ? snapshot.name : project.name;
  return {
    ...project,
    name,
    startMonth: pick(snapshot.start_month, project.startMonth),
    endMonth: pick(snapshot.end_month, project.endMonth),
    isCurrent: pick(snapshot.is_current, project.isCurrent),
    projectType: pick(snapshot.project_type, project.projectType),
    experienceType: pick(snapshot.experience_type, project.experienceType),
    competencies: pick(snapshot.competencies, project.competencies),
    situation: pick(star.situation, project.situation),
    task: pick(star.task, project.task),
    action: pick(star.action, project.action),
    result: pick(star.result, project.result),
    learnings: pick(star.learnings, project.learnings),
  };
}

export function buildWritingChatContext(input: WritingChatTurnInput): WritingChatContext {
  const draft = parseStructuredDraft(input.structuredDraft);
  const done = [...input.messages].filter((m) => m.status === "done").sort((a, b) => a.sequence - b.sequence);

  const messages = new Map<string, V9Message>();
  const messageAliasById = new Map<string, string>();
  for (const m of done) {
    const alias = messageAlias(m.sequence);
    messages.set(alias, { alias, id: m.id, role: m.role, sequence: m.sequence, content: m.content });
    messageAliasById.set(m.id, alias);
  }
  const pending = done.filter((m) => m.role === "user" && m.sequence > input.lastExtractedSequence);
  const pendingAliases = new Set(pending.map((m) => messageAlias(m.sequence)));

  const p = applyFormSnapshot(input.project, input.formSnapshot);
  const project: V9Project = {
    star: projectStar(p),
    startMonth: toMonth(p.startMonth),
    endMonth: toMonth(p.endMonth),
    isCurrent: p.isCurrent,
    projectType: p.projectType,
    experienceType: p.experienceType,
    competencies: p.competencies,
  };
  const remainingChars = Object.fromEntries(STAR_FIELDS.map((f) => [f, remainingStarChars(f, project, draft)])) as Record<StarField, number>;
  const fullFields = STAR_FIELDS.filter((f) => remainingChars[f] < STAR_FULL_THRESHOLD);

  const chatLines = [
    "<chat>",
    `project_name: ${esc(p.name)}`,
    `affiliation: ${p.parent.type === "experience" ? "경력" : "교육"} ${p.parent.name ? `'${esc(p.parent.name)}'` : "(이름 없음)"}`,
    "</chat>",
  ];
  const sharedBlocks: AiTextBlock[] = [{ text: chatLines.join("\n") }];
  done.forEach((m, i) => {
    sharedBlocks.push({
      text: `<message id="${messageAlias(m.sequence)}" role="${m.role}">\n${esc(m.content)}\n</message>`,
      ...(i === done.length - 1 ? { cache: true } : {}),
    });
  });

  const v9: V9Context = { messages, pendingAliases, project, draft };
  const slotState = { project: { star: project.star, startMonth: project.startMonth }, draft };
  const focus = computeFocusSlots({ ...slotState, gate: input.gate, requestedSlot: input.requestedSlot, fullFields });

  const latestUser = [...done].reverse().find((m) => m.role === "user");
  return {
    input,
    project: p,
    valueSource: input.formSnapshot ? "form_snapshot" : "db",
    draft,
    v9,
    focus,
    chips: quickChips(slotState),
    remainingChars,
    pendingUserSequences: pending.map((m) => m.sequence),
    processThroughSequence: pending.length ? pending[pending.length - 1].sequence : null,
    sensitiveNotice: [...new Set(pending.flatMap((m) => detectSensitive(m.content)))],
    delegationRequested: !!latestUser && isDelegationRequest(latestUser.content),
    lastMessage: input.isFinalReply,
    sharedBlocks,
    messageAliasById,
  };
}

// ---------- rendering (used by the prompts) ----------

const PERIOD_ONGOING = "현재(진행 중)";

/** Period line of the project: "YYYY-MM ~ YYYY-MM" / "YYYY-MM ~ 현재(진행 중)" / "YYYY-MM ~ (종료 미입력)" / "(비어 있음)". */
export function renderPeriod(project: V9Project): string {
  if (!project.startMonth) return "(비어 있음)";
  const end = project.endMonth ?? (project.isCurrent ? PERIOD_ONGOING : "(종료 미입력)");
  return `${project.startMonth} ~ ${end}`;
}

function classificationValue(field: (typeof CLASSIFICATION_FIELDS)[number], project: V9Project): string | null {
  if (field === "project_type") return isProjectType(project.projectType) ? `${project.projectType} (${PROJECT_TYPE_LABELS[project.projectType]})` : null;
  if (field === "experience_type") return isExperienceType(project.experienceType) ? `${project.experienceType} (${EXPERIENCE_TYPE_LABELS[project.experienceType]})` : null;
  const comps = project.competencies.filter(isCompetency);
  return comps.length ? comps.map((c) => `${c} (${COMPETENCY_LABELS[c]})`).join(", ") : null;
}

/** v4.10 (UP-6 [무시]): marker the extract prompt reads as "do not recommend this classification". */
export const CLASSIFICATION_DISMISSED_MARK = "(비어 있음 — 사용자가 이 대화에서 추천을 무시함, 추천하지 않음)";

/**
 * v4.10 (UP-14): a STAR value as stored (markdown) in its own block, lines
 * unindented, so the model sees the user's block formatting (lists, numbers,
 * nesting, headings, paragraphs, quotes, tables, code) exactly and can keep it.
 */
function starValueBlock(field: StarField, value: string): string {
  const body = `<star_value field="${field}">\n${escMarkdown(value.trim())}\n</star_value>`;
  return field === "learnings" ? `<reflection>\n${body}\n</reflection>` : body;
}

/**
 * Extract: the project's current values (STAR text so a merged `set` keeps
 * every existing fact, v4.9 RQ-5; v4.10 UP-14 as stored markdown in
 * <star_value> blocks; classification as reference, never a source — a
 * dismissed one marked, UP-6), with the room left per STAR field (C-14
 * "정리 프롬프트에는 필드별 남은 글자 수").
 */
export function renderProjectForExtract(ctx: WritingChatContext): string {
  const project = ctx.v9.project;
  const source = ctx.valueSource === "form_snapshot" ? "화면 폼의 현재 값(저장 전 편집 포함)" : "저장된 값";
  const out = ["<project_state>", `values: ${source}`, `period: ${renderPeriod(project)}`, "classification (참고, 출처 아님):"];
  for (const f of CLASSIFICATION_FIELDS) {
    const value = classificationValue(f, project);
    out.push(`  ${f}: ${value ?? (isDismissedClassification(ctx.draft.classification[f]) ? CLASSIFICATION_DISMISSED_MARK : "(비어 있음)")}`);
  }
  out.push("star (프로젝트에 이미 있는 값, 저장된 마크다운 그대로 — 값이 있는 필드는 기존 텍스트와 새 내용을 합친 전체 글로 set):");
  for (const f of STAR_FIELDS) {
    const v = project.star[f];
    const room = `남은 글자 수 ${Math.max(0, ctx.remainingChars[f])}`;
    if (v && v.trim() !== "") out.push(`  ${f} [${room}]:`, starValueBlock(f, v));
    else out.push(`  ${f} [${room}]: (비어 있음)`);
  }
  out.push("</project_state>");
  return out.join("\n");
}

/** Extract: the chat's proposal with values, origin/review, applied state, and source aliases. */
export function renderDraftForExtract(ctx: WritingChatContext): string {
  const { draft } = ctx;
  const src = (ids: readonly string[]) => (ids.length ? ` (출처 ${ids.map((id) => ctx.messageAliasById.get(id) ?? "?").join(", ")})` : "");
  const out = ["<draft>", "project:"];
  for (const f of DRAFT_PERIOD_FIELDS) {
    const d = draft.project[f];
    out.push(isPending(d) ? `  ${f} [${d!.origin}/${d!.review}]: ${esc(d!.value ?? "")}${src(d!.source_message_ids)}` : `  ${f}: (제안 없음)`);
  }
  out.push("star:");
  for (const f of STAR_FIELDS) {
    const d = draft.star[f];
    if (!isPending(d)) out.push(`  ${f}: (제안 없음)`);
    // v4.6: filled into the form already — it is part of <project_state> now.
    else if (pendingInForm(f, ctx.v9.project, draft)) out.push(`  ${f}: (폼에 채워짐 — <project_state>에 있음)`);
    else out.push(`  ${f} [${d!.op}/${d!.origin}/${d!.review}]${src(d!.source_message_ids)}:`, starValueBlock(f, d!.value ?? ""));
  }
  out.push("classification:");
  for (const f of CLASSIFICATION_FIELDS) {
    const d = draft.classification[f];
    const value = d && isPending(d) ? (Array.isArray(d.value) ? d.value.join(", ") : d.value) : null;
    out.push(value ? `  ${f} [${d!.origin}]: ${esc(value)}` : isDismissedClassification(d) ? `  ${f}: (무시함 — 다시 추천하지 않음)` : `  ${f}: (추천 없음)`);
  }
  out.push(`clarifications: ${renderClarifications(ctx)}`);
  out.push("</draft>");
  return out.join("\n");
}

/**
 * Reply (R7, RQ-1): the project's current values so the coach can quote the
 * user's own words and ask about the concrete element that is still missing.
 * Form values (period, STAR; learnings in <reflection>), then the proposals not
 * in the form yet (values, 합친 제안 / 새로 채움, review), then clarifications. No classification
 * values (the reply never asks about classification — only which keys have a
 * recommendation, for the one-time hint) and no remaining-char counts
 * (full fields come in <turn>). No source aliases or ids.
 */
export function renderProjectForReply(ctx: WritingChatContext): string {
  const { draft } = ctx;
  const project = ctx.v9.project;
  const source = ctx.valueSource === "form_snapshot" ? "화면 폼의 현재 값(저장 전 편집 포함)" : "저장된 값";
  const multiline = (t: string) => t.replace(/\n/g, "\n    ");
  const starText = (f: StarField, v: string) => multiline(f === "learnings" ? `<reflection>${esc(v)}</reflection>` : esc(v));

  const out = ["<project_state>", `values: ${source}`, `period: ${renderPeriod(project)}`, "star (폼에 있는 값):"];
  for (const f of STAR_FIELDS) {
    const v = project.star[f];
    out.push(v && v.trim() !== "" ? `  ${f}: ${starText(f, v)}` : `  ${f}: (비어 있음)`);
  }

  const proposals: string[] = [];
  if (!project.startMonth) {
    const start = draft.project.start_month;
    const end = draft.project.end_month;
    if (isPending(start) || isPending(end)) {
      const v = (d: typeof start) => (isPending(d) ? esc(String(d!.value ?? "")) : "(없음)");
      proposals.push(`  period: ${v(start)} ~ ${v(end)}`);
    }
  }
  for (const f of STAR_FIELDS) {
    const d = draft.star[f];
    if (!isPending(d) || pendingInForm(f, project, draft)) continue;
    const review = d!.review === "needs_review" ? ", 검토 필요" : "";
    // v4.9 (RQ-5): a proposal for a field that already has text is a merged proposal (old drafts: append).
    const merged = d!.op === "append" || (project.star[f] ?? "").trim() !== "";
    proposals.push(`  ${f} [${merged ? "합친 제안" : "새로 채움"}${review}]: ${starText(f, d!.value ?? "")}`);
  }
  out.push("proposals (정리했지만 아직 폼에 넣지 않은 제안 — 화면 제안 카드에 있음):");
  out.push(...(proposals.length ? proposals : ["  (없음)"]));

  const recommended = CLASSIFICATION_FIELDS.filter((f) => isPending(draft.classification[f]));
  out.push(`classification_recommended: ${recommended.length ? recommended.join(", ") : "(없음)"}`);
  out.push(`clarifications: ${renderClarifications(ctx)}`);
  out.push("</project_state>");
  return out.join("\n");
}

function renderClarifications(ctx: WritingChatContext): string {
  const list = ctx.draft.clarifications;
  if (list.length === 0) return "(없음)";
  return list.map((c) => [c.kind, c.field].filter(Boolean).join(" ")).join("; ");
}

// ---------- helpers ----------

/** Data blocks can't close their tags (C-4). Full-width brackets normalize away in V-9b. */
function esc(text: string): string {
  return text.replace(/</g, "＜").replace(/>/g, "＞");
}

/**
 * v4.10 (UP-14): STAR markdown in <star_value>: only a `<` that could start a
 * tag is replaced (C-4), so quote markers `>` and the editor's `&lt;` reach the
 * model as stored and a merged proposal can keep them.
 */
function escMarkdown(text: string): string {
  return text.replace(/<(?=[A-Za-z/!?])/g, "＜");
}

/** 'YYYY-MM-DD' (date column) or 'YYYY-MM' → 'YYYY-MM'. */
export function toMonth(v: string | null): string | null {
  if (!v) return null;
  const m = /^(\d{4})-(\d{2})/.exec(v);
  return m ? `${m[1]}-${m[2]}` : null;
}
