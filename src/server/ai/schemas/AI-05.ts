import { z } from "zod";
import { ModelEvidenceSchema } from "../validation/evidence";
import { CRITERIA_KEYS, DATA_SUFFICIENCY_LEVELS, INTERVIEW_ANCHORS, INTERVIEW_SOURCE_KINDS, INTERVIEW_TYPES } from "./interview-common";

/**
 * AI-05 면접 질문 일괄 생성 model output, schema_version 2 (card "출력 스키마").
 * Key order matters for streaming: `weak_requirement_refs` closes before
 * `questions`, and each `questions[n]` object is validated and saved as soon
 * as it closes. Canonical form (C-10.2): every key present, depth ≤ 5.
 * Count caps are generous so an over-producing model still parses (V-6);
 * the server keeps only the questions it needs.
 */
export const AI05_OUTPUT_SCHEMA_VERSION = 2;

const Ref = z.string().max(20);
const Refs = z.array(Ref).max(12);

export const Ai05QuestionSchema = z.object({
  order: z.number().int().min(1).max(50),
  source_kind: z.enum(INTERVIEW_SOURCE_KINDS),
  anchor: z.enum(INTERVIEW_ANCHORS),
  text: z.string().min(1).max(600),
  intent: z.string().max(400),
  focus_criteria: z.array(z.enum(CRITERIA_KEYS)).max(4),
  target_requirement_refs: Refs,
  target_gap_requirement_refs: Refs,
  evidence: z.array(ModelEvidenceSchema).max(10),
  good_answer_signals: z.array(z.string().max(200)).max(8),
});

export const Ai05OutputSchema = z.object({
  schema_version: z.literal(AI05_OUTPUT_SCHEMA_VERSION),
  interview_type: z.enum(INTERVIEW_TYPES),
  weak_requirement_refs: z.array(Ref).max(30),
  questions: z.array(Ai05QuestionSchema).max(12),
  data_sufficiency: z.object({
    level: z.enum(DATA_SUFFICIENCY_LEVELS),
    hints: z.array(z.string().max(300)).max(5),
  }),
});

export type Ai05Question = z.infer<typeof Ai05QuestionSchema>;
export type Ai05Output = z.infer<typeof Ai05OutputSchema>;
