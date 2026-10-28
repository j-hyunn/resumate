import type { z } from "zod";
import { DRAFT_DETAIL_FIELDS, type AiProvider, type ConnectionTier, type KeyStatus } from "@/lib/contracts/enums";
import { AppError } from "@/lib/contracts/errors";
import {
  WRITING_CHAT_MESSAGE_LIMIT,
  WritingChatCommitRpcResult,
  type ActiveWritingChatSummary,
  ApplyDraftEditInput,
  type AugmentTargetDto,
  type DetailRef,
  type DraftFieldPath,
  EditDraftAchievementInput,
  EditDraftDetailInput,
  EditDraftSkillInput,
  SetAffiliationInput,
  StartWritingChatInput,
  type StructuredDraft,
  type WritingChatConnection,
  type WritingChatDto,
  type WritingChatProgress,
  type WritingChatSaveResult,
} from "@/lib/contracts/writing-chat";
import { mapDbError } from "@/server/db/errors";
import type { UserSupabaseClient } from "@/server/db/types";
import { loadActiveConsents, loadDisclosures, mayRunWithConsent } from "@/server/services/ai-connection/consent";
import { loadActiveProvider, loadKeyMetas } from "@/server/services/ai-connection/keys";
import { deleteCareerItem } from "@/server/services/career/rpc";
import { applyDraftPatch, loadChatSnapshot } from "./db";
import { draftProgress } from "./draft";
import { daysUntilAutoDelete, toMessageDtos } from "./mappers";
import { hasRoomForTurn } from "./turn";
import type { ChatSnapshot } from "./types";

/**
 * AI writing chat Server Action services (DM §7 대화 rows, §3.3, UX S-36 / S-08).
 * Everything runs as the user (RLS). Reading, editing the preview, saving,
 * and the hand-off never need an AI key (PRD 3.3, D-36); only a new message does.
 */

function internal(cause: unknown): AppError {
  return new AppError("internal_error", undefined, { status: 500, cause });
}

// ---------------- start ----------------

/** start_writing_chat: chat row + the fixed greeting (no AI call, counts as message 1). */
export async function startWritingChat(supabase: UserSupabaseClient, input: z.output<typeof StartWritingChatInput>): Promise<{ writingChatId: string }> {
  const rt = input.returnTarget;
  const { data, error } = await supabase.rpc("start_writing_chat", {
    p_mode: input.mode,
    ...(input.mode === "augment_project" ? { p_project_id: input.projectId } : {}),
    ...(rt ? { p_return_target: { application_project_id: rt.applicationProjectId, feature: rt.feature, params: rt.params as Record<string, never> } } : {}),
  });
  if (error) throw mapDbError(error);
  if (typeof data !== "string") throw internal(new Error("start_writing_chat returned no id"));
  return { writingChatId: data };
}

// ---------------- read ----------------

/** C-19 badge + C-18 lock for "send" (never blocks reading). */
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

async function loadAugmentTarget(supabase: UserSupabaseClient, projectId: string): Promise<AugmentTargetDto | null> {
  const [project, details] = await Promise.all([
    supabase.from("projects").select("id, name").eq("id", projectId).maybeSingle(),
    supabase
      .from("project_details")
      .select("id, title, situation, task, action, result, learnings, sort_order")
      .eq("project_id", projectId)
      .order("sort_order"),
  ]);
  if (project.error) throw mapDbError(project.error);
  if (details.error) throw mapDbError(details.error);
  if (!project.data) return null;
  return {
    projectId: project.data.id,
    name: project.data.name,
    details: (details.data ?? []).map((d) => ({
      id: d.id,
      title: d.title,
      filled: Object.fromEntries(DRAFT_DETAIL_FIELDS.map((f) => [f, typeof d[f] === "string" && d[f]!.trim() !== ""])) as AugmentTargetDto["details"][number]["filled"],
    })),
  };
}

