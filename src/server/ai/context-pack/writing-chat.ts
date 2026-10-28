import type { AiTextBlock } from "../providers/types";
import type { SensitiveCategory } from "../schemas/AI-12";
import {
  ACHIEVEMENT_FIELDS,
  DETAIL_FIELDS,
  PROJECT_FIELDS,
  parseStructuredDraft,
  type AffiliationType,
  type DetailField,
  type DraftField,
  type ProjectField,
  type StructuredDraft,
} from "../schemas/structured-draft";
import { detectSensitive, isDelegationRequest, type V9Context, type V9Message } from "../validation/v9";
import {
  computeFocusSlots,
  type ExistingDetailState,
  type FocusPlan,
  type GateFeature,
  type ReadinessMissing,
  type RequestedSlot,
} from "./focus-slots";

/**
 * AI-12 입력 컨텍스트 (턴마다). Builds, from rows the runner loaded:
 * - aliases: `M{sequence}` for messages (status = 'done' only; failed replies
 *   are excluded, AI-12 저장 규칙), `EXP-n` / `EDU-n` for affiliation
 *   candidates, `PRJ-1` / `DET-n` for the augment target;
 * - the V-9 context (validators) and the focus plan (focus-slots.ts);
 * - data blocks shared by both calls, in C-8 prefix order: context (stable
 *   through the chat) → one block per message (append-only, so the previous
 *   turn's prefix is reused; cache breakpoint on the last one).
 *
 * Only this conversation, its draft, the augment target, the candidates'
 * names and periods, and the desired job title go to the model — no other
 * project content, no JD (AI-12 "게이트 진입 외에는 … 넣지 않는다"; the
 * gate's requirement list is an S5 extension point). No name or contact (C-7).
 */

export type WritingChatMode = "new_project" | "augment_project";

export type WritingChatMessageRow = {
  id: string;
  sequence: number;
  role: "user" | "assistant";
  content: string;
  status: "streaming" | "done" | "failed";
};

export type WritingChatTurnInput = {
  mode: WritingChatMode;
  messages: readonly WritingChatMessageRow[];
  /** writing_chats.structured_draft as stored (jsonb, '{}' allowed). */
  structuredDraft: unknown;
  /** writing_chats.last_extracted_sequence. */
  lastExtractedSequence: number;
  /** Optional: experience/education ids the user declined as affiliation in this chat ([아니요]). No DB column yet (spec-gaps). */
  declinedAffiliationIds?: readonly string[];
  affiliation: { experienceId: string | null; educationId: string | null; parentStatus: "complete" | "draft" | null };
  candidates: {
    experiences: readonly {
      id: string;
      companyName: string | null;
      startMonth: string | null;
      endMonth: string | null;
      isCurrent: boolean | null;
    }[];
    educations: readonly {
      id: string;
      institutionName: string | null;
      programName: string | null;
      startMonth: string | null;
      endMonth: string | null;
    }[];
  };
  augmentTarget: {
    project: {
      id: string;
      name: string | null;
      role: string | null;
      summary: string | null;
      startMonth: string | null;
      endMonth: string | null;
      teamSize: number | null;
    };
    details: readonly {
      id: string;
      status: "draft" | "complete";
      sortOrder: number;
      title: string | null;
      situation: string | null;
      task: string | null;
      action: string | null;
      result: string | null;
      learnings: string | null;
    }[];
  } | null;
  desiredJobTitle: string | null;
  gate: { feature: GateFeature; missing: readonly ReadinessMissing[] } | null;
  requestedSlot: RequestedSlot | null;
  /**
   * begin_assistant_message `is_final`: this reply is the last message the
   * chat can take (DM 2.5 limit 40; the RPC decides, S4 db notes) → summarize
   * empty fields and point to save / form instead of asking.
   */
  isFinalReply: boolean;
};

export type WritingChatContext = {
  input: WritingChatTurnInput;
  draft: StructuredDraft;
  v9: V9Context;
  focus: FocusPlan;
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
  /** DET alias by existing detail id. */
  detailAliasById: ReadonlyMap<string, string>;
};

