import { z } from "zod";
import {
  ClarificationSchema,
  StructuredDraftSchema,
  parseStructuredDraft as parseStoredDraft,
  type StructuredDraft as StructuredDraftType,
} from "@/server/ai/schemas/structured-draft";
import {
  DeliverableClarificationSchema,
  DeliverableDraftSchema,
  StoredBlockSchema,
  StoredDraftBodySchema,
  parseDeliverableDraft as parseStoredDeliverableDraft,
  type DeliverableDraft as DeliverableDraftType,
} from "@/server/ai/schemas/deliverable-draft";
import { COMPOSE_STYLES, DELIVERABLE_REQUESTED_ACTIONS, DELIVERABLE_SLOTS, WRITING_KINDS } from "@/server/ai/context-pack/deliverable-slots";
import {
  CoverLetterBlockSchema,
  CoverLetterClarificationStoredSchema,
  CoverLetterDraftSchema,
  CoverLetterQuestionDraftSchema,
  parseCoverLetterDraft as parseStoredCoverLetterDraft,
  type CoverLetterDraft as CoverLetterDraftType,
} from "@/server/ai/schemas/cover-letter-draft";
import { AiErrorCodeSchema, AiJobStatusSchema, AiProviderSchema, ConnectionTierSchema, ErrorEvent, ModelTierSchema } from "./ai";
import {
  APPLICATION_DOCUMENT_KINDS,
  APPLY_PROPOSAL_FIELDS,
  CLASSIFICATION_FIELDS,
  COMPETENCIES,
  DOCUMENT_COMPOSE_STYLES,
  DRAFT_PERIOD_FIELDS,
  EXPERIENCE_TYPES,
  KEY_STATUSES,
  MAX_COMPETENCIES,
  PROJECT_TYPES,
  RETURN_TARGET_FEATURES,
  STAR_FIELDS,
  WRITING_CHAT_MESSAGE_ROLES,
  WRITING_CHAT_MESSAGE_STATUSES,
  WRITING_CHAT_SLOTS,
  WRITING_CHAT_STATUSES,
} from "./enums";

/**
 * AI writing chat contracts v4.5 (F-P1-13·F-P1-18, AI-12 v4.6 / AI-13, DM §2.5 / 2.5.0 / 2.5.1 / §3.3 / §7,
 * UX S-10 · S-44 Resumate AI 패널).
 *
 * - A chat belongs to one affiliated project (STAR chat, AI-12) or to one deliverable of a standalone
 *   project (deliverable chat, AI-13, `projectDeliverableId`). [반영] only fills the form; the page
 *   save RPC records "반영됨" (DM 3.3 v4.5 — `apply_writing_chat_proposal` is gone).
 * - `form_snapshot` (turn / start request): the form's unsaved values. Validated here, passed to the
 *   AI input, never stored or logged (DM 2.5.1).
 * - Action inputs / DTOs are camelCase. `structuredDraft` keeps the DB jsonb v3 shape
 *   (snake_case, DM §2.5) — the documented storage format the panel renders field by field.
 *   The schema is the one the AI pipeline parses (`src/server/ai/schemas/structured-draft.ts`).
 * - SSE turn events (`POST /api/writing-chats/{id}/turns`, DM §7): `turn_started` →
 *   `reply_delta`* → `reply_done` → `draft_patch` → `draft_flags` → `turn_done`, or `error`
 *   (exactly one terminal). `draft_patch` / `draft_flags` are skipped when the extract call
 *   failed or changed nothing. Deliverable chats stream `DeliverableTurnEvent`s instead (AI-13).
 * - Quick chips are computed by the screen (R-PA-5): no `chips` in DTOs or `turn_done`.
 */

/** DM §2.5 (R1 A5): user + assistant messages per chat, the greeting excluded. */
export const WRITING_CHAT_MESSAGE_LIMIT = 40;
/** DM §2.5 [가정]: writing_chat_messages.content ≤ 4,000. */
export const WRITING_CHAT_MESSAGE_MAX_CHARS = 4000;
/** UX S-10 [가정]: quick chips hide from this message_count on. */
export const QUICK_CHIPS_HIDE_FROM = 36;

const uuid = z.guid();
const isoDateTime = z.string();

// ---------- structured_draft v3 (DM §2.5 v4.4) ----------

export const StructuredDraft = StructuredDraftSchema;
export type StructuredDraft = StructuredDraftType;
/** Alias used by `src/types/db.ts` (the legacy `StructuredDraft` name there is the v1 shape). */
export type StructuredDraftV3 = StructuredDraftType;
export const DraftClarification = ClarificationSchema;
export type DraftClarification = z.infer<typeof ClarificationSchema>;

/** Parses the stored jsonb (column default `{}`). Throws on a malformed value (server bug). */
export function parseStructuredDraft(value: unknown): StructuredDraft {
  return parseStoredDraft(value);
}

// ---------- deliverable chat structured_draft (DM 2.5.0, AI-13) ----------

export const DeliverableDraft = DeliverableDraftSchema;
export type DeliverableDraft = DeliverableDraftType;
export const DeliverableDraftBody = StoredDraftBodySchema;
export const DeliverableDraftBlock = StoredBlockSchema;

/** Parses the stored jsonb of a deliverable chat. Throws on a malformed value (server bug). */
export function parseDeliverableDraft(value: unknown): DeliverableDraft {
  return parseStoredDeliverableDraft(value);
}

