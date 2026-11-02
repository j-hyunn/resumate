"use server";

import { invalid, runAction, type ActionResult } from "@/lib/contracts/errors";
import {
  ApplyDraftEditInput,
  EditDraftAchievementInput,
  EditDraftDetailInput,
  EditDraftSkillInput,
  ProjectWritingChatsInput,
  ReviewDraftFieldInput,
  SetAffiliationInput,
  StartWritingChatInput,
  WritingChatIdInput,
  type ProjectWritingChatSummary,
  type ResumeWritingChatResult,
  type StartWritingChatResult,
  type StructuredDraft,
  type WritingChatDto,
  type WritingChatLists,
  type WritingChatSaveResult,
} from "@/lib/contracts/writing-chat";
import { requireConsentedUser } from "@/server/auth/session";
import * as chats from "@/server/services/writing-chat/chat";
import type { DraftEditResult } from "@/server/services/writing-chat/chat";

/**
 * S4 AI writing chat Server Actions (DM §7 대화 rows, UX S-36 / S-08).
 * Thin: consent-gated user session → zod → service. Every write is the user's
 * own RPC (RLS); none of these call an AI provider, so none needs a key
 * (PRD 3.3 — only sending a message does, through the turn route).
 */

/** S-36 / C-09 start: chat + fixed greeting. `returnTarget` when coming from the data gate (U-5). */
export async function startWritingChat(input: unknown): Promise<ActionResult<StartWritingChatResult>> {
  const parsed = StartWritingChatInput.safeParse(input);
  if (!parsed.success) return invalid(parsed.error);
  return runAction(async () => {
    const { supabase } = await requireConsentedUser();
    return chats.startWritingChat(supabase, parsed.data);
  });
}

/** S-36 (이어 하기 포함): messages, preview, affiliation, progress, provider badge / lock. */
export async function getWritingChat(input: unknown): Promise<ActionResult<WritingChatDto>> {
  const parsed = WritingChatIdInput.safeParse(input);
  if (!parsed.success) return invalid(parsed.error);
  return runAction(async () => {
    const { supabase, user } = await requireConsentedUser();
    return chats.getWritingChat(supabase, user.id, parsed.data.writingChatId);
  });
}

/** Preview direct edit (origin user_edit). `value: null` clears the field. */
export async function applyDraftEdit(input: unknown): Promise<ActionResult<DraftEditResult>> {
  const parsed = ApplyDraftEditInput.safeParse(input);
  if (!parsed.success) return invalid(parsed.error);
  return runAction(async () => {
    const { supabase } = await requireConsentedUser();
    return chats.applyDraftEdit(supabase, parsed.data);
  });
}

/** 검토 필요 → [수락] (review accepted, kept on later turns). */
export async function acceptDraftField(input: unknown): Promise<ActionResult<DraftEditResult>> {
  const parsed = ReviewDraftFieldInput.safeParse(input);
  if (!parsed.success) return invalid(parsed.error);
  return runAction(async () => {
    const { supabase } = await requireConsentedUser();
    return chats.reviewDraftField(supabase, parsed.data, "accept");
  });
}

/** 검토 필요 → [거절] (value cleared; the AI asks again). */
export async function rejectDraftField(input: unknown): Promise<ActionResult<DraftEditResult>> {
  const parsed = ReviewDraftFieldInput.safeParse(input);
  if (!parsed.success) return invalid(parsed.error);
  return runAction(async () => {
    const { supabase } = await requireConsentedUser();
    return chats.reviewDraftField(supabase, parsed.data, "reject");
  });
}

/** Preview 사용 기술 add / remove. */
export async function editDraftSkill(input: unknown): Promise<ActionResult<DraftEditResult>> {
  const parsed = EditDraftSkillInput.safeParse(input);
  if (!parsed.success) return invalid(parsed.error);
  return runAction(async () => {
    const { supabase } = await requireConsentedUser();
    return chats.editDraftSkill(supabase, parsed.data);
  });
}

/** Preview 상세 내용 card add / remove. */
export async function editDraftDetail(input: unknown): Promise<ActionResult<DraftEditResult>> {
  const parsed = EditDraftDetailInput.safeParse(input);
  if (!parsed.success) return invalid(parsed.error);
  return runAction(async () => {
    const { supabase } = await requireConsentedUser();
    return chats.editDraftDetail(supabase, parsed.data);
  });
}

/** Preview 정량 성과 add / remove. */
export async function editDraftAchievement(input: unknown): Promise<ActionResult<DraftEditResult>> {
  const parsed = EditDraftAchievementInput.safeParse(input);
  if (!parsed.success) return invalid(parsed.error);
  return runAction(async () => {
    const { supabase } = await requireConsentedUser();
    return chats.editDraftAchievement(supabase, parsed.data);
  });
}

