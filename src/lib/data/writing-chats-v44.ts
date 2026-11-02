/**
 * Resumate AI 패널 data layer v4.4 (S-10, DM §2.5 / §3.3 / §7; AI-12 v4.5). Server only.
 * 연결 대기: the reworked S-10 panel imports these; the current S-36 screen still uses `./writing-chats`
 * (v4.3b shims). The turn itself streams from `POST /api/writing-chats/{id}/turns` (SSE events in
 * `src/lib/contracts/writing-chat.ts`); `turnRequest` gives the screen that endpoint and body.
 */
import "server-only"
import type { z } from "zod"
import { invalid } from "@/lib/contracts/errors"
import {
  ApplyDraftEditInput,
  ApplyProposalInput,
  ReviewDraftFieldInput,
  StartWritingChatInput,
  WritingChatTurnInput,
  type ApplyProposalResult,
  type DraftEditResult,
  type ProjectWritingChatSummary,
  type WritingChatDto,
} from "@/lib/contracts/writing-chat"
import { requireConsentedUser } from "@/server/auth/session"
import * as chats from "@/server/services/writing-chat/chat"
import { unwrap } from "./source"

function parseInput<S extends z.ZodType>(schema: S, input: unknown): z.output<S> {
  const parsed = schema.safeParse(input)
  if (!parsed.success) unwrap(invalid(parsed.error))
  return parsed.data as z.output<S>
}

/** 대화 기록 목록 (latest activity first). */
export async function listProjectChats(projectId: string): Promise<ProjectWritingChatSummary[]> {
  const { supabase } = await requireConsentedUser()
  return chats.listProjectWritingChats(supabase, projectId)
}

/** Open one chat (messages, proposal card, chips, lock). */
export async function getProjectChat(chatId: string): Promise<WritingChatDto> {
  const { supabase, user } = await requireConsentedUser()
  return chats.getWritingChat(supabase, user.id, chatId)
}

/** "+ 새 대화" / C-09 gate entry. Returns the opened chat. */
export async function startProjectChat(input: z.input<typeof StartWritingChatInput>): Promise<WritingChatDto> {
  const { supabase, user } = await requireConsentedUser()
  const { writingChatId } = await chats.startWritingChat(supabase, parseInput(StartWritingChatInput, input))
  return chats.getWritingChat(supabase, user.id, writingChatId)
}

/** Proposal card direct edit. */
export async function editProposalField(input: z.input<typeof ApplyDraftEditInput>): Promise<DraftEditResult> {
  const { supabase } = await requireConsentedUser()
  return chats.applyDraftEdit(supabase, parseInput(ApplyDraftEditInput, input))
}

/** [수락] / [거절(비우기)] of a needs_review field. */
export async function reviewProposalField(input: z.input<typeof ReviewDraftFieldInput>, decision: "accept" | "reject"): Promise<DraftEditResult> {
  const { supabase } = await requireConsentedUser()
  return chats.reviewDraftField(supabase, parseInput(ReviewDraftFieldInput, input), decision === "reject" ? "reject" : "accept")
}

/** [반영] / [모두 반영] (no key needed). */
export async function applyProposal(input: z.input<typeof ApplyProposalInput>): Promise<ApplyProposalResult> {
  const { supabase } = await requireConsentedUser()
  return chats.applyWritingChatProposal(supabase, parseInput(ApplyProposalInput, input))
}

/** 패널 ⋯ "이 대화 삭제". */
export async function deleteProjectChat(chatId: string): Promise<{ messageCount: number; lastAppliedAt: string | null }> {
  const { supabase } = await requireConsentedUser()
  return chats.deleteWritingChat(supabase, chatId)
}

/** The SSE request for one turn (`retry` = "다시 보내기"). The body is validated here and again by the route. */
export function turnRequest(chatId: string, body: z.input<typeof WritingChatTurnInput> | null): { endpoint: string; body: unknown } {
  const base = `/api/writing-chats/${chatId}/turns`
  if (body === null) return { endpoint: `${base}?retry=1`, body: {} }
  return { endpoint: base, body: parseInput(WritingChatTurnInput, body) }
}