// ---------- 서류 대화 structured_draft (R15, DM 2.5.0b, AI-04) ----------

export const CoverLetterDraft = CoverLetterDraftSchema;
export type CoverLetterDraft = CoverLetterDraftType;
export const CoverLetterDraftBlock = CoverLetterBlockSchema;

/** Parses the stored jsonb of a 서류 대화. Throws on a malformed value (server bug). */
export function parseCoverLetterDraft(value: unknown): CoverLetterDraft {
  return parseStoredCoverLetterDraft(value);
}

/**
 * 서류 대화 slot keys: `q_1` … `q_999` (DM 2.7.3). Unlike the STAR / deliverable slots this is a
 * pattern, not a list, so `requested_slot` takes a plain string the turn service checks.
 */
export const DOCUMENT_SLOT_RE = /^q_[0-9]{1,3}$/;
export const DocumentSlotSchema = z.string().regex(DOCUMENT_SLOT_RE);

/** AI-13 slot keys (`requested_slot` of a deliverable chat). */
export const DeliverableSlotSchema = z.enum(DELIVERABLE_SLOTS);
export const WritingKindSchema = z.enum(WRITING_KINDS);
/** AI-13 chips: "지금까지 내용으로 초안 만들기" / "프로젝트 내용을 바탕으로" (R5-AI-2). */
export const DeliverableRequestedActionSchema = z.enum(DELIVERABLE_REQUESTED_ACTIONS);
export const ComposeStyleSchema = z.enum(COMPOSE_STYLES);
/** 서류 대화 style chips (R15, AI-04): a different vocabulary from the deliverable chat's. */
export const DocumentComposeStyleSchema = z.enum(DOCUMENT_COMPOSE_STYLES);

// ---------- form snapshot (DM 2.5.1, AI DA-15 — never stored, never logged) ----------

/** Characters counted like the DB (`char_length` = code points), not UTF-16 units (QA-R5-07). */
export function codePointLength(s: string): number {
  return Array.from(s).length;
}
const maxChars = (max: number) => z.string().refine((s) => codePointLength(s) <= max, { message: `max_${max}_chars` });

const YEAR_MONTH_OR_DATE_RE = /^((?:19|20)\d{2})-(0[1-9]|1[0-2])(-\d{2})?$/;
const snapshotStar = maxChars(2000).nullable();

/**
 * S-10 form snapshot: `{name, start_month, end_month, is_current, project_type, experience_type,
 * competencies, star: {situation, task, action, result, learnings}}`. A missing key = use the DB value;
 * null / "" = cleared in the form. Lengths = DB limits (name 100, STAR 2,000), else `invalid_form_snapshot`.
 * Unknown keys are dropped (only these reach the AI input).
 */
export const ProjectFormSnapshotSchema = z.object({
  name: maxChars(100).optional(),
  start_month: z.string().regex(YEAR_MONTH_OR_DATE_RE).nullable().optional(),
  end_month: z.string().regex(YEAR_MONTH_OR_DATE_RE).nullable().optional(),
  is_current: z.boolean().optional(),
  project_type: z.enum(PROJECT_TYPES).nullable().optional(),
  experience_type: z.enum(EXPERIENCE_TYPES).nullable().optional(),
  competencies: z
    .array(z.enum(COMPETENCIES))
    .max(MAX_COMPETENCIES)
    .refine((v) => new Set(v).size === v.length, { message: "duplicate_competency" })
    .optional(),
  star: z
    .object({
      situation: snapshotStar.optional(),
      task: snapshotStar.optional(),
      action: snapshotStar.optional(),
      result: snapshotStar.optional(),
      learnings: snapshotStar.optional(),
    })
    .optional(),
});
export type ProjectFormSnapshot = z.output<typeof ProjectFormSnapshotSchema>;

/** S-44 form snapshot `{title, body}` (title 100, body 20,000). */
export const DeliverableFormSnapshotSchema = z.object({
  title: maxChars(100).optional(),
  body: maxChars(20000).optional(),
});
export type DeliverableFormSnapshot = z.output<typeof DeliverableFormSnapshotSchema>;

/** Address of one field object in structured_draft (also the SSE `FieldRef`). */
export const DraftFieldPath = z.discriminatedUnion("section", [
  z.object({ section: z.literal("project"), field: z.enum(DRAFT_PERIOD_FIELDS) }),
  z.object({ section: z.literal("star"), field: z.enum(STAR_FIELDS) }),
  z.object({ section: z.literal("classification"), field: z.enum(CLASSIFICATION_FIELDS) }),
]);
export type DraftFieldPath = z.infer<typeof DraftFieldPath>;

// ---------- return target (DM §2.5 v3.2, U-5) ----------

export const ReturnTarget = z.object({
  application_project_id: uuid,
  feature: z.enum(RETURN_TARGET_FEATURES),
  /** Screen settings to restore (e.g. `{ question_count: 5 }`). Small JSON object. */
  params: z.record(z.string(), z.unknown()).default({}),
  created_at: isoDateTime,
});
export type ReturnTarget = z.infer<typeof ReturnTarget>;

/** What the client sends; the server stamps `created_at`. */
export const ReturnTargetInput = z.object({
  applicationProjectId: uuid,
  feature: z.enum(RETURN_TARGET_FEATURES),
  params: z
    .record(z.string(), z.unknown())
    .default({})
    .refine((v) => JSON.stringify(v).length <= 2000, { message: "params_too_large" }),
});

