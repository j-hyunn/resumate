import { CLASSIFICATION_FIELDS, DRAFT_PERIOD_FIELDS, STAR_FIELDS, type ApplyProposalField } from "@/lib/contracts/enums";
import type { DraftFieldPath, QuickChip, StructuredDraft } from "@/lib/contracts/writing-chat";
import { QUICK_CHIPS_HIDE_FROM } from "@/lib/contracts/writing-chat";
import { quickChips, type ProjectSlotState } from "@/server/ai/context-pack/focus-slots";
import { isApplicable, isPending } from "@/server/ai/schemas/structured-draft";

/**
 * Pure helpers over `structured_draft` v3 (DM §2.5 v4.4): field iteration, the per-turn diff behind
 * `draft_patch`, the panel counts ([모두 반영] fields, 검토 필요 N개), and quick chips (AI-12).
 * No DB, no Next — unit tested.
 */

type AnyField = { value: string | string[] | null; review: "ok" | "needs_review" | "accepted"; origin: string; applied_at: string | null };
export type DraftFieldEntry = { path: DraftFieldPath; field: AnyField };

/** Stable key of a path (diffing, de-duplication). */
export function pathKey(path: DraftFieldPath): string {
  return `${path.section}.${path.field}`;
}

/** Every field object in the draft with its path, in [모두 반영] order (period, STAR, classification). */
export function draftFields(draft: StructuredDraft): DraftFieldEntry[] {
  const out: DraftFieldEntry[] = [];
  for (const f of DRAFT_PERIOD_FIELDS) {
    const field = draft.project[f];
    if (field) out.push({ path: { section: "project", field: f }, field });
  }
  for (const f of STAR_FIELDS) {
    const field = draft.star[f];
    if (field) out.push({ path: { section: "star", field: f }, field });
  }
  for (const f of CLASSIFICATION_FIELDS) {
    const field = draft.classification[f];
    if (field) out.push({ path: { section: "classification", field: f }, field });
  }
  return out;
}

export type DraftDiff = {
  /** Field objects added or changed by this turn (card highlight). */
  changed: DraftFieldPath[];
  /** Whether anything at all differs (incl. clarifications, sensitive count). */
  any: boolean;
};

/** Diff of two drafts (before / after one AI patch). */
export function diffDrafts(before: StructuredDraft, after: StructuredDraft): DraftDiff {
  const old = new Map(draftFields(before).map((e) => [pathKey(e.path), JSON.stringify(e.field)]));
  const changed = draftFields(after)
    .filter((e) => old.get(pathKey(e.path)) !== JSON.stringify(e.field))
    .map((e) => e.path);
  return { changed, any: changed.length > 0 || JSON.stringify(before) !== JSON.stringify(after) };
}

/** Pending (not applied) fields still `needs_review` — "검토가 필요한 항목 N개". */
export function needsReviewCount(draft: StructuredDraft): number {
  return draftFields(draft).filter((e) => isPending(e.field) && e.field.review === "needs_review").length;
}

/**
 * Fields [모두 반영] would try now (DM §3.3: value, not applied, review ok / accepted). The RPC may
 * still skip some against the project (period / classification already set) — that comes back in `skipped`.
 */
export function applicableFields(draft: StructuredDraft): ApplyProposalField[] {
  return draftFields(draft)
    .filter((e) => isApplicable(e.field))
    .map((e) => e.path.field);
}

/** AI-12 quick chips (camelCase for the contract). Hidden from QUICK_CHIPS_HIDE_FROM messages on (UX S-10 [가정]). */
export function chipsFor(project: ProjectSlotState, draft: StructuredDraft, messageCount: number, open: boolean): QuickChip[] {
  if (!open || messageCount >= QUICK_CHIPS_HIDE_FROM) return [];
  return quickChips({ project, draft }).map((c) => ({ label: c.label, requestedSlot: c.requested_slot }));
}
