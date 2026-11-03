import { z } from "zod";
import { COMPOSE_STYLES, DELIVERABLE_SLOTS, WRITING_KINDS } from "../context-pack/deliverable-slots";
import { toCanonicalJsonSchema } from "../providers/schema";
import { SENSITIVE_CATEGORIES } from "./AI-12";
import { DELIVERABLE_CLARIFICATION_KINDS, DRAFT_BLOCK_BASES, DRAFT_BLOCK_TYPES, FACT_ACTORS, PROJECT_SOURCE_FIELDS } from "./deliverable-draft";

/**
 * AI-13 model outputs (AI spec v4.6 AI-13 "출력 스키마"), keys exactly as the
 * spec. Canonical form (C-10.2): every key present, optional values as null,
 * enums for type / basis / actor / slot, object depth ≤ 5 (root → block →
 * item / row). Counts the server trims anyway (C-14: facts per turn ≤ 10,
 * fact text ≤ 300, block text ≤ 1,500) are looser here so one long value does
 * not fail the whole parse (V-6); the block count (≤ 120) is the C-14 value.
 */

export const AI13_OUTPUT_SCHEMA_VERSION = 1;

const MessageIds = z.array(z.string().max(20)).max(10);
const Quotes = z.array(z.string().max(1000)).max(10);

// ---------- 정리 (extract): question and draft turns ----------

export const Ai13FactOutputSchema = z.object({
  slot: z.enum(DELIVERABLE_SLOTS),
  text: z.string().max(600),
  actor: z.enum(FACT_ACTORS),
  source_message_ids: MessageIds,
  source_quotes: Quotes,
});

export const Ai13ClarificationOutputSchema = z.object({
  kind: z.enum(DELIVERABLE_CLARIFICATION_KINDS),
  slot: z.enum(DELIVERABLE_SLOTS).nullable(),
  /** Model's note, cleaned before storage (no aliases, no sensitive text, ≤ 200). */
  note: z.string().max(500).nullable(),
});

export const Ai13ExtractOutputSchema = z.object({
  schema_version: z.literal(AI13_OUTPUT_SCHEMA_VERSION),
  writing_kind: z.enum(WRITING_KINDS).nullable(),
  intent: z.enum(["compose_draft"]).nullable(),
  style: z.enum(COMPOSE_STYLES).nullable(),
  facts: z.array(Ai13FactOutputSchema).max(20),
  clarifications: z.array(Ai13ClarificationOutputSchema).max(10),
  sensitive_flags: z
    .array(z.object({ category: z.enum(SENSITIVE_CATEGORIES), message_id: z.string().max(20) }))
    .max(20),
});
export type Ai13ExtractOutput = z.infer<typeof Ai13ExtractOutputSchema>;
export type Ai13FactOutput = z.infer<typeof Ai13FactOutputSchema>;

// ---------- 초안 (compose): draft turns ----------

/** C-14: 초안 블록 ≤ 120개. */
export const AI13_MAX_BLOCKS = 120;

const FactIds = z.array(z.string().max(20)).max(20);
const BodyQuotes = z.array(z.string().max(2000)).max(10);
const ProjectFields = z.array(z.enum(PROJECT_SOURCE_FIELDS)).max(5);

export const Ai13ListItemOutputSchema = z.object({
  text: z.string().max(3000),
  source_fact_ids: FactIds,
  source_body_quotes: BodyQuotes,
  source_project_fields: ProjectFields,
});

export const Ai13TableRowOutputSchema = z.object({
  cells: z.array(z.string().max(1000)).max(12),
  source_fact_ids: FactIds,
  source_body_quotes: BodyQuotes,
  source_project_fields: ProjectFields,
});

export const Ai13BlockOutputSchema = z.object({
  type: z.enum(DRAFT_BLOCK_TYPES),
  /** heading only (2–3 by prompt; ≤ 3 by V-10g). */
  level: z.number().int().nullable(),
  /** heading / paragraph / quote / code. */
  text: z.string().max(3000).nullable(),
  /** bullet_list / numbered_list. */
  items: z.array(Ai13ListItemOutputSchema).max(50).nullable(),
  /** table (first row = header). */
  rows: z.array(Ai13TableRowOutputSchema).max(50).nullable(),
  /** Content blocks; the server re-derives it (V-10h). */
  basis: z.enum(DRAFT_BLOCK_BASES).nullable(),
  source_fact_ids: FactIds,
  source_body_quotes: BodyQuotes,
  source_project_fields: ProjectFields,
});

export const Ai13ComposeOutputSchema = z.object({
  schema_version: z.literal(AI13_OUTPUT_SCHEMA_VERSION),
  writing_kind: z.enum(WRITING_KINDS),
  replace_mode: z.boolean(),
  blocks: z.array(Ai13BlockOutputSchema).max(AI13_MAX_BLOCKS),
  missing_slots: z.array(z.enum(DELIVERABLE_SLOTS)).max(DELIVERABLE_SLOTS.length),
});
export type Ai13ComposeOutput = z.infer<typeof Ai13ComposeOutputSchema>;
export type Ai13BlockOutput = z.infer<typeof Ai13BlockOutputSchema>;

let extractJson: Record<string, unknown> | null = null;
let composeJson: Record<string, unknown> | null = null;
/** Canonical JSON schemas (C-10.2) — tests assert both convert. */
export function ai13ExtractJsonSchema(): Record<string, unknown> {
  extractJson ??= toCanonicalJsonSchema(Ai13ExtractOutputSchema);
  return extractJson;
}
export function ai13ComposeJsonSchema(): Record<string, unknown> {
  composeJson ??= toCanonicalJsonSchema(Ai13ComposeOutputSchema);
  return composeJson;
}