/**
 * A `streaming` reply whose turn job is no longer running (the invocation died)
 * is shown as failed, so the screen offers "다시 보내기" (begin_assistant_message
 * reuses it, DM §2.5).
 */
async function settleOrphanedStreaming(supabase: UserSupabaseClient, chat: ChatSnapshot): Promise<void> {
  const streaming = chat.messages.filter((m) => m.role === "assistant" && m.status === "streaming");
  const jobIds = streaming.map((m) => m.aiJobId).filter((id): id is string => !!id);
  if (streaming.length === 0) return;
  const running = new Set<string>();
  if (jobIds.length > 0) {
    const { data, error } = await supabase.from("ai_jobs").select("id").in("id", jobIds).in("status", ["queued", "running"]);
    if (error) throw mapDbError(error);
    for (const r of data ?? []) running.add(r.id);
  }
  for (const m of streaming) if (!m.aiJobId || !running.has(m.aiJobId)) m.status = "failed";
}

export function toWritingChatDto(
  chat: ChatSnapshot,
  extra: { connection: WritingChatConnection; augmentTarget: AugmentTargetDto | null; now: Date },
): WritingChatDto {
  const progress: WritingChatProgress = draftProgress(chat.structuredDraft, { augment: chat.mode === "augment_project" });
  const room = hasRoomForTurn(chat.messageCount);
  const last = chat.messages[chat.messages.length - 1];
  const replyRunning = last?.role === "assistant" && last.status === "streaming";
  return {
    id: chat.id,
    mode: chat.mode,
    projectId: chat.projectId,
    experienceId: chat.experienceId,
    educationId: chat.educationId,
    status: chat.status,
    structuredDraft: chat.structuredDraft,
    messageCount: chat.messageCount,
    messageLimit: WRITING_CHAT_MESSAGE_LIMIT,
    limitReached: !room,
    lastActivityAt: chat.lastActivityAt,
    savedAt: chat.savedAt,
    returnTarget: chat.returnTarget,
    createdAt: chat.createdAt,
    daysUntilAutoDelete: daysUntilAutoDelete(chat, extra.now),
    messages: toMessageDtos(chat.messages),
    progress,
    connection: extra.connection,
    augmentTarget: extra.augmentTarget,
    canSend: chat.status === "active" && room && extra.connection.lock === null && !replyRunning,
  };
}

/** S-36: messages, preview, confirmed affiliation, progress, provider badge (이어 하기 복원). */
export async function getWritingChat(supabase: UserSupabaseClient, userId: string, chatId: string, now: Date = new Date()): Promise<WritingChatDto> {
  const chat = await loadChatSnapshot(supabase, chatId);
  if (!chat) throw new AppError("not_found", "요청한 대화를 찾을 수 없습니다.");
  const [connection, augmentTarget] = await Promise.all([
    readChatConnection(supabase, userId, now),
    chat.mode === "augment_project" && chat.projectId ? loadAugmentTarget(supabase, chat.projectId) : Promise.resolve(null),
    settleOrphanedStreaming(supabase, chat),
  ]);
  return toWritingChatDto(chat, { connection, augmentTarget, now });
}

/** S-08 "작성 중인 AI 대화" (active chats, latest activity first). */
export async function listActiveWritingChats(supabase: UserSupabaseClient, now: Date = new Date()): Promise<ActiveWritingChatSummary[]> {
  const { data, error } = await supabase
    .from("writing_chats")
    .select("id, mode, project_id, last_activity_at, message_count, status, projects!writing_chats_project_fkey(name)")
    .eq("status", "active")
    .order("last_activity_at", { ascending: false });
  if (error) throw mapDbError(error);
  return (data ?? []).map((r) => {
    const project = (r as { projects?: { name: string | null } | { name: string | null }[] | null }).projects;
    const name = Array.isArray(project) ? (project[0]?.name ?? null) : (project?.name ?? null);
    return {
      id: r.id,
      mode: r.mode as ActiveWritingChatSummary["mode"],
      projectId: r.project_id,
      projectName: r.mode === "augment_project" ? name : null,
      lastActivityAt: r.last_activity_at,
      messageCount: r.message_count,
      messageLimit: WRITING_CHAT_MESSAGE_LIMIT,
      daysUntilAutoDelete: daysUntilAutoDelete({ projectId: r.project_id, status: "active", lastActivityAt: r.last_activity_at }, now),
    };
  });
}

