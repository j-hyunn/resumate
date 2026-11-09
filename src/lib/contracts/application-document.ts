import { z } from "zod";
import { APPLICATION_DOCUMENT_KINDS, PAGE_SAVE_SKIP_REASONS, type ApplicationDocumentKind, type DocumentSaveSkipReason, type NameSource } from "./enums";

/**
 * R15 자기소개서 정본 contracts (DM 2.5.1 `save_application_document`, 2.5.0b,
 * 2.7.3, 11.8 #1·#4; UX S-46; CF-1·CF-5·CF-6·CF-S1).
 *
 * **zod checks the JSON shape only** (R5-API-2): every rule — the 5-question cap,
 * `char_limit` 1~10,000, slot format and duplicates, length caps, the allowed
 * evidence sources, V-8 — is judged by `save_application_document` so the DB stays
 * the single source of truth. The action maps the RPC's `P0001` raises to codes
 * (see `DOCUMENT_SAVE_ERROR_CODES` and `src/server/db/errors.ts`).
 *
 * The screen never sends question-level `sources` (CF-S1): an applied AI proposal
 * is the only origin of `{slot}.sources.{n}` evidence, so no screen value can be
 * stored as `origin = 'ai'` evidence.
 */

const uuid = z.guid();
const slot = z.string();

/** DM 2.5.1 `[가정]`: `p_applied_proposals` ≤ 50 (same cap as the page save RPCs). */
export const DOCUMENT_SAVE_MAX_APPLIED = 50;

export const ApplicationDocumentKindSchema = z.enum(APPLICATION_DOCUMENT_KINDS);

/** `blocks[].evidence[]` element (DM 2.8). Values are passed through; the RPC and the insert trigger judge them. */
export const DocumentBlockEvidence = z
  .object({
    source_type: z.string(),
    source_id: z.string(),
    source_field: z.string().nullish(),
    source_locator: z.string().nullish(),
    quote: z.string().nullish(),
    label: z.string().nullish(),
  })
  .strict();

/** `questions[].blocks[]` element (DM 2.5.0b / 2.7.3, db notes ②-1). */
export const DocumentBlock = z
  .object({
    block_id: z.string(),
    type: z.string(),
    text: z.string().nullish(),
    basis: z.string().nullish(),
    placeholders: z.array(z.string()).nullish(),
    flags: z.array(z.string()).nullish(),
    applied_writing_chat_id: z.string().nullish(),
    applied_rev: z.number().nullish(),
    applied_at: z.string().nullish(),
    user_modified: z.boolean().nullish(),
    evidence: z.array(DocumentBlockEvidence).nullish(),
  })
  .strict();

/**
 * `p_body.questions[]` element. `sort_order` is **not** accepted: the server re-numbers from 1 in
 * the order sent (db notes ②-1). `question_id` may be absent / null — the RPC makes one.
 */
export const DocumentQuestion = z
  .object({
    slot,
    question_id: z.string().nullish(),
    question_text: z.string().nullish(),
    answer_title: z.string().nullish(),
    template_key: z.string().nullish(),
    question_class: z.string().nullish(),
    char_limit: z.number().nullish(),
    count_basis: z.string().nullish(),
    user_note: z.string().nullish(),
    body: z.string().nullish(),
    blocks: z.array(DocumentBlock).nullish(),
  })
  .strict();

/** `p_body` — the whole question list, overwritten on every save. A slot that is not sent is deleted. */
export const DocumentBody = z.object({ questions: z.array(DocumentQuestion) }).strict();
export type DocumentBody = z.input<typeof DocumentBody>;

/** `p_meta` — `{tone}` only (DM 2.7.3). Absent = keep the stored tone. */
export const DocumentMeta = z.object({ tone: z.string().nullish() }).strict();

/** `p_application_values` — `{name, deadline}` only. An empty `name` returns to the default name. */
export const DocumentApplicationValues = z.object({ name: z.string().nullish(), deadline: z.string().nullish() }).strict();

/** One AI proposal the screen filled into a slot this visit (DM 2.5.1 `{writing_chat_id, slot, rev}`). */
export const AppliedDocumentProposal = z.object({ writingChatId: uuid, slot, rev: z.number().int().min(0).max(999_999_999) }).strict();

/**
 * S-46 "저장하기" → `save_application_document`. The target is
 * `(applicationProjectId, documentKind)` — there is no document id to send, and this RPC is the
 * only way a row is created. `expectedUpdatedAt` is the **document row's** `updatedAt`; omit it
 * for "내 내용으로 저장".
 */
export const SaveApplicationDocumentInput = z
  .object({
    applicationProjectId: uuid,
    documentKind: ApplicationDocumentKindSchema,
    body: DocumentBody,
    meta: DocumentMeta.optional(),
    expectedUpdatedAt: z.iso.datetime({ offset: true }).optional(),
    appliedProposals: z.array(AppliedDocumentProposal).max(DOCUMENT_SAVE_MAX_APPLIED).optional(),
    /** `[가정]` The RPC accepts and ignores `p_client_id`; kept so the screen can send one key shape. */
    clientId: uuid.optional(),
    applicationValues: DocumentApplicationValues.optional(),
  })
  .strict();
