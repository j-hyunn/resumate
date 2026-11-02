import { z } from "zod";
import { AiProviderSchema, ConnectionTierSchema, ErrorEvent, ModelTierSchema } from "./ai";
import {
  CLARIFICATION_KINDS,
  DRAFT_ACHIEVEMENT_FIELDS,
  DRAFT_DETAIL_FIELDS,
  DRAFT_FIELD_ORIGINS,
  DRAFT_FIELD_REVIEWS,
  DRAFT_PROJECT_FIELDS,
  KEY_STATUSES,
  RETURN_TARGET_FEATURES,
  WRITING_CHAT_MESSAGE_ROLES,
  WRITING_CHAT_MESSAGE_STATUSES,
  WRITING_CHAT_MODES,
  WRITING_CHAT_SLOTS,
  WRITING_CHAT_STATUSES,
} from "./enums";

/**
 * S4 AI writing chat contracts (F-P1-13, AI-12, DM §2.5 / §3.3 / §7, UX S-36 / S-08).
 *
 * - Action inputs / DTOs are camelCase. `structuredDraft` keeps the DB jsonb
 *   shape (snake_case, DM §2.5) because it IS the documented storage format and
 *   the screen renders it field by field.
 * - SSE turn events (`POST /api/writing-chats/{id}/turns`): `turn_started` →
 *   `reply_delta`* → `reply_done` → `draft_patch` → `draft_flags` → `turn_done`,
 *   or `error` (exactly one terminal: `turn_done` or `error`). `draft_patch` /
 *   `draft_flags` are skipped when the extract call failed or changed nothing.
 */

/** DM §2.5 / D-34: user + assistant messages per chat (the fixed greeting counts, spec-gaps 2026-10-30 ②). */
export const WRITING_CHAT_MESSAGE_LIMIT = 40;
/** DM §2.5 [가정]: writing_chat_messages.content ≤ 4,000. */
export const WRITING_CHAT_MESSAGE_MAX_CHARS = 4000;
/** DM §3.4 [가정] (U-9): unbound chats (no project) are deleted 90 days after the last activity. */
export const WRITING_CHAT_RETENTION_DAYS = 90;

const uuid = z.guid();
const isoDateTime = z.string();

// ---------- structured_draft (DM §2.5, schema_version 1) ----------

export const DraftFieldValue = z.union([z.string(), z.number(), z.null()]);

/** One field object. `source_message_ids` are user messages of the same chat only (V-9a). */
export const DraftField = z.object({
  value: DraftFieldValue,
  origin: z.enum(DRAFT_FIELD_ORIGINS),
  source_message_ids: z.array(uuid).default([]),
  source_quotes: z.array(z.string()).default([]),
  review: z.enum(DRAFT_FIELD_REVIEWS),
  reviewed_at: isoDateTime.nullable().default(null),
});
export type DraftField = z.infer<typeof DraftField>;

const projectFieldsShape = Object.fromEntries(DRAFT_PROJECT_FIELDS.map((f) => [f, DraftField.optional()])) as Record<
  (typeof DRAFT_PROJECT_FIELDS)[number],
  z.ZodOptional<typeof DraftField>
>;
const detailFieldsShape = Object.fromEntries(DRAFT_DETAIL_FIELDS.map((f) => [f, DraftField.optional()])) as Record<
  (typeof DRAFT_DETAIL_FIELDS)[number],
  z.ZodOptional<typeof DraftField>
>;
const achievementFieldsShape = Object.fromEntries(DRAFT_ACHIEVEMENT_FIELDS.map((f) => [f, DraftField.optional()])) as Record<
  (typeof DRAFT_ACHIEVEMENT_FIELDS)[number],
  z.ZodOptional<typeof DraftField>
>;

/** One quantitative achievement; `achievement_key` (A1, A2…) is assigned by the patch RPC. */
export const DraftAchievement = z.object({ achievement_key: z.string().nullable().default(null), ...achievementFieldsShape });
export type DraftAchievement = z.infer<typeof DraftAchievement>;

