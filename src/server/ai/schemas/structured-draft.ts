import { z } from "zod";
import { CLASSIFICATION_FIELDS, type ClassificationField } from "../classification";

/**
 * `writing_chats.structured_draft` v3 (DM v4.4 2.5, AI spec v4.5 AI-12 "패치 →
 * structured_draft 매핑") and the AI patch handed to `apply_structured_draft_patch`.
 *
 * One project, one STAR (CR-2): `project.{start_month,end_month}`,
 * `star.{situation,task,action,result,learnings}`, `classification.{project_type,
 * experience_type,competencies}` (CR-20). Field keys = `projects` column names.
 * Sources are `writing_chat_messages.id` UUIDs of `role = 'user'` messages
 * only (V-9a). `is_current` is never proposed (R-CR-15).
 */

export const STRUCTURED_DRAFT_SCHEMA_VERSION = 3;

export const DRAFT_PERIOD_FIELDS = ["start_month", "end_month"] as const;
export const STAR_FIELDS = ["situation", "task", "action", "result", "learnings"] as const;
export const STAR_OPS = ["set", "append"] as const;
/**
 * R8 QA-4 (DM v4.9 2.5 `review_reason`): why a STAR proposal is needs_review —
 * `existing_missing` = V-9j (an existing number / name is not in the merged value),
 * `content_unverified` = V-9e. Absent / null = no reason (older objects, review ok).
 */
export const STAR_REVIEW_REASONS = ["existing_missing", "content_unverified"] as const;
export type StarReviewReason = (typeof STAR_REVIEW_REASONS)[number];
export const REVIEW_STATES = ["ok", "needs_review", "accepted"] as const;
export const FIELD_ORIGINS = ["ai", "user_edit"] as const;
/** v4.5: `affiliation_unclear` is gone (the project already has its affiliation). */
export const CLARIFICATION_KINDS = ["actor_ambiguous", "number_vague", "period_unclear"] as const;
export { CLASSIFICATION_FIELDS };

export type PeriodField = (typeof DRAFT_PERIOD_FIELDS)[number];
export type StarField = (typeof STAR_FIELDS)[number];
export type StarOp = (typeof STAR_OPS)[number];
export type ReviewState = (typeof REVIEW_STATES)[number];
export type ClarificationKind = (typeof CLARIFICATION_KINDS)[number];
export type { ClassificationField };

/** Fields a clarification may point at. */
export const CLARIFICATION_FIELDS = [...DRAFT_PERIOD_FIELDS, ...STAR_FIELDS] as const;

/** DM 2.3: one STAR field ≤ 2,000 chars (also the merged value on apply, C-14). */
export const STAR_FIELD_MAX_LENGTH = 2000;
/** C-14 [가정]: classification `reason` ≤ 100 chars (DM column allows 200). */
export const CLASSIFICATION_REASON_MAX = 100;

const fieldBase = {
  origin: z.enum(FIELD_ORIGINS).default("ai"),
  source_message_ids: z.array(z.string()).default([]),
  review: z.enum(REVIEW_STATES).default("ok"),
  reviewed_at: z.string().nullable().default(null),
  /** v4.5 (DM 2.5.1, PA-3): set by save_project_page ("저장하기"); null = not saved as applied yet. */
  applied_at: z.string().nullable().default(null),
  /**
   * v4.5 (DM 2.5 `rev`): proposal version, monotonic per slot. The screen
   * remembers it when filling the form and sends it on save (`proposal_changed`).
   * Objects written before v4.5 have none → 1.
   */
  rev: z.number().int().min(1).default(1),
};

export const PeriodFieldSchema = z.object({
  value: z.string().nullable().default(null),
  source_quotes: z.array(z.string()).default([]),
  ...fieldBase,
});
export type PeriodDraftField = z.infer<typeof PeriodFieldSchema>;

export const StarFieldSchema = z.object({
  value: z.string().nullable().default(null),
  /**
   * set = the whole value of the field (v4.9 RQ-5: on a filled field, the merged proposal that replaces it);
   * append = new sentences only, added after the current value (old drafts / compatibility).
   */
  op: z.enum(STAR_OPS).default("set"),
  source_quotes: z.array(z.string()).default([]),
  /** R8 QA-4: set by the RPC only with review = needs_review; unknown values read as absent. */
  review_reason: z.enum(STAR_REVIEW_REASONS).nullable().optional().catch(undefined),
  ...fieldBase,
});
export type StarDraftField = z.infer<typeof StarFieldSchema>;