// ---------- action inputs ----------

/**
 * 패널 "+ 새 대화" / C-09 게이트 진입 (DM §3.3): affiliated projects only (DB refuses standalone).
 * `formSnapshot` only picks the greeting (DB never stores it).
 */
export const StartWritingChatInput = z.object({
  projectId: uuid,
  returnTarget: ReturnTargetInput.optional(),
  formSnapshot: ProjectFormSnapshotSchema.optional(),
});
export type StartWritingChatInput = z.input<typeof StartWritingChatInput>;

/** S-44 패널 "+ 새 대화" → `start_deliverable_writing_chat` (DM §3.3 v4.5). */
export const StartDeliverableWritingChatInput = z.object({
  projectDeliverableId: uuid,
  formSnapshot: DeliverableFormSnapshotSchema.optional(),
});
export type StartDeliverableWritingChatInput = z.input<typeof StartDeliverableWritingChatInput>;

export const DeliverableWritingChatsInput = z.object({ projectDeliverableId: uuid });
export type DeliverableWritingChatsInput = z.input<typeof DeliverableWritingChatsInput>;

export const WritingChatIdInput = z.object({ writingChatId: uuid });
export type WritingChatIdInput = z.input<typeof WritingChatIdInput>;

const YEAR_MONTH_RE = /^((?:19|20)\d{2})-(0[1-9]|1[0-2])$/;

/**
 * Proposal card direct edit → origin `user_edit`, review `ok` (DM §2.5). `null` / `''` clears.
 * Value by section: STAR text ≤ 2,000 / period 'YYYY-MM' / classification key (competencies: 1–3 keys).
 */
export const ApplyDraftEditInput = z
  .object({
    writingChatId: uuid,
    path: DraftFieldPath,
    value: z.union([z.string(), z.array(z.string()), z.null()]),
  })
  .transform((v) => ({ ...v, value: typeof v.value === "string" ? (v.value.trim() === "" ? null : v.value.trim()) : v.value }))
  .superRefine((v, ctx) => {
    const bad = (message: string) => ctx.addIssue({ code: "custom", path: ["value"], message });
    if (v.value === null) return;
    const { section, field } = v.path;
    if (section === "star") {
      if (typeof v.value !== "string" || v.value.length > 2000) bad("star_text");
    } else if (section === "project") {
      if (typeof v.value !== "string" || !YEAR_MONTH_RE.test(v.value)) bad("year_month");
    } else if (field === "competencies") {
      const list = v.value;
      if (!Array.isArray(list) || list.length === 0 || list.length > MAX_COMPETENCIES || new Set(list).size !== list.length) bad("competencies");
      else if (list.some((k) => !(COMPETENCIES as readonly string[]).includes(k))) bad("competencies");
    } else {
      const keys: readonly string[] = field === "project_type" ? PROJECT_TYPES : EXPERIENCE_TYPES;
      if (typeof v.value !== "string" || !keys.includes(v.value)) bad("classification_key");
    }
  });
export type ApplyDraftEditInput = z.input<typeof ApplyDraftEditInput>;

/**
 * Deliverable card edit (DM 2.5.0 user ops): fact [수락] / [거절], draft block [수락] / [빼기].
 * Ids are the stored fact / block ids (`facts[].id`, `deliverable.body.blocks[].block_id`).
 */
export const DeliverableDraftEditInput = z.discriminatedUnion("op", [
  z.object({ writingChatId: uuid, op: z.literal("accept_fact"), factId: z.string().min(1).max(64) }),
  z.object({ writingChatId: uuid, op: z.literal("reject_fact"), factId: z.string().min(1).max(64) }),
  z.object({ writingChatId: uuid, op: z.literal("accept_block"), blockId: z.string().min(1).max(50) }),
  z.object({ writingChatId: uuid, op: z.literal("remove_block"), blockId: z.string().min(1).max(50) }),
]);
export type DeliverableDraftEditInput = z.input<typeof DeliverableDraftEditInput>;

/** `needs_review` → accepted / rejected (value null, review ok, reviewed_at). */
export const ReviewDraftFieldInput = z.object({ writingChatId: uuid, path: DraftFieldPath });
export type ReviewDraftFieldInput = z.input<typeof ReviewDraftFieldInput>;

// ---------- turn request ----------

/**
 * Quick chip / "AI에게 물어보기": this slot goes first in focus_slots. STAR chats take AI-12 slots
 * (`period` … `learnings`), deliverable chats AI-13 slots; the turn service checks the slot against
 * the chat's target (`invalid_input`).
 */
export const RequestedSlot = z.object({ slot: z.union([z.enum(WRITING_CHAT_SLOTS), DeliverableSlotSchema, DocumentSlotSchema]) });
export type RequestedSlot = z.infer<typeof RequestedSlot>;

/** Fields shared by a new message and "다시 보내기" (AI-13 options are refused on STAR chats). */
const turnOptions = {
  requestedSlot: RequestedSlot.nullable().default(null),
  /** Deliverable chats only: chip action (`compose_draft` at draft_count 6 → 409 before the message is saved). */
  requestedAction: DeliverableRequestedActionSchema.nullable().default(null),
  /** Draft style chip; the vocabulary depends on the chat's target (deliverable / 서류). */
  style: z.union([ComposeStyleSchema, DocumentComposeStyleSchema]).nullable().default(null),
  /**
   * The page form's unsaved values (S-10 / S-44 shape by the chat's target). Validated by the turn
   * service once the target is known → `invalid_form_snapshot` (400). Never stored or logged.
   */
  formSnapshot: z.unknown().optional(),
};

