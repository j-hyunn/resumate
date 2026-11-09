import type { z } from "zod";
import {
  AI_ERROR_CODES,
  AI_JOB_STATUSES,
  type AiErrorCode,
  type AiJobStatus,
  type AiProvider,
  type ApplicationDocumentKind,
  type ConnectionTier,
  type KeyStatus,
  type WritingChatStatus,
} from "@/lib/contracts/enums";
import { AppError } from "@/lib/contracts/errors";
import {
  DELIVERABLE_DRAFT_LIMIT,
  DOCUMENT_DRAFT_LIMIT,
  WRITING_CHAT_MESSAGE_LIMIT,
  type AnyWritingChatDto,
  type ApplyDraftEditInput,
  type DeliverableDraftEditResult,
  type DeliverableWritingChatDto,
  type DocumentWritingChatDto,
  type DraftEditResult,
  type DraftFieldPath,
  type ProjectWritingChatSummary,
  type StartDeliverableWritingChatInput,
  type StartWritingChatInput,
  type WritingChatConnection,
  type WritingChatDto,
  type WritingChatTurnFailure,
} from "@/lib/contracts/writing-chat";
import type { Json } from "@/server/db/database.types";
import { mapDbError } from "@/server/db/errors";
import type { UserSupabaseClient } from "@/server/db/types";
import { loadActiveConsents, loadDisclosures, mayRunWithConsent } from "@/server/services/ai-connection/consent";
import { loadActiveProvider, loadKeyMetas } from "@/server/services/ai-connection/keys";
import { assertApplicationProjectOwned } from "@/server/services/application/db";
import { deleteCareerItem } from "@/server/services/career/rpc";
import { applyDeliverableDraftPatch, applyDraftPatch, loadChatSnapshot } from "./db";
import { applicableFields, needsReviewCount } from "./draft";
import { toMessageDtos } from "./mappers";
import { hasRoomForTurn, remainingMessages } from "./turn";
import type { ChatSnapshot } from "./types";

/**
 * AI writing chat Server Action services v4.5 (DM §3.3 / §7, UX S-10 · S-44 Resumate AI 패널).
 * Everything runs as the user (RLS). Reading and editing the proposal card never need an AI key
 * (PRD 3.3, D-36); only a new message does. [반영] fills the form on the screen only; "반영됨" is
 * recorded by the page save RPC (services/career/page-save.ts, DM 3.3 v4.5).
 */

function internal(cause: unknown): AppError {
  return new AppError("internal_error", undefined, { status: 500, cause });
}

// ---------------- start ----------------

/**
 * "+ 새 대화" / C-09 gate entry: `start_writing_chat(p_project_id, p_return_target, p_form_snapshot)`
 * — a chat row on an affiliated project + the fixed greeting (no AI call; not counted, R1 A5). A
 * standalone project is refused (`writing_chat_requires_affiliated_project`). The snapshot only picks
 * the greeting; the DB never stores it (`invalid_form_snapshot` on a bad one).
 */
export async function startWritingChat(supabase: UserSupabaseClient, input: z.output<typeof StartWritingChatInput>): Promise<{ writingChatId: string }> {
  const rt = input.returnTarget;
  // S5 (R-31): the gate's application project must be the user's (RLS read; `not_found` otherwise).
  if (rt) await assertApplicationProjectOwned(supabase, rt.applicationProjectId);
  const { data, error } = await supabase.rpc("start_writing_chat", {
    p_project_id: input.projectId,
    ...(rt ? { p_return_target: { application_project_id: rt.applicationProjectId, feature: rt.feature, params: rt.params as Record<string, never> } } : {}),
    ...(input.formSnapshot ? { p_form_snapshot: input.formSnapshot as Json } : {}),
  });
  if (error) throw mapDbError(error);
  if (typeof data !== "string") throw internal(new Error("start_writing_chat returned no id"));
  return { writingChatId: data };
}

