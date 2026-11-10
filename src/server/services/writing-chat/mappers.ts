import {
  AI_PROVIDERS,
  CONNECTION_TIERS,
  MODEL_TIERS,
  WRITING_CHAT_STATUSES,
  type AiProvider,
  type ApplicationDocumentKind,
  type ConnectionTier,
  type ModelTier,
  type WritingChatMessageRole,
  type WritingChatMessageStatus,
  type WritingChatStatus,
} from "@/lib/contracts/enums";
import { AppError } from "@/lib/contracts/errors";
import {
  parseCoverLetterDraft,
  parseDeliverableDraft,
  parseStructuredDraft,
  ReturnTarget,
  type WritingChatMessageDto,
  type WritingChatTurnFailure,
} from "@/lib/contracts/writing-chat";
import type { ChatMessage, ChatSnapshot } from "./types";

/** writing_chats / writing_chat_messages rows ↔ service types (DM §2.5 v4.5). */

export const CHAT_COLUMNS =
  "id, user_id, project_id, project_deliverable_id, application_project_id, document_kind, title, status, structured_draft, message_count, last_extracted_sequence, return_target, last_activity_at, last_applied_at, created_at";
export const MESSAGE_COLUMNS = "id, sequence, role, content, status, ai_job_id, provider, model, model_tier, connection_tier, created_at";

export type ChatRow = {
  id: string;
  /** R15 D2: null on a 서류 대화 (the not-null constraint was released). */
  project_id: string | null;
  user_id: string;
  project_deliverable_id: string | null;
  /** R15 D2: set (with `document_kind`) on a 서류 대화; null otherwise. */
  application_project_id: string | null;
  document_kind: string | null;
  title: string | null;
  status: string;
  structured_draft: unknown;
  message_count: number;
  last_extracted_sequence: number;
  return_target: unknown;
  last_activity_at: string;
  last_applied_at: string | null;
  created_at: string;
};

export type MessageRow = {
  id: string;
  sequence: number;
  role: string;
  content: string;
  status: string;
  ai_job_id: string | null;
  provider: string | null;
  model: string | null;
  model_tier: string | null;
  connection_tier: string | null;
  created_at: string;
};

function oneOf<T extends string>(list: readonly T[], value: string | null): T | null {
  return value !== null && (list as readonly string[]).includes(value) ? (value as T) : null;
}

function required<T extends string>(list: readonly T[], value: string): T {
  const v = oneOf(list, value);
  if (!v) throw new AppError("internal_error", undefined, { status: 500, cause: new Error("unexpected enum value") });
  return v;
}

export function toChatMessage(row: MessageRow): ChatMessage {
  return {
    id: row.id,
    sequence: row.sequence,
    role: required<WritingChatMessageRole>(["user", "assistant"], row.role),
    content: row.content,
    status: required<WritingChatMessageStatus>(["streaming", "done", "failed"], row.status),
    aiJobId: row.ai_job_id,
    provider: oneOf<AiProvider>(AI_PROVIDERS, row.provider),
    model: row.model,
    modelTier: oneOf<ModelTier>(MODEL_TIERS, row.model_tier),
    connectionTier: oneOf<ConnectionTier>(CONNECTION_TIERS, row.connection_tier),
    createdAt: row.created_at,
  };
}

export function toChatSnapshot(row: ChatRow, messages: MessageRow[]): ChatSnapshot {
  // DM 2.5 v4.15: the target is exactly one of project (STAR, AI-12) / project_deliverable (AI-13) /
  // application_project + document_kind (서류, AI-04), and the draft's shape follows it.
  const isDeliverable = row.project_deliverable_id !== null && row.project_deliverable_id !== undefined;
  const isDocument = !isDeliverable && row.application_project_id !== null && row.application_project_id !== undefined;
  let draft;
  let deliverableDraft = null;
  let documentDraft = null;
  try {
    draft = parseStructuredDraft(isDeliverable || isDocument ? {} : row.structured_draft);
    if (isDeliverable) deliverableDraft = parseDeliverableDraft(row.structured_draft);
    if (isDocument) documentDraft = parseCoverLetterDraft(row.structured_draft);
  } catch (cause) {
    throw new AppError("internal_error", undefined, { status: 500, cause });
  }
  const target = row.return_target === null ? null : ReturnTarget.safeParse(row.return_target);
  return {
    id: row.id,
    userId: row.user_id,
    projectId: row.project_id,
    projectDeliverableId: isDeliverable ? row.project_deliverable_id : null,
    applicationProjectId: isDocument ? row.application_project_id : null,
    documentKind: isDocument ? (row.document_kind as ApplicationDocumentKind | null) : null,
    title: row.title,
    status: required<WritingChatStatus>(WRITING_CHAT_STATUSES, row.status),
    structuredDraft: draft,
    deliverableDraft,
    documentDraft,
    messageCount: row.message_count,
    lastExtractedSequence: row.last_extracted_sequence,
    // soft reference (DM §2.5): an unreadable value is ignored rather than failing the chat.
    returnTarget: target && target.success ? target.data : null,
    lastActivityAt: row.last_activity_at,
    lastAppliedAt: row.last_applied_at,
    createdAt: row.created_at,
    messages: messages.map(toChatMessage).sort((a, b) => a.sequence - b.sequence),
  };
}

export function toMessageDto(m: ChatMessage, userNumber: number | null, turnFailure: WritingChatTurnFailure | null = null): WritingChatMessageDto {
  return {
    id: m.id,
    sequence: m.sequence,
    role: m.role,
    content: m.content,
    status: m.status,
    userNumber,
    provider: m.role === "assistant" ? m.provider : null,
    model: m.role === "assistant" ? m.model : null,
    modelTier: m.role === "assistant" ? m.modelTier : null,
    connectionTier: m.role === "assistant" ? m.connectionTier : null,
    aiJobId: m.aiJobId,
    turnFailure: m.role === "assistant" && m.status === "failed" ? turnFailure : null,
    createdAt: m.createdAt,
  };
}

/** "내 답변 #n": user messages numbered among themselves. */
export function toMessageDtos(messages: ChatMessage[], failures: ReadonlyMap<string, WritingChatTurnFailure> = new Map()): WritingChatMessageDto[] {
  let n = 0;
  return messages.map((m) => toMessageDto(m, m.role === "user" ? ++n : null, m.aiJobId ? (failures.get(m.aiJobId) ?? null) : null));
}