/** `POST /api/writing-chats/{id}/turns` body (JSON). `?retry=1` = "다시 보내기" (no body content). */
export const WritingChatTurnInput = z.object({
  content: z.string().trim().min(1).max(WRITING_CHAT_MESSAGE_MAX_CHARS),
  ...turnOptions,
});
export type WritingChatTurnInput = z.input<typeof WritingChatTurnInput>;

/** `?retry=1` body (optional). */
export const WritingChatRetryInput = z.object({ ...turnOptions });

// ---------- DTOs ----------

/**
 * The turn job of a `failed` assistant reply (v4.11 OD-P10 / R-OD-8, DM §2.5 · §7): a stopped turn is
 * message `failed` + job `canceled` (`errorCode = "canceled"`), a real failure is job `failed` with its cause.
 * The screen shows the neutral "다시 보내기" for `canceled` and the C-11 failure copy otherwise
 * (same rule as the S-36 view: `error_code !== "canceled"`).
 */
export const WritingChatTurnFailure = z.object({
  jobStatus: AiJobStatusSchema,
  /** null when the job row has no (known) code. */
  errorCode: AiErrorCodeSchema.nullable(),
  retryAfter: isoDateTime.nullable(),
  quotaResetsAt: isoDateTime.nullable(),
});
export type WritingChatTurnFailure = z.infer<typeof WritingChatTurnFailure>;

export const WritingChatMessageDto = z.object({
  id: uuid,
  sequence: z.number().int(),
  role: z.enum(WRITING_CHAT_MESSAGE_ROLES),
  content: z.string(),
  status: z.enum(WRITING_CHAT_MESSAGE_STATUSES),
  /** "#n" (user messages only, numbered among user messages). */
  userNumber: z.number().int().nullable(),
  /** Assistant result meta (턴별 공급자 표시). Null for the fixed greeting and user messages. */
  provider: AiProviderSchema.nullable(),
  model: z.string().nullable(),
  modelTier: ModelTierSchema.nullable(),
  connectionTier: ConnectionTierSchema.nullable(),
  aiJobId: uuid.nullable(),
  /**
   * (v4.11 OD-P10) Only on a `failed` assistant reply in the chat detail read (`getWritingChat`) whose turn job
   * was found; null otherwise (user messages, done replies, SSE events).
   */
  turnFailure: WritingChatTurnFailure.nullable(),
  createdAt: isoDateTime,
});
export type WritingChatMessageDto = z.infer<typeof WritingChatMessageDto>;

/** C-19 badge + whether a new message can be sent (reading / editing / applying never need a key). */
export const WritingChatConnection = z.object({
  provider: AiProviderSchema.nullable(),
  connectionTier: ConnectionTierSchema.nullable(),
  keyStatus: z.enum(KEY_STATUSES).nullable(),
  /** null = can send; otherwise the lock reason (C-18). */
  lock: z.enum(["ai_not_connected", "key_invalid", "ai_consent_required"]).nullable(),
});
export type WritingChatConnection = z.infer<typeof WritingChatConnection>;

/** AI-12 "빠른 버튼 칩 3개" (server-computed; the label is sent as the user message with `requestedSlot`). */
export const QuickChip = z.object({ label: z.string(), requestedSlot: z.enum(STAR_FIELDS) });
export type QuickChip = z.infer<typeof QuickChip>;

/** One chat for the S-10 panel (opened chat). */
export const WritingChatDto = z.object({
  id: uuid,
  projectId: uuid,
  /** Always `project` here: a deliverable chat opens as `DeliverableWritingChatDto`. */
  target: z.literal("project"),
  /** First user message's first 30 chars (DB); null → "새 대화". */
  title: z.string().nullable(),
  status: z.enum(WRITING_CHAT_STATUSES),
  structuredDraft: StructuredDraft,
  /** "n / 40": user + AI messages, the greeting excluded (R1 A5). */
  messageCount: z.number().int(),
  messageLimit: z.literal(WRITING_CHAT_MESSAGE_LIMIT),
  remainingMessages: z.number().int().nonnegative(),
  /** No room for another turn (messageCount > 38) or `closed`: the input is disabled. */
  limitReached: z.boolean(),
  lastActivityAt: isoDateTime,
  lastAppliedAt: isoDateTime.nullable(),
  returnTarget: ReturnTarget.nullable(),
  createdAt: isoDateTime,
  messages: z.array(WritingChatMessageDto),
  connection: WritingChatConnection,
  /** "검토가 필요한 항목 N개" (pending needs_review fields). */
  needsReviewCount: z.number().int().nonnegative(),
  /** Pending proposal fields [모두 반영] would fill now (review ok / accepted, not applied). */
  applicableFields: z.array(z.enum(APPLY_PROPOSAL_FIELDS)),
  /** True when the chat accepts new messages (active, under the limit, no lock, no reply running). */
  canSend: z.boolean(),
});
export type WritingChatDto = z.infer<typeof WritingChatDto>;

