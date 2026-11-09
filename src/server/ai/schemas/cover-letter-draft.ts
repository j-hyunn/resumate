import { z } from "zod";
import { STORABLE_SOURCE_TYPES } from "../evidence-rules";
import { ANSWER_TITLE_MAX, COVER_LETTER_CLARIFICATION_KINDS, COVER_LETTER_TONES, QUESTION_SLOT_PATTERN } from "./AI-04";
import { FIELD_ORIGINS, REVIEW_STATES } from "./structured-draft";

/**
 * `writing_chats.structured_draft` of a **자소서 대화** (DM v4.15 2.5.0b,
 * `target: "cover_letter"`). Told apart from the deliverable shape (2.5.0a) by
 * `target`; its `schema_version` **stays 1** (DM v4.15: 11.8 is not deployed, so
 * the first shape already carries `answer_title`) — the AI-04 model output
 * version (3 → 4) is a separate number.
 *
 * (R15, CF-1) `target: "career_description"`, `document.sections[]`,
 * `heading_label`, `document.section_order_proposal` and
 * `document.source_ranking` do not exist: 경력기술서와 AI-11이 폐기됐다.
 *
 * Only RPCs write the column (`apply_structured_draft_patch` as app_ai_writer
 * for AI ops / as the session for the user ops, and the save RPC's `applied_*`
 * helper). Blocks carry their own `evidence[]` here — the rows in
 * `evidence_links` are written later by `save_application_document` (C-3),
 * keyed `{slot}.blocks.{block_id}` / `{slot}.sources.{n}`.
 */

export const COVER_LETTER_DRAFT_SCHEMA_VERSION = 1;
export const COVER_LETTER_DRAFT_TARGET = "cover_letter";

/** DM 2.5.0b: 대화 전체 초안 제안 6회 (문항별이 아니다). */
export const COVER_LETTER_DRAFT_LIMIT = 6;

const Slot = z.string().regex(QUESTION_SLOT_PATTERN);

export const CoverLetterFactSchema = z.object({
  id: z.string(),
  slot: Slot,
  text: z.string(),
  actor: z.enum(["self", "team", "unknown"]),
  source_message_ids: z.array(z.string()).default([]),
  source_quotes: z.array(z.string()).default([]),
  review: z.enum(REVIEW_STATES).default("ok"),
  reviewed_at: z.string().nullable().default(null),
  origin: z.enum(FIELD_ORIGINS).default("ai"),
});
export type CoverLetterFact = z.infer<typeof CoverLetterFactSchema>;

/** Stored evidence of a block (UUIDs, DM 2.5.0b `blocks[].evidence[]`). */
export const StoredEvidenceSchema = z.object({
  source_type: z.enum(STORABLE_SOURCE_TYPES as unknown as [string, ...string[]]),
  source_id: z.string(),
  source_field: z.string().nullable().default(null),
  source_locator: z.record(z.string(), z.unknown()).nullable().default(null),
  quote: z.string().nullable().default(null),
  label: z.string().nullable().default(null),
});
export type StoredEvidence = z.infer<typeof StoredEvidenceSchema>;

/**
 * (CF-S1, 확정 2026-11-09 사용자 — 문서 PR #68 미머지) 문항 근거.
 * `save_application_document`가 그 슬롯의 적용 제안에서 읽어
 * `evidence_links`의 `{slot}.sources.{n}` 행으로 만든다(`n` = 배열 순서,
 * `primary` 먼저). `role`은 행에 저장하지 않는다 — 제안 쪽 표시값이다.
 * **폐기된 `document.source_ranking`(AI-11)과는 다른 자리다.**
 */
export const StoredSourceSchema = z.object({
  source_type: z.enum(STORABLE_SOURCE_TYPES as unknown as [string, ...string[]]),
  source_id: z.string(),
  role: z.enum(["primary", "supporting"]),
});
export type StoredSource = z.infer<typeof StoredSourceSchema>;

export const CoverLetterBlockSchema = z.object({
  block_id: z.string(),
  type: z.literal("paragraph").default("paragraph"),
  text: z.string(),
  basis: z.enum(["new", "current_body"]).nullable().default(null),
  evidence: z.array(StoredEvidenceSchema).default([]),
  source_fact_ids: z.array(z.string()).default([]),
  source_body_quotes: z.array(z.string()).default([]),
  requirement_ids: z.array(z.string()).default([]),
  placeholders: z.array(z.object({ token: z.string(), hint: z.string().nullable().default(null) })).default([]),
  flags: z.array(z.string()).default([]),
  review: z.enum(REVIEW_STATES).default("ok"),
  /** `no_evidence` when the block kept no evidence (DM 2.5.0b). */
  review_reason: z.string().nullable().default(null),
});
export type CoverLetterBlock = z.infer<typeof CoverLetterBlockSchema>;

