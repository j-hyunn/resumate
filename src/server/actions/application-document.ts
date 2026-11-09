"use server";

import {
  SaveApplicationDocumentInput,
  StartDocumentWritingChatInput,
  type SaveApplicationDocumentResult,
  type StartDocumentWritingChatResult,
} from "@/lib/contracts/application-document";
import { invalid, runAction, type ActionResult } from "@/lib/contracts/errors";
import { requireConsentedUser } from "@/server/auth/session";
import * as documents from "@/server/services/application-document/save";

/**
 * R15 A5 — 자기소개서 정본 Server Actions (DM 2.5.1 / 2.5.0b / 11.8 #4; UX S-46).
 *
 * Two actions replace the old 서류 flow's three generation buttons (CF-1): one
 * save and one chat start. Thin: consent-gated user session → zod (JSON shape
 * only, R5-API-2) → service. Neither calls an AI provider or needs a key (CL-8);
 * drafting is the chat turn route `POST /api/writing-chats/{id}/turns`.
 */

/**
 * S-46 "저장하기" → `save_application_document`. The whole question list is overwritten in the
 * order sent (a slot left out is deleted, with its evidence), the "반영됨" record of every applied
 * proposal is written in the same transaction, and an applied proposal's `draft.sources[]` replaces
 * that slot's `{slot}.sources.{n}` evidence (CF-S1). `name` / `deadline` ride along in
 * `applicationValues`; an empty `name` returns to the default "{회사명} 자기소개서".
 */
export async function saveApplicationDocument(input: unknown): Promise<ActionResult<SaveApplicationDocumentResult>> {
  const parsed = SaveApplicationDocumentInput.safeParse(input);
  if (!parsed.success) return invalid(parsed.error);
  return runAction(async () => {
    const { supabase } = await requireConsentedUser();
    return documents.saveApplicationDocument(supabase, parsed.data);
  });
}

/**
 * S-46 "AI와 쓰기" → `start_document_writing_chat`. Does not create the 정본 row; 404
 * `application_project_not_found` when the application project is missing or someone else's.
 */
export async function startDocumentWritingChat(input: unknown): Promise<ActionResult<StartDocumentWritingChatResult>> {
  const parsed = StartDocumentWritingChatInput.safeParse(input);
  if (!parsed.success) return invalid(parsed.error);
  return runAction(async () => {
    const { supabase } = await requireConsentedUser();
    return documents.startDocumentWritingChat(supabase, parsed.data);
  });
}