export const DraftDetail = z.object({
  /** New detail: conversation-scoped key (D1, D2…). Null for an existing detail. */
  detail_key: z.string().nullable().default(null),
  /** augment_project: the existing project_details row whose EMPTY fields this fills. */
  existing_detail_id: uuid.nullable().default(null),
  fields: z.object(detailFieldsShape).default({}),
  achievements: z.array(DraftAchievement).default([]),
});
export type DraftDetail = z.infer<typeof DraftDetail>;

export const DraftSkill = z.object({
  value: z.string(),
  source_message_ids: z.array(uuid).default([]),
  source_quotes: z.array(z.string()).default([]),
});
export type DraftSkill = z.infer<typeof DraftSkill>;

export const DraftAffiliationSuggestion = z.object({
  type: z.enum(["experience", "education"]),
  id: uuid,
  source_message_ids: z.array(uuid).default([]),
});

export const DraftClarification = z.object({
  kind: z.enum(CLARIFICATION_KINDS),
  field: z.string().nullable().default(null),
  detail_key: z.string().nullable().default(null),
  existing_detail_id: uuid.nullable().default(null),
});
export type DraftClarification = z.infer<typeof DraftClarification>;

/** `writing_chats.structured_draft`. The column default is `{}`, so every key is optional. */
export const StructuredDraft = z.object({
  schema_version: z.number().int().optional(),
  project: z.object(projectFieldsShape).default({}),
  affiliation_suggestion: DraftAffiliationSuggestion.nullable().default(null),
  details: z.array(DraftDetail).default([]),
  skills: z.array(DraftSkill).default([]),
  clarifications: z.array(DraftClarification).default([]),
  sensitive_flags_count: z.number().int().nonnegative().default(0),
});
export type StructuredDraft = z.infer<typeof StructuredDraft>;

/** Parses the stored jsonb (lenient defaults). Unknown keys are dropped. */
export function parseStructuredDraft(value: unknown): StructuredDraft {
  return StructuredDraft.parse(value ?? {});
}

// ---------- field paths (preview edits, highlights, flags) ----------

/** Which detail: a new one by its conversation key, or an existing row (augment). */
export const DetailRef = z.union([
  z.object({ detailKey: z.string().regex(/^D[1-9][0-9]{0,2}$/) }),
  z.object({ existingDetailId: uuid }),
]);
export type DetailRef = z.infer<typeof DetailRef>;

