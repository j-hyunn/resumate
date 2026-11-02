"use server";

import { invalid, runAction, type ActionResult } from "@/lib/contracts/errors";
import {
  ApplyDraftEditInput,
  ApplyProposalInput,
  ProjectWritingChatsInput,
  ReviewDraftFieldInput,
  StartWritingChatInput,
  WritingChatIdInput,
  type ApplyProposalResult,
  type DraftEditResult,
  type ProjectWritingChatSummary,
  type StartWritingChatResult,
  type WritingChatDto,
} from "@/lib/contracts/writing-chat";
import { requireConsentedUser } from "@/server/auth/session";
import * as chats from "@/server/services/writing-chat/chat";

/**
 * AI writing chat Server Actions v4.4 (DM §7 대화 rows, UX S-10 Resumate AI 패널).
 * Thin: consent-gated user session → zod → service. Every write is the user's own RPC (RLS);
 * none of these call an AI provider, so none needs a key (PRD 3.3 — only sending a message
 * does, through the turn route). Removed in R4: save / hand-off / affiliation / abandon / resume.
 */

/** 패널 "+ 새 대화" / C-09 게이트 진입: chat on an affiliated project + fixed greeting. */
export async function startWritingChat(input: unknown): Promise<ActionResult<StartWritingChatResult>> {
  const parsed = StartWritingChatInput.safeParse(input);
  if (!parsed.success) return invalid(parsed.error);
  return runAction(async () => {
    const { supabase } = await requireConsentedUser();
    return chats.startWritingChat(supabase, parsed.data);
  });
}

/** Open one chat: messages, proposal card, chips, provider badge / lock. */
export async function getWritingChat(input: unknown): Promise<ActionResult<WritingChatDto>> {
  const parsed = WritingChatIdInput.safeParse(input);
  if (!parsed.success) return invalid(parsed.error);
  return runAction(async () => {
    const { supabase, user } = await requireConsentedUser();
    return chats.getWritingChat(supabase, user.id, parsed.data.writingChatId);
  });
}

/** 대화 기록 목록 of one project (latest activity first). */
export async function listProjectWritingChats(input: unknown): Promise<ActionResult<ProjectWritingChatSummary[]>> {
  const parsed = ProjectWritingChatsInput.safeParse(input);
  if (!parsed.success) return invalid(parsed.error);
  return runAction(async () => {
    const { supabase } = await requireConsentedUser();
    return chats.listProjectWritingChats(supabase, parsed.data.projectId);
  });
}

/** Proposal card direct edit (origin user_edit). `value: null` clears the field. */
export async function applyDraftEdit(input: unknown): Promise<ActionResult<DraftEditResult>> {
  const parsed = ApplyDraftEditInput.safeParse(input);
  if (!parsed.success) return invalid(parsed.error);
  return runAction(async () => {
    const { supabase } = await requireConsentedUser();
    return chats.applyDraftEdit(supabase, parsed.data);
  });
}

/** [수락] a needs_review field. */
export async function acceptDraftField(input: unknown): Promise<ActionResult<DraftEditResult>> {
  const parsed = ReviewDraftFieldInput.safeParse(input);
  if (!parsed.success) return invalid(parsed.error);
  return runAction(async () => {
    const { supabase } = await requireConsentedUser();
    return chats.reviewDraftField(supabase, parsed.data, "accept");
  });
}

/** [거절(비우기)] a needs_review field. */
export async function rejectDraftField(input: unknown): Promise<ActionResult<DraftEditResult>> {
  const parsed = ReviewDraftFieldInput.safeParse(input);
  if (!parsed.success) return invalid(parsed.error);
  return runAction(async () => {
    const { supabase } = await requireConsentedUser();
    return chats.reviewDraftField(supabase, parsed.data, "reject");
  });
}

/** [반영] (fields) / [모두 반영] (no fields) → apply_writing_chat_proposal (DM §3.3, no key needed). */
export async function applyWritingChatProposal(input: unknown): Promise<ActionResult<ApplyProposalResult>> {
  const parsed = ApplyProposalInput.safeParse(input);
  if (!parsed.success) return invalid(parsed.error);
  return runAction(async () => {
    const { supabase } = await requireConsentedUser();
    return chats.applyWritingChatProposal(supabase, parsed.data);
  });
}

/** C-10 복귀 후 return_target 비우기. */
export async function clearWritingChatReturnTarget(input: unknown): Promise<ActionResult<{ writingChatId: string }>> {
  const parsed = WritingChatIdInput.safeParse(input);
  if (!parsed.success) return invalid(parsed.error);
  return runAction(async () => {
    const { supabase } = await requireConsentedUser();
    await chats.clearReturnTarget(supabase, parsed.data.writingChatId);
    return { writingChatId: parsed.data.writingChatId };
  });
}

/** 패널 ⋯ "이 대화 삭제": the applied STAR stays on the project. */
export async function deleteWritingChat(input: unknown): Promise<ActionResult<{ messageCount: number; lastAppliedAt: string | null }>> {
  const parsed = WritingChatIdInput.safeParse(input);
  if (!parsed.success) return invalid(parsed.error);
  return runAction(async () => {
    const { supabase } = await requireConsentedUser();
    return chats.deleteWritingChat(supabase, parsed.data.writingChatId);
  });
}
