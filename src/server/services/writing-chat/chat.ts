import type { z } from "zod";
import type { AiProvider, ConnectionTier, KeyStatus, WritingChatStatus } from "@/lib/contracts/enums";
import { AppError } from "@/lib/contracts/errors";
import {
  ApplyProposalRpcResult,
  WRITING_CHAT_MESSAGE_LIMIT,
  type ApplyDraftEditInput,
  type ApplyProposalInput,
  type ApplyProposalResult,
  type DraftEditResult,
  type DraftFieldPath,
  type ProjectWritingChatSummary,
  type StartWritingChatInput,
  type WritingChatConnection,
  type WritingChatDto,
} from "@/lib/contracts/writing-chat";
import type { ProjectSlotState } from "@/server/ai/context-pack/focus-slots";
import { mapDbError } from "@/server/db/errors";
import type { UserSupabaseClient } from "@/server/db/types";
import { loadActiveConsents, loadDisclosures, mayRunWithConsent } from "@/server/services/ai-connection/consent";
import { loadActiveProvider, loadKeyMetas } from "@/server/services/ai-connection/keys";
import { assertApplicationProjectOwned } from "@/server/services/application/db";
import { deleteCareerItem } from "@/server/services/career/rpc";
import { applyDraftPatch, loadChatSnapshot } from "./db";
import { applicableFields, chipsFor, needsReviewCount } from "./draft";
import { toMessageDtos } from "./mappers";
import { hasRoomForTurn, remainingMessages } from "./turn";
import type { ChatSnapshot } from "./types";

/**
 * AI writing chat Server Action services v4.4 (DM §3.3 / §7, UX S-10 Resumate AI 패널).
 * Everything runs as the user (RLS). Reading, editing the proposal card, and applying never need
 * an AI key (PRD 3.3, D-36); only a new message does.
 */

function internal(cause: unknown): AppError {
  return new AppError("internal_error", undefined, { status: 500, cause });
}

// ---------------- start ----------------

/**
 * "+ 새 대화" / C-09 gate entry: `start_writing_chat(p_project_id, p_return_target)` — a chat row
 * on an affiliated project + the fixed greeting (no AI call; not counted, R1 A5). A standalone
 * project is refused (`writing_chat_requires_affiliated_project`).
 */
export async function startWritingChat(supabase: UserSupabaseClient, input: z.output<typeof StartWritingChatInput>): Promise<{ writingChatId: string }> {
  const rt = input.returnTarget;
  // S5 (R-31): the gate's application project must be the user's (RLS read; `not_found` otherwise).
  if (rt) await assertApplicationProjectOwned(supabase, rt.applicationProjectId);
  const { data, error } = await supabase.rpc("start_writing_chat", {
    p_project_id: input.projectId,
    ...(rt ? { p_return_target: { application_project_id: rt.applicationProjectId, feature: rt.feature, params: rt.params as Record<string, never> } } : {}),
  });
  if (error) throw mapDbError(error);
  if (typeof data !== "string") throw internal(new Error("start_writing_chat returned no id"));
  return { writingChatId: data };
}

// ---------------- read ----------------

/** C-19 badge + C-18 lock for "send" (never blocks reading or applying). */
export async function readChatConnection(supabase: UserSupabaseClient, userId: string, now: Date = new Date()): Promise<WritingChatConnection> {
  const active = await loadActiveProvider(supabase, userId);
  if (!active) return { provider: null, connectionTier: null, keyStatus: null, lock: "ai_not_connected" };
  const [key] = await loadKeyMetas(supabase, active);
  if (!key) return { provider: active, connectionTier: null, keyStatus: null, lock: "ai_not_connected" };
  const tier = key.connection_tier as ConnectionTier;
  const keyStatus = key.status as KeyStatus;
  if (keyStatus === "invalid") return { provider: active, connectionTier: tier, keyStatus, lock: "key_invalid" };
  const [disclosures, consents] = await Promise.all([loadDisclosures(supabase, active), loadActiveConsents(supabase, active)]);
  const lock = mayRunWithConsent(disclosures, consents, active as AiProvider, tier, now) ? null : "ai_consent_required";
  return { provider: active, connectionTier: tier, keyStatus, lock };
}

