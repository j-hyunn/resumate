import type { z } from "zod";
import {
  SaveApplicationDocumentRpcResult,
  type SaveApplicationDocumentInput,
  type SaveApplicationDocumentResult,
  type StartDocumentWritingChatInput,
  type StartDocumentWritingChatResult,
} from "@/lib/contracts/application-document";
import type { ApplicationDocumentKind, NameSource } from "@/lib/contracts/enums";
import { AppError } from "@/lib/contracts/errors";
import type { Json } from "@/server/db/database.types";
import { mapDbError } from "@/server/db/errors";
import type { UserSupabaseClient } from "@/server/db/types";

/**
 * R15 A5 — the 자기소개서 정본 save and the 서류 대화 start.
 *
 * Both run through the **user session** (DM §5): `save_application_document` is
 * security invoker and `start_document_writing_chat` is definer with an owner
 * check. Neither looks at the key, the consent or the active provider (CL-8) —
 * saving a 자기소개서 never needs an AI connection.
 *
 * The three generation buttons of the old 서류 flow (경력기술서 / 전체 문항 /
 * 이 문항만) are gone (CF-1): there is one save action and one chat-start action,
 * and drafting happens inside the chat turn route.
 *
 * Nothing here logs question text, answers or evidence (NFR-PRV-09).
 */

function internal(cause: unknown): AppError {
  return new AppError("internal_error", undefined, { status: 500, cause });
}

/** S-46 "저장하기". Creates the row when `(applicationProjectId, documentKind)` has none. */
export async function saveApplicationDocument(
  supabase: UserSupabaseClient,
  input: z.output<typeof SaveApplicationDocumentInput>,
): Promise<SaveApplicationDocumentResult> {
  const applied = input.appliedProposals?.map((p) => ({ writing_chat_id: p.writingChatId, slot: p.slot, rev: p.rev }));
  const { data, error } = await supabase.rpc("save_application_document", {
    p_application_project_id: input.applicationProjectId,
    p_document_kind: input.documentKind,
    p_body: input.body as unknown as Json,
    ...(input.meta ? { p_meta: input.meta as unknown as Json } : {}),
    ...(input.expectedUpdatedAt ? { p_expected_updated_at: input.expectedUpdatedAt } : {}),
    ...(applied && applied.length > 0 ? { p_applied_proposals: applied as unknown as Json } : {}),
    ...(input.clientId ? { p_client_id: input.clientId } : {}),
    ...(input.applicationValues ? { p_application_values: input.applicationValues as unknown as Json } : {}),
  });
  if (error) throw mapDbError(error);
  const parsed = SaveApplicationDocumentRpcResult.safeParse(data);
  if (!parsed.success) throw internal(parsed.error);
  const r = parsed.data;
  return {
    applicationDocumentId: r.application_document_id,
    documentKind: r.document_kind as ApplicationDocumentKind,
    filledSlotCount: r.filled_slot_count,
    slotCount: r.slot_count,
    name: r.name,
    nameSource: r.name_source as NameSource | null,
    deadline: r.deadline,
    updatedAt: r.updated_at,
    applied: r.applied.map((a) => ({ writingChatId: a.writing_chat_id, slot: a.slot })),
    skipped: r.skipped.map((s) => ({ writingChatId: s.writing_chat_id, slot: s.slot, reason: s.reason })),
  };
}

/**
 * S-46 "AI와 쓰기" → a new 서류 대화 (`writing_chats` with
 * `(application_project_id, document_kind)` and `project_id` null). Returns the new chat id;
 * the greeting is `writing_chat_messages.sequence = 1`.
 */
export async function startDocumentWritingChat(
  supabase: UserSupabaseClient,
  input: z.output<typeof StartDocumentWritingChatInput>,
): Promise<StartDocumentWritingChatResult> {
  const { data, error } = await supabase.rpc("start_document_writing_chat", {
    p_application_project_id: input.applicationProjectId,
    p_document_kind: input.documentKind,
    // DM 2.5.1: in memory only — it is not stored and never reaches ai_jobs.params or a log line.
    ...(input.formSnapshot ? { p_form_snapshot: input.formSnapshot as unknown as Json } : {}),
  });
  if (error) throw mapDbError(error);
  if (typeof data !== "string" || data.length === 0) throw internal(data);
  return { writingChatId: data };
}