/** 소속 칸: [연결] / 직접 고르기 / 없음, or [아니요] (`clearSuggestionOnly`). */
export async function setWritingChatAffiliation(
  input: unknown,
): Promise<ActionResult<{ experienceId: string | null; educationId: string | null; structuredDraft: StructuredDraft }>> {
  const parsed = SetAffiliationInput.safeParse(input);
  if (!parsed.success) return invalid(parsed.error);
  return runAction(async () => {
    const { supabase } = await requireConsentedUser();
    return chats.setWritingChatAffiliation(supabase, parsed.data);
  });
}

/** 저장 (F-P1-13 (5)): reviewed draft → career tables as the user. needs_review fields are skipped. */
export async function saveWritingChat(input: unknown): Promise<ActionResult<WritingChatSaveResult>> {
  const parsed = WritingChatIdInput.safeParse(input);
  if (!parsed.success) return invalid(parsed.error);
  return runAction(async () => {
    const { supabase } = await requireConsentedUser();
    return chats.saveWritingChat(supabase, parsed.data.writingChatId);
  });
}

/** 폼으로 전환 (F-P1-13 (7)). */
export async function handOffWritingChat(input: unknown): Promise<ActionResult<WritingChatSaveResult>> {
  const parsed = WritingChatIdInput.safeParse(input);
  if (!parsed.success) return invalid(parsed.error);
  return runAction(async () => {
    const { supabase } = await requireConsentedUser();
    return chats.handOffWritingChat(supabase, parsed.data.writingChatId);
  });
}

/** 그만두기 (active → abandoned). */
export async function abandonWritingChat(input: unknown): Promise<ActionResult<{ writingChatId: string; status: "abandoned" }>> {
  const parsed = WritingChatIdInput.safeParse(input);
  if (!parsed.success) return invalid(parsed.error);
  return runAction(async () => {
    const { supabase } = await requireConsentedUser();
    return chats.abandonWritingChat(supabase, parsed.data.writingChatId);
  });
}

/** "다시 이어 하기" (R1 A6; S-08 그만둔 AI 대화, S-10 대화 기록): abandoned → active. No AI call, no key. */
export async function resumeWritingChat(input: unknown): Promise<ActionResult<ResumeWritingChatResult>> {
  const parsed = WritingChatIdInput.safeParse(input);
  if (!parsed.success) return invalid(parsed.error);
  return runAction(async () => {
    const { supabase } = await requireConsentedUser();
    return chats.resumeWritingChat(supabase, parsed.data.writingChatId);
  });
}

/** S-08 "작성 중인 AI 대화" + "그만둔 AI 대화" (R1 A6). The career tree carries the same lists. */
export async function listWritingChats(): Promise<ActionResult<WritingChatLists>> {
  return runAction(async () => {
    const { supabase } = await requireConsentedUser();
    return chats.listWritingChats(supabase);
  });
}

/** S-10 "AI 작성 대화 기록": the project's chats incl. abandoned (R1 A6). */
export async function listProjectWritingChats(input: unknown): Promise<ActionResult<ProjectWritingChatSummary[]>> {
  const parsed = ProjectWritingChatsInput.safeParse(input);
  if (!parsed.success) return invalid(parsed.error);
  return runAction(async () => {
    const { supabase } = await requireConsentedUser();
    return chats.listProjectWritingChats(supabase, parsed.data.projectId);
  });
}

/** After returning to the original feature (C-10): clear return_target. */
export async function clearWritingChatReturnTarget(input: unknown): Promise<ActionResult<{ writingChatId: string }>> {
  const parsed = WritingChatIdInput.safeParse(input);
  if (!parsed.success) return invalid(parsed.error);
  return runAction(async () => {
    const { supabase } = await requireConsentedUser();
    await chats.clearReturnTarget(supabase, parsed.data.writingChatId);
    return { writingChatId: parsed.data.writingChatId };
  });
}

/** 대화만 삭제 (C-05): saved career rows stay. Impact preview = career `getDeletionImpact({ entityType: 'writing_chat' })`. */
export async function deleteWritingChat(input: unknown): Promise<ActionResult<{ messageCount: number; linkedSavedRows: number }>> {
  const parsed = WritingChatIdInput.safeParse(input);
  if (!parsed.success) return invalid(parsed.error);
  return runAction(async () => {
    const { supabase } = await requireConsentedUser();
    return chats.deleteWritingChat(supabase, parsed.data.writingChatId);
  });
}
