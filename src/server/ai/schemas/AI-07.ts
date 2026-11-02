import { z } from "zod";
import { CRITERIA_KEYS, INTERVIEW_TYPES, NEXT_PRACTICE_TYPES } from "./interview-common";

/**
 * AI-07 세션 종합 피드백 model output, schema_version 2 (card "출력 스키마").
 * `next_practice[]` items share one closed shape (C-10.2: no oneOf);
 * fields that don't apply to a type are null / []. `session_score` and
 * `unanswered_note` are overwritten by the server (counts are server values,
 * score is pending_method). `criteria_summary` is server-built, not output.
 */
export const AI07_OUTPUT_SCHEMA_VERSION = 2;

const Refs = z.array(z.string().max(20)).max(10);

const Point = z.object({
  text: z.string().max(500),
  question_refs: Refs,
  related_criteria: z.array(z.enum(CRITERIA_KEYS)).max(4),
});

export const Ai07OutputSchema = z.object({
  schema_version: z.literal(AI07_OUTPUT_SCHEMA_VERSION),
  headline: z.string().max(300),
  overall_strengths: z.array(Point).max(6),
  overall_weaknesses: z.array(Point).max(6),
  unanswered_note: z.string().max(300).nullable(),
  next_practice: z
    .array(
      z.object({
        type: z.enum(NEXT_PRACTICE_TYPES),
        text: z.string().max(400),
        requirement_refs: Refs,
        interview_type: z.enum(INTERVIEW_TYPES).nullable(),
        question_ref: z.string().max(20).nullable(),
      }),
    )
    .max(5),
  session_score: z.object({
    status: z.string().max(30),
    value: z.number().nullable(),
    max: z.number().nullable(),
    method_version: z.string().max(30).nullable(),
    rationale: z.string().max(600).nullable(),
    counted_questions: z.number().int().nullable(),
    unanswered_count: z.number().int().nullable(),
  }),
});

export type Ai07Output = z.infer<typeof Ai07OutputSchema>;
export type Ai07Point = z.infer<typeof Point>;