/** AI-13 drafts per chat (DM 2.5.0 `draft_count` ≤ 6 [가정]). */
export const DELIVERABLE_DRAFT_LIMIT = 6;

/** One deliverable chat for the S-44 panel. Chips are the screen's (`deliverableChips`, R-PA-5). */
export const DeliverableWritingChatDto = z.object({
  id: uuid,
  target: z.literal("project_deliverable"),
  /** The deliverable's parent standalone project. */
  projectId: uuid,
  projectDeliverableId: uuid,
  title: z.string().nullable(),
  status: z.enum(WRITING_CHAT_STATUSES),
  structuredDraft: DeliverableDraftSchema,
  /** structured_draft.draft_count; the screen shows 6 − draftCount. */
  draftCount: z.number().int().nonnegative(),
  draftLimit: z.literal(DELIVERABLE_DRAFT_LIMIT),
  messageCount: z.number().int(),
  messageLimit: z.literal(WRITING_CHAT_MESSAGE_LIMIT),
  remainingMessages: z.number().int().nonnegative(),
  limitReached: z.boolean(),
  lastActivityAt: isoDateTime,
  lastAppliedAt: isoDateTime.nullable(),
  createdAt: isoDateTime,
  messages: z.array(WritingChatMessageDto),
  connection: WritingChatConnection,
  /** Facts still needs_review ("검토가 필요한 항목 N개"). */
  needsReviewCount: z.number().int().nonnegative(),
  canSend: z.boolean(),
});
export type DeliverableWritingChatDto = z.infer<typeof DeliverableWritingChatDto>;

/** 서류 대화 drafts per chat — **초안 턴 6회** (DM 2.9.4, AI 명세 C-14; R15-API-7 판정: 턴당 1). */
export const DOCUMENT_DRAFT_LIMIT = 6;

/**
 * One 서류 대화 for the S-46 panel (R15 후속, DM 7장 25행). Same shape and conventions as
 * `DeliverableWritingChatDto`; the target is `(applicationProjectId, documentKind)` and there is no
 * project.
 *
 * **Key case**: like every chat DTO, `structuredDraft` is the **stored jsonb as is** (snake_case —
 * `draft_count`, `document.questions[].draft.sources[]` `{source_type, source_id, role}`,
 * `answer_title`, block `source_fact_ids` …), the same object the SSE `draft_patch` event carries.
 * The DTO's own fields are camelCase. The only camelCase rename of draft-derived data is the SSE
 * `sources_selected` display card (`DocumentSourcesSelectedEvent`), which is a separate payload —
 * the screen reads the stored proposal from `structuredDraft`, never from that event.
 */
export const DocumentWritingChatDto = z.object({
  id: uuid,
  target: z.literal("application_document"),
  applicationProjectId: uuid,
  documentKind: z.enum(APPLICATION_DOCUMENT_KINDS),
  title: z.string().nullable(),
  status: z.enum(WRITING_CHAT_STATUSES),
  structuredDraft: CoverLetterDraftSchema,
  /** structured_draft.draft_count (초안 턴 수); the screen shows 6 − draftCount. */
  draftCount: z.number().int().nonnegative(),
  draftLimit: z.literal(DOCUMENT_DRAFT_LIMIT),
  messageCount: z.number().int(),
  messageLimit: z.literal(WRITING_CHAT_MESSAGE_LIMIT),
  remainingMessages: z.number().int().nonnegative(),
  limitReached: z.boolean(),
  lastActivityAt: isoDateTime,
  lastAppliedAt: isoDateTime.nullable(),
  createdAt: isoDateTime,
  messages: z.array(WritingChatMessageDto),
  connection: WritingChatConnection,
  /** Facts still needs_review ("검토가 필요한 항목 N개"). */
  needsReviewCount: z.number().int().nonnegative(),
  canSend: z.boolean(),
  /**
   * R15 후속 4: display labels of each proposal's `draft.sources[]`, keyed by slot, in the **same
   * order** as that slot's `structuredDraft.document.questions[].draft.sources` (pair by index for
   * the stored `role`). `label` is the same string the live SSE `sources_selected` card showed
   * ("부모 › 프로젝트"); `deleted: true` + `label: null` when the source row is gone (원본 삭제됨).
   * A separate field on purpose: `structuredDraft` stays the stored shape. No rationale (CF-S1).
   */
  sourceLabels: z.record(
    z.string(),
    z.array(z.object({ sourceType: z.string(), sourceId: z.string(), label: z.string().nullable(), deleted: z.boolean() })),
  ),
});
export type DocumentWritingChatDto = z.infer<typeof DocumentWritingChatDto>;

/** Any panel's opened chat (`getWritingChat` answers by the chat's target). */
export type AnyWritingChatDto = WritingChatDto | DeliverableWritingChatDto | DocumentWritingChatDto;

/** S-46 패널 대화 기록 목록 input: the 서류's chats (DM 7장 25행). */
export const DocumentWritingChatsInput = z.object({
  applicationProjectId: uuid,
  documentKind: z.enum(APPLICATION_DOCUMENT_KINDS).default("cover_letter"),
});
export type DocumentWritingChatsInput = z.input<typeof DocumentWritingChatsInput>;

