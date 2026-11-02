import { z } from "zod";
import { ModelEvidenceSchema } from "../validation/evidence";
import { PlaceholdersOutput } from "./drafts-common";
import { CRITERIA_GRADES, CRITERIA_KEYS } from "./interview-common";

/**
 * AI-06 답변별 평가 model output, schema_version 2 (card "출력 스키마").
 * `criteria` is an array of 4 (one per key); the "all four keys, once each"
 * rule is checked after zod (accept → one V-6 retry). `score` is in the
 * schema because the card has it, but the server always overwrites it with
 * `pending_method` (D-AI-07 (a), D-14 대기).
 *
 * `consistency_notes[]` has no item shape in the card; [가정] `{ text,
 * answer_quotes, evidence }` (evidence = the registered career fact the
 * answer differs from).
 */
export const AI06_OUTPUT_SCHEMA_VERSION = 2;

const Quotes = z.array(z.string().max(500)).max(6);
const Evidence = z.array(ModelEvidenceSchema).max(8);

export const Ai06CriterionSchema = z.object({
  key: z.enum(CRITERIA_KEYS),
  grade: z.enum(CRITERIA_GRADES),
  reason: z.string().max(600),
  answer_quotes: Quotes,
  missing: z.string().max(300).nullable(),
});

export const Ai06OutputSchema = z.object({
  schema_version: z.literal(AI06_OUTPUT_SCHEMA_VERSION),
  question_ref: z.string().max(20),
  answer_ref: z.string().max(20),
  criteria: z.array(Ai06CriterionSchema).min(1).max(8),
  strengths: z
    .array(z.object({ text: z.string().max(400), answer_quotes: Quotes }))
    .max(6),
  improvements: z
    .array(
      z.object({
        text: z.string().max(400),
        how: z.string().max(600),
        related_criteria: z.array(z.enum(CRITERIA_KEYS)).max(4),
        evidence: Evidence,
      }),
    )
    .max(6),
  intent_reveal: z.string().max(400),
  model_answer: z.object({
    text: z.string().max(2000),
    evidence: Evidence,
    placeholders: PlaceholdersOutput,
    suggestions_if_true: z.array(z.string().max(300)).max(5),
  }),
  consistency_notes: z
    .array(z.object({ text: z.string().max(400), answer_quotes: Quotes, evidence: Evidence }))
    .max(5),
  score: z.object({
    status: z.string().max(30),
    value: z.number().nullable(),
    max: z.number().nullable(),
    method_version: z.string().max(30).nullable(),
    rationale: z.string().max(600).nullable(),
  }),
});

export type Ai06Criterion = z.infer<typeof Ai06CriterionSchema>;
export type Ai06Output = z.infer<typeof Ai06OutputSchema>;
