"use server"

/**
 * Server actions for the L-02 pages (S-10 · S-44) and the Resumate AI 패널 core. Thin wrappers over
 * `./career-v45` so client components can call the v4.5 data layer. `previewState` is the page's `?state=`
 * (mock variants only — the real path ignores it; a preview request is decided by the proxy marker).
 */
import type { DeliverableStructuredDraft, ProjectStructuredDraft, ReturnTarget } from "@/types/db"
import * as data from "./career-v45"
import type {
  DeliverableFormSnapshot,
  ProjectFormSnapshot,
  SaveProjectDeliverableInput,
  SaveProjectPageInput,
  StructuredDraftUserPatch,
  TurnRequestBody,
  WritingChatMessageView,
} from "./career-v45-shared"

export async function saveProjectPageAction(input: SaveProjectPageInput, previewState?: string | null) {
  return data.saveProjectPage(input, previewState)
}

export async function saveProjectDeliverableAction(input: SaveProjectDeliverableInput, previewState?: string | null) {
  return data.saveProjectDeliverable(input, previewState)
}

export async function checkAiConnectionAction() {
  return data.checkAiConnection()
}

export async function startWritingChatAction(
  projectId: string,
  returnTarget: { application_project_id: string; feature: ReturnTarget["feature"]; params?: Record<string, unknown> } | null,
  formSnapshot: ProjectFormSnapshot | null,
  previewState?: string | null,
) {
  return data.startWritingChat(projectId, returnTarget, formSnapshot, previewState)
}

export async function startDeliverableWritingChatAction(deliverableId: string, formSnapshot: DeliverableFormSnapshot | null, previewState?: string | null) {
  return data.startDeliverableWritingChat(deliverableId, formSnapshot, previewState)
}

export async function getWritingChatAction(chatId: string) {
  return data.getWritingChat(chatId)
}

export async function deleteWritingChatAction(chatId: string) {
  return data.deleteWritingChat(chatId)
}

export async function applyStructuredDraftPatchAction(chatId: string, patch: StructuredDraftUserPatch) {
  return data.applyStructuredDraftPatch<ProjectStructuredDraft | DeliverableStructuredDraft>(chatId, patch)
}

export async function prepareWritingChatTurnAction(input: {
  chat_id: string
  target: "project" | "deliverable"
  body: TurnRequestBody
  retry: boolean
  structured_draft: ProjectStructuredDraft | DeliverableStructuredDraft
  message_count: number
  next_sequence: number
  preview_state: string | null
}) {
  return data.prepareWritingChatTurn(input)
}

export async function recordMockTurnAction(
  chatId: string,
  turn: { messages: WritingChatMessageView[]; structured_draft: ProjectStructuredDraft | DeliverableStructuredDraft; message_count: number; closed: boolean; title: string | null },
) {
  return data.recordMockTurn(chatId, turn)
}

/** C-23 mode "choose" options (C-09 / S-16 entry points). */
export async function listProjectAffiliationsAction() {
  return data.listProjectAffiliations()
}