export function messageAlias(sequence: number): string {
  return `M${sequence}`;
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

  // Affiliation candidates: experiences (recent first), then educations.
  const candidates = new Map<string, { type: AffiliationType; id: string; names: string[] }>();
  const candidateLines: string[] = [];
  const exps = [...input.candidates.experiences].sort(byStartDesc);
  exps.forEach((e, i) => {
    const alias = `EXP-${i + 1}`;
    candidates.set(alias, { type: "experience", id: e.id, names: [e.companyName ?? ""].filter(Boolean) });
    candidateLines.push(`  ${alias}: ${esc(e.companyName ?? "(이름 없음)")} (${period(e.startMonth, e.endMonth, e.isCurrent)})`);
  });
  const edus = [...input.candidates.educations].sort(byStartDesc);
  edus.forEach((e, i) => {
    const alias = `EDU-${i + 1}`;
    candidates.set(alias, { type: "education", id: e.id, names: [e.institutionName ?? "", e.programName ?? ""].filter(Boolean) });
    const program = e.programName ? ` ${esc(e.programName)}` : "";
    candidateLines.push(`  ${alias}: ${esc(e.institutionName ?? "(이름 없음)")}${program} (${period(e.startMonth, e.endMonth, null)})`);
  });

  // Augment target.
  const existingDetails = new Map<string, { id: string; filled: Set<DetailField> }>();
  const existingDetailStates: ExistingDetailState[] = [];
  const detailAliasById = new Map<string, string>();
  let existingProject: { id: string; filled: Set<ProjectField> } | null = null;
  const targetLines: string[] = [];
  if (input.mode === "augment_project" && input.augmentTarget) {
    const p = input.augmentTarget.project;
    const projectValues: Record<ProjectField, string | number | null> = {
      name: p.name,
      role: p.role,
      summary: p.summary,
      start_month: toMonth(p.startMonth),
      end_month: toMonth(p.endMonth),
      team_size: p.teamSize,
    };
    existingProject = { id: p.id, filled: new Set(PROJECT_FIELDS.filter((f) => filled(projectValues[f]))) };
    targetLines.push("augment_target:", "  PRJ-1 (보강 대상 프로젝트, 채워진 필드는 바꾸지 않음)");
    for (const f of PROJECT_FIELDS) targetLines.push(`    ${f}: ${show(projectValues[f])}`);
    const details = [...input.augmentTarget.details].sort((a, b) => a.sortOrder - b.sortOrder || cmp(a.id, b.id));
    details.forEach((d, i) => {
      const alias = `DET-${i + 1}`;
      const values: Record<DetailField, string | null> = {
        title: d.title,
        situation: d.situation,
        task: d.task,
        action: d.action,
        result: d.result,
        learnings: d.learnings,
      };
      const filledFields = new Set(DETAIL_FIELDS.filter((f) => filled(values[f])));
      existingDetails.set(alias, { id: d.id, filled: filledFields });
      existingDetailStates.push({ id: d.id, alias, status: d.status, sortOrder: d.sortOrder, filled: filledFields });
      detailAliasById.set(d.id, alias);
      targetLines.push(`  ${alias} (기존 상세 내용, ${d.status === "complete" ? "완료" : "작성 중"})`);
      for (const f of DETAIL_FIELDS) {
        const v = values[f];
        targetLines.push(f === "learnings" && filled(v) ? `    ${f}: <reflection>${esc(v!)}</reflection>` : `    ${f}: ${show(v)}`);
      }
    });
  }

  const affiliationConfirmed = !!(input.affiliation.experienceId || input.affiliation.educationId);
  const confirmedAlias = input.affiliation.experienceId
    ? [...candidates].find(([, c]) => c.id === input.affiliation.experienceId)?.[0]
    : input.affiliation.educationId
      ? [...candidates].find(([, c]) => c.id === input.affiliation.educationId)?.[0]
      : undefined;

  const contextLines = [
    "<context>",
    `mode: ${input.mode}`,
    `desired_job_title: ${input.desiredJobTitle ? esc(input.desiredJobTitle) : "(없음)"}`,
    `affiliation_confirmed: ${affiliationConfirmed ? (confirmedAlias ?? "확정됨") : "없음"}`,
    "affiliation_candidates:",
    ...(candidateLines.length ? candidateLines : ["  (없음)"]),
    ...targetLines,
    "</context>",
  ];

  const sharedBlocks: AiTextBlock[] = [{ text: contextLines.join("\n") }];
  done.forEach((m, i) => {
    sharedBlocks.push({
      text: `<message id="${messageAlias(m.sequence)}" role="${m.role}">\n${esc(m.content)}\n</message>`,
      ...(i === done.length - 1 ? { cache: true } : {}),
    });
  });

  const v9: V9Context = {
    mode: input.mode,
    messages,
    pendingAliases,
    existingProject,
    existingDetails,
    candidates,
    draft,
    affiliationConfirmed,
    declinedAffiliationIds: new Set(input.declinedAffiliationIds ?? []),
  };

  const focus = computeFocusSlots({
    mode: input.mode,
    draft,
    existingProject,
    existingDetails: existingDetailStates,
    gate: input.gate,
    requestedSlot: input.requestedSlot,
    affiliationParentStatus: input.affiliation.parentStatus,
  });

  const latestUser = [...done].reverse().find((m) => m.role === "user");
  return {
    input,
    draft,
    v9,
    focus,
    pendingUserSequences: pending.map((m) => m.sequence),
    processThroughSequence: pending.length ? pending[pending.length - 1].sequence : null,
    sensitiveNotice: [...new Set(pending.flatMap((m) => detectSensitive(m.content)))],
    delegationRequested: !!latestUser && isDelegationRequest(latestUser.content),
    lastMessage: input.isFinalReply,
    sharedBlocks,
    messageAliasById,
    detailAliasById,
  };
}

