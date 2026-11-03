import { z } from "zod";
import { DELIVERABLE_SLOTS, WRITING_KINDS } from "../context-pack/deliverable-slots";
import { REVIEW_STATES, FIELD_ORIGINS } from "./structured-draft";

/**
 * `writing_chats.structured_draft` for deliverable chats (DM v4.5 2.5.0 = AI
 * spec v4.6 AI-13 "저장"). Told apart from the STAR draft (schema_version 3)
 * by `target: "project_deliverable"` and the chat's project_deliverable_id.
 *
 * Sources inside are UUIDs: facts cite `writing_chat_messages.id` (role user,
 * V-9a); blocks cite fact ids. Nothing here goes to evidence_links (DM-15).
 * Only RPCs write the column: apply_structured_draft_patch (AI = app_ai_writer,
 * user = session) and the save RPC's helper (applied_*).
 */

export const DELIVERABLE_DRAFT_SCHEMA_VERSION = 1;
export const DELIVERABLE_DRAFT_TARGET = "project_deliverable";

export const FACT_ACTORS = ["self", "team", "unknown"] as const;
export type FactActor = (typeof FACT_ACTORS)[number];

/** V-10g block types (C-14). */
export const DRAFT_BLOCK_TYPES = ["heading", "paragraph", "bullet_list", "numbered_list", "table", "quote", "code"] as const;
export type DraftBlockType = (typeof DRAFT_BLOCK_TYPES)[number];

export const DRAFT_BLOCK_BASES = ["new", "current_body"] as const;
export type DraftBlockBasis = (typeof DRAFT_BLOCK_BASES)[number];

/** `source_project_fields` keys (AI-13 "초안 출처"). */
export const PROJECT_SOURCE_FIELDS = ["PRJ.description", "PRJ.role", "PRJ.skills", "PRJ.name", "PRJ.period"] as const;
export type ProjectSourceField = (typeof PROJECT_SOURCE_FIELDS)[number];

export const APPLIED_MODES = ["replace", "append"] as const;
export const DELIVERABLE_CLARIFICATION_KINDS = ["actor_ambiguous", "number_vague"] as const;
export type DeliverableClarificationKind = (typeof DELIVERABLE_CLARIFICATION_KINDS)[number];

export const StoredFactSchema = z.object({
  id: z.string(),
  slot: z.enum(DELIVERABLE_SLOTS),
  text: z.string(),
  actor: z.enum(FACT_ACTORS),
  source_message_ids: z.array(z.string()).default([]),
  source_quotes: z.array(z.string()).default([]),
  review: z.enum(REVIEW_STATES).default("ok"),
  reviewed_at: z.string().nullable().default(null),
  origin: z.enum(FIELD_ORIGINS).default("ai"),
});
export type StoredFact = z.infer<typeof StoredFactSchema>;

const blockSources = {
  source_fact_ids: z.array(z.string()).default([]),
  source_body_quotes: z.array(z.string()).default([]),
  source_project_fields: z.array(z.enum(PROJECT_SOURCE_FIELDS)).default([]),
};

export const StoredListItemSchema = z.object({ text: z.string(), ...blockSources });
export const StoredTableRowSchema = z.object({ cells: z.array(z.string()), ...blockSources });

export const StoredBlockSchema = z.object({
  block_id: z.string(),
  type: z.enum(DRAFT_BLOCK_TYPES),
  /** heading only: 1–3. */
  level: z.number().int().nullable().default(null),
  /** heading / paragraph / quote / code. */
  text: z.string().nullable().default(null),
  /** bullet_list / numbered_list [가정]. */
  items: z.array(StoredListItemSchema).nullable().default(null),
  /** table: first row is the header [가정]. */
  rows: z.array(StoredTableRowSchema).nullable().default(null),
  basis: z.enum(DRAFT_BLOCK_BASES).nullable().default(null),
  ...blockSources,
  review: z.enum(REVIEW_STATES).default("ok"),
});
export type StoredBlock = z.infer<typeof StoredBlockSchema>;

export const StoredDraftBodySchema = z.object({
  value: z.string(),
  blocks: z.array(StoredBlockSchema).default([]),
  rev: z.number().int().min(1).default(1),
  generated_at: z.string().nullable().default(null),
  base_body_hash: z.string().nullable().default(null),
  replace_allowed: z.boolean().default(true),
  missing_slots: z.array(z.string()).default([]),
  dropped_block_count: z.number().int().min(0).default(0),
  applied_at: z.string().nullable().default(null),
  applied_mode: z.enum(APPLIED_MODES).nullable().default(null),
  applied_rev: z.number().int().nullable().default(null),
});
export type StoredDraftBody = z.infer<typeof StoredDraftBodySchema>;

export const DeliverableClarificationSchema = z.object({
  kind: z.enum(DELIVERABLE_CLARIFICATION_KINDS),
  slot: z.enum(DELIVERABLE_SLOTS).nullable().default(null),
  note: z.string().nullable().default(null),
});
export type DeliverableClarification = z.infer<typeof DeliverableClarificationSchema>;

export const DeliverableDraftSchema = z.object({
  schema_version: z.number().default(DELIVERABLE_DRAFT_SCHEMA_VERSION),
  target: z.literal(DELIVERABLE_DRAFT_TARGET).default(DELIVERABLE_DRAFT_TARGET),
  writing_kind: z.enum(WRITING_KINDS).nullable().default(null),
  facts: z.array(StoredFactSchema).default([]),
  /** `{}` until the first draft. */
  deliverable: z.object({ body: StoredDraftBodySchema.optional() }).default({}),
  clarifications: z.array(DeliverableClarificationSchema).default([]),
  sensitive_flags_count: z.number().int().min(0).default(0),
  draft_count: z.number().int().min(0).default(0),
});
export type DeliverableDraft = z.infer<typeof DeliverableDraftSchema>;

/** True when the stored jsonb is a deliverable-chat draft (vs the STAR v3 draft). */
export function isDeliverableDraftJson(json: unknown): boolean {
  return !!json && typeof json === "object" && (json as { target?: unknown }).target === DELIVERABLE_DRAFT_TARGET;
}

/**
 * Reads the stored jsonb. The start RPC writes the empty shape; `'{}'` is read
 * as empty too. A value that does not parse is a server bug (RPC-only column),
 * so this throws rather than resetting the user's facts.
 */
export function parseDeliverableDraft(json: unknown): DeliverableDraft {
  const value = json && typeof json === "object" && Object.keys(json).length > 0 ? json : {};
  return DeliverableDraftSchema.parse(value);
}

export function emptyDeliverableDraft(): DeliverableDraft {
  return DeliverableDraftSchema.parse({});
}

/** The current draft body, if any (an empty `deliverable` = no draft yet). */
export function currentDraftBody(d: DeliverableDraft): StoredDraftBody | null {
  return d.deliverable.body ?? null;
}
