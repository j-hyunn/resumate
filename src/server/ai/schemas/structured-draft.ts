import { z } from "zod";

/**
 * `writing_chats.structured_draft` storage format (data model 2.5, AI spec
 * AI-12 "패치 → structured_draft 매핑") and the AI patch handed to the RPC
 * `apply_structured_draft_patch` (S4 notes 0.4).
 *
 * Field keys are the target column names (DM 2.5 v3.1). Sources are
 * `writing_chat_messages.id` UUIDs of `role = 'user'` messages only (V-9a).
 */

export const STRUCTURED_DRAFT_SCHEMA_VERSION = 1;

export const PROJECT_FIELDS = ["name", "role", "summary", "start_month", "end_month", "team_size"] as const;
export const DETAIL_FIELDS = ["title", "situation", "task", "action", "result", "learnings"] as const;
export const ACHIEVEMENT_FIELDS = ["metric_name", "value_before", "value_after", "unit"] as const;
export const REVIEW_STATES = ["ok", "needs_review", "accepted"] as const;
export const FIELD_ORIGINS = ["ai", "user_edit"] as const;
export const CLARIFICATION_KINDS = ["actor_ambiguous", "number_vague", "period_unclear", "affiliation_unclear"] as const;
export const AFFILIATION_TYPES = ["experience", "education"] as const;

export type ProjectField = (typeof PROJECT_FIELDS)[number];
export type DetailField = (typeof DETAIL_FIELDS)[number];
export type AchievementField = (typeof ACHIEVEMENT_FIELDS)[number];
export type ReviewState = (typeof REVIEW_STATES)[number];
export type ClarificationKind = (typeof CLARIFICATION_KINDS)[number];
export type AffiliationType = (typeof AFFILIATION_TYPES)[number];

/** Any field name a clarification may point at. */
export const CLARIFICATION_FIELDS = [...PROJECT_FIELDS, ...DETAIL_FIELDS, ...ACHIEVEMENT_FIELDS] as const;

const FieldValueSchema = z.union([z.string(), z.number()]).nullable();

export const DraftFieldSchema = z.object({
  value: FieldValueSchema.default(null),
  origin: z.enum(FIELD_ORIGINS).default("ai"),
  source_message_ids: z.array(z.string()).default([]),
  source_quotes: z.array(z.string()).default([]),
  review: z.enum(REVIEW_STATES).default("ok"),
  reviewed_at: z.string().nullable().default(null),
});
export type DraftField = z.infer<typeof DraftFieldSchema>;

const partialRecord = <K extends readonly [string, ...string[]]>(keys: K) =>
  z.partialRecord(z.enum(keys), DraftFieldSchema);

/** Achievement item: `achievement_key` ("A1"…, assigned by the RPC) + one field object per metric field. */
export const DraftAchievementSchema = z.object({
  achievement_key: z.string().nullable().default(null),
  metric_name: DraftFieldSchema.optional(),
  value_before: DraftFieldSchema.optional(),
  value_after: DraftFieldSchema.optional(),
  unit: DraftFieldSchema.optional(),
});
export type DraftAchievement = z.infer<typeof DraftAchievementSchema>;

export const DraftDetailSchema = z.object({
  detail_key: z.string().nullable().default(null),
  existing_detail_id: z.string().nullable().default(null),
  fields: partialRecord(DETAIL_FIELDS).default({}),
  achievements: z.array(DraftAchievementSchema).default([]),
});
export type DraftDetail = z.infer<typeof DraftDetailSchema>;

export const DraftSkillSchema = z.object({
  value: z.string(),
  source_message_ids: z.array(z.string()).default([]),
  source_quotes: z.array(z.string()).default([]),
});
export type DraftSkill = z.infer<typeof DraftSkillSchema>;

export const AffiliationSuggestionSchema = z.object({
  type: z.enum(AFFILIATION_TYPES),
  id: z.string(),
  source_message_ids: z.array(z.string()).default([]),
});
export type AffiliationSuggestion = z.infer<typeof AffiliationSuggestionSchema>;

export const ClarificationSchema = z.object({
  kind: z.enum(CLARIFICATION_KINDS),
  field: z.string().nullable().default(null),
  detail_key: z.string().nullable().default(null),
  existing_detail_id: z.string().nullable().default(null),
});
export type Clarification = z.infer<typeof ClarificationSchema>;

