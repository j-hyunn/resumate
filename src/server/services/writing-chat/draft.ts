import {
  DRAFT_ACHIEVEMENT_FIELDS,
  DRAFT_DETAIL_FIELDS,
  DRAFT_PROJECT_FIELDS,
  WRITING_CHAT_SLOTS,
  type WritingChatSlot,
} from "@/lib/contracts/enums";
import type {
  DetailRef,
  DraftDetail,
  DraftField,
  DraftFieldPath,
  StructuredDraft,
  WritingChatProgress,
} from "@/lib/contracts/writing-chat";

/**
 * Pure helpers over `structured_draft` (DM §2.5): field iteration, the
 * per-turn diff behind `draft_patch` / `draft_flags`, and the S-36 progress
 * bar. No DB, no Next — unit tested.
 */

export type DraftFieldEntry = { path: DraftFieldPath; field: DraftField };

function refOf(detail: DraftDetail): DetailRef | null {
  if (detail.existing_detail_id) return { existingDetailId: detail.existing_detail_id };
  if (detail.detail_key) return { detailKey: detail.detail_key };
  return null;
}

/** Stable key of a path (diffing, de-duplication). */
export function pathKey(path: DraftFieldPath): string {
  if (path.section === "project") return `project.${path.field}`;
  if (path.section === "achievement") return `achievement.${path.achievementKey}.${path.field}`;
  const ref = "existingDetailId" in path.detail ? `id:${path.detail.existingDetailId}` : `key:${path.detail.detailKey}`;
  return `detail.${ref}.${path.field}`;
}

/** Every field object in the draft with its path. */
export function draftFields(draft: StructuredDraft): DraftFieldEntry[] {
  const out: DraftFieldEntry[] = [];
  for (const f of DRAFT_PROJECT_FIELDS) {
    const field = draft.project[f];
    if (field) out.push({ path: { section: "project", field: f }, field });
  }
  for (const d of draft.details) {
    const ref = refOf(d);
    if (!ref) continue;
    for (const f of DRAFT_DETAIL_FIELDS) {
      const field = d.fields[f];
      if (field) out.push({ path: { section: "detail", detail: ref, field: f }, field });
    }
    for (const a of d.achievements) {
      if (!a.achievement_key) continue;
      for (const f of DRAFT_ACHIEVEMENT_FIELDS) {
        const field = a[f];
        if (field) out.push({ path: { section: "achievement", achievementKey: a.achievement_key, field: f }, field });
      }
    }
  }
  return out;
}

function sameField(a: DraftField | undefined, b: DraftField | undefined): boolean {
  return JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
}

export type DraftDiff = {
  /** Field objects added or changed by this turn (preview highlight). */
  changed: DraftFieldPath[];
  /** Changed fields left as `needs_review` (V-9e). */
  needsReview: DraftFieldPath[];
  /** Sensitive items left out this turn (count delta, V-9g). */
  sensitiveAdded: number;
  /** Whether anything at all differs (incl. skills, suggestion, clarifications). */
  any: boolean;
};

/** Diff of two drafts (before / after one AI patch). */
export function diffDrafts(before: StructuredDraft, after: StructuredDraft): DraftDiff {
  const old = new Map(draftFields(before).map((e) => [pathKey(e.path), e.field]));
  const changed: DraftFieldPath[] = [];
  const needsReview: DraftFieldPath[] = [];
  for (const { path, field } of draftFields(after)) {
    if (sameField(old.get(pathKey(path)), field)) continue;
    changed.push(path);
    if (field.review === "needs_review") needsReview.push(path);
  }
  const sensitiveAdded = Math.max(0, after.sensitive_flags_count - before.sensitive_flags_count);
  const any = changed.length > 0 || sensitiveAdded > 0 || JSON.stringify(before) !== JSON.stringify(after);
  return { changed, needsReview, sensitiveAdded, any };
}

function hasValue(field: DraftField | undefined): boolean {
  if (!field) return false;
  if (field.value === null) return false;
  return typeof field.value !== "string" || field.value.trim() !== "";
}

const DETAIL_SLOT_FIELD: Partial<Record<WritingChatSlot, (typeof DRAFT_DETAIL_FIELDS)[number]>> = {
  situation: "situation",
  task: "task",
  action: "action",
  result: "result",
  learnings: "learnings",
};

/**
 * S-36 진행 단계 (기본 정보 → 상황 → 과제 → 행동 → 결과 → 회고 및 배운 점):
 * a slot is filled when some value exists in the draft. `basic` = project name
 * and role (augment mode: the existing project counts as filled). `next_episode`
 * is never "filled" and never the current slot (optional step 7).
 * Fields still `needs_review` count as filled (they show in the preview).
 */
export function draftProgress(draft: StructuredDraft, opts: { augment: boolean } = { augment: false }): WritingChatProgress {
  const filled = (slot: WritingChatSlot): boolean => {
    if (slot === "basic_info") return opts.augment || (hasValue(draft.project.name) && hasValue(draft.project.role));
    if (slot === "next_episode") return false;
    const col = DETAIL_SLOT_FIELD[slot]!;
    if (slot === "result" && draft.details.some((d) => d.achievements.length > 0)) return true;
    return draft.details.some((d) => hasValue(d.fields[col]));
  };
  const slots = WRITING_CHAT_SLOTS.filter((s) => s !== "next_episode").map((slot) => ({ slot, filled: filled(slot) }));
  const current = slots.find((s) => !s.filled)?.slot ?? null;
  const needsReviewCount = draftFields(draft).filter((e) => e.field.review === "needs_review").length;
  return { slots, current, needsReviewCount };
}
