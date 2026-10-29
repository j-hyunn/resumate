import { AI_PROVIDERS, CONNECTION_TIERS, MODEL_TIERS, WRITING_CHAT_MODES, WRITING_CHAT_STATUSES, type AiProvider, type ConnectionTier, type ModelTier, type WritingChatMessageRole, type WritingChatMessageStatus, type WritingChatMode, type WritingChatStatus } from "@/lib/contracts/enums";
import { AppError } from "@/lib/contracts/errors";
import { parseStructuredDraft, ReturnTarget, WRITING_CHAT_RETENTION_DAYS, type WritingChatMessageDto } from "@/lib/contracts/writing-chat";
import type { ChatMessage, ChatSnapshot } from "./types";

/** writing_chats / writing_chat_messages rows ↔ service types (DM §2.5). */

export const CHAT_COLUMNS =
  "id, user_id, mode, project_id, experience_id, education_id, status, structured_draft, message_count, last_extracted_sequence, return_target, last_activity_at, saved_at, created_at";
export const MESSAGE_COLUMNS = "id, sequence, role, content, status, ai_job_id, provider, model, model_tier, connection_tier, created_at";

export type ChatRow = {
  id: string;
  user_id: string;
  mode: string;
  project_id: string | null;
  experience_id: string | null;
  education_id: string | null;
  status: string;
  structured_draft: unknown;
  message_count: number;
  last_extracted_sequence: number;
  return_target: unknown;
  last_activity_at: string;
  saved_at: string | null;
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
  let draft;
  try {
    draft = parseStructuredDraft(row.structured_draft);
  } catch (cause) {
    throw new AppError("internal_error", undefined, { status: 500, cause });
  }
  const target = row.return_target === null ? null : ReturnTarget.safeParse(row.return_target);
  return {
    id: row.id,
    userId: row.user_id,
    mode: required<WritingChatMode>(WRITING_CHAT_MODES, row.mode),
    projectId: row.project_id,
    experienceId: row.experience_id,
    educationId: row.education_id,
    status: required<WritingChatStatus>(WRITING_CHAT_STATUSES, row.status),
    structuredDraft: draft,
    messageCount: row.message_count,
    lastExtractedSequence: row.last_extracted_sequence,
    // soft reference (DM §2.5): an unreadable value is ignored rather than failing the chat.
    returnTarget: target && target.success ? target.data : null,
    lastActivityAt: row.last_activity_at,
    createdAt: row.created_at,
    savedAt: row.saved_at,
    messages: messages.map(toChatMessage).sort((a, b) => a.sequence - b.sequence),
  };
}

export function toMessageDto(m: ChatMessage, userNumber: number | null): WritingChatMessageDto {
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
    createdAt: m.createdAt,
  };
}

/** "내 답변 #n": user messages numbered among themselves. */
export function toMessageDtos(messages: ChatMessage[]): WritingChatMessageDto[] {
  let n = 0;
  return messages.map((m) => toMessageDto(m, m.role === "user" ? ++n : null));
}

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * S-08 / S-36 "{N}일 뒤 자동 삭제" (DM §3.4 [가정] 90 days after the last
 * activity). Only chats without a project (`project_id` null) that are active
 * or abandoned; rounded up, between 0 and WRITING_CHAT_RETENTION_DAYS.
 */
export function daysUntilAutoDelete(chat: { projectId: string | null; status: WritingChatStatus; lastActivityAt: string }, now: Date): number | null {
  if (chat.projectId !== null) return null;
  if (chat.status !== "active" && chat.status !== "abandoned") return null;
  const deleteAt = Date.parse(chat.lastActivityAt) + WRITING_CHAT_RETENTION_DAYS * DAY_MS;
  // QA-S6-05: a DB clock slightly ahead of the app's must not show 91 days for a chat created just now.
  return Math.min(WRITING_CHAT_RETENTION_DAYS, Math.max(0, Math.ceil((deleteAt - now.getTime()) / DAY_MS)));
}
