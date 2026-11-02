"use server";

import {
  AddCoverLetterQuestionInput,
  CreateCoverLetterDraftInput,
  DeleteCoverLetterQuestionInput,
  DraftIdInput,
  GetDraftInput,
  ListDraftsInput,
  RenameDraftInput,
  ReorderCoverLetterQuestionsInput,
  SaveSectionEditInput,
  SetSectionSourcesInput,
  UpdateCoverLetterQuestionInput,
  type CoverLetterQuestionResult,
  type DeleteDraftResult,
  type DeleteQuestionResult,
  type DraftList,
  type DraftView,
  type MarkDraftCopiedResult,
  type RenameDraftResult,
  type ReorderQuestionsResult,
  type SaveSectionEditResult,
} from "@/lib/contracts/draft";
import { invalid, runAction, type ActionResult } from "@/lib/contracts/errors";
import { requireConsentedUser } from "@/server/auth/session";
import * as coverLetter from "@/server/services/drafts/cover-letter";
import * as edit from "@/server/services/drafts/edit";
import * as reads from "@/server/services/drafts/read";

/**
 * S7 draft Server Actions (F-DOC-01~04, 08, 09; UX S-17, S-18, S-19, C-11).
 * Thin: consent-gated user session → zod → service. None of these calls an AI
 * provider or needs a key (D-36). Generation is the Route Handlers
 * `POST /api/application-projects/{id}/draft-source-ranking` (AI-11, sync),
 * `POST /api/application-projects/{id}/career-descriptions` (AI-03, SSE) and
 * `POST /api/draft-sections/{id}/generate` (AI-04, SSE).
 */

// ---- S-18 cover letter questions ----

/** "새 자기소개서": draft (composing) + 기본 3문항 시드. Returns the editor view. */
export async function createCoverLetterDraft(input: unknown): Promise<ActionResult<DraftView>> {
  const parsed = CreateCoverLetterDraftInput.safeParse(input);
  if (!parsed.success) return invalid(parsed.error);
  return runAction(async () => {
    const { supabase } = await requireConsentedUser();
    const created = await coverLetter.createCoverLetterDraft(supabase, parsed.data.applicationProjectId);
    return reads.getDraft(supabase, created.draftId);
  });
}

export async function addCoverLetterQuestion(input: unknown): Promise<ActionResult<CoverLetterQuestionResult>> {
  const parsed = AddCoverLetterQuestionInput.safeParse(input);
  if (!parsed.success) return invalid(parsed.error);
  return runAction(async () => {
    const { supabase } = await requireConsentedUser();
    const { draftId, sectionId } = await coverLetter.addCoverLetterQuestion(supabase, parsed.data);
    return { draftId, section: await reads.getSectionView(supabase, draftId, sectionId) };
  });
}

/** Question text / char limit / count basis / memo (≤ 300, F-DOC-09). Omitted fields stay. */
export async function updateCoverLetterQuestion(input: unknown): Promise<ActionResult<CoverLetterQuestionResult>> {
  const parsed = UpdateCoverLetterQuestionInput.safeParse(input);
  if (!parsed.success) return invalid(parsed.error);
  return runAction(async () => {
    const { supabase } = await requireConsentedUser();
    const { draftId, sectionId } = await coverLetter.updateCoverLetterQuestion(supabase, parsed.data);
    return { draftId, section: await reads.getSectionView(supabase, draftId, sectionId) };
  });
}

/** 최소 1문항 (409 `last_question`); a generating question can't be deleted (409 `section_generating`). */
export async function deleteCoverLetterQuestion(input: unknown): Promise<ActionResult<DeleteQuestionResult>> {
  const parsed = DeleteCoverLetterQuestionInput.safeParse(input);
  if (!parsed.success) return invalid(parsed.error);
  return runAction(async () => {
    const { supabase } = await requireConsentedUser();
    return coverLetter.deleteCoverLetterQuestion(supabase, parsed.data.sectionId);
  });
}

export async function reorderCoverLetterQuestions(input: unknown): Promise<ActionResult<ReorderQuestionsResult>> {
  const parsed = ReorderCoverLetterQuestionsInput.safeParse(input);
  if (!parsed.success) return invalid(parsed.error);
  return runAction(async () => {
    const { supabase } = await requireConsentedUser();
    return coverLetter.reorderCoverLetterQuestions(supabase, parsed.data.draftId, parsed.data.sectionIds);
  });
}

/** C-11 "사용한 경력·프로젝트" 변경 → user mode; then "변경 사항으로 다시 생성" (SSE route). */
export async function setSectionSources(input: unknown): Promise<ActionResult<CoverLetterQuestionResult>> {
  const parsed = SetSectionSourcesInput.safeParse(input);
  if (!parsed.success) return invalid(parsed.error);
  return runAction(async () => {
    const { supabase } = await requireConsentedUser();
    const { draftId, sectionId } = await coverLetter.setSectionSources(supabase, parsed.data);
    return { draftId, section: await reads.getSectionView(supabase, draftId, sectionId) };
  });
}

// ---- S-19 edit / copy, S-17 rename / delete ----

export async function saveSectionEdit(input: unknown): Promise<ActionResult<SaveSectionEditResult>> {
  const parsed = SaveSectionEditInput.safeParse(input);
  if (!parsed.success) return invalid(parsed.error);
  return runAction(async () => {
    const { supabase } = await requireConsentedUser();
    return edit.saveSectionEdit(supabase, parsed.data);
  });
}

/** Call when the user copies (whole draft or a block); only the first copy is recorded. */
export async function markDraftCopied(input: unknown): Promise<ActionResult<MarkDraftCopiedResult>> {
  const parsed = DraftIdInput.safeParse(input);
  if (!parsed.success) return invalid(parsed.error);
  return runAction(async () => {
    const { supabase } = await requireConsentedUser();
    return edit.markDraftCopied(supabase, parsed.data.draftId);
  });
}

export async function renameDraft(input: unknown): Promise<ActionResult<RenameDraftResult>> {
  const parsed = RenameDraftInput.safeParse(input);
  if (!parsed.success) return invalid(parsed.error);
  return runAction(async () => {
    const { supabase } = await requireConsentedUser();
    return edit.renameDraft(supabase, parsed.data.draftId, parsed.data.title);
  });
}

export async function deleteDraft(input: unknown): Promise<ActionResult<DeleteDraftResult>> {
  const parsed = DraftIdInput.safeParse(input);
  if (!parsed.success) return invalid(parsed.error);
  return runAction(async () => {
    const { supabase } = await requireConsentedUser();
    return edit.deleteDraft(supabase, parsed.data.draftId);
  });
}

// ---- reads (Server Components call the services directly at wiring time) ----

export async function listDrafts(input: unknown): Promise<ActionResult<DraftList>> {
  const parsed = ListDraftsInput.safeParse(input);
  if (!parsed.success) return invalid(parsed.error);
  return runAction(async () => {
    const { supabase } = await requireConsentedUser();
    return reads.listDrafts(supabase, parsed.data.applicationProjectId);
  });
}

export async function getDraft(input: unknown): Promise<ActionResult<DraftView>> {
  const parsed = GetDraftInput.safeParse(input);
  if (!parsed.success) return invalid(parsed.error);
  return runAction(async () => {
    const { supabase } = await requireConsentedUser();
    return reads.getDraft(supabase, parsed.data.draftId);
  });
}