/** Address of one field object in structured_draft. */
export const DraftFieldPath = z.discriminatedUnion("section", [
  z.object({ section: z.literal("project"), field: z.enum(DRAFT_PROJECT_FIELDS) }),
  z.object({ section: z.literal("detail"), detail: DetailRef, field: z.enum(DRAFT_DETAIL_FIELDS) }),
  z.object({
    section: z.literal("achievement"),
    /** `achievement_key` of the item (A1, A2…). */
    achievementKey: z.string().regex(/^A[1-9][0-9]{0,3}$/),
    field: z.enum(DRAFT_ACHIEVEMENT_FIELDS),
  }),
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

export const StartWritingChatInput = z.discriminatedUnion("mode", [
  z.object({ mode: z.literal("new_project"), returnTarget: ReturnTargetInput.optional() }),
  z.object({ mode: z.literal("augment_project"), projectId: uuid, returnTarget: ReturnTargetInput.optional() }),
]);
export type StartWritingChatInput = z.input<typeof StartWritingChatInput>;

export const WritingChatIdInput = z.object({ writingChatId: uuid });
export type WritingChatIdInput = z.input<typeof WritingChatIdInput>;

const fieldValue = z.union([z.string().trim().max(2000), z.number().finite(), z.null()]);

/** Preview direct edit → origin `user_edit`, review `ok` (DM §2.5). `null` / `''` clears the value. */
export const ApplyDraftEditInput = z.object({
  writingChatId: uuid,
  path: DraftFieldPath,
  value: fieldValue.transform((v) => (v === "" ? null : v)),
});
export type ApplyDraftEditInput = z.input<typeof ApplyDraftEditInput>;

/** `needs_review` → accepted / rejected (value null, review ok, reviewed_at). */
export const ReviewDraftFieldInput = z.object({ writingChatId: uuid, path: DraftFieldPath });
export type ReviewDraftFieldInput = z.input<typeof ReviewDraftFieldInput>;

/** Preview "사용 기술": add one / remove one (normalized-name match, DM §2.5 skills[]). */
export const EditDraftSkillInput = z.object({
  writingChatId: uuid,
  action: z.enum(["add", "remove"]),
  value: z.string().trim().min(1).max(50),
});
export type EditDraftSkillInput = z.input<typeof EditDraftSkillInput>;

/** Preview cards: add a new detail card / remove a card (the career rows are never touched). */
export const EditDraftDetailInput = z.discriminatedUnion("action", [
  z.object({ writingChatId: uuid, action: z.literal("add"), detailKey: z.string().regex(/^D[1-9][0-9]{0,2}$/) }),
  z.object({ writingChatId: uuid, action: z.literal("remove"), detail: DetailRef }),
]);
export type EditDraftDetailInput = z.input<typeof EditDraftDetailInput>;

/** Preview 정량 성과: add one to a detail (at least one value) / remove one by key. */
export const EditDraftAchievementInput = z.discriminatedUnion("action", [
  z.object({
    writingChatId: uuid,
    action: z.literal("add"),
    detail: DetailRef,
    fields: z
      .object({
        metric_name: z.string().trim().min(1).max(200).optional(),
        value_before: z.number().finite().optional(),
        value_after: z.number().finite().optional(),
        unit: z.string().trim().min(1).max(50).optional(),
      })
      .refine((f) => Object.values(f).some((v) => v !== undefined), { message: "empty_achievement" }),
  }),
  z.object({ writingChatId: uuid, action: z.literal("remove"), achievementKey: z.string().regex(/^A[1-9][0-9]{0,3}$/) }),
]);
export type EditDraftAchievementInput = z.input<typeof EditDraftAchievementInput>;

/**
 * Affiliation (S-36 소속 칸): connect / pick directly (one id) / "아니요" (none:
 * clears only the suggestion when `clearSuggestionOnly`) / clear.
 */
export const SetAffiliationInput = z.object({
  writingChatId: uuid,
  affiliation: z.discriminatedUnion("type", [
    z.object({ type: z.literal("experience"), id: uuid }),
    z.object({ type: z.literal("education"), id: uuid }),
    z.object({ type: z.literal("none") }),
  ]),
  /** "[아니요]": drop the AI suggestion, keep the confirmed affiliation as is. */
  clearSuggestionOnly: z.boolean().default(false),
});
export type SetAffiliationInput = z.input<typeof SetAffiliationInput>;

// ---------- turn request ----------

/** `POST /api/writing-chats/{id}/turns` body (JSON). `?retry=1` = "다시 보내기" (no body content). */
/** R-18 "이 부분 물어봐 줘": this slot goes first in focus_slots (optionally for one detail card). */
export const RequestedSlot = z.object({
  slot: z.enum(WRITING_CHAT_SLOTS),
  detailKey: z.string().regex(/^D[1-9][0-9]{0,2}$/).nullable().default(null),
  existingDetailId: uuid.nullable().default(null),
});
export type RequestedSlot = z.infer<typeof RequestedSlot>;

export const WritingChatTurnInput = z.object({
  content: z.string().trim().min(1).max(WRITING_CHAT_MESSAGE_MAX_CHARS),
  requestedSlot: RequestedSlot.nullable().default(null),
});
export type WritingChatTurnInput = z.input<typeof WritingChatTurnInput>;

/** `?retry=1` body (optional): "다시 보내기" sends no new content. */
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
  /** "내 답변 #n" (user messages only, numbered among user messages). */
  userNumber: z.number().int().nullable(),
  /** Assistant result meta (S-36 턴별 공급자 표시). Null for the fixed greeting and user messages. */
  provider: AiProviderSchema.nullable(),
  model: z.string().nullable(),
  modelTier: ModelTierSchema.nullable(),
  connectionTier: ConnectionTierSchema.nullable(),
  aiJobId: uuid.nullable(),
  createdAt: isoDateTime,
});
export type WritingChatMessageDto = z.infer<typeof WritingChatMessageDto>;

