import { z } from "zod";
import { DRAFT_SOURCE_ROLES, QUESTION_CLASSES, SOURCE_SELECTION_MODES } from "@/lib/contracts/enums";
import { DraftEvidence, DraftRef, DraftRefs, NotesForUser, TextBlockOutputSchema } from "./drafts-common";

/**
 * AI-04 자기소개서 문항 model output, schema_version 2 (card "출력 스키마 (문항 1개)").
 * `sources` come before `paragraphs` so the selection streams first (PRD 6.3);
 * Gemini keeps the key order via `propertyOrdering`. `project_ref` is nullable:
 * a user-mode source may be an experience or education alone (DM A.11).
 */
export const AI04_OUTPUT_SCHEMA_VERSION = 2;

export const Ai04SourceSchema = z.object({
  project_ref: DraftRef.nullable(),
  experience_ref: DraftRef.nullable(),
  education_ref: DraftRef.nullable(),
  detail_refs: DraftRefs,
  role: z.enum(DRAFT_SOURCE_ROLES),
  rationale: z.string().max(600),
  requirement_refs: DraftRefs,
  reuse_reason: z.string().max(300).nullable(),
  evidence: DraftEvidence,
});

export const Ai04ParagraphSchema = TextBlockOutputSchema.extend({ requirement_refs: DraftRefs });

export const Ai04OutputSchema = z.object({
  schema_version: z.literal(AI04_OUTPUT_SCHEMA_VERSION),
  question_ref: z.string().max(20),
  question_class: z.enum(QUESTION_CLASSES),
  selection_mode: z.enum(SOURCE_SELECTION_MODES),
  sources: z.array(Ai04SourceSchema).max(6),
  // db: complete_cover_letter_section takes 1~20 paragraph blocks; 0 is a schema miss (V-6).
  paragraphs: z.array(Ai04ParagraphSchema).min(1).max(12),
  notes_for_user: NotesForUser,
});

/** ai-04.adjust: paragraphs only (block ids, evidence, placeholders kept). */
export const Ai04AdjustOutputSchema = z.object({
  schema_version: z.literal(AI04_OUTPUT_SCHEMA_VERSION),
  paragraphs: z.array(Ai04ParagraphSchema).min(1).max(12),
});

export type Ai04Output = z.infer<typeof Ai04OutputSchema>;
export type Ai04Source = z.infer<typeof Ai04SourceSchema>;
export type Ai04Paragraph = z.infer<typeof Ai04ParagraphSchema>;
export type Ai04AdjustOutput = z.infer<typeof Ai04AdjustOutputSchema>;