/** S-10 패널 대화 기록 목록 (DM §7: id, title, status, message_count, last_activity_at, last_applied_at). */
export const ProjectWritingChatSummary = z.object({
  id: uuid,
  title: z.string().nullable(),
  /** `closed` → "끝난 대화" (열람·반영만). */
  status: z.enum(WRITING_CHAT_STATUSES),
  lastActivityAt: isoDateTime,
  lastAppliedAt: isoDateTime.nullable(),
  messageCount: z.number().int(),
  messageLimit: z.literal(WRITING_CHAT_MESSAGE_LIMIT),
});
export type ProjectWritingChatSummary = z.infer<typeof ProjectWritingChatSummary>;

export const ProjectWritingChatsInput = z.object({ projectId: uuid });
export type ProjectWritingChatsInput = z.input<typeof ProjectWritingChatsInput>;

export const StartWritingChatResult = z.object({ writingChatId: uuid });
export type StartWritingChatResult = z.infer<typeof StartWritingChatResult>;

/** Preview edit / review result: the new draft and what changed for the panel. */
export type DraftEditResult = { structuredDraft: StructuredDraft; needsReviewCount: number; applicableFields: (typeof APPLY_PROPOSAL_FIELDS)[number][] };

/** Deliverable card edit (fact accept / reject, block accept / remove) result. */
export type DeliverableDraftEditResult = { structuredDraft: DeliverableDraft; needsReviewCount: number };

// ---------- SSE turn events (DM §7 대화 턴, AI-12 응답 모드) ----------

export const TurnStartedEvent = z.object({
  type: z.literal("turn_started"),
  jobId: uuid,
  /** The user message this turn answers (new, or the same one on "다시 보내기"). */
  userMessage: WritingChatMessageDto,
  assistantMessageId: uuid,
  provider: AiProviderSchema,
  connectionTier: ConnectionTierSchema,
  messageCount: z.number().int(),
  retry: z.boolean(),
});
export const ReplyDeltaEvent = z.object({
  type: z.literal("reply_delta"),
  text: z.string(),
});
export const ReplyDoneEvent = z.object({
  type: z.literal("reply_done"),
  message: WritingChatMessageDto,
});
export const DraftPatchEvent = z.object({
  type: z.literal("draft_patch"),
  /** Authoritative structured_draft after the patch (what the RPC returned). */
  structuredDraft: StructuredDraft,
  /** Fields this turn changed (card highlight). */
  changed: z.array(DraftFieldPath),
});
export const DraftFlagsEvent = z.object({
  type: z.literal("draft_flags"),
  /** Fields this turn left as needs_review (V-9e). */
  needsReview: z.array(DraftFieldPath),
  /** Team-subject `action` (V-9f). */
  actorAmbiguous: z.array(DraftFieldPath),
  /** Sensitive items left out this turn (V-9g) → "이 내용은 기록하지 않을게요". */
  sensitiveAdded: z.number().int().nonnegative(),
  sensitiveFlagsCount: z.number().int().nonnegative(),
  /** STAR fields that would pass 2,000 chars with more text (C-14) → "글자 수가 가득 찼어요". */
  lengthFull: z.array(z.enum(STAR_FIELDS)),
  clarifications: z.array(DraftClarification),
});
export const TurnDoneEvent = z.object({
  type: z.literal("turn_done"),
  jobId: uuid,
  messageCount: z.number().int(),
  /** 40 − messageCount (R1 A5). */
  remainingMessages: z.number().int().nonnegative(),
  limitReached: z.boolean(),
  /** The chat is now `closed` (the 40th message was this reply): "새 대화에서 이어 하기". */
  closed: z.boolean(),
  /** `updated` (draft_patch sent), `unchanged`, `failed` (extract failed; retried next turn, AI-12). */
  draftStatus: z.enum(["updated", "unchanged", "failed"]),
  /** Gate chat whose feature is ready now (D-01 met) → C-10 "돌아가기". */
  readyToReturn: z.boolean(),
  needsReviewCount: z.number().int().nonnegative(),
  applicableFields: z.array(z.enum(APPLY_PROPOSAL_FIELDS)),
});

export const WritingChatTurnEventSchema = z.discriminatedUnion("type", [
  TurnStartedEvent,
  ReplyDeltaEvent,
  ReplyDoneEvent,
  DraftPatchEvent,
  DraftFlagsEvent,
  TurnDoneEvent,
  ErrorEvent,
]);
export type WritingChatTurnEvent = z.infer<typeof WritingChatTurnEventSchema>;
export type WritingChatTurnEventType = WritingChatTurnEvent["type"];
export const WRITING_CHAT_TURN_EVENT_TYPES = [
  "turn_started",
  "reply_delta",
  "reply_done",
  "draft_patch",
  "draft_flags",
  "turn_done",
  "error",
] as const satisfies readonly WritingChatTurnEventType[];
export const WRITING_CHAT_TURN_TERMINAL_EVENTS = ["turn_done", "error"] as const satisfies readonly WritingChatTurnEventType[];

// ---------- SSE turn events of a deliverable chat (AI-13, DM §7 v4.5) ----------
//
// Question turn: turn_started → reply_delta* → reply_done → facts_patch → draft_flags → turn_done.
// Draft turn:    turn_started → facts_patch → draft_flags → draft_started → draft_block* → draft_done →
//                reply_done (fixed message) → turn_done. No content block left: no draft_done.
//                Not possible (too few facts / limit / unconfirmed request): reply_delta* → reply_done.
// Exactly one terminal: turn_done or error.