export type SaveApplicationDocumentInput = z.input<typeof SaveApplicationDocumentInput>;

const nullableString = z.string().nullable().catch(null);
const skipReason = z.enum(PAGE_SAVE_SKIP_REASONS);

/** RPC `save_application_document` jsonb — the 11 keys of db notes ②-1 + R15 후속 3 (`slot_high_water`). */
export const SaveApplicationDocumentRpcResult = z.object({
  application_document_id: z.string(),
  document_kind: z.string(),
  filled_slot_count: z.number().int(),
  slot_count: z.number().int(),
  slot_high_water: z.number().int().nonnegative(),
  name: nullableString,
  name_source: nullableString,
  deadline: nullableString,
  updated_at: z.string(),
  applied: z.array(z.object({ writing_chat_id: z.string(), slot: z.string() })),
  skipped: z.array(z.object({ writing_chat_id: nullableString, slot: nullableString, reason: skipReason })),
});

export type SaveApplicationDocumentResult = {
  applicationDocumentId: string;
  documentKind: ApplicationDocumentKind;
  /** Questions whose `body` is not blank — a question with only an `answer_title` is not counted (`[가정]`). */
  filledSlotCount: number;
  /** Generated column = the number of questions. */
  slotCount: number;
  /**
   * R15 후속 3: the largest slot number ever saved. Number the next **new** question
   * `slot_high_water + 1` — a new question at or below it is refused (`invalid_slot`).
   */
  slotHighWater: number;
  name: string | null;
  nameSource: NameSource | null;
  deadline: string | null;
  /** The next save's `expectedUpdatedAt`. */
  updatedAt: string;
  applied: { writingChatId: string; slot: string }[];
  skipped: { writingChatId: string | null; slot: string | null; reason: DocumentSaveSkipReason }[];
};

// ---------- 서류 대화 시작 (DM 2.5.0b, 11.8 #4) ----------

/**
 * S-46 "AI와 쓰기" → `start_document_writing_chat`. It does **not** create the 정본 row
 * (`save_application_document` is the only path that does), and takes no `return_target`
 * (the chat's `return_target` stays null).
 *
 * `formSnapshot` (DM 2.5.1) is the S-46 form as it stands, used only to pick the greeting and
 * seed the first turn's context — it is never stored, never in `ai_jobs.params`, never logged.
 */
export const DocumentFormSnapshotQuestion = z
  .object({
    slot,
    question_text: z.string().nullish(),
    char_limit: z.number().nullish(),
    count_basis: z.string().nullish(),
    user_note: z.string().nullish(),
    answer_title: z.string().nullish(),
    body: z.string().nullish(),
  })
  .strict();

/** db notes ②-2: ≤ 20 elements; the RPC checks lengths and stores nothing. */
export const DOCUMENT_FORM_SNAPSHOT_MAX_QUESTIONS = 20;
export const DocumentFormSnapshotSchema = z
  .object({ questions: z.array(DocumentFormSnapshotQuestion).max(DOCUMENT_FORM_SNAPSHOT_MAX_QUESTIONS) })
  .strict();
export type DocumentFormSnapshot = z.output<typeof DocumentFormSnapshotSchema>;

export const StartDocumentWritingChatInput = z
  .object({
    applicationProjectId: uuid,
    documentKind: ApplicationDocumentKindSchema,
    formSnapshot: DocumentFormSnapshotSchema.optional(),
  })
  .strict();
export type StartDocumentWritingChatInput = z.input<typeof StartDocumentWritingChatInput>;

export type StartDocumentWritingChatResult = { writingChatId: string };

/**
 * Refusals the S-46 screen handles. `too_many_questions` carries
 * `details { limit: 5, current }` (the RPC's raise detail is the string `'5,{current}'` —
 * R5-DB-8 shape, converted in `src/server/db/errors.ts`); `stale_write` carries
 * `details { current_updated_at }`; `invalid_fields` / `field_too_long` / `invalid_slot` /
 * `invalid_evidence_source` carry a dot path or the offending slot in `details.field`.
 */
export const DOCUMENT_SAVE_ERROR_CODES = [
  "invalid_fields",
  "field_too_long",
  "invalid_slot",
  "too_many_questions",
  "application_project_not_found",
  "stale_write",
  "invalid_evidence_source",
] as const;
export type DocumentSaveErrorCode = (typeof DOCUMENT_SAVE_ERROR_CODES)[number];

// ---------- R15 후속: reads (DM 7장 25행) ----------

/** S-46 정본 1행 / 대화 목록의 대상: `(applicationProjectId, documentKind)`. */
export const ApplicationDocumentTargetInput = z
  .object({ applicationProjectId: uuid, documentKind: ApplicationDocumentKindSchema.default("cover_letter") })
  .strict();
export type ApplicationDocumentTargetInput = z.input<typeof ApplicationDocumentTargetInput>;

/** S-46 근거 읽기: the 정본 row's id (`owner_id` of its `evidence_links`). */
export const ApplicationDocumentIdInput = z.object({ applicationDocumentId: uuid }).strict();
export type ApplicationDocumentIdInput = z.input<typeof ApplicationDocumentIdInput>;