// ---------- draft rendering (used by the prompts) ----------

/** Full draft with values, origin/review, and source aliases — for extract (append, protection, duplicates). */
export function renderDraftForExtract(ctx: WritingChatContext): string {
  const { draft } = ctx;
  const src = (f: DraftField) =>
    f.source_message_ids.length ? ` (출처 ${f.source_message_ids.map((id) => ctx.messageAliasById.get(id) ?? "?").join(", ")})` : "";
  const line = (name: string, f: DraftField | undefined) =>
    f && f.value !== null && f.value !== ""
      ? `${name} [${f.origin}/${f.review}]: ${esc(String(f.value))}${src(f)}`
      : `${name}: (비어 있음)`;
  const out = ["<draft>", "project:"];
  for (const f of PROJECT_FIELDS) out.push(`  ${line(f, draft.project[f])}`);
  out.push(`skills: ${draft.skills.length ? draft.skills.map((s) => esc(s.value)).join(", ") : "(없음)"}`);
  const sugg = draft.affiliation_suggestion;
  out.push(`affiliation_suggestion: ${sugg ? (aliasOfCandidate(ctx, sugg.id) ?? "있음") : "(없음)"}`);
  out.push("details:");
  if (draft.details.length === 0) out.push("  (없음)");
  for (const d of draft.details) {
    const label = d.existing_detail_id ? `${ctx.detailAliasById.get(d.existing_detail_id) ?? "DET-?"} (기존 상세 내용 보강)` : d.detail_key;
    out.push(`  ${label}:`);
    for (const f of DETAIL_FIELDS) if (d.fields[f]) out.push(`    ${line(f, d.fields[f])}`);
    d.achievements.forEach((a, i) => {
      const parts = ACHIEVEMENT_FIELDS.filter((f) => a[f] && a[f]!.value !== null).map((f) => `${f}=${esc(String(a[f]!.value))}`);
      out.push(`    achievement ${i + 1}: ${parts.join(", ")}`);
    });
  }
  out.push(`clarifications: ${renderClarifications(ctx)}`);
  out.push("</draft>");
  return out.join("\n");
}