export const StructuredDraftSchema = z.object({
  schema_version: z.number().default(STRUCTURED_DRAFT_SCHEMA_VERSION),
  project: partialRecord(PROJECT_FIELDS).default({}),
  affiliation_suggestion: AffiliationSuggestionSchema.nullable().default(null),
  details: z.array(DraftDetailSchema).default([]),
  skills: z.array(DraftSkillSchema).default([]),
  clarifications: z.array(ClarificationSchema).default([]),
  sensitive_flags_count: z.number().int().min(0).default(0),
});
export type StructuredDraft = z.infer<typeof StructuredDraftSchema>;

export function emptyStructuredDraft(): StructuredDraft {
  return StructuredDraftSchema.parse({});
}

/**
 * Reads the stored jsonb (the column default is `'{}'`). Unknown keys are
 * dropped. A value that does not parse is a server bug (only RPCs write the
 * column), so this throws rather than silently resetting the user's draft.
 */
export function parseStructuredDraft(json: unknown): StructuredDraft {
  return StructuredDraftSchema.parse(json ?? {});
}

/** A field counts as filled when it has a non-empty value (any review state). */
export function hasValue(field: DraftField | undefined | null): boolean {
  if (!field) return false;
  const v = field.value;
  return v !== null && !(typeof v === "string" && v.trim() === "");
}

/** Usable by save_writing_chat: a value and review ok/accepted (needs_review is skipped, R-27·T-18). */
export function isSavable(field: DraftField | undefined | null): boolean {
  return hasValue(field) && field!.review !== "needs_review";
}

/** User-owned fields an AI patch must not overwrite (AI-12 매핑표, RPC enforces too). */
export function isProtected(field: DraftField | undefined | null): boolean {
  return !!field && (field.origin === "user_edit" || field.review === "accepted");
}

// ---------- Validated AI changes (V-9 output) ----------
// The pipeline builds DraftChanges, then `toDraftPatch` turns them into the
// RPC's ordered op list (db-engineer S4 notes "패치 계약").

export type PatchTarget = "project" | "detail";

export type PatchFieldObject = {
  value: string | number;
  source_message_ids: string[];
  source_quotes: string[];
  review: "ok" | "needs_review";
};

export type DraftPatchField = PatchFieldObject & {
  target: PatchTarget;
  detail_key: string | null;
  existing_detail_id: string | null;
  field: ProjectField | DetailField;
};

export type DraftPatchAchievement = {
  detail_key: string | null;
  existing_detail_id: string | null;
  fields: Partial<Record<AchievementField, PatchFieldObject>>;
};

export type DraftChanges = {
  fields: DraftPatchField[];
  new_details: { detail_key: string }[];
  achievements: DraftPatchAchievement[];
  skills: DraftSkill[];
  /** null = unchanged. */
  affiliation_suggestion: AffiliationSuggestion | null;
  /** null = unchanged; an array replaces the whole list. */
  clarifications: Clarification[] | null;
  sensitive_flags_add: number;
};

export function emptyDraftChanges(): DraftChanges {
  return {
    fields: [],
    new_details: [],
    achievements: [],
    skills: [],
    affiliation_suggestion: null,
    clarifications: null,
    sensitive_flags_add: 0,
  };
}

export function isEmptyDraftChanges(patch: DraftChanges): boolean {
  return (
    patch.fields.length === 0 &&
    patch.new_details.length === 0 &&
    patch.achievements.length === 0 &&
    patch.skills.length === 0 &&
    patch.affiliation_suggestion === null &&
    patch.clarifications === null &&
    patch.sensitive_flags_add === 0
  );
}

// ---------- RPC patch: apply_structured_draft_patch(p_writing_chat_id, p_patch) ----------

export type PatchTargetRef =
  | { section: "project"; field: ProjectField }
  | { section: "detail"; detail_key: string; field: DetailField }
  | { section: "detail"; existing_detail_id: string; field: DetailField };

export type PatchSource = { source_message_ids: string[]; source_quotes: string[] };

export type DraftPatchOp =
  | ({ op: "set"; target: PatchTargetRef; value: string | number; review: "ok" | "needs_review" } & PatchSource)
  | { op: "new_detail"; detail_key: string }
  | {
      op: "add_achievement";
      detail: { detail_key: string } | { existing_detail_id: string };
      fields: Partial<Record<AchievementField, { value: string | number; review: "ok" | "needs_review" } & PatchSource>>;
    }
  | ({ op: "add_skill"; value: string } & PatchSource)
  | { op: "set_affiliation_suggestion"; type: AffiliationType; id: string; source_message_ids: string[] }
  | { op: "set_clarifications"; items: Clarification[] }
  | { op: "add_sensitive_flags"; count: number };