/** (CF-S1 `[가정]`) 문항 근거 ≤ 5개. */
export const MAX_QUESTION_SOURCES = 5;

export const CoverLetterQuestionDraftSchema = z.object({
  /** (v4.15, CF-6) ≤ 100자, 글자 수·보정 대상이 아니다. */
  answer_title: z.string().max(ANSWER_TITLE_MAX).nullable().default(null),
  value: z.string().default(""),
  blocks: z.array(CoverLetterBlockSchema).default([]),
  /** (CF-S1) 이 제안이 고른 문항 근거. 저장 때 `{slot}.sources.{n}` 행이 된다. */
  sources: z.array(StoredSourceSchema).max(MAX_QUESTION_SOURCES).default([]),
  char_count: z.number().int().min(0).default(0),
  char_limit_at_generation: z.number().int().nullable().default(null),
  char_adjust_needed: z.boolean().default(false),
  correction_applied: z.boolean().default(false),
  rev: z.number().int().min(1).default(1),
  generated_at: z.string().nullable().default(null),
  base_body_hash: z.string().nullable().default(null),
  replace_allowed: z.boolean().default(true),
  missing_slots: z.array(z.string()).default([]),
  dropped_block_count: z.number().int().min(0).default(0),
  applied_at: z.string().nullable().default(null),
  applied_rev: z.number().int().nullable().default(null),
});
export type CoverLetterQuestionDraft = z.infer<typeof CoverLetterQuestionDraftSchema>;

export const CoverLetterQuestionEntrySchema = z.object({
  slot: Slot,
  question_id: z.string(),
  draft: CoverLetterQuestionDraftSchema,
});
export type CoverLetterQuestionEntry = z.infer<typeof CoverLetterQuestionEntrySchema>;

export const CoverLetterClarificationStoredSchema = z.object({
  kind: z.enum(COVER_LETTER_CLARIFICATION_KINDS),
  slot: Slot.nullable().default(null),
  note: z.string().nullable().default(null),
});
export type CoverLetterClarificationStored = z.infer<typeof CoverLetterClarificationStoredSchema>;

export const CoverLetterDraftSchema = z.object({
  schema_version: z.number().default(COVER_LETTER_DRAFT_SCHEMA_VERSION),
  target: z.literal(COVER_LETTER_DRAFT_TARGET).default(COVER_LETTER_DRAFT_TARGET),
  facts: z.array(CoverLetterFactSchema).default([]),
  document: z
    .object({
      questions: z.array(CoverLetterQuestionEntrySchema).default([]),
      /** F-DOC-10 Could: 자리만 잡아 둔다. */
      question_edit_proposal: z.array(z.record(z.string(), z.unknown())).default([]),
    })
    .default({ questions: [], question_edit_proposal: [] }),
  meta: z
    .object({
      tone_requested: z.enum(COVER_LETTER_TONES).nullable().default(null),
      tone_requested_at: z.string().nullable().default(null),
    })
    .default({ tone_requested: null, tone_requested_at: null }),
  clarifications: z.array(CoverLetterClarificationStoredSchema).default([]),
  sensitive_flags_count: z.number().int().min(0).default(0),
  draft_count: z.number().int().min(0).default(0),
});
export type CoverLetterDraft = z.infer<typeof CoverLetterDraftSchema>;

/** True when the stored jsonb is a cover-letter chat draft. */
export function isCoverLetterDraftJson(json: unknown): boolean {
  return !!json && typeof json === "object" && (json as { target?: unknown }).target === COVER_LETTER_DRAFT_TARGET;
}

/**
 * Reads the stored jsonb (the start RPC writes the empty shape; `'{}'` reads as
 * empty). A value that does not parse is a server bug (RPC-only column), so
 * this throws instead of resetting the user's facts.
 */
export function parseCoverLetterDraft(json: unknown): CoverLetterDraft {
  const value = json && typeof json === "object" && Object.keys(json).length > 0 ? json : {};
  return CoverLetterDraftSchema.parse(value);
}

export function emptyCoverLetterDraft(): CoverLetterDraft {
  return CoverLetterDraftSchema.parse({});
}

/** The stored proposal of one question, if any. */
export function questionDraft(draft: CoverLetterDraft, slot: string): CoverLetterQuestionDraft | null {
  return draft.document.questions.find((q) => q.slot === slot)?.draft ?? null;
}

/** 문단 id는 서버가 정한다 — 같은 서류의 다른 문항과 겹치지 않게 `{slot}.{n}` (AI-04). */
export function paragraphBlockId(slot: string, n: number): string {
  return `${slot}.${n}`;
}