/** Status only (no values) — for the reply, so questions don't carry facts. */
export function renderDraftStatusForReply(ctx: WritingChatContext): string {
  const { draft } = ctx;
  const state = (f: DraftField | undefined, existing = false) =>
    existing ? "기존 값 있음" : !f || f.value === null || f.value === "" ? "비어 있음" : f.review === "needs_review" ? "검토 필요" : "채워짐";
  const project = ctx.v9.existingProject;
  const out = ["<draft_status>", "project:"];
  for (const f of PROJECT_FIELDS) out.push(`  ${f}: ${state(draft.project[f], !!project?.filled.has(f))}`);
  out.push(`  skills: ${draft.skills.length}개`);
  out.push("details:");
  const shown = new Set<string>();
  for (const d of draft.details) {
    const label = d.existing_detail_id ? (ctx.detailAliasById.get(d.existing_detail_id) ?? "DET-?") : d.detail_key;
    if (d.existing_detail_id) shown.add(d.existing_detail_id);
    const existing = d.existing_detail_id ? [...ctx.v9.existingDetails.values()].find((e) => e.id === d.existing_detail_id) : undefined;
    const fields = DETAIL_FIELDS.map((f) => `${f}=${state(d.fields[f], !!existing?.filled.has(f))}`).join(", ");
    out.push(`  ${label}: ${fields}, achievements=${d.achievements.length}개`);
  }
  for (const [alias, e] of ctx.v9.existingDetails) {
    if (shown.has(e.id)) continue;
    out.push(`  ${alias}: ${DETAIL_FIELDS.map((f) => `${f}=${e.filled.has(f) ? "기존 값 있음" : "비어 있음"}`).join(", ")}`);
  }
  if (draft.details.length === 0 && ctx.v9.existingDetails.size === 0) out.push("  (없음)");
  out.push(`clarifications: ${renderClarifications(ctx)}`);
  out.push("</draft_status>");
  return out.join("\n");
}

function renderClarifications(ctx: WritingChatContext): string {
  const list = ctx.draft.clarifications;
  if (list.length === 0) return "(없음)";
  return list
    .map((c) => {
      const target = c.existing_detail_id ? ctx.detailAliasById.get(c.existing_detail_id) : c.detail_key;
      return [c.kind, target, c.field].filter(Boolean).join(" ");
    })
    .join("; ");
}

function aliasOfCandidate(ctx: WritingChatContext, id: string): string | undefined {
  for (const [alias, c] of ctx.v9.candidates) if (c.id === id) return alias;
  return undefined;
}

// ---------- helpers ----------

/** Data blocks can't close their tags (C-4). Full-width brackets normalize away in V-9b. */
function esc(text: string): string {
  return text.replace(/</g, "＜").replace(/>/g, "＞");
}

function filled(v: string | number | null): boolean {
  return v !== null && !(typeof v === "string" && v.trim() === "");
}

function show(v: string | number | null): string {
  return filled(v) ? esc(String(v)) : "(비어 있음)";
}

/** 'YYYY-MM-DD' (date column) or 'YYYY-MM' → 'YYYY-MM'. */
export function toMonth(v: string | null): string | null {
  if (!v) return null;
  const m = /^(\d{4})-(\d{2})/.exec(v);
  return m ? `${m[1]}-${m[2]}` : null;
}

function period(start: string | null, end: string | null, isCurrent: boolean | null): string {
  const s = toMonth(start) ?? "?";
  const e = isCurrent ? "재직 중" : (toMonth(end) ?? "");
  return e ? `${s} ~ ${e}` : s;
}

function byStartDesc(a: { id: string; startMonth: string | null }, b: { id: string; startMonth: string | null }): number {
  const sa = a.startMonth ?? "";
  const sb = b.startMonth ?? "";
  if (sa !== sb) return sa < sb ? 1 : -1;
  return cmp(a.id, b.id);
}

function cmp(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}
