"use server"

/**
 * A2 커리어 server actions. Thin wrappers around src/lib/data/* (career, deletion,
 * writing-chats). Autosave actions don't revalidate (the form owns its state); structural
 * changes (create from S-36, delete) call refresh() so server lists re-render.
 *
 * `fail` flags simulate ST-SAVE-FAILED / AI failures for `?state=` previews (mock only).
 */
import { refresh } from "next/cache"
import type {
  AiErrorCode,
  Achievement,
  AffiliationMode,
  DeletionEntityType,
  Education,
  Experience,
  Profile,
  Project,
  ProjectDetail,
  ResultMode,
  ReturnTarget,
  WritingChatMode,
} from "@/types/db"
import {
  addManualSkill,
  reorderProjectDetails,
  saveAchievement,
  saveEducation,
  saveExperience,
  saveProject,
  saveProjectDetail,
  setProjectSkills,
  updateProfile,
} from "@/lib/data/career"
import { deleteCareerItem } from "@/lib/data/deletion"
import { getDataReadiness } from "@/lib/data/readiness"
import {
  applyStructuredDraftPatch,
  clearReturnTarget,
  completeWritingChatTurn,
  getWritingChat,
  getWritingChatSaveSummary,
  handOffWritingChat,
  saveWritingChat,
  setWritingChatAffiliation,
  startWritingChat,
  WritingChatLockedError,
  markWritingChatSlotAsked,
  retryWritingChatTurn,
  sendWritingChatTurn,
  type StructuredDraftPath,
} from "@/lib/data/writing-chats"
import { withAiGuard } from "@/lib/data/ai-guard"
import { MockAiError } from "@/lib/mock/ai"
import { slotFromPath, type ChatSlot } from "@/lib/data/writing-chat-slots"
import { buildChatView } from "@/lib/data/writing-chat-view"

type Opts = { fail?: boolean }

// ---------------------------------------------------------------------------
// forms (autosave targets)
// ---------------------------------------------------------------------------

export async function saveProfileAction(patch: Partial<Profile>, opts?: Opts) {
  return updateProfile(patch, opts)
}

export async function saveExperienceAction(id: string | null, patch: Partial<Experience>, opts?: Opts) {
  return saveExperience(id, patch, opts)
}

export async function saveEducationAction(id: string | null, patch: Partial<Education>, opts?: Opts) {
  return saveEducation(id, patch, opts)
}

export async function saveProjectAction(id: string | null, patch: Partial<Project>, opts?: Opts) {
  return saveProject(id, patch, opts)
}

export async function setProjectSkillsAction(projectId: string, names: string[], opts?: Opts) {
  return setProjectSkills(projectId, names, opts)
}

export async function saveProjectDetailAction(
  projectId: string,
  id: string | null,
  patch: Partial<ProjectDetail>,
  opts?: Opts,
) {
  return saveProjectDetail(projectId, id, patch, opts)
}

export async function reorderProjectDetailsAction(projectId: string, orderedIds: string[]) {
  await reorderProjectDetails(projectId, orderedIds)
}

export async function saveAchievementAction(id: string | null, patch: Partial<Achievement>, opts?: Opts) {
  return saveAchievement(id, patch, opts)
}

export async function addManualSkillAction(name: string) {
  const skill = await addManualSkill(name)
  refresh()
  return skill
}

/** C-05 → RPC delete_career_item */
export async function deleteCareerItemAction(
  entityType: DeletionEntityType,
  entityId: string,
  affiliationMode?: AffiliationMode,
  resultMode?: ResultMode,
) {
  await deleteCareerItem(entityType, entityId, affiliationMode, resultMode)
  refresh()
}

// ---------------------------------------------------------------------------
// S-36 AI 작성 대화
// ---------------------------------------------------------------------------

export async function startWritingChatAction(input: {
  mode: WritingChatMode
  project_id?: string | null
  experience_id?: string | null
  education_id?: string | null
  return_target?: Omit<ReturnTarget, "created_at"> | null
}): Promise<{ ok: true; id: string } | { ok: false; reason: "locked" | "key_invalid" }> {
  try {
    const chat = await startWritingChat(input)
    return { ok: true, id: chat.id }
  } catch (e) {
    // v4: no active key (C-18 should have shown first; another tab may have deleted the key)
    if (e instanceof WritingChatLockedError) return { ok: false, reason: "locked" }
    if (e instanceof MockAiError) return { ok: false, reason: "key_invalid" }
    throw e
  }
}

/**
 * User turn: RPC append_writing_chat_message, then plan the (mock) AI turn.
 * Returns what the client streams (reply + patched paths). `requestedSlot` = "이 부분부터
 * 다시 물어봐 줘" / "AI에게 물어봐 줘" (AI 명세 v3.1 requested_slot).
 */
export async function sendWritingChatMessageAction(chatId: string, content: string, requestedSlot?: ChatSlot | null) {
  // A2 request 10: `{ rejected: key_missing | key_invalid }` → the message is not appended
  return withAiGuard(() => sendWritingChatTurn(chatId, content, requestedSlot ?? null))
}

/** 실패한 턴 다시 보내기: same planned turn, no new user message (메시지 수 미증가 [가정]). `{ rejected }` when no usable key. */
export async function retryWritingChatTurnAction(chatId: string) {
  return withAiGuard(() => retryWritingChatTurn(chatId))
}

/** Stream finished (or failed): store the assistant message (+ the failure cause) and apply the AI patch. */
export async function completeWritingChatTurnAction(
  chatId: string,
  failed: boolean,
  errorCode?: AiErrorCode | null,
  timing?: { retry_after?: string | null; quota_resets_at?: string | null },
) {
  await completeWritingChatTurn(chatId, failed, errorCode ?? null, timing)
  return loadChatView(chatId)
}

export async function applyDraftPatchAction(
  chatId: string,
  patch: { path: StructuredDraftPath; action: "edit"; value: string | number | null } | { path: StructuredDraftPath; action: "accept" | "reject" },
) {
  await applyStructuredDraftPatch(chatId, patch)
  if (patch.action === "reject") await markWritingChatSlotAsked(chatId, slotFromPath(patch.path))
  return loadChatView(chatId)
}

export async function setWritingChatAffiliationAction(
  chatId: string,
  affiliation: { experience_id: string | null; education_id: string | null } | "dismiss_suggestion",
) {
  await setWritingChatAffiliation(chatId, affiliation)
  return loadChatView(chatId)
}

export async function getWritingChatSaveSummaryAction(chatId: string) {
  return getWritingChatSaveSummary(chatId)
}

/** RPC save_writing_chat → re-judge readiness (C-10 / 저장 완료 화면) */
export async function saveWritingChatAction(chatId: string, opts?: Opts) {
  const result = await saveWritingChat(chatId, opts)
  const readiness = await getDataReadiness()
  refresh()
  return { ...result, readiness }
}

/** RPC hand_off_writing_chat → S-10 */
export async function handOffWritingChatAction(chatId: string) {
  const result = await handOffWritingChat(chatId)
  refresh()
  return result
}

export async function clearReturnTargetAction(chatId: string) {
  await clearReturnTarget(chatId)
}

export async function loadChatView(chatId: string) {
  const chat = await getWritingChat(chatId)
  if (!chat) return null
  return buildChatView(chat)
}