// ---------------- preview edits (user session apply_structured_draft_patch) ----------------

function detailTarget(ref: DetailRef): Record<string, string> {
  return "existingDetailId" in ref ? { existing_detail_id: ref.existingDetailId } : { detail_key: ref.detailKey };
}

/** Contract path → db patch target (db notes "target"). */
export function toPatchTarget(path: DraftFieldPath): Record<string, string> {
  if (path.section === "project") return { section: "project", field: path.field };
  if (path.section === "detail") return { section: "detail", ...detailTarget(path.detail), field: path.field };
  return { section: "achievement", achievement_key: path.achievementKey, field: path.field };
}

export type DraftEditResult = { structuredDraft: StructuredDraft; progress: WritingChatProgress };

async function patchAsUser(supabase: UserSupabaseClient, chatId: string, ops: unknown[]): Promise<DraftEditResult> {
  const result = await applyDraftPatch(supabase, chatId, { ops });
  const { data, error } = await supabase.from("writing_chats").select("mode").eq("id", chatId).maybeSingle();
  if (error) throw mapDbError(error);
  return { structuredDraft: result.structuredDraft, progress: draftProgress(result.structuredDraft, { augment: data?.mode === "augment_project" }) };
}

/** Direct edit → origin user_edit, review ok; `null` clears the field (AI may ask again). */
export function applyDraftEdit(supabase: UserSupabaseClient, input: z.output<typeof ApplyDraftEditInput>): Promise<DraftEditResult> {
  return patchAsUser(supabase, input.writingChatId, [{ op: "set", target: toPatchTarget(input.path), value: input.value }]);
}

export function reviewDraftField(supabase: UserSupabaseClient, input: { writingChatId: string; path: DraftFieldPath }, decision: "accept" | "reject"): Promise<DraftEditResult> {
  return patchAsUser(supabase, input.writingChatId, [{ op: decision, target: toPatchTarget(input.path) }]);
}

export function editDraftSkill(supabase: UserSupabaseClient, input: z.output<typeof EditDraftSkillInput>): Promise<DraftEditResult> {
  return patchAsUser(supabase, input.writingChatId, [{ op: input.action === "add" ? "add_skill" : "remove_skill", value: input.value }]);
}

export function editDraftDetail(supabase: UserSupabaseClient, input: z.output<typeof EditDraftDetailInput>): Promise<DraftEditResult> {
  const op = input.action === "add" ? { op: "new_detail", detail_key: input.detailKey } : { op: "remove_detail", ...detailTarget(input.detail) };
  return patchAsUser(supabase, input.writingChatId, [op]);
}

export function editDraftAchievement(supabase: UserSupabaseClient, input: z.output<typeof EditDraftAchievementInput>): Promise<DraftEditResult> {
  if (input.action === "remove") return patchAsUser(supabase, input.writingChatId, [{ op: "remove_achievement", achievement_key: input.achievementKey }]);
  const fields = Object.fromEntries(Object.entries(input.fields).filter(([, v]) => v !== undefined).map(([k, v]) => [k, { value: v }]));
  return patchAsUser(supabase, input.writingChatId, [{ op: "add_achievement", detail: detailTarget(input.detail), fields }]);
}

// ---------------- affiliation / save / hand-off / abandon / delete ----------------