export const ClassificationFieldSchema = z.object({
  /** project_type / experience_type: one key; competencies: 1–3 keys. */
  value: z.union([z.string(), z.array(z.string())]).nullable().default(null),
  reason: z.string().nullable().default(null),
  ...fieldBase,
});
export type ClassificationDraftField = z.infer<typeof ClassificationFieldSchema>;

export const ClarificationSchema = z.object({
  kind: z.enum(CLARIFICATION_KINDS),
  field: z.string().nullable().default(null),
});
export type Clarification = z.infer<typeof ClarificationSchema>;

export const StructuredDraftSchema = z.object({
  schema_version: z.number().default(STRUCTURED_DRAFT_SCHEMA_VERSION),
  project: z.partialRecord(z.enum(DRAFT_PERIOD_FIELDS), PeriodFieldSchema).default({}),
  star: z.partialRecord(z.enum(STAR_FIELDS), StarFieldSchema).default({}),
  classification: z.partialRecord(z.enum(CLASSIFICATION_FIELDS), ClassificationFieldSchema).default({}),
  clarifications: z.array(ClarificationSchema).default([]),
  sensitive_flags_count: z.number().int().min(0).default(0),
});
export type StructuredDraft = z.infer<typeof StructuredDraftSchema>;

export function emptyStructuredDraft(): StructuredDraft {
  return StructuredDraftSchema.parse({});
}

/**
 * Reads the stored jsonb (the column default is `'{}'`; v1 drafts are cleared
 * by the R4 migration). Unknown keys are dropped. A value that does not parse
 * is a server bug (only RPCs write the column), so this throws rather than
 * silently resetting the user's proposal.
 */
export function parseStructuredDraft(json: unknown): StructuredDraft {
  return StructuredDraftSchema.parse(json ?? {});
}

type AnyDraftField = { value: string | string[] | null; review: ReviewState; origin: string; applied_at: string | null };

/** A field counts as filled when it has a non-empty value (any review state). */
export function hasValue(field: AnyDraftField | undefined | null): boolean {
  if (!field) return false;
  const v = field.value;
  if (v === null) return false;
  return Array.isArray(v) ? v.length > 0 : v.trim() !== "";
}

/** Not applied yet and has a value: the card still shows it as a proposal. */
export function isPending(field: AnyDraftField | undefined | null): boolean {
  return hasValue(field) && field!.applied_at === null;
}

/** What the screen's fill rule takes (AI-12 채우기 규칙): pending, review ok/accepted (needs_review is skipped, T-18). */
export function isApplicable(field: AnyDraftField | undefined | null): boolean {
  return isPending(field) && field!.review !== "needs_review";
}

/** User-owned, not yet applied fields an AI patch must not overwrite (AI-12 매핑표, RPC enforces too). */
export function isProtected(field: AnyDraftField | undefined | null): boolean {
  return !!field && field.applied_at === null && (field.origin === "user_edit" || field.review === "accepted");
}

/**
 * v4.10 (UP-6, DM 11.5 #1 option (b), leader decision R9): the user dismissed
 * this classification suggestion ([무시]) in this chat. [무시] is the user patch
 * `set` null, which the RPC stores as an empty object with the next rev
 * (`{value: null, origin: 'ai', rev: prev + 1}`). No AI path writes a null
 * classification value (the RPC rejects it as `invalid_value`; reject/accept
 * never apply — classification is never needs_review), and a slot's first
 * object has rev 1, so "exists, value null, rev ≥ 2" is only ever [무시].
 * An empty competencies array reads the same as null.
 */
export function isDismissedClassification(field: ClassificationDraftField | undefined | null): boolean {
  if (!field || hasValue(field)) return false;
  return field.rev >= 2;
}

// ---------- Validated AI changes (V-9 output) ----------
// The pipeline builds DraftChanges, then `toDraftPatch` turns them into the
// RPC's ordered op list (contract: supabase/migrations/20261107101000_r4_structured_draft_patch_v3.sql).

export type PatchSource = { source_message_ids: string[]; source_quotes: string[] };

export type PeriodChange = PatchSource & { field: PeriodField; value: string; review: "ok" | "needs_review" };
/**
 * `value`: set = the field's full text (v4.9 merged proposal when the field had text); append = this
 * turn's new sentences only. The RPC replaces (set) or appends to (append) the pending proposal.
 * `new_object` (v4.5, DM 2.5 DA-10): the pending object is already in this turn's form
 * snapshot (filled, not saved) → the RPC replaces the slot with a new object (rev + 1)
 * instead of appending to it, so the filled sentence is not offered twice.
 */