/**
 * S-44 패널 "+ 새 대화": `start_deliverable_writing_chat(p_project_deliverable_id, p_form_snapshot)`
 * (DM §3.3 v4.5) — chat row + one of the three deliverable greetings (snapshot first, not stored).
 * The row must exist: a new deliverable is saved first (DM §7 첫 메시지 순서).
 */
export async function startDeliverableWritingChat(
  supabase: UserSupabaseClient,
  input: z.output<typeof StartDeliverableWritingChatInput>,
): Promise<{ writingChatId: string }> {
  const { data, error } = await supabase.rpc("start_deliverable_writing_chat", {
    p_project_deliverable_id: input.projectDeliverableId,
    ...(input.formSnapshot ? { p_form_snapshot: input.formSnapshot as Json } : {}),
  });
  if (error) throw mapDbError(error);
  if (typeof data !== "string") throw internal(new Error("start_deliverable_writing_chat returned no id"));
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

/**
 * (v4.11 OD-P10 / R-OD-8) The turn job of every `failed` reply, so the screen can tell a stopped turn
 * (job `canceled`) from a failed one (job `failed` + cause) after a reload. Runs after
 * `settleOrphanedStreaming` so replies it just marked failed are included.
 */
export async function loadTurnFailures(supabase: UserSupabaseClient, chat: ChatSnapshot): Promise<Map<string, WritingChatTurnFailure>> {
  const jobIds = [...new Set(chat.messages.filter((m) => m.role === "assistant" && m.status === "failed" && m.aiJobId).map((m) => m.aiJobId!))];
  const out = new Map<string, WritingChatTurnFailure>();
  if (jobIds.length === 0) return out;
  const { data, error } = await supabase.from("ai_jobs").select("id, status, error_code, retry_after, quota_resets_at").in("id", jobIds);
  if (error) throw mapDbError(error);
  for (const r of data ?? []) {
    if (!(AI_JOB_STATUSES as readonly string[]).includes(r.status)) continue;
    out.set(r.id, {
      jobStatus: r.status as AiJobStatus,
      errorCode: r.error_code && (AI_ERROR_CODES as readonly string[]).includes(r.error_code) ? (r.error_code as AiErrorCode) : null,
      retryAfter: r.retry_after,
      quotaResetsAt: r.quota_resets_at,
    });
  }
  return out;
}

type ChatDtoExtra = { connection: WritingChatConnection; failures?: ReadonlyMap<string, WritingChatTurnFailure> };

export function toWritingChatDto(chat: ChatSnapshot, extra: ChatDtoExtra): WritingChatDto {
  const room = hasRoomForTurn(chat.messageCount);
  const open = chat.status === "active";
  const last = chat.messages[chat.messages.length - 1];
  const replyRunning = last?.role === "assistant" && last.status === "streaming";
  // R15 D2: `projectId` is nullable now, but a STAR chat always has one.
  if (!chat.projectId) throw internal(new Error("not a project chat"));
  return {
    id: chat.id,
    projectId: chat.projectId,
    target: "project",
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
    messages: toMessageDtos(chat.messages, extra.failures),
    connection: extra.connection,
    needsReviewCount: needsReviewCount(chat.structuredDraft),
    applicableFields: applicableFields(chat.structuredDraft),
    canSend: open && room && extra.connection.lock === null && !replyRunning,
  };
}

/** S-44 panel DTO of a deliverable chat (AI-13). Chips are the screen's (`deliverableChips`, R-PA-5). */
export function toDeliverableWritingChatDto(chat: ChatSnapshot, extra: ChatDtoExtra): DeliverableWritingChatDto {
  const draft = chat.deliverableDraft;
  if (!draft || !chat.projectDeliverableId || !chat.projectId) throw internal(new Error("not a deliverable chat"));
  const room = hasRoomForTurn(chat.messageCount);
  const open = chat.status === "active";
  const last = chat.messages[chat.messages.length - 1];
  const replyRunning = last?.role === "assistant" && last.status === "streaming";
  return {
    id: chat.id,
    target: "project_deliverable",
    projectId: chat.projectId,
    projectDeliverableId: chat.projectDeliverableId,
    title: chat.title,
    status: chat.status,
    structuredDraft: draft,
    draftCount: draft.draft_count,
    draftLimit: DELIVERABLE_DRAFT_LIMIT,
    messageCount: chat.messageCount,
    messageLimit: WRITING_CHAT_MESSAGE_LIMIT,
    remainingMessages: remainingMessages(chat.messageCount),
    limitReached: !open || !room,
    lastActivityAt: chat.lastActivityAt,
    lastAppliedAt: chat.lastAppliedAt,
    createdAt: chat.createdAt,
    messages: toMessageDtos(chat.messages, extra.failures),
    connection: extra.connection,
    needsReviewCount: draft.facts.filter((f) => f.review === "needs_review").length,
    canSend: open && room && extra.connection.lock === null && !replyRunning,
  };
}

/** S-46 panel DTO of a 서류 대화 (AI-04, R15 후속). Mirrors `toDeliverableWritingChatDto`. */
export function toDocumentWritingChatDto(chat: ChatSnapshot, extra: ChatDtoExtra): DocumentWritingChatDto {
  const draft = chat.documentDraft;
  if (!draft || !chat.applicationProjectId || !chat.documentKind) throw internal(new Error("not a document chat"));
  const room = hasRoomForTurn(chat.messageCount);
  const open = chat.status === "active";
  const last = chat.messages[chat.messages.length - 1];
  const replyRunning = last?.role === "assistant" && last.status === "streaming";
  return {
    id: chat.id,
    target: "application_document",
    applicationProjectId: chat.applicationProjectId,
    documentKind: chat.documentKind,
    title: chat.title,
    status: chat.status,
    structuredDraft: draft,
    draftCount: draft.draft_count,
    draftLimit: DOCUMENT_DRAFT_LIMIT,
    messageCount: chat.messageCount,
    messageLimit: WRITING_CHAT_MESSAGE_LIMIT,
    remainingMessages: remainingMessages(chat.messageCount),
    limitReached: !open || !room,
    lastActivityAt: chat.lastActivityAt,
    lastAppliedAt: chat.lastAppliedAt,
    createdAt: chat.createdAt,
    messages: toMessageDtos(chat.messages, extra.failures),
    connection: extra.connection,
    needsReviewCount: draft.facts.filter((f) => f.review === "needs_review").length,
    canSend: open && room && extra.connection.lock === null && !replyRunning,
  };
}

/**
 * S-10 / S-44 / S-46 패널: messages, proposal card, provider badge (opening a chat from the history list).
 * The DTO follows the chat's target (`target: "project" | "project_deliverable" | "application_document"`).
 */
export async function getWritingChat(supabase: UserSupabaseClient, userId: string, chatId: string, now: Date = new Date()): Promise<AnyWritingChatDto> {
  const chat = await loadChatSnapshot(supabase, chatId);
  if (!chat) throw new AppError("not_found", "요청한 대화를 찾을 수 없습니다.");
  const [connection, failures] = await Promise.all([
    readChatConnection(supabase, userId, now),
    settleOrphanedStreaming(supabase, chat).then(() => loadTurnFailures(supabase, chat)),
  ]);
  if (chat.projectDeliverableId) return toDeliverableWritingChatDto(chat, { connection, failures });
  // R15 후속: a 서류 대화 used to fall through to the STAR DTO and fail ("not a project chat").
  if (chat.applicationProjectId) return toDocumentWritingChatDto(chat, { connection, failures });
  return toWritingChatDto(chat, { connection, failures });
}

const SUMMARY_COLUMNS = "id, title, status, last_activity_at, last_applied_at, message_count" as const;

/** S-10 패널 대화 기록 목록: the project's STAR chats, latest activity first (DM §7). */
export async function listProjectWritingChats(supabase: UserSupabaseClient, projectId: string): Promise<ProjectWritingChatSummary[]> {
  const { data, error } = await supabase
    .from("writing_chats")
    .select(SUMMARY_COLUMNS)
    .eq("project_id", projectId)
    // Deliverable chats carry their parent standalone project's id too (DM 2.5 v4.5).
    .is("project_deliverable_id", null)
    .order("last_activity_at", { ascending: false });
  if (error) throw mapDbError(error);
  return toSummaries(data ?? []);
}

/** S-44 패널 대화 기록 목록: the deliverable's chats, latest activity first (DM §7 v4.5). */
export async function listDeliverableWritingChats(supabase: UserSupabaseClient, projectDeliverableId: string): Promise<ProjectWritingChatSummary[]> {
  const { data, error } = await supabase
    .from("writing_chats")
    .select(SUMMARY_COLUMNS)
    .eq("project_deliverable_id", projectDeliverableId)
    .order("last_activity_at", { ascending: false });
  if (error) throw mapDbError(error);
  return toSummaries(data ?? []);
}

/**
 * S-46 패널 대화 기록 목록 (DM 7장 25행): the 서류's chats
 * `where application_project_id = ? and document_kind = ?` `order by last_activity_at desc`.
 */
export async function listDocumentWritingChats(
  supabase: UserSupabaseClient,
  applicationProjectId: string,
  documentKind: ApplicationDocumentKind = "cover_letter",
): Promise<ProjectWritingChatSummary[]> {
  const { data, error } = await supabase
    .from("writing_chats")
    .select(SUMMARY_COLUMNS)
    .eq("application_project_id", applicationProjectId)
    .eq("document_kind", documentKind)
    .order("last_activity_at", { ascending: false });
  if (error) throw mapDbError(error);
  return toSummaries(data ?? []);
}

function toSummaries(
  data: { id: string; title: string | null; status: string; last_activity_at: string; last_applied_at: string | null; message_count: number }[],
): ProjectWritingChatSummary[] {
  return data.map((r) => ({
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

/**
 * Deliverable card (DM 2.5.0 user ops, AI-13): fact [수락] / [거절] (needs_review only; reject removes
 * the fact), draft block [수락] (rev kept) / [빼기] (rev + 1). An applied draft → `field_already_applied`.
 * There is no "reject the whole draft" path.
 */
export async function editDeliverableDraft(
  supabase: UserSupabaseClient,
  input: { writingChatId: string; op: "accept_fact" | "reject_fact"; factId: string } | { writingChatId: string; op: "accept_block" | "remove_block"; blockId: string },
): Promise<DeliverableDraftEditResult> {
  const op = "factId" in input ? { op: input.op, fact_id: input.factId } : { op: input.op, block_id: input.blockId };
  const result = await applyDeliverableDraftPatch(supabase, input.writingChatId, { ops: [op] });
  return { structuredDraft: result.structuredDraft, needsReviewCount: result.structuredDraft.facts.filter((f) => f.review === "needs_review").length };
}

// ---------------- return target / delete ----------------

/** C-10 복귀 후: clear return_target (DM §2.5 "복귀하면 null로 비움"; the user's only direct update). */
export async function clearReturnTarget(supabase: UserSupabaseClient, chatId: string): Promise<void> {
  const { error } = await supabase.from("writing_chats").update({ return_target: null }).eq("id", chatId);
  if (error) throw mapDbError(error);
}

/**
 * 패널 ⋯ "이 대화 삭제" (DM §3.3–3.4): messages cascade; the saved STAR / body stays
 * (source_writing_chat_id → null); an in-flight turn gets a cancel request (DB trigger).
 */
export async function deleteWritingChat(supabase: UserSupabaseClient, chatId: string): Promise<{ messageCount: number; lastAppliedAt: string | null }> {
  const result = await deleteCareerItem(supabase, { entityType: "writing_chat", entityId: chatId, resultMode: "keep_results" });
  if (result.entity_type !== "writing_chat") throw internal(new Error("unexpected delete result"));
  return { messageCount: result.message_count, lastAppliedAt: result.last_applied_at };
}