/** 진행 단계 표시 (S-36): which slots have a value in structured_draft. */
export const WritingChatProgress = z.object({
  slots: z.array(z.object({ slot: z.enum(WRITING_CHAT_SLOTS), filled: z.boolean() })),
  /** First slot not filled yet (null when all are). */
  current: z.enum(WRITING_CHAT_SLOTS).nullable(),
  /** "검토가 필요한 항목 N개". */
  needsReviewCount: z.number().int().nonnegative(),
});
export type WritingChatProgress = z.infer<typeof WritingChatProgress>;

/** C-19 badge + whether a new message can be sent (PRD 3.3: reading/saving never need a key). */
export const WritingChatConnection = z.object({
  provider: AiProviderSchema.nullable(),
  connectionTier: ConnectionTierSchema.nullable(),
  keyStatus: z.enum(KEY_STATUSES).nullable(),
  /** null = can send; otherwise the lock reason (C-18). */
  lock: z.enum(["ai_not_connected", "key_invalid", "ai_consent_required"]).nullable(),
});
export type WritingChatConnection = z.infer<typeof WritingChatConnection>;

/** augment_project: the target project's existing details (filled fields read-only, R-06). */
export const AugmentTargetDto = z.object({
  projectId: uuid,
  name: z.string().nullable(),
  details: z.array(
    z.object({
      id: uuid,
      title: z.string().nullable(),
      /** Which columns already have a value (V-9h: never overwritten by the chat). */
      filled: z.record(z.enum(DRAFT_DETAIL_FIELDS), z.boolean()),
    }),
  ),
});
export type AugmentTargetDto = z.infer<typeof AugmentTargetDto>;

export const WritingChatDto = z.object({
  id: uuid,
  mode: z.enum(WRITING_CHAT_MODES),
  projectId: uuid.nullable(),
  experienceId: uuid.nullable(),
  educationId: uuid.nullable(),
  status: z.enum(WRITING_CHAT_STATUSES),
  structuredDraft: StructuredDraft,
  /** "n / 40": user + AI messages, the greeting excluded (R1 A5, DM §2.5). */
  messageCount: z.number().int(),
  messageLimit: z.literal(WRITING_CHAT_MESSAGE_LIMIT),
  /** 40 − messageCount (≥ 0). */
  remainingMessages: z.number().int().nonnegative(),
  /** No room for another turn (messageCount > 38): the input is disabled. */
  limitReached: z.boolean(),
  lastActivityAt: isoDateTime,
  savedAt: isoDateTime.nullable(),
  returnTarget: ReturnTarget.nullable(),
  createdAt: isoDateTime,
  /** Unbound chats only (no project): days until the 90-day cleanup. Null otherwise. */
  daysUntilAutoDelete: z.number().int().nullable(),
  messages: z.array(WritingChatMessageDto),
  progress: WritingChatProgress,
  connection: WritingChatConnection,
  augmentTarget: AugmentTargetDto.nullable(),
  /** True when the chat accepts new messages (active, under the limit, no lock). */
  canSend: z.boolean(),
});
export type WritingChatDto = z.infer<typeof WritingChatDto>;

/** S-08 "작성 중인 AI 대화" / "그만둔 AI 대화" row (R1 A6: `status` tells the two groups apart). */
export const ActiveWritingChatSummary = z.object({
  id: uuid,
  mode: z.enum(WRITING_CHAT_MODES),
  /** `active` (작성 중) or `abandoned` (그만둔 대화 — "다시 이어 하기"). */
  status: z.enum(["active", "abandoned"]),
  projectId: uuid.nullable(),
  /** augment_project target name (null for new_project). */
  projectName: z.string().nullable(),
  lastActivityAt: isoDateTime,
  /** Greeting excluded (R1 A5). */
  messageCount: z.number().int(),
  messageLimit: z.literal(WRITING_CHAT_MESSAGE_LIMIT),
  daysUntilAutoDelete: z.number().int().nullable(),
});
export type ActiveWritingChatSummary = z.infer<typeof ActiveWritingChatSummary>;
/** Alias: the S-08 list rows cover both groups. */
export type WritingChatSummary = ActiveWritingChatSummary;