export type StarChange = PatchSource & {
  field: StarField;
  op: StarOp;
  value: string;
  review: "ok" | "needs_review";
  /** R8 QA-4: V-9j → existing_missing, V-9e → content_unverified; null when review is ok (or no rule says why). */
  review_reason?: StarReviewReason | null;
  new_object?: boolean;
};
export type ClassificationChange = { field: ClassificationField; value: string | string[]; source_message_ids: string[]; reason: string | null };

export type DraftChanges = {
  period: PeriodChange[];
  star: StarChange[];
  classification: ClassificationChange[];
  /** null = unchanged; an array replaces the whole list. */
  clarifications: Clarification[] | null;
  sensitive_flags_add: number;
};

export function emptyDraftChanges(): DraftChanges {
  return { period: [], star: [], classification: [], clarifications: null, sensitive_flags_add: 0 };
}

export function isEmptyDraftChanges(c: DraftChanges): boolean {
  return c.period.length === 0 && c.star.length === 0 && c.classification.length === 0 && c.clarifications === null && c.sensitive_flags_add === 0;
}

// ---------- RPC patch: apply_structured_draft_patch(p_writing_chat_id, p_patch) v3 ----------

export type DraftPatchOp =
  | ({ op: "set"; target: { section: "project"; field: PeriodField }; value: string; review: "ok" | "needs_review" } & PatchSource)
  | ({ op: StarOp; target: { section: "star"; field: StarField }; value: string; review: "ok" | "needs_review"; review_reason?: StarReviewReason; new_object?: true } & PatchSource)
  | { op: "set"; target: { section: "classification"; field: ClassificationField }; value: string | string[]; source_message_ids: string[]; reason: string | null }
  | { op: "set_clarifications"; items: Clarification[] }
  | { op: "add_sensitive_flags"; count: number };

/** p_patch for apply_structured_draft_patch (AI caller = app_ai_writer). Ops apply in order. */
export type DraftPatch = { ops: DraftPatchOp[] };

/** RPC limits (r4_structured_draft_patch_v3: ops ≤ 100, sources ≤ 20, clarifications ≤ 50; quotes kept from S4). */
export const DRAFT_PATCH_MAX_OPS = 100;
export const DRAFT_PATCH_MAX_SOURCES = 20;
export const DRAFT_PATCH_MAX_QUOTES = 20;
export const DRAFT_PATCH_MAX_QUOTE_LENGTH = 1000;
export const DRAFT_PATCH_MAX_CLARIFICATIONS = 50;
export const DRAFT_PATCH_MAX_SENSITIVE_ADD = 100;

function clampSources<T extends { source_message_ids: string[]; source_quotes?: string[] }>(obj: T): T {
  return {
    ...obj,
    source_message_ids: obj.source_message_ids.slice(0, DRAFT_PATCH_MAX_SOURCES),
    ...(obj.source_quotes ? { source_quotes: obj.source_quotes.slice(0, DRAFT_PATCH_MAX_QUOTES) } : {}),
  };
}

/**
 * DraftChanges → ordered RPC ops: sensitive count (if any, never truncated),
 * period `set`, STAR `set`/`append`, classification `set` (section
 * "classification"), clarifications.
 */
export function toDraftPatch(changes: DraftChanges): DraftPatch {
  const ops: DraftPatchOp[] = [];
  for (const p of changes.period) {
    ops.push(clampSources({ op: "set" as const, target: { section: "project" as const, field: p.field }, value: p.value, review: p.review, source_message_ids: p.source_message_ids, source_quotes: p.source_quotes }));
  }
  for (const s of changes.star) {
    ops.push(
      clampSources({
        op: s.op,
        target: { section: "star" as const, field: s.field },
        value: s.value,
        review: s.review,
        // R8 QA-4: next to `review`, only when needs_review has a reason (the RPC stores it only then).
        ...(s.review === "needs_review" && s.review_reason ? { review_reason: s.review_reason } : {}),
        ...(s.new_object ? { new_object: true as const } : {}),
        source_message_ids: s.source_message_ids,
        source_quotes: s.source_quotes,
      }),
    );
  }
  for (const c of changes.classification) {
    ops.push({
      op: "set",
      target: { section: "classification", field: c.field },
      value: c.value,
      source_message_ids: c.source_message_ids.slice(0, DRAFT_PATCH_MAX_SOURCES),
      reason: c.reason,
    });
  }
  if (changes.clarifications) ops.push({ op: "set_clarifications", items: changes.clarifications.slice(0, DRAFT_PATCH_MAX_CLARIFICATIONS) });
  // QA-S4-07: the sensitive count goes first and is never cut by the op cap.
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
export type FieldRef = { section: "project" | "star" | "classification"; field: string };
