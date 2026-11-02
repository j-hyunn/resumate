import { AppError } from "@/lib/contracts/errors";
import { parseStructuredDraft, type StructuredDraft } from "@/lib/contracts/writing-chat";
import { mapDbError } from "@/server/db/errors";
import type { Json } from "@/server/db/database.types";
import type { AiWriterSupabaseClient, UserSupabaseClient } from "@/server/db/types";
import { CHAT_COLUMNS, MESSAGE_COLUMNS, toChatSnapshot, type ChatRow, type MessageRow } from "./mappers";
import type { ChatSnapshot, TurnChatDb } from "./types";

/**
 * Supabase implementation of the turn's chat persistence (DM §2.5, §5):
 * - user session: reads (RLS) and `append_writing_chat_message`;
 * - app_ai_writer: begin / finish assistant, AI patch, extract mark (definer RPCs).
 * No career table is written here (NFR-AI-05).
 */

function internal(cause: unknown): AppError {
  return new AppError("internal_error", undefined, { status: 500, cause });
}

export async function loadChatSnapshot(supabase: UserSupabaseClient | AiWriterSupabaseClient, chatId: string): Promise<ChatSnapshot | null> {
  const [chat, messages] = await Promise.all([
    supabase.from("writing_chats").select(CHAT_COLUMNS).eq("id", chatId).maybeSingle(),
    supabase.from("writing_chat_messages").select(MESSAGE_COLUMNS).eq("writing_chat_id", chatId).order("sequence"),
  ]);
  if (chat.error) throw mapDbError(chat.error);
  if (messages.error) throw mapDbError(messages.error);
  if (!chat.data) return null;
  return toChatSnapshot(chat.data as unknown as ChatRow, (messages.data ?? []) as MessageRow[]);
}

/** `apply_structured_draft_patch` result (db notes "반환"). */
export type PatchResult = { structuredDraft: StructuredDraft; rejected: { index: number; op: string; reason: string }[] };

export function parsePatchResult(data: unknown): PatchResult {
  const obj = (data ?? {}) as { structured_draft?: unknown; rejected?: unknown };
  try {
    const rejected = Array.isArray(obj.rejected) ? (obj.rejected as PatchResult["rejected"]) : [];
    return { structuredDraft: parseStructuredDraft(obj.structured_draft), rejected };
  } catch (cause) {
    throw internal(cause);
  }
}

export async function applyDraftPatch(supabase: UserSupabaseClient | AiWriterSupabaseClient, chatId: string, patch: unknown): Promise<PatchResult> {
  const { data, error } = await supabase.rpc("apply_structured_draft_patch", { p_writing_chat_id: chatId, p_patch: patch as Json });
  if (error) throw mapDbError(error);
  return parsePatchResult(data);
}

export function createTurnChatDb(user: UserSupabaseClient, writer: AiWriterSupabaseClient, log?: (event: string, fields: Record<string, string | number | boolean | null>) => void): TurnChatDb {
  return {
    load: (chatId) => loadChatSnapshot(user, chatId),

    async appendUserMessage(chatId, content) {
      const { data, error } = await user.rpc("append_writing_chat_message", { p_writing_chat_id: chatId, p_content: content });
      if (error) throw mapDbError(error);
      const row = data?.[0];
      if (!row) throw internal(new Error("append_writing_chat_message returned no row"));
      return { id: row.message_id, sequence: row.sequence, messageCount: row.message_count };
    },

    async beginAssistant(chatId, jobId, meta) {
      const { data, error } = await writer.rpc("begin_assistant_message", {
        p_writing_chat_id: chatId,
        p_ai_job_id: jobId,
        p_provider: meta.provider,
        p_model: meta.model,
        p_model_tier: meta.modelTier,
        p_connection_tier: meta.connectionTier,
      });
      if (error) throw mapDbError(error);
      const row = data?.[0];
      if (!row) throw internal(new Error("begin_assistant_message returned no row"));
      return { id: row.message_id, sequence: row.sequence, messageCount: row.message_count, reused: row.reused, isFinal: row.is_final };
    },

    async finishAssistant(messageId, status, content) {
      const { error } = await writer.rpc("finish_assistant_message", { p_message_id: messageId, p_status: status, p_content: content });
      if (error) throw mapDbError(error);
    },

    async applyAiPatch(chatId, patch) {
      const result = await applyDraftPatch(writer, chatId, patch);
      // Ops the RPC refused (V-9a / V-9h / protected fields) are logged without any text (C-7).
      if (result.rejected.length > 0) {
        log?.("writing_chat.patch_rejected", {
          chatId,
          count: result.rejected.length,
          reasons: [...new Set(result.rejected.map((r) => r.reason))].join(","),
        });
      }
      return result.structuredDraft;
    },

    async markExtracted(chatId, sequence) {
      const { error } = await writer.rpc("mark_writing_chat_extracted", { p_writing_chat_id: chatId, p_sequence: sequence });
      if (error) throw mapDbError(error);
    },
  };
}