/** The project's current STAR + start month (quick chips are computed against it, AI-12). */
export async function loadProjectSlotState(supabase: UserSupabaseClient, projectId: string): Promise<ProjectSlotState> {
  const { data, error } = await supabase
    .from("projects")
    .select("situation, task, action, result, learnings, start_month")
    .eq("id", projectId)
    .maybeSingle();
  if (error) throw mapDbError(error);
  if (!data) throw new AppError("not_found", "대상 프로젝트를 찾을 수 없습니다.");
  return {
    star: { situation: data.situation, task: data.task, action: data.action, result: data.result, learnings: data.learnings },
    startMonth: data.start_month,
  };
}

/**
 * A `streaming` reply whose turn job is no longer running (the invocation died) is shown as
 * failed, so the panel offers "다시 보내기" (begin_assistant_message reuses it, DM §2.5).
 */
async function settleOrphanedStreaming(supabase: UserSupabaseClient, chat: ChatSnapshot): Promise<void> {
  const streaming = chat.messages.filter((m) => m.role === "assistant" && m.status === "streaming");
  if (streaming.length === 0) return;
  const jobIds = streaming.map((m) => m.aiJobId).filter((id): id is string => !!id);
  const running = new Set<string>();
  if (jobIds.length > 0) {
    const { data, error } = await supabase.from("ai_jobs").select("id").in("id", jobIds).in("status", ["queued", "running"]);
    if (error) throw mapDbError(error);
    for (const r of data ?? []) running.add(r.id);
  }
  for (const m of streaming) if (!m.aiJobId || !running.has(m.aiJobId)) m.status = "failed";
}

export function toWritingChatDto(chat: ChatSnapshot, extra: { connection: WritingChatConnection; project: ProjectSlotState }): WritingChatDto {
  const room = hasRoomForTurn(chat.messageCount);
  const open = chat.status === "active";
  const last = chat.messages[chat.messages.length - 1];
  const replyRunning = last?.role === "assistant" && last.status === "streaming";
  return {
    id: chat.id,
    projectId: chat.projectId,
    title: chat.title,
    status: chat.status,
    structuredDraft: chat.structuredDraft,
    messageCount: chat.messageCount,
    messageLimit: WRITING_CHAT_MESSAGE_LIMIT,
    remainingMessages: remainingMessages(chat.messageCount),
    limitReached: !open || !room,
    lastActivityAt: chat.lastActivityAt,
    lastAppliedAt: chat.lastAppliedAt,
    returnTarget: chat.returnTarget,
    createdAt: chat.createdAt,
    messages: toMessageDtos(chat.messages),
    connection: extra.connection,
    chips: chipsFor(extra.project, chat.structuredDraft, chat.messageCount, open && room),
    needsReviewCount: needsReviewCount(chat.structuredDraft),
    applicableFields: applicableFields(chat.structuredDraft),
    canSend: open && room && extra.connection.lock === null && !replyRunning,
  };
}

/** S-10 패널: messages, proposal card, chips, provider badge (opening a chat from the history list). */
export async function getWritingChat(supabase: UserSupabaseClient, userId: string, chatId: string, now: Date = new Date()): Promise<WritingChatDto> {
  const chat = await loadChatSnapshot(supabase, chatId);
  if (!chat) throw new AppError("not_found", "요청한 대화를 찾을 수 없습니다.");
  const [connection, project] = await Promise.all([
    readChatConnection(supabase, userId, now),
    loadProjectSlotState(supabase, chat.projectId),
    settleOrphanedStreaming(supabase, chat),
  ]);
  return toWritingChatDto(chat, { connection, project });
}

/** S-10 패널 대화 기록 목록: the project's chats, latest activity first (DM §7). */
export async function listProjectWritingChats(supabase: UserSupabaseClient, projectId: string): Promise<ProjectWritingChatSummary[]> {
  const { data, error } = await supabase
    .from("writing_chats")
    .select("id, title, status, last_activity_at, last_applied_at, message_count")
    .eq("project_id", projectId)
    .order("last_activity_at", { ascending: false });
  if (error) throw mapDbError(error);
  return (data ?? []).map((r) => ({
    id: r.id,
    title: r.title,
    status: r.status as WritingChatStatus,
    lastActivityAt: r.last_activity_at,
    lastAppliedAt: r.last_applied_at,
    messageCount: r.message_count,
    messageLimit: WRITING_CHAT_MESSAGE_LIMIT,
  }));
}