/** The facts patch the RPC stored (authoritative deliverable draft, fact ids are UUIDs). */
export const FactsPatchEvent = z.object({
  type: z.literal("facts_patch"),
  structuredDraft: DeliverableDraftSchema,
  /** Fact ids added this turn (card highlight). */
  added: z.array(z.string()),
});
/** AI-13 flags (ids / booleans / counts only — `deliverableDraftFlags`). */
export const DeliverableDraftFlagsEvent = z.object({
  type: z.literal("draft_flags"),
  /** Fact ids still needs_review. */
  needsReview: z.array(z.string()),
  actorAmbiguous: z.boolean(),
  numberVague: z.boolean(),
  sensitiveAdded: z.number().int().nonnegative(),
  sensitiveFlagsCount: z.number().int().nonnegative(),
  clarifications: z.array(DeliverableClarificationSchema),
});
/** A compose call starts. attempt 2 = schema retry / V-10 regeneration: drop the blocks of attempt 1. */
export const DraftStartedEvent = z.object({
  type: z.literal("draft_started"),
  attempt: z.number().int().positive(),
  reason: z.enum(["initial", "schema_retry", "regenerate"]),
});
/** One block that passed V-10a–g (provisional — `draft_done.body` is authoritative). */
export const DraftBlockEvent = z.object({
  type: z.literal("draft_block"),
  attempt: z.number().int().positive(),
  block: StoredBlockSchema,
});
/** The stored draft (RPC answer) + the full V-10 result. */
export const DraftDoneEvent = z.object({
  type: z.literal("draft_done"),
  body: StoredDraftBodySchema,
  rev: z.number().int().positive(),
  draftCount: z.number().int().nonnegative(),
  droppedBlockCount: z.number().int().nonnegative(),
  needsReviewBlockIds: z.array(z.string()),
  missingSlots: z.array(z.string()),
  replaceAllowed: z.boolean(),
});
export const DeliverableTurnDoneEvent = z.object({
  type: z.literal("turn_done"),
  jobId: uuid,
  messageCount: z.number().int(),
  remainingMessages: z.number().int().nonnegative(),
  limitReached: z.boolean(),
  closed: z.boolean(),
  /** `updated` (facts or draft stored), `unchanged`, `failed` (extract / draft failed). */
  draftStatus: z.enum(["updated", "unchanged", "failed"]),
  /** structured_draft.draft_count after this turn (R-PA-15). */
  draftCount: z.number().int().nonnegative(),
  /** Deliverable chats have no return target. */
  readyToReturn: z.literal(false),
  needsReviewCount: z.number().int().nonnegative(),
});

export const DeliverableTurnEventSchema = z.discriminatedUnion("type", [
  TurnStartedEvent,
  ReplyDeltaEvent,
  ReplyDoneEvent,
  FactsPatchEvent,
  DeliverableDraftFlagsEvent,
  DraftStartedEvent,
  DraftBlockEvent,
  DraftDoneEvent,
  DeliverableTurnDoneEvent,
  ErrorEvent,
]);
export type DeliverableTurnEvent = z.infer<typeof DeliverableTurnEventSchema>;
export const DELIVERABLE_TURN_EVENT_TYPES = [
  "turn_started",
  "reply_delta",
  "reply_done",
  "facts_patch",
  "draft_flags",
  "draft_started",
  "draft_block",
  "draft_done",
  "turn_done",
  "error",
] as const satisfies readonly DeliverableTurnEvent["type"][];

// ---------- SSE turn events of a 서류 대화 (R15, AI-04; leader decision R15-L2) ----------
//
// The event NAMES are the deliverable turn's (no new names were invented); a 서류 draft turn
// writes up to three questions in one call (CL-10), so `sources_selected`, `draft_started`,
// `draft_block`, `adjusting_length` and `draft_done` carry a `slot` (`q_{n}`) and the screen's
// question number `questionNo`. `useAiStream`'s return shape does not change.
//
// Question turn: turn_started → reply_delta* → reply_done → draft_patch → draft_flags → turn_done.
// Draft turn:    turn_started → draft_patch → draft_flags →
//                (per question) sources_selected → draft_started → draft_block* →
//                [adjusting_length] → (per question) draft_done →
//                reply_done (fixed message) → turn_done.
// Exactly one terminal: turn_done or error.

/** The facts / tone patch the RPC stored (authoritative 서류 draft). */
export const DocumentDraftPatchEvent = z.object({
  type: z.literal("draft_patch"),
  structuredDraft: CoverLetterDraftSchema,
  /** Fact ids added this turn (card highlight). */
  added: z.array(z.string()),
});

/** AI-04 flags (ids / counts only). */
export const DocumentDraftFlagsEvent = z.object({
  type: z.literal("draft_flags"),
  /** Fact ids still needs_review. */
  needsReview: z.array(z.string()),
  sensitiveAdded: z.number().int().nonnegative(),
  sensitiveFlagsCount: z.number().int().nonnegative(),
  clarifications: z.array(CoverLetterClarificationStoredSchema),
});