/** S-08 lists (R1 A6): active chats, then abandoned ones not yet auto-deleted; latest activity first each. */
export const WritingChatLists = z.object({
  active: z.array(ActiveWritingChatSummary),
  abandoned: z.array(ActiveWritingChatSummary),
});
export type WritingChatLists = z.infer<typeof WritingChatLists>;

/** S-10 "AI 작성 대화 기록" (R1 A6): chats bound to one project, every status. */
export const ProjectWritingChatSummary = z.object({
  id: uuid,
  mode: z.enum(WRITING_CHAT_MODES),
  /** active → 이어 하기 / abandoned → "다시 이어 하기" / saved · handed_off → read-only. */
  status: z.enum(WRITING_CHAT_STATUSES),
  lastActivityAt: isoDateTime,
  savedAt: isoDateTime.nullable(),
  messageCount: z.number().int(),
  messageLimit: z.literal(WRITING_CHAT_MESSAGE_LIMIT),
});
export type ProjectWritingChatSummary = z.infer<typeof ProjectWritingChatSummary>;

export const ProjectWritingChatsInput = z.object({ projectId: uuid });
export type ProjectWritingChatsInput = z.input<typeof ProjectWritingChatsInput>;

/** "다시 이어 하기" (R1 A6): abandoned → active. */
export const ResumeWritingChatResult = z.object({ writingChatId: uuid, status: z.literal("active"), lastActivityAt: isoDateTime });
export type ResumeWritingChatResult = z.infer<typeof ResumeWritingChatResult>;

export const StartWritingChatResult = z.object({ writingChatId: uuid });
export type StartWritingChatResult = z.infer<typeof StartWritingChatResult>;

const n = z.number().int().nonnegative();

/** RPC `save_writing_chat` / `hand_off_writing_chat` jsonb (snake_case as returned). */
export const WritingChatCommitRpcResult = z.object({
  writing_chat_id: uuid,
  status: z.enum(["saved", "handed_off"]),
  project_id: uuid,
  project: z.object({ created: z.boolean(), updated: z.boolean() }),
  project_details: z.object({ created: n, updated: n, missing: n }),
  achievements: z.object({ created: n }),
  skills: z.object({ created: n, linked: n }),
  skipped_needs_review: n,
});

/** save / hand-off result (S-36 → S-10 / S-35). */
export const WritingChatSaveResult = z.object({
  writingChatId: uuid,
  projectId: uuid,
  status: z.enum(["saved", "handed_off"]),
  projectCreated: z.boolean(),
  projectUpdated: z.boolean(),
  detailsCreated: n,
  detailsUpdated: n,
  /** Existing details (augment) that were deleted meanwhile and so not filled. */
  detailsMissing: n,
  achievementsCreated: n,
  skillsCreated: n,
  skillsLinked: n,
  /** needs_review fields left out (T-18). */
  skippedNeedsReview: n,
});
export type WritingChatSaveResult = z.infer<typeof WritingChatSaveResult>;

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
  /** Fields this turn changed (preview highlight). */
  changed: z.array(DraftFieldPath),
});
export const DraftFlagsEvent = z.object({
  type: z.literal("draft_flags"),
  needsReview: z.array(DraftFieldPath),
  clarifications: z.array(DraftClarification),
  /** Sensitive items left out this turn (V-9g) → "이 내용은 기록하지 않을게요". */
  sensitiveAdded: z.number().int().nonnegative(),
  sensitiveFlagsCount: z.number().int().nonnegative(),
});
export const TurnDoneEvent = z.object({
  type: z.literal("turn_done"),
  jobId: uuid,
  messageCount: z.number().int(),
  /** 40 − messageCount (R1 A5). */
  remainingMessages: z.number().int().nonnegative(),
  limitReached: z.boolean(),
  /**
   * Preview this turn (QA-S4-05): `updated` (draft_patch sent), `unchanged` (nothing pending, e.g. a
   * resend, or no change), `failed` (extract failed; the messages are extracted again next turn, AI-12).
   */
  draftStatus: z.enum(["updated", "unchanged", "failed"]),
  /** = draftStatus !== "failed" (kept for the S4 contract). */
  draftUpdated: z.boolean(),
  progress: WritingChatProgress,
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
