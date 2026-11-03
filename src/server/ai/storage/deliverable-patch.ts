import type { DeliverableChatContext } from "../context-pack/deliverable-chat";
import type { WritingKind } from "../context-pack/deliverable-slots";
import type { DeliverableClarification, DeliverableDraft, StoredBlock } from "../schemas/deliverable-draft";
import type { ComposeValidation, FactChange, FactsResult } from "../validation/v10";

/**
 * AI-13 → `apply_structured_draft_patch(p_writing_chat_id, p_patch)` for a
 * deliverable chat (AI caller = app_ai_writer). Contract:
 * supabase/migrations/20261110000200_r5_structured_draft_patch_v4.sql (DM 2.5.0).
 *
 * Sources stay inside structured_draft (no evidence_links, DM-15): facts cite
 * message UUIDs, blocks cite fact UUIDs (the RPC re-checks both against the chat).
 * The RPC assigns fact ids, assembles `value` from the blocks, bumps `rev` and
 * `draft_count`, and refuses a draft at draft_count ≥ 6 (writing_chat_draft_limit_reached).
 */

export type DeliverableDraftBodyInput = {
  blocks: StoredBlock[];
  base_body_hash: string;
  replace_allowed: boolean;
  missing_slots: string[];
  /** [가정] content units (sentences / list items / table rows) V-10 removed; RPC accepts 0–999. */
  dropped_block_count: number;
};

export type DeliverablePatchOp =
  | { op: "add_sensitive_flags"; count: number }
  | { op: "add_facts"; facts: FactChange[] }
  | { op: "set_writing_kind"; value: WritingKind | null }
  | { op: "set_clarifications"; items: DeliverableClarification[] }
  | { op: "replace_draft"; body: DeliverableDraftBodyInput }
  | { op: "count_draft" };

export type DeliverablePatch = { ops: DeliverablePatchOp[] };

/** RPC limits (r5 patch v4 / S4 helpers). */
export const DELIVERABLE_PATCH_MAX_SENSITIVE_ADD = 100;
export const DELIVERABLE_PATCH_MAX_CLARIFICATIONS = 50;
export const DELIVERABLE_PATCH_MAX_DROPPED = 999;

export function isEmptyDeliverablePatch(patch: DeliverablePatch): boolean {
  return patch.ops.length === 0;
}

/** Extract result → ops: sensitive count first, facts, kind, clarifications. */
export function factsPatch(result: Pick<FactsResult, "facts" | "writingKind" | "clarifications" | "sensitiveAdd">): DeliverablePatch {
  const ops: DeliverablePatchOp[] = [];
  if (result.sensitiveAdd > 0) ops.push({ op: "add_sensitive_flags", count: Math.min(result.sensitiveAdd, DELIVERABLE_PATCH_MAX_SENSITIVE_ADD) });
  if (result.facts.length > 0) ops.push({ op: "add_facts", facts: result.facts });
  if (result.writingKind !== undefined) ops.push({ op: "set_writing_kind", value: result.writingKind });
  if (result.clarifications !== null) ops.push({ op: "set_clarifications", items: result.clarifications.slice(0, DELIVERABLE_PATCH_MAX_CLARIFICATIONS) });
  return { ops };
}

/**
 * Compose result → ops. No content block left → `count_draft` only (the turn
 * still counts, AI-13). The compose output's kind is stored when the chat had none.
 */
export function draftPatch(ctx: Pick<DeliverableChatContext, "draft" | "baseBodyHash" | "replaceAllowed">, v: ComposeValidation): DeliverablePatch {
  const ops: DeliverablePatchOp[] = [];
  if (v.sensitiveAdded > 0) ops.push({ op: "add_sensitive_flags", count: Math.min(v.sensitiveAdded, DELIVERABLE_PATCH_MAX_SENSITIVE_ADD) });
  if (ctx.draft.writing_kind === null) ops.push({ op: "set_writing_kind", value: v.writingKind });
  if (v.blocks.length === 0) {
    ops.push({ op: "count_draft" });
    return { ops };
  }
  ops.push({
    op: "replace_draft",
    body: {
      blocks: v.blocks,
      base_body_hash: ctx.baseBodyHash,
      replace_allowed: ctx.replaceAllowed,
      missing_slots: v.missingSlots,
      dropped_block_count: Math.min(v.droppedUnits, DELIVERABLE_PATCH_MAX_DROPPED),
    },
  });
  return { ops };
}

/** SSE `draft_flags` payload for a deliverable turn, from the draft the RPC returned (ids only, no text). */
export type DeliverableDraftFlags = {
  needs_review: string[];
  actor_ambiguous: boolean;
  number_vague: boolean;
  sensitive: number;
};

export function deliverableDraftFlags(stored: DeliverableDraft, sensitiveAdded: number): DeliverableDraftFlags {
  return {
    needs_review: stored.facts.filter((f) => f.review === "needs_review").map((f) => f.id),
    actor_ambiguous: stored.clarifications.some((c) => c.kind === "actor_ambiguous"),
    number_vague: stored.clarifications.some((c) => c.kind === "number_vague"),
    sensitive: sensitiveAdded,
  };
}
