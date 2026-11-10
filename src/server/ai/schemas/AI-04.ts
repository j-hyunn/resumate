import { z } from "zod";
import { DRAFT_SOURCE_ROLES, QUESTION_CLASSES } from "@/lib/contracts/enums";
import { DraftEvidence, DraftRef, DraftRefs, NotesForUser, PlaceholdersOutput } from "./drafts-common";

/**
 * AI-04 자소서 문항 답변 작성 AI 채팅 — model output, **schema_version 4**
 * (AI spec v4.15 AI-04 "출력 스키마"; 3 → 4 adds `answer_title`, CF-6).
 *
 * Three calls, three shapes:
 * - `compose` (초안 턴): `questions[]` — this turn's questions only (≤ 3, CL-10),
 *   each with `sources` → `paragraphs` → `answer_title` in that key order
 *   (sources stream first, the title is written after the body — C-10.2);
 * - `extract` (질문·보강 턴 정리): facts / source_selection / clarifications / tone;
 * - `adjust` (글자 수 보정): paragraphs per question, **no title** (CF-6: the
 *   title is not counted and not adjusted).
 *
 * Dropped in v4 (v4.13 CL-*): `selection_mode` (V-7 is one rule now) and
 * `question_ref` (`CLQ-n`) → `question_slot` (`q_{n}`, DM 2.5.0b).
 */

export const AI04_OUTPUT_SCHEMA_VERSION = 4;

/** DM 2.5.0b 슬롯 키: `q_{n}`, ≤ 3 digits. */
export const QUESTION_SLOT_PATTERN = /^q_[0-9]{1,3}$/;
export const QuestionSlot = z.string().max(8).regex(QUESTION_SLOT_PATTERN);

/** (v4.15, CF-6) 답변 제목 ≤ 100자, 한 줄. */
export const ANSWER_TITLE_MAX = 100;

/** `meta.tone_requested` (DM 2.5.0b `set_tone`). */
export const COVER_LETTER_TONES = ["concise", "detailed"] as const;
export type CoverLetterTone = (typeof COVER_LETTER_TONES)[number];

/** AI-04 clarifications (DM 2.5.0a 모양 + `slot`). */
export const COVER_LETTER_CLARIFICATION_KINDS = ["actor_ambiguous", "number_vague"] as const;
export type CoverLetterClarificationKind = (typeof COVER_LETTER_CLARIFICATION_KINDS)[number];

// ---------------------------------------------------------------------------
// compose (초안 턴)
// ---------------------------------------------------------------------------

export const Ai04SourceSchema = z.object({
  project_ref: DraftRef.nullable(),
  experience_ref: DraftRef.nullable(),
  education_ref: DraftRef.nullable(),
  role: z.enum(DRAFT_SOURCE_ROLES),
  rationale: z.string().max(600),
  requirement_refs: DraftRefs,
  reuse_reason: z.string().max(300).nullable(),
  evidence: DraftEvidence,
});

/**
 * One answer paragraph. 출처 3종 (DM 2.5.0b): `evidence` (커리어·JD·메모),
 * `source_fact_ids` (`F-n`, 이 대화에서 정리된 사실), `source_body_quotes`
 * (지금 답변 본문의 부분 문자열). 하나 이상 필요하다 (V-4).
 */
export const Ai04ParagraphSchema = z.object({
  block_id: z.string().max(60),
  text: z.string().max(3000),
  evidence: DraftEvidence,
  source_fact_ids: z.array(DraftRef).max(20),
  source_body_quotes: z.array(z.string().max(1000)).max(20),
  requirement_refs: DraftRefs,
  placeholders: PlaceholdersOutput,
});

