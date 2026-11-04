/**
 * S-10 프로젝트 상세 page save + S-44 산출물 상세 AI 패널 data layer v4.5 (DM 2.5.1 / §3.3 / §7,
 * AI-12 v4.6 · AI-13, PA-1·PA-3). Server only.
 *
 * The S-10 / S-44 screens reach these through `./career-v45` (snake_case view models, `?state=` mock
 * branch); this file is the camelCase service boundary.
 *
 * 새 페이지의 첫 AI 메시지 (DM §7, the screen calls in order — not one transaction):
 *   ① name (S-10) / title (S-44) empty → don't send (focus the field, no temporary name)
 *   ② `getDataReadiness().ai_connection` — no key / invalid / consent needed → stop, create nothing
 *   ③ `saveProjectPage` / `saveDeliverablePage` with the whole form (creates the row; failure = nothing)
 *   ④ `startProjectChatWithSnapshot` / `startDeliverableChat` (failure = the row stays, URL replaced)
 *   ⑤ the turn (`turnRequest` / `deliverableTurnRequest`, `formSnapshot` from now on)
 */
import "server-only"
import type { z } from "zod"
import {
  SaveProjectDeliverableInput,
  SaveProjectPageInput,
  type SaveProjectDeliverableResult,
  type SaveProjectPageResult,
} from "@/lib/contracts/career"
import { AppError, invalid } from "@/lib/contracts/errors"
import {
  DeliverableDraftEditInput,
  StartDeliverableWritingChatInput,
  StartWritingChatInput,
  WritingChatRetryInput,
  WritingChatTurnInput,
  type AnyWritingChatDto,
  type DeliverableDraftEditResult,
  type DeliverableWritingChatDto,
  type ProjectWritingChatSummary,
  type WritingChatDto,
} from "@/lib/contracts/writing-chat"
import { requireConsentedUser } from "@/server/auth/session"
import { saveProjectDeliverable, saveProjectPage as savePage } from "@/server/services/career/page-save"
import * as chats from "@/server/services/writing-chat/chat"
import { unwrap } from "./source"

function parseInput<S extends z.ZodType>(schema: S, input: unknown): z.output<S> {
  const parsed = schema.safeParse(input)
  if (!parsed.success) {
    // DM 2.5.1: a bad form snapshot is its own code.
    if (parsed.error.issues.some((i) => i.path[0] === "formSnapshot")) {
      throw new AppError("invalid_form_snapshot", "작성 중인 내용이 너무 길거나 형식이 맞지 않아요. 글자 수를 확인해 주세요.", { status: 400 })
    }
    unwrap(invalid(parsed.error))
  }
  return parsed.data as z.output<S>
}

function asProjectChat(dto: AnyWritingChatDto): WritingChatDto {
  if (dto.target !== "project") throw new AppError("not_found", "요청한 대화를 찾을 수 없습니다.")
  return dto
}

function asDeliverableChat(dto: AnyWritingChatDto): DeliverableWritingChatDto {
  if (dto.target !== "project_deliverable") throw new AppError("not_found", "요청한 대화를 찾을 수 없습니다.")
  return dto
}

// ---------- page saves ----------

/**
 * S-10 상단 바 "저장하기" (`save_project_page`). `projectId: null` creates; pass the proposals the
 * screen filled this visit as `appliedProposals` (`{writingChatId, field, rev}`). Errors keep their
 * codes: `stale_write` (details.current_updated_at), `field_too_long` / `invalid_period` /
 * `invalid_classification` (details.field), `project_name_required`, `project_affiliation_required`.
 */
export async function saveProjectPage(input: z.input<typeof SaveProjectPageInput>): Promise<SaveProjectPageResult> {
  const { supabase } = await requireConsentedUser()
  return savePage(supabase, parseInput(SaveProjectPageInput, input))
}

/** S-44 상단 바 "저장하기" (`save_project_deliverable`). `projectDeliverableId: null` creates under `projectId`. */
export async function saveDeliverablePage(input: z.input<typeof SaveProjectDeliverableInput>): Promise<SaveProjectDeliverableResult> {
  const { supabase } = await requireConsentedUser()
  return saveProjectDeliverable(supabase, parseInput(SaveProjectDeliverableInput, input))
}

// ---------- chats ----------

/** S-10 "+ 새 대화" with the form snapshot (greeting only; never stored). */
export async function startProjectChatWithSnapshot(input: z.input<typeof StartWritingChatInput>): Promise<WritingChatDto> {
  const { supabase, user } = await requireConsentedUser()
  const { writingChatId } = await chats.startWritingChat(supabase, parseInput(StartWritingChatInput, input))
  return asProjectChat(await chats.getWritingChat(supabase, user.id, writingChatId))
}

/** S-44 "+ 새 대화" (`start_deliverable_writing_chat`). Returns the opened chat. */
export async function startDeliverableChat(input: z.input<typeof StartDeliverableWritingChatInput>): Promise<DeliverableWritingChatDto> {
  const { supabase, user } = await requireConsentedUser()
  const { writingChatId } = await chats.startDeliverableWritingChat(supabase, parseInput(StartDeliverableWritingChatInput, input))
  return asDeliverableChat(await chats.getWritingChat(supabase, user.id, writingChatId))
}

/** S-44 대화 기록 목록 (latest activity first). */
export async function listDeliverableChats(projectDeliverableId: string): Promise<ProjectWritingChatSummary[]> {
  const { supabase } = await requireConsentedUser()
  return chats.listDeliverableWritingChats(supabase, projectDeliverableId)
}

/** Open one deliverable chat (messages, facts, draft card, draft count, lock). */
export async function getDeliverableChat(chatId: string): Promise<DeliverableWritingChatDto> {
  const { supabase, user } = await requireConsentedUser()
  return asDeliverableChat(await chats.getWritingChat(supabase, user.id, chatId))
}

/** Open one chat of either target (대화 기록 → 열기 on S-10 or S-44). */
export async function getAnyChat(chatId: string): Promise<AnyWritingChatDto> {
  const { supabase, user } = await requireConsentedUser()
  return chats.getWritingChat(supabase, user.id, chatId)
}

/** S-44 card: fact [수락] / [거절], draft block [수락] / [빼기]. */
export async function editDeliverableDraft(input: z.input<typeof DeliverableDraftEditInput>): Promise<DeliverableDraftEditResult> {
  const { supabase } = await requireConsentedUser()
  return chats.editDeliverableDraft(supabase, parseInput(DeliverableDraftEditInput, input))
}

/**
 * The SSE request for one turn of either panel. Include `formSnapshot` (S-10: `{name, start_month, …,
 * star: {…}}`, S-44: `{title, body}`) on every turn of a page with a form. The route validates it again
 * against the chat's target.
 * "다시 보내기" (`{ retry: true, … }`): no content, but the same options (`requestedSlot`,
 * `requestedAction`, `style`, `formSnapshot`) so a chip draft turn is resent as a draft turn with the
 * current form (QA-R5-05).
 */
export function deliverableTurnRequest(
  chatId: string,
  body: z.input<typeof WritingChatTurnInput> | ({ retry: true } & z.input<typeof WritingChatRetryInput>),
): { endpoint: string; body: unknown } {
  const base = `/api/writing-chats/${chatId}/turns`
  if ("retry" in body) {
    const { retry: _retry, ...options } = body
    void _retry
    return { endpoint: `${base}?retry=1`, body: parseInput(WritingChatRetryInput, options) }
  }
  return { endpoint: base, body: parseInput(WritingChatTurnInput, body) }
}
