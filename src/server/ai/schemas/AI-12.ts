import { z } from "zod";
import { toCanonicalJsonSchema } from "../providers/schema";
import {
  AFFILIATION_TYPES,
  CLARIFICATION_FIELDS,
  CLARIFICATION_KINDS,
  DETAIL_FIELDS,
  PROJECT_FIELDS,
} from "./structured-draft";

/**
 * AI-12 정리(extract) model output, schema_version 2 (AI spec AI-12 "출력
 * 스키마"). Keys match the spec exactly. Canonical form (C-10.2): every key
 * present, optional values as explicit null, depth ≤ 5. Limits are checked by
 * zod after parsing (V-6) and by V-9.
 */

export const AI12_OUTPUT_SCHEMA_VERSION = 2;

export const SENSITIVE_CATEGORIES = ["health", "religion", "union", "politics", "third_party_name", "contact"] as const;
export type SensitiveCategory = (typeof SENSITIVE_CATEGORIES)[number];

export const PATCH_OPS = ["set", "append"] as const;

const MessageIds = z.array(z.string().max(20)).max(10);
const Quotes = z.array(z.string().max(1000)).max(10);

export const ProjectPatchSchema = z.object({
  field: z.enum(PROJECT_FIELDS),
  op: z.enum(PATCH_OPS),
  value: z.union([z.string().max(2000), z.number()]),
  source_message_ids: MessageIds,
  source_quotes: Quotes,
});

export const DetailPatchSchema = z.object({
  detail_key: z.string().max(10).nullable(),
  detail_ref: z.string().max(20).nullable(),
  field: z.enum(DETAIL_FIELDS),
  op: z.enum(PATCH_OPS),
  value: z.string().max(4000),
  source_message_ids: MessageIds,
  source_quotes: Quotes,
});

export const AchievementOutputSchema = z.object({
  detail_key: z.string().max(10).nullable(),
  detail_ref: z.string().max(20).nullable(),
  metric_name: z.string().max(200).nullable(),
  value_before: z.number().nullable(),
  value_after: z.number().nullable(),
  unit: z.string().max(100).nullable(),
  source_message_ids: MessageIds,
  source_quotes: Quotes,
});

export const SkillOutputSchema = z.object({
  value: z.string().max(200),
  source_message_ids: MessageIds,
  source_quotes: Quotes,
});

export const NewDetailSchema = z.object({
  detail_key: z.string().max(10),
  source_message_ids: MessageIds,
});

export const AffiliationOutputSchema = z.object({
  type: z.enum(AFFILIATION_TYPES),
  ref: z.string().max(20),
  source_message_ids: MessageIds,
  source_quotes: Quotes,
});

export const ClarificationOutputSchema = z.object({
  kind: z.enum(CLARIFICATION_KINDS),
  field: z.enum(CLARIFICATION_FIELDS).nullable(),
  detail_key: z.string().max(10).nullable(),
  detail_ref: z.string().max(20).nullable(),
  /** Model's note; never stored (DM 2.5 clarification has no text) and never logged. */
  note: z.string().max(500).nullable(),
});

export const SensitiveFlagSchema = z.object({
  category: z.enum(SENSITIVE_CATEGORIES),
  message_id: z.string().max(20),
});

export const Ai12ExtractOutputSchema = z.object({
  schema_version: z.literal(AI12_OUTPUT_SCHEMA_VERSION),
  project_patches: z.array(ProjectPatchSchema).max(20),
  detail_patches: z.array(DetailPatchSchema).max(40),
  achievements: z.array(AchievementOutputSchema).max(20),
  skills: z.array(SkillOutputSchema).max(30),
  new_details: z.array(NewDetailSchema).max(10),
  affiliation_suggestion: AffiliationOutputSchema.nullable(),
  clarifications: z.array(ClarificationOutputSchema).max(20),
  sensitive_flags: z.array(SensitiveFlagSchema).max(20),
});

export type Ai12ExtractOutput = z.infer<typeof Ai12ExtractOutputSchema>;
export type ProjectPatch = z.infer<typeof ProjectPatchSchema>;
export type DetailPatch = z.infer<typeof DetailPatchSchema>;
export type AchievementOutput = z.infer<typeof AchievementOutputSchema>;
export type SkillOutput = z.infer<typeof SkillOutputSchema>;
export type ClarificationOutput = z.infer<typeof ClarificationOutputSchema>;

let cachedJsonSchema: Record<string, unknown> | null = null;
/** Canonical JSON schema for the structured-output request (C-10.2). */
export function ai12ExtractJsonSchema(): Record<string, unknown> {
  cachedJsonSchema ??= toCanonicalJsonSchema(Ai12ExtractOutputSchema);
  return cachedJsonSchema;
}
