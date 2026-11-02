import { z } from "zod";
import { COMPETENCIES, EXPERIENCE_TYPES, PROJECT_TYPES } from "../classification";
import { toCanonicalJsonSchema } from "../providers/schema";
import { CLARIFICATION_FIELDS, CLARIFICATION_KINDS, DRAFT_PERIOD_FIELDS, STAR_FIELDS, STAR_OPS } from "./structured-draft";

/**
 * AI-12 정리(extract) model output, schema_version 3 (AI spec v4.5 AI-12 "출력
 * 스키마"). Keys match the spec exactly. Canonical form (C-10.2): every key
 * present, optional values as explicit null, depth ≤ 5. Classification values
 * are enums in the provider schema (structured output keeps the model inside
 * the CR-17 lists); V-9i re-checks them. Counts and lengths that V-9 trims
 * (competencies ≤ 3, reason ≤ 100) are looser here so one long value does not
 * fail the whole turn's parse (V-6).
 *
 * v4.4 `detail_patches`, `new_details`, `achievements`, `skills`,
 * `affiliation_suggestion` are gone.
 */

export const AI12_OUTPUT_SCHEMA_VERSION = 3;

export const SENSITIVE_CATEGORIES = ["health", "religion", "union", "politics", "third_party_name", "contact"] as const;
export type SensitiveCategory = (typeof SENSITIVE_CATEGORIES)[number];

const MessageIds = z.array(z.string().max(20)).max(10);
const Quotes = z.array(z.string().max(1000)).max(10);
const Reason = z.string().max(500).nullable();

export const ProjectPatchSchema = z.object({
  field: z.enum(DRAFT_PERIOD_FIELDS),
  op: z.enum(["set"]),
  value: z.string().max(20),
  source_message_ids: MessageIds,
  source_quotes: Quotes,
});

export const StarPatchSchema = z.object({
  field: z.enum(STAR_FIELDS),
  op: z.enum(STAR_OPS),
  value: z.string().max(4000),
  source_message_ids: MessageIds,
  source_quotes: Quotes,
});

export const ClassificationSuggestionsSchema = z.object({
  project_type: z.object({ value: z.enum(PROJECT_TYPES), source_message_ids: MessageIds, reason: Reason }).nullable(),
  experience_type: z.object({ value: z.enum(EXPERIENCE_TYPES), source_message_ids: MessageIds, reason: Reason }).nullable(),
  competencies: z.object({ value: z.array(z.enum(COMPETENCIES)).max(10), source_message_ids: MessageIds, reason: Reason }).nullable(),
});

export const ClarificationOutputSchema = z.object({
  kind: z.enum(CLARIFICATION_KINDS),
  field: z.enum(CLARIFICATION_FIELDS).nullable(),
  /** Model's note; never stored (DM 2.5 clarification has no text) and never logged. */
  note: z.string().max(500).nullable(),
});

export const SensitiveFlagSchema = z.object({
  category: z.enum(SENSITIVE_CATEGORIES),
  message_id: z.string().max(20),
});

export const Ai12ExtractOutputSchema = z.object({
  schema_version: z.literal(AI12_OUTPUT_SCHEMA_VERSION),
  project_patches: z.array(ProjectPatchSchema).max(4),
  star_patches: z.array(StarPatchSchema).max(20),
  classification_suggestions: ClassificationSuggestionsSchema,
  clarifications: z.array(ClarificationOutputSchema).max(20),
  sensitive_flags: z.array(SensitiveFlagSchema).max(20),
});

export type Ai12ExtractOutput = z.infer<typeof Ai12ExtractOutputSchema>;
export type ProjectPatch = z.infer<typeof ProjectPatchSchema>;
export type StarPatch = z.infer<typeof StarPatchSchema>;
export type ClassificationSuggestions = z.infer<typeof ClassificationSuggestionsSchema>;
export type ClarificationOutput = z.infer<typeof ClarificationOutputSchema>;

let cachedJsonSchema: Record<string, unknown> | null = null;
/** Canonical JSON schema for the structured-output request (C-10.2). */
export function ai12ExtractJsonSchema(): Record<string, unknown> {
  cachedJsonSchema ??= toCanonicalJsonSchema(Ai12ExtractOutputSchema);
  return cachedJsonSchema;
}