/** The sources AI-04 chose for one question (display only; the stored rows come from the save RPC). */
export const DocumentSourcesSelectedEvent = z.object({
  type: z.literal("sources_selected"),
  slot: DocumentSlotSchema,
  questionNo: z.number().int().positive(),
  questionClass: z.string(),
  /** Display cards (C-11 근거 칩). The stored `{slot}.sources.{n}` rows come from the save RPC (CF-S1). */
  sources: z.array(
    z.object({
      sortOrder: z.number().int().nonnegative(),
      role: z.enum(["primary", "supporting"]),
      experienceId: uuid.nullable(),
      educationId: uuid.nullable(),
      projectId: uuid.nullable(),
      /** "회사명 › 프로젝트명" (server-built from the rows). */
      label: z.string(),
      rationale: z.string(),
      reuseReason: z.string().nullable(),
      requirementIds: z.array(uuid),
    }),
  ),
});

/** A compose call starts. attempt 2 = schema retry: drop the blocks of attempt 1. */
export const DocumentDraftStartedEvent = z.object({
  type: z.literal("draft_started"),
  attempt: z.number().int().positive(),
  reason: z.enum(["initial", "schema_retry"]),
  /** The questions this call writes (CL-10: at most 3). */
  slots: z.array(DocumentSlotSchema),
});

/** One paragraph that passed validation (provisional — `draft_done` is authoritative). */
export const DocumentDraftBlockEvent = z.object({
  type: z.literal("draft_block"),
  slot: DocumentSlotSchema,
  questionNo: z.number().int().positive(),
  attempt: z.number().int().positive(),
  block: CoverLetterBlockSchema,
});

/** Right before the length-correction call, for the questions that need it. */
export const DocumentAdjustingLengthEvent = z.object({
  type: z.literal("adjusting_length"),
  questions: z.array(
    z.object({
      slot: DocumentSlotSchema,
      questionNo: z.number().int().positive(),
      charCount: z.number().int().nonnegative(),
      charLimit: z.number().int().positive(),
      countBasis: z.enum(["with_spaces", "without_spaces"]),
      reasons: z.array(z.enum(["length", "numbers"])),
    }),
  ),
});

/** One question's stored proposal (the RPC's `rev` / `draft_count` + the pipeline's result). */
export const DocumentDraftDoneEvent = z.object({
  type: z.literal("draft_done"),
  slot: DocumentSlotSchema,
  questionNo: z.number().int().positive(),
  /** CF-6: null when the title was dropped by validation (the body survives). */
  answerTitle: z.string().nullable(),
  charCount: z.number().int().nonnegative(),
  charLimit: z.number().int().positive().nullable(),
  charAdjustNeeded: z.boolean(),
  correctionApplied: z.boolean(),
  needsReviewBlockIds: z.array(z.string()),
  droppedBlockCount: z.number().int().nonnegative(),
  /** `structured_draft.document.questions[].draft.rev` (per slot, monotonic). */
  rev: z.number().int().positive(),
  /** Draft proposals used in this chat (DM 2.9.4: 6 per chat, not per slot). */
  draftCount: z.number().int().nonnegative(),
  /**
   * R15 후속 3 (리더 판정): the slot's **stored** proposal as
   * `structured_draft.document.questions[].draft` holds it after the patch RPC, parsed through
   * `CoverLetterQuestionDraftSchema` — so every field [반영] reads is identical to the stored copy
   * (QA follow-up round 2), but the schema normalizes always-empty optional arrays (e.g.
   * `requirement_ids` / `source_project_fields`), exactly as the reload DTO does. The same role as
   * the deliverable `draft_done.body`. `draft_block` is provisional (it streams **before** the
   * 글자 수 보정), so [반영] must read this: corrected `blocks`, the `value` the DB rebuilt from
   * them, `base_body_hash`, `answer_title`, `sources` (CF-S1) and `rev`.
   * Inside it is the stored shape (snake_case), like `draft_block.block`; the outer fields are camelCase.
   */
  draft: CoverLetterQuestionDraftSchema,
});

export const DocumentTurnDoneEvent = z.object({
  type: z.literal("turn_done"),
  jobId: uuid,
  messageCount: z.number().int(),
  remainingMessages: z.number().int().nonnegative(),
  limitReached: z.boolean(),
  closed: z.boolean(),
  draftStatus: z.enum(["updated", "unchanged", "failed"]),
  draftCount: z.number().int().nonnegative(),
  /** 서류 대화 has no return target (`start_document_writing_chat` takes none). */
  readyToReturn: z.literal(false),
  needsReviewCount: z.number().int().nonnegative(),
});

export const DocumentTurnEventSchema = z.discriminatedUnion("type", [
  TurnStartedEvent,
  ReplyDeltaEvent,
  ReplyDoneEvent,
  DocumentDraftPatchEvent,
  DocumentDraftFlagsEvent,
  DocumentSourcesSelectedEvent,
  DocumentDraftStartedEvent,
  DocumentDraftBlockEvent,
  DocumentAdjustingLengthEvent,
  DocumentDraftDoneEvent,
  DocumentTurnDoneEvent,
  ErrorEvent,
]);
export type DocumentTurnEvent = z.infer<typeof DocumentTurnEventSchema>;

export const DOCUMENT_TURN_EVENT_TYPES = [
  "turn_started",
  "reply_delta",
  "reply_done",
  "draft_patch",
  "draft_flags",
  "sources_selected",
  "draft_started",
  "draft_block",
  "adjusting_length",
  "draft_done",
  "turn_done",
  "error",
] as const satisfies readonly DocumentTurnEvent["type"][];

/** Any event of the turn route (the chat's target picks the set). */
export type AnyWritingChatTurnEvent = WritingChatTurnEvent | DeliverableTurnEvent | DocumentTurnEvent;