// ---------------- proposal card (user session apply_structured_draft_patch, v3) ----------------

/** Contract path → patch target (db notes "apply_structured_draft_patch v3 payload"). */
export function toPatchTarget(path: DraftFieldPath): { section: string; field: string } {
  return { section: path.section, field: path.field };
}

async function patchAsUser(supabase: UserSupabaseClient, chatId: string, ops: unknown[]): Promise<DraftEditResult> {
  const result = await applyDraftPatch(supabase, chatId, { ops });
  return {
    structuredDraft: result.structuredDraft,
    needsReviewCount: needsReviewCount(result.structuredDraft),
    applicableFields: applicableFields(result.structuredDraft),
  };
}

/**
 * Direct edit → origin user_edit, review ok; `null` clears the field (DM §2.5). Allowed on
 * `active` and `closed` chats ([가정] R4-DB); an applied field → `field_already_applied`.
 */
export function applyDraftEdit(supabase: UserSupabaseClient, input: z.output<typeof ApplyDraftEditInput>): Promise<DraftEditResult> {
  return patchAsUser(supabase, input.writingChatId, [{ op: "set", target: toPatchTarget(input.path), value: input.value }]);
}

/** `needs_review` → [수락] accepted / [거절] value cleared (DM §2.5). */
export function reviewDraftField(supabase: UserSupabaseClient, input: { writingChatId: string; path: DraftFieldPath }, decision: "accept" | "reject"): Promise<DraftEditResult> {
  return patchAsUser(supabase, input.writingChatId, [{ op: decision, target: toPatchTarget(input.path) }]);
}

// ---------------- apply (DM §3.3 v4.4) ----------------

/**
 * [반영] / [모두 반영] → `apply_writing_chat_proposal` (user session, synchronous, no AI / key).
 * STAR: appended to the current value with one newline (or set when empty); period / classification
 * only when empty; needs_review skipped. Any merged STAR value over 2,000 chars → nothing written,
 * `field_too_long` (409, details.fields). Returns the RPC answer and the chat's new draft.
 */
export async function applyWritingChatProposal(supabase: UserSupabaseClient, input: z.output<typeof ApplyProposalInput>): Promise<ApplyProposalResult> {
  const { data, error } = await supabase.rpc("apply_writing_chat_proposal", {
    p_writing_chat_id: input.writingChatId,
    ...(input.fields ? { p_fields: input.fields } : {}),
  });
  if (error) throw mapDbError(error);
  const parsed = ApplyProposalRpcResult.safeParse(data);
  if (!parsed.success) throw internal(parsed.error);
  const chat = await loadChatSnapshot(supabase, input.writingChatId);
  if (!chat) throw new AppError("not_found", "요청한 대화를 찾을 수 없습니다.");
  return { applied: parsed.data.applied, skipped: parsed.data.skipped, projectStatus: parsed.data.project_status, structuredDraft: chat.structuredDraft };
}

// ---------------- return target / delete ----------------

/** C-10 복귀 후: clear return_target (DM §2.5 "복귀하면 null로 비움"; the user's only direct update). */
export async function clearReturnTarget(supabase: UserSupabaseClient, chatId: string): Promise<void> {
  const { error } = await supabase.from("writing_chats").update({ return_target: null }).eq("id", chatId);
  if (error) throw mapDbError(error);
}

/**
 * 패널 ⋯ "이 대화 삭제" (DM §3.3–3.4): messages cascade; the applied STAR stays on the project
 * (source_writing_chat_id → null); an in-flight turn gets a cancel request (DB trigger).
 */
export async function deleteWritingChat(supabase: UserSupabaseClient, chatId: string): Promise<{ messageCount: number; lastAppliedAt: string | null }> {
  const result = await deleteCareerItem(supabase, { entityType: "writing_chat", entityId: chatId, resultMode: "keep_results" });
  if (result.entity_type !== "writing_chat") throw internal(new Error("unexpected delete result"));
  return { messageCount: result.message_count, lastAppliedAt: result.last_applied_at };
}