/** p_patch for apply_structured_draft_patch (AI caller = app_ai_writer). Ops apply in order. */
export type DraftPatch = { ops: DraftPatchOp[] };

/** RPC limits (20261030000400_s4_structured_draft_patch.sql): ops, ids / quotes per field, clarifications, sensitive count. */
export const DRAFT_PATCH_MAX_OPS = 100;
export const DRAFT_PATCH_MAX_SOURCES = 20;
export const DRAFT_PATCH_MAX_QUOTES = 20;
export const DRAFT_PATCH_MAX_QUOTE_LENGTH = 1000;
export const DRAFT_PATCH_MAX_CLARIFICATIONS = 50;
export const DRAFT_PATCH_MAX_SENSITIVE_ADD = 100;

function clampSources<T extends PatchSource>(obj: T): T {
  return {
    ...obj,
    source_message_ids: obj.source_message_ids.slice(0, DRAFT_PATCH_MAX_SOURCES),
    source_quotes: obj.source_quotes.slice(0, DRAFT_PATCH_MAX_QUOTES),
  };
}

/**
 * DraftChanges → ordered RPC ops: sensitive count (if any, never truncated),
 * new_detail (later sets use the keys), field sets, achievements, skills,
 * affiliation, clarifications. Ops beyond DRAFT_PATCH_MAX_OPS are dropped
 * (left for the next turn; the model never proposes that many in one turn).
 */
export function toDraftPatch(changes: DraftChanges): DraftPatch {
  const ops: DraftPatchOp[] = [];
  for (const nd of changes.new_details) ops.push({ op: "new_detail", detail_key: nd.detail_key });
  for (const f of changes.fields) {
    const target: PatchTargetRef =
      f.target === "project"
        ? { section: "project", field: f.field as ProjectField }
        : f.existing_detail_id
          ? { section: "detail", existing_detail_id: f.existing_detail_id, field: f.field as DetailField }
          : { section: "detail", detail_key: f.detail_key!, field: f.field as DetailField };
    ops.push(clampSources({ op: "set" as const, target, value: f.value, source_message_ids: f.source_message_ids, source_quotes: f.source_quotes, review: f.review }));
  }
  for (const a of changes.achievements) {
    ops.push({
      op: "add_achievement",
      detail: a.existing_detail_id ? { existing_detail_id: a.existing_detail_id } : { detail_key: a.detail_key! },
      fields: Object.fromEntries(Object.entries(a.fields).map(([k, v]) => [k, clampSources(v)])),
    });
  }
  for (const s of changes.skills) {
    ops.push(clampSources({ op: "add_skill" as const, value: s.value, source_message_ids: s.source_message_ids, source_quotes: s.source_quotes }));
  }
  if (changes.affiliation_suggestion) {
    const a = changes.affiliation_suggestion;
    ops.push({ op: "set_affiliation_suggestion", type: a.type, id: a.id, source_message_ids: a.source_message_ids.slice(0, DRAFT_PATCH_MAX_SOURCES) });
  }
  if (changes.clarifications) ops.push({ op: "set_clarifications", items: changes.clarifications.slice(0, DRAFT_PATCH_MAX_CLARIFICATIONS) });
  // QA-S4-07: the sensitive count goes first and is never cut by the op cap
  // (it carries no target, so its position doesn't matter to the RPC).
  if (changes.sensitive_flags_add > 0) {
    const sensitive: DraftPatchOp = { op: "add_sensitive_flags", count: Math.min(changes.sensitive_flags_add, DRAFT_PATCH_MAX_SENSITIVE_ADD) };
    return { ops: [sensitive, ...ops.slice(0, DRAFT_PATCH_MAX_OPS - 1)] };
  }
  return { ops: ops.slice(0, DRAFT_PATCH_MAX_OPS) };
}

export function isEmptyDraftPatch(patch: DraftPatch): boolean {
  return patch.ops.length === 0;
}

/** Points at one field in the draft, for SSE `draft_flags` (no text). */
export type FieldRef = {
  target: "project" | "detail" | "achievement";
  detail_key: string | null;
  existing_detail_id: string | null;
  field: string;
};
