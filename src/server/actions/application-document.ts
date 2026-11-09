"use server";

import {
  ApplicationDocumentIdInput,
  ApplicationDocumentTargetInput,
  SaveApplicationDocumentInput,
  StartDocumentWritingChatInput,
  type SaveApplicationDocumentResult,
  type StartDocumentWritingChatResult,
} from "@/lib/contracts/application-document";
import type { EvidenceChip } from "@/lib/contracts/evidence";
import type { ApplicationDocument } from "@/types/db";
import { invalid, runAction, type ActionResult } from "@/lib/contracts/errors";
import { requireConsentedUser } from "@/server/auth/session";
import * as reads from "@/server/services/application-document/read";
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

// ---------------- R15 후속: reads (DM 7장 25행 · 33행) ----------------

/**
 * S-46 정본 1행. `null` = no row yet → 문항 설정 상태. When a row comes back the screen opens in
 * 작성 상태 and sends its `updated_at` as the next save's `expectedUpdatedAt` — that is what keeps a
 * re-opened 자기소개서 from being overwritten with the default questions.
 */
export async function getApplicationDocument(input: unknown): Promise<ActionResult<ApplicationDocument | null>> {
  const parsed = ApplicationDocumentTargetInput.safeParse(input);
  if (!parsed.success) return invalid(parsed.error);
  return runAction(async () => {
    const { supabase } = await requireConsentedUser();
    return reads.getApplicationDocument(supabase, parsed.data.applicationProjectId, parsed.data.documentKind);
  });
}

/** S-46 근거 칩 of one 정본 row, grouped by `item_key` (`{slot}.blocks.{block_id}` / `{slot}.sources.{n}`). */
export async function listApplicationDocumentEvidence(input: unknown): Promise<ActionResult<Record<string, EvidenceChip[]>>> {
  const parsed = ApplicationDocumentIdInput.safeParse(input);
  if (!parsed.success) return invalid(parsed.error);
  return runAction(async () => {
    const { supabase } = await requireConsentedUser();
    return reads.listApplicationDocumentEvidence(supabase, parsed.data.applicationDocumentId);
  });
}

/** S-39 카드 문항 수: every 자기소개서 of the user, keyed by `application_project_id`. No input. */
export async function listDocumentSlotCounts(): Promise<ActionResult<Record<string, reads.DocumentSlotCounts>>> {
  return runAction(async () => {
    const { supabase } = await requireConsentedUser();
    return reads.listDocumentSlotCounts(supabase);
  });
}

/**
 * S-46 [복사] → the first-copy record. Answers the stored `first_copied_at` (the first value on
 * every later call), or `null` when there is no 정본 row yet. Never moves `updated_at`, so it never
 * breaks the next save's expected version.
 */
export async function markApplicationDocumentCopied(input: unknown): Promise<ActionResult<{ firstCopiedAt: string | null }>> {
  const parsed = ApplicationDocumentTargetInput.safeParse(input);
  if (!parsed.success) return invalid(parsed.error);
  return runAction(async () => {
    const { supabase } = await requireConsentedUser();
    return documents.markApplicationDocumentCopied(supabase, parsed.data.applicationProjectId, parsed.data.documentKind);
  });
}