export const Ai04QuestionOutputSchema = z.object({
  question_slot: QuestionSlot,
  question_class: z.enum(QUESTION_CLASSES),
  sources: z.array(Ai04SourceSchema).max(6),
  // V-6: 0 paragraphs is a schema miss.
  paragraphs: z.array(Ai04ParagraphSchema).min(1).max(12),
  /** (v4.15, CF-6) 현재 제목이 있는 문항은 null. */
  answer_title: z.string().max(ANSWER_TITLE_MAX * 3).nullable(),
  notes_for_user: NotesForUser,
});

export const Ai04ComposeOutputSchema = z.object({
  schema_version: z.literal(AI04_OUTPUT_SCHEMA_VERSION),
  draft_type: z.literal("cover_letter"),
  turn_kind: z.literal("compose"),
  // CL-10: ≤ 3 questions per draft turn; a longer array is cut by the validator.
  questions: z.array(Ai04QuestionOutputSchema).min(1).max(5),
});

/** ai-04.adjust: paragraphs per question (ids, evidence, placeholders kept; no title). */
export const Ai04AdjustQuestionSchema = z.object({
  question_slot: QuestionSlot,
  paragraphs: z.array(Ai04ParagraphSchema).min(1).max(12),
});

export const Ai04AdjustOutputSchema = z.object({
  schema_version: z.literal(AI04_OUTPUT_SCHEMA_VERSION),
  draft_type: z.literal("cover_letter"),
  turn_kind: z.literal("adjust_length"),
  questions: z.array(Ai04AdjustQuestionSchema).min(1).max(5),
});

// ---------------------------------------------------------------------------
// extract (질문·보강 턴 정리)
// ---------------------------------------------------------------------------

export const Ai04FactSchema = z.object({
  slot: QuestionSlot,
  project_ref: DraftRef.nullable(),
  text: z.string().max(600),
  actor: z.enum(["self", "team", "unknown"]),
  source_message_ids: z.array(z.string().max(20)).max(20),
  source_quotes: z.array(z.string().max(1000)).max(20),
});

export const Ai04SourceSelectionSchema = z.object({
  slot: QuestionSlot,
  op: z.enum(["add", "remove"]),
  project_ref: DraftRef.nullable(),
  reason: z.string().max(300),
  source_message_ids: z.array(z.string().max(20)).max(20),
});

export const Ai04ClarificationSchema = z.object({
  kind: z.enum(COVER_LETTER_CLARIFICATION_KINDS),
  slot: QuestionSlot.nullable(),
  note: z.string().max(300).nullable(),
});

export const Ai04SensitiveFlagSchema = z.object({
  message_id: z.string().max(20),
  category: z.string().max(40),
});

export const Ai04ExtractOutputSchema = z.object({
  schema_version: z.literal(AI04_OUTPUT_SCHEMA_VERSION),
  draft_type: z.literal("cover_letter"),
  turn_kind: z.literal("extract"),
  /** 사용자가 초안을 요청했는지 (자유 문장 요청 확인, AI-13과 같은 자리). */
  intent: z.enum(["compose_draft"]).nullable(),
  tone: z.enum(COVER_LETTER_TONES).nullable(),
  facts: z.array(Ai04FactSchema).max(10),
  source_selection: z.array(Ai04SourceSelectionSchema).max(10),
  clarifications: z.array(Ai04ClarificationSchema).max(10),
  sensitive_flags: z.array(Ai04SensitiveFlagSchema).max(10),
});

export type Ai04ComposeOutput = z.infer<typeof Ai04ComposeOutputSchema>;
export type Ai04QuestionOutput = z.infer<typeof Ai04QuestionOutputSchema>;
export type Ai04Source = z.infer<typeof Ai04SourceSchema>;
export type Ai04Paragraph = z.infer<typeof Ai04ParagraphSchema>;
export type Ai04AdjustOutput = z.infer<typeof Ai04AdjustOutputSchema>;
export type Ai04ExtractOutput = z.infer<typeof Ai04ExtractOutputSchema>;
export type Ai04Fact = z.infer<typeof Ai04FactSchema>;
export type Ai04Clarification = z.infer<typeof Ai04ClarificationSchema>;