export async function setWritingChatAffiliation(supabase: UserSupabaseClient, input: z.output<typeof SetAffiliationInput>): Promise<{ experienceId: string | null; educationId: string | null; structuredDraft: StructuredDraft }> {
  const a = input.affiliation;
  const { error } = await supabase.rpc("set_writing_chat_affiliation", {
    p_writing_chat_id: input.writingChatId,
    ...(a.type === "experience" ? { p_experience_id: a.id } : {}),
    ...(a.type === "education" ? { p_education_id: a.id } : {}),
    p_dismiss_only: input.clearSuggestionOnly,
  });
  if (error) throw mapDbError(error);
  const chat = await loadChatSnapshot(supabase, input.writingChatId);
  if (!chat) throw new AppError("not_found");
  return { experienceId: chat.experienceId, educationId: chat.educationId, structuredDraft: chat.structuredDraft };
}

function toSaveResult(data: unknown): WritingChatSaveResult {
  const parsed = WritingChatCommitRpcResult.safeParse(data);
  if (!parsed.success) throw internal(parsed.error);
  const r = parsed.data;
  return {
    writingChatId: r.writing_chat_id,
    projectId: r.project_id,
    status: r.status,
    projectCreated: r.project.created,
    projectUpdated: r.project.updated,
    detailsCreated: r.project_details.created,
    detailsUpdated: r.project_details.updated,
    detailsMissing: r.project_details.missing,
    achievementsCreated: r.achievements.created,
    skillsCreated: r.skills.created,
    skillsLinked: r.skills.linked,
    skippedNeedsReview: r.skipped_needs_review,
  };
}

/** "저장" (F-P1-13 (5)): the reviewed structured_draft → career tables, as the user (NFR-AI-05). */
export async function saveWritingChat(supabase: UserSupabaseClient, chatId: string): Promise<WritingChatSaveResult> {
  const { data, error } = await supabase.rpc("save_writing_chat", { p_writing_chat_id: chatId });
  if (error) throw mapDbError(error);
  return toSaveResult(data);
}

/** "폼으로 전환" (F-P1-13 (7)): same rules, status handed_off. */
export async function handOffWritingChat(supabase: UserSupabaseClient, chatId: string): Promise<WritingChatSaveResult> {
  const { data, error } = await supabase.rpc("hand_off_writing_chat", { p_writing_chat_id: chatId });
  if (error) throw mapDbError(error);
  return toSaveResult(data);
}

/** "그만두기": active → abandoned (direct column update; the guard trigger allows only this). */
export async function abandonWritingChat(supabase: UserSupabaseClient, chatId: string): Promise<{ writingChatId: string; status: "abandoned" }> {
  const { data, error } = await supabase.from("writing_chats").update({ status: "abandoned" }).eq("id", chatId).eq("status", "active").select("id");
  if (error) throw mapDbError(error);
  if (!data || data.length === 0) {
    const exists = await supabase.from("writing_chats").select("id").eq("id", chatId).maybeSingle();
    if (exists.error) throw mapDbError(exists.error);
    if (!exists.data) throw new AppError("not_found", "요청한 대화를 찾을 수 없습니다.");
    throw new AppError("writing_chat_not_active", "저장했거나 그만둔 대화예요.", { status: 409 });
  }
  return { writingChatId: chatId, status: "abandoned" };
}

/** C-10 복귀 후: clear return_target (DM §2.5 "복귀하면 null로 비움"). */
export async function clearReturnTarget(supabase: UserSupabaseClient, chatId: string): Promise<void> {
  const { error } = await supabase.from("writing_chats").update({ return_target: null }).eq("id", chatId);
  if (error) throw mapDbError(error);
}

/** "대화만 삭제" (DM §3.4): messages cascade, saved career rows stay (source_writing_chat_id → null). */
export async function deleteWritingChat(supabase: UserSupabaseClient, chatId: string): Promise<{ messageCount: number; linkedSavedRows: number }> {
  const result = await deleteCareerItem(supabase, { entityType: "writing_chat", entityId: chatId, affiliationMode: "keep_projects", resultMode: "keep_results" });
  if (result.entity_type !== "writing_chat") throw internal(new Error("unexpected delete result"));
  return { messageCount: result.message_count, linkedSavedRows: result.linked_saved_rows };
}
