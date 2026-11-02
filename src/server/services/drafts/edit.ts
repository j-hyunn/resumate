import type {
  DeleteDraftResult,
  MarkDraftCopiedResult,
  RenameDraftResult,
  SaveSectionEditInput,
  SaveSectionEditResult,
} from "@/lib/contracts/draft";
import { AppError } from "@/lib/contracts/errors";
import type { Json } from "@/server/db/database.types";
import { mapDbError } from "@/server/db/errors";
import type { UserSupabaseClient } from "@/server/db/types";
import { requestCancel } from "@/server/services/ai-jobs";
import { loadEvidenceChips } from "@/server/services/evidence";
import type { z } from "zod";
import { assertNotGenerating } from "./active";
import { parseBlocks, presentPlaceholders, toBlockViews, type StoredBlock } from "./blocks";

/**
 * F-DOC-04 편집·복사 (no key, D-36) and S-17 rename / delete. User session
 * only (column grants: drafts.title / edited_at / first_copied_at,
 * draft_sections.edited_content; delete own drafts [가정 S7-3]).
 */

const draftNotFound = () => new AppError("not_found", "초안을 찾을 수 없습니다. 새로고침 후 다시 시도해 주세요.", { status: 404 });
const sectionNotFound = () => new AppError("not_found", "문항을 찾을 수 없습니다. 새로고침 후 다시 시도해 주세요.", { status: 404 });

/**
 * Saves the edited blocks of one section. Block ids must be the section's AI
 * block ids (kept, AI-03 저장); a block whose text differs from the AI text is
 * `user_modified` (its evidence stays, shown as "편집됨 — 근거 재확인 권장").
 * Then drafts.edited_at (same request; no trigger, db notes).
 */
export async function saveSectionEdit(user: UserSupabaseClient, input: z.output<typeof SaveSectionEditInput>, now: () => Date = () => new Date()): Promise<SaveSectionEditResult> {
  const { data: section, error } = await user.from("draft_sections").select("id, draft_id, status, ai_content").eq("id", input.sectionId).maybeSingle();
  if (error) throw mapDbError(error);
  if (!section) throw sectionNotFound();
  await assertNotGenerating(user, { sectionId: section.id, draftId: section.draft_id });
  const aiBlocks = parseBlocks(section.ai_content);
  if (aiBlocks.length === 0) throw new AppError("nothing_to_edit", "아직 생성된 초안이 없어요.", { status: 409 });

  const byId = new Map(aiBlocks.map((b) => [b.block_id, b]));
  const seen = new Set<string>();
  const edited: StoredBlock[] = [];
  for (const b of input.blocks) {
    const ai = byId.get(b.blockId);
    if (!ai || seen.has(b.blockId)) throw new AppError("invalid_input", "초안 블록이 바뀌었어요. 새로고침 후 다시 편집해 주세요.");
    seen.add(b.blockId);
    // QA-S7-05: placeholders = the AI tokens still in the edited text.
    edited.push({ ...ai, text: b.text, user_modified: b.text !== ai.text, placeholders: presentPlaceholders(ai.placeholders, b.text) });
  }

  const { data: updated, error: updateError } = await user
    .from("draft_sections")
    .update({ edited_content: edited as unknown as Json })
    .eq("id", input.sectionId)
    .select("id");
  if (updateError) throw mapDbError(updateError);
  if (!updated || updated.length === 0) throw sectionNotFound();

  const editedAt = now().toISOString();
  const { error: draftError } = await user.from("drafts").update({ edited_at: editedAt }).eq("id", section.draft_id);
  if (draftError) throw mapDbError(draftError);

  const chips = await loadEvidenceChips(user, { ownerType: "draft_section", ownerIds: [section.id] });
  return { sectionId: section.id, draftId: section.draft_id, editedAt, blocks: toBlockViews(aiBlocks, edited, chips.get(section.id)) };
}

/** First copy only (the DB trigger keeps the first value). */
export async function markDraftCopied(user: UserSupabaseClient, draftId: string, now: () => Date = () => new Date()): Promise<MarkDraftCopiedResult> {
  const { error } = await user.from("drafts").update({ first_copied_at: now().toISOString() }).eq("id", draftId).is("first_copied_at", null);
  if (error) throw mapDbError(error);
  const { data, error: readError } = await user.from("drafts").select("first_copied_at").eq("id", draftId).maybeSingle();
  if (readError) throw mapDbError(readError);
  if (!data || !data.first_copied_at) throw draftNotFound();
  return { draftId, firstCopiedAt: data.first_copied_at };
}

export async function renameDraft(user: UserSupabaseClient, draftId: string, title: string): Promise<RenameDraftResult> {
  const { data, error } = await user.from("drafts").update({ title }).eq("id", draftId).select("id, title, updated_at");
  if (error) throw mapDbError(error);
  const row = data?.[0];
  if (!row) throw draftNotFound();
  return { draftId, title: row.title, updatedAt: row.updated_at };
}

/** Cancels the draft's in-flight generation (career description or any question), then deletes (cascade). */
export async function deleteDraft(user: UserSupabaseClient, draftId: string): Promise<DeleteDraftResult> {
  const { data: draft, error } = await user.from("drafts").select("id, application_project_id").eq("id", draftId).maybeSingle();
  if (error) throw mapDbError(error);
  if (!draft) throw draftNotFound();
  const { data: sections, error: secError } = await user.from("draft_sections").select("id").eq("draft_id", draftId);
  if (secError) throw mapDbError(secError);
  const targets = [draftId, ...(sections ?? []).map((s) => s.id)];
  const { data: jobs, error: jobsError } = await user
    .from("ai_jobs")
    .select("id")
    .eq("application_project_id", draft.application_project_id)
    .in("job_type", ["career_description", "cover_letter"])
    .in("target_id", targets)
    .in("status", ["queued", "running"]);
  if (jobsError) throw mapDbError(jobsError);
  for (const job of jobs ?? []) {
    try {
      await requestCancel(user, job.id);
    } catch (err) {
      if (!(err instanceof AppError)) throw err;
    }
  }
  const { data, error: delError } = await user.from("drafts").delete().eq("id", draftId).select("id");
  if (delError) throw mapDbError(delError);
  if (!data || data.length === 0) throw draftNotFound();
  return { draftId, deleted: true };
}
