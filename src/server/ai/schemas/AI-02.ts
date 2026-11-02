import { z } from "zod";
import { ModelEvidenceSchema } from "../validation/evidence";

/**
 * AI-02 JD 인사이트 model output, schema_version 1 (AI spec AI-02 "출력 스키마").
 * Two schemas for the two-stage chain:
 * - stage 1 (`match`, one per batch): `matches[]`
 * - stage 2 (`synthesize`): `strengths`, `gaps`, `strategy`
 * `basis_note`, `data_sufficiency`, `requirement_matches`, `summary_counts`
 * of the final form are server-built (card: "summary_counts는 서버가 계산").
 *
 * Canonical form (C-10.2): every key present, absent = explicit null, depth ≤ 5.
 * Count caps here are generous so a model that over-produces still parses
 * (V-6); the server trims (strengths ≤ 3, priorities ≤ 5) after validation.
 */

export const AI02_OUTPUT_SCHEMA_VERSION = 1;

/** Screen labels: 충족 / 부분 충족 / 근거 없음. */
export const INSIGHT_MATCH_STATUSES = ["met", "partial", "no_evidence"] as const;
export type InsightMatchStatus = (typeof INSIGHT_MATCH_STATUSES)[number];

/** `gaps[].gap_kind`: a gap comes from a partial or no_evidence requirement. */
export const INSIGHT_GAP_KINDS = ["partial", "no_evidence"] as const;
export type InsightGapKind = (typeof INSIGHT_GAP_KINDS)[number];

/** `gaps[].actions[].type` — limited to three kinds (card 프롬프트 전략). */
export const INSIGHT_ACTION_TYPES = ["add_data", "reframe", "prepare_answer"] as const;
export type InsightActionType = (typeof INSIGHT_ACTION_TYPES)[number];

const Ref = z.string().max(20);
const Refs = z.array(Ref).max(20);
const Evidence = z.array(ModelEvidenceSchema).max(12);

// ---------- stage 1 ----------

export const Ai02MatchSchema = z.object({
  requirement_ref: Ref,
  status: z.enum(INSIGHT_MATCH_STATUSES),
  rationale: z.string().max(800),
  missing_aspect: z.string().max(400).nullable(),
  evidence: Evidence,
});

export const Ai02MatchOutputSchema = z.object({
  schema_version: z.literal(AI02_OUTPUT_SCHEMA_VERSION),
  matches: z.array(Ai02MatchSchema).max(30),
});

export type Ai02Match = z.infer<typeof Ai02MatchSchema>;
export type Ai02MatchOutput = z.infer<typeof Ai02MatchOutputSchema>;

// ---------- stage 2 ----------

export const Ai02StrengthSchema = z.object({
  title: z.string().max(120),
  description: z.string().max(800),
  requirement_refs: Refs,
  evidence: Evidence,
});

export const Ai02GapActionSchema = z.object({
  type: z.enum(INSIGHT_ACTION_TYPES),
  text: z.string().max(600),
  /** Required for reframe / prepare_answer (V-4 drops them otherwise); add_data may be empty. */
  evidence: Evidence,
});

export const Ai02GapSchema = z.object({
  requirement_refs: Refs,
  gap_kind: z.enum(INSIGHT_GAP_KINDS),
  description: z.string().max(800),
  actions: z.array(Ai02GapActionSchema).max(6),
  evidence: Evidence,
});

export const Ai02PrioritySchema = z.object({
  rank: z.number().int().min(1).max(50),
  ref: Ref,
  reason: z.string().max(400),
  requirement_refs: Refs,
});

export const Ai02StrategySchema = z.object({
  positioning: z.string().max(600),
  positioning_evidence: Evidence,
  project_priorities: z.array(Ai02PrioritySchema).max(10),
});

export const Ai02SynthesisOutputSchema = z.object({
  schema_version: z.literal(AI02_OUTPUT_SCHEMA_VERSION),
  strengths: z.array(Ai02StrengthSchema).max(6),
  gaps: z.array(Ai02GapSchema).max(40),
  strategy: Ai02StrategySchema,
});

export type Ai02Strength = z.infer<typeof Ai02StrengthSchema>;
export type Ai02Gap = z.infer<typeof Ai02GapSchema>;
export type Ai02GapAction = z.infer<typeof Ai02GapActionSchema>;
export type Ai02Priority = z.infer<typeof Ai02PrioritySchema>;
export type Ai02SynthesisOutput = z.infer<typeof Ai02SynthesisOutputSchema>;
