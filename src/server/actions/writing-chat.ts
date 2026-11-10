"use server";

import type { z } from "zod";
import { invalid, runAction, type ActionResult } from "@/lib/contracts/errors";
import {
  ApplyDraftEditInput,
  DeliverableDraftEditInput,
  DeliverableWritingChatsInput,
  DocumentWritingChatsInput,
  ProjectWritingChatsInput,
  ReviewDraftFieldInput,
  StartDeliverableWritingChatInput,
  StartWritingChatInput,
  WritingChatIdInput,
  type AnyWritingChatDto,
  type DeliverableDraftEditResult,
  type DraftEditResult,
  type ProjectWritingChatSummary,
  type StartWritingChatResult,
} from "@/lib/contracts/writing-chat";
import { requireConsentedUser } from "@/server/auth/session";
import * as chats from "@/server/services/writing-chat/chat";

/**
 * AI writing chat Server Actions v4.5 (DM §7 대화 rows, UX S-10 · S-44 Resumate AI 패널).
 * Thin: consent-gated user session → zod → service. Every write is the user's own RPC (RLS);
 * none of these call an AI provider, so none needs a key (PRD 3.3 — only sending a message
 * does, through the turn route). Removed in R5: [반영] (`apply_writing_chat_proposal`) — [반영]
 * fills the form on the screen and "저장하기" records it (actions/career.ts saveProjectPage /
 * saveProjectDeliverable, DM 3.3 v4.5).
 *
 * 새 페이지의 첫 메시지 (DM §7, 화면이 순서대로 부름): ① 이름·제목이 비면 보내지 않음 ②
 * `getDataReadiness().ai_connection` ③ saveProjectPage / saveProjectDeliverable (행 생성) ④
 * startWritingChat / startDeliverableWritingChat ⑤ 턴 (`formSnapshot` 포함).
 */

/** 패널 "+ 새 대화" / C-09 게이트 진입: chat on an affiliated project + fixed greeting. */
export async function startWritingChat(input: unknown): Promise<ActionResult<StartWritingChatResult>> {
  const parsed = StartWritingChatInput.safeParse(input);
  if (!parsed.success) return invalidSnapshotOr(parsed.error);
  return runAction(async () => {
    const { supabase } = await requireConsentedUser();
    return chats.startWritingChat(supabase, parsed.data);
  });
}

/** S-44 패널 "+ 새 대화": chat on a deliverable + fixed greeting (DM §3.3 v4.5). */
export async function startDeliverableWritingChat(input: unknown): Promise<ActionResult<StartWritingChatResult>> {
  const parsed = StartDeliverableWritingChatInput.safeParse(input);
  if (!parsed.success) return invalidSnapshotOr(parsed.error);
  return runAction(async () => {
    const { supabase } = await requireConsentedUser();
    return chats.startDeliverableWritingChat(supabase, parsed.data);
  });
}

/** Open one chat: messages, proposal card, provider badge / lock (DTO by the chat's target). */
export async function getWritingChat(input: unknown): Promise<ActionResult<AnyWritingChatDto>> {
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

/** S-44 대화 기록 목록 of one deliverable (latest activity first). */
export async function listDeliverableWritingChats(input: unknown): Promise<ActionResult<ProjectWritingChatSummary[]>> {
  const parsed = DeliverableWritingChatsInput.safeParse(input);
  if (!parsed.success) return invalid(parsed.error);
  return runAction(async () => {
    const { supabase } = await requireConsentedUser();
    return chats.listDeliverableWritingChats(supabase, parsed.data.projectDeliverableId);
  });
}

/**
 * S-46 대화 기록 목록 of one 서류 (R15 후속, DM 7장 25행 — latest activity first). Opening one is
 * `getWritingChat`, which answers a `DocumentWritingChatDto` for a 서류 대화 (`target:
 * "application_document"`), so a reload restores the messages and the unapplied proposals.
 */
export async function listDocumentWritingChats(input: unknown): Promise<ActionResult<ProjectWritingChatSummary[]>> {
  const parsed = DocumentWritingChatsInput.safeParse(input);
  if (!parsed.success) return invalid(parsed.error);
  return runAction(async () => {
    const { supabase } = await requireConsentedUser();
    return chats.listDocumentWritingChats(supabase, parsed.data.applicationProjectId, parsed.data.documentKind);
  });
}

/** S-44 card: fact [수락] / [거절], draft block [수락] / [빼기]. */
export async function editDeliverableDraft(input: unknown): Promise<ActionResult<DeliverableDraftEditResult>> {
  const parsed = DeliverableDraftEditInput.safeParse(input);
  if (!parsed.success) return invalid(parsed.error);
  return runAction(async () => {
    const { supabase } = await requireConsentedUser();
    return chats.editDeliverableDraft(supabase, parsed.data);
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

/** A bad `formSnapshot` is its own code (DM 2.5.1 `invalid_form_snapshot`); the rest is `invalid_input`. */
function invalidSnapshotOr(error: z.ZodError) {
  if (error.issues.some((i) => i.path[0] === "formSnapshot")) {
    return { error: { code: "invalid_form_snapshot", message: "작성 중인 내용이 너무 길거나 형식이 맞지 않아요. 글자 수를 확인해 주세요." } } as const;
  }
  return invalid(error);
}
