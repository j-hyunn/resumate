import { z } from "zod";
import {
  ClarificationSchema,
  StructuredDraftSchema,
  parseStructuredDraft as parseStoredDraft,
  type StructuredDraft as StructuredDraftType,
} from "@/server/ai/schemas/structured-draft";
import { AiProviderSchema, ConnectionTierSchema, ErrorEvent, ModelTierSchema } from "./ai";
import {
  APPLY_PROPOSAL_FIELDS,
  APPLY_PROPOSAL_SKIP_REASONS,
  CAREER_STATUSES,
  CLASSIFICATION_FIELDS,
  COMPETENCIES,
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
 * AI writing chat contracts v4.4 (F-P1-13, AI-12 v4.5, DM §2.5 / §3.3 / §7, UX S-10 Resumate AI 패널).
 *
 * - Every chat belongs to one affiliated project; a project has many chats (CR-5·CR-6).
 * - Action inputs / DTOs are camelCase. `structuredDraft` keeps the DB jsonb v3 shape
 *   (snake_case, DM §2.5) — the documented storage format the panel renders field by field.
 *   The schema is the one the AI pipeline parses (`src/server/ai/schemas/structured-draft.ts`).
 * - SSE turn events (`POST /api/writing-chats/{id}/turns`, DM §7): `turn_started` →
 *   `reply_delta`* → `reply_done` → `draft_patch` → `draft_flags` → `turn_done`, or `error`
 *   (exactly one terminal). `draft_patch` / `draft_flags` are skipped when the extract call
 *   failed or changed nothing.
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

/** 패널 "+ 새 대화" / C-09 게이트 진입 (DM §3.3): affiliated projects only (DB refuses standalone). */
export const StartWritingChatInput = z.object({
  projectId: uuid,
  returnTarget: ReturnTargetInput.optional(),
});
export type StartWritingChatInput = z.input<typeof StartWritingChatInput>;

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

/** `needs_review` → accepted / rejected (value null, review ok, reviewed_at). */
export const ReviewDraftFieldInput = z.object({ writingChatId: uuid, path: DraftFieldPath });
export type ReviewDraftFieldInput = z.input<typeof ReviewDraftFieldInput>;

/** [반영] (one field) / [모두 반영] (`fields` omitted) → apply_writing_chat_proposal (DM §3.3). */
export const ApplyProposalInput = z.object({
  writingChatId: uuid,
  fields: z
    .array(z.enum(APPLY_PROPOSAL_FIELDS))
    .min(1)
    .refine((v) => new Set(v).size === v.length, { message: "duplicate_field" })
    .optional(),
});
export type ApplyProposalInput = z.input<typeof ApplyProposalInput>;

/** RPC `apply_writing_chat_proposal` jsonb (DM §3.3). */
export const ApplyProposalRpcResult = z.object({
  applied: z.array(z.enum(APPLY_PROPOSAL_FIELDS)),
  skipped: z.array(z.object({ field: z.enum(APPLY_PROPOSAL_FIELDS), reason: z.enum(APPLY_PROPOSAL_SKIP_REASONS) })),
  project_status: z.enum(CAREER_STATUSES),
});
export type ApplyProposalRpcResult = z.infer<typeof ApplyProposalRpcResult>;

// ---------- turn request ----------

/** Quick chip / "AI에게 물어보기": this slot goes first in focus_slots (AI-12 v4.5). */
export const RequestedSlot = z.object({ slot: z.enum(WRITING_CHAT_SLOTS) });
export type RequestedSlot = z.infer<typeof RequestedSlot>;

/** `POST /api/writing-chats/{id}/turns` body (JSON). `?retry=1` = "다시 보내기" (no body content). */
export const WritingChatTurnInput = z.object({
  content: z.string().trim().min(1).max(WRITING_CHAT_MESSAGE_MAX_CHARS),
  requestedSlot: RequestedSlot.nullable().default(null),
});
export type WritingChatTurnInput = z.input<typeof WritingChatTurnInput>;

/** `?retry=1` body (optional). */
export const WritingChatRetryInput = z.object({
  requestedSlot: RequestedSlot.nullable().default(null),
});

// ---------- DTOs ----------

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
  /** Quick chips for the current state (hidden from QUICK_CHIPS_HIDE_FROM messages on). */
  chips: z.array(QuickChip),
  /** "검토가 필요한 항목 N개" (pending needs_review fields). */
  needsReviewCount: z.number().int().nonnegative(),
  /** Pending proposal fields [모두 반영] would write now (review ok / accepted, not applied). */
  applicableFields: z.array(z.enum(APPLY_PROPOSAL_FIELDS)),
  /** True when the chat accepts new messages (active, under the limit, no lock, no reply running). */
  canSend: z.boolean(),
});
export type WritingChatDto = z.infer<typeof WritingChatDto>;

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

/** [반영] result: the RPC's answer + the project's new STAR / period / classification for the left side. */
export type ApplyProposalResult = {
  applied: ApplyProposalRpcResult["applied"];
  skipped: ApplyProposalRpcResult["skipped"];
  projectStatus: ApplyProposalRpcResult["project_status"];
  structuredDraft: StructuredDraft;
};

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
  /** Quick chips from the RPC's new draft (AI-12). Empty from QUICK_CHIPS_HIDE_FROM messages on. */
  chips: z.array(QuickChip),
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
