import type { EvidenceChip } from "@/lib/contracts/evidence";
import { APPLICATION_DOCUMENT_KINDS, type ApplicationDocumentKind } from "@/lib/contracts/enums";
import { AppError } from "@/lib/contracts/errors";
import { mapDbError } from "@/server/db/errors";
import type { UserSupabaseClient } from "@/server/db/types";
import { loadEvidenceChips } from "@/server/services/evidence";
import type { ApplicationDocument } from "@/types/db";

/**
 * R15 후속 — the reads S-46 and S-39 need (DM 7장 "서류 작성 화면 조회" / "보드 조회").
 *
 * Everything here runs through the **user session** (RLS = ownership): another user's document,
 * chat or evidence simply isn't returned. Nothing is written and nothing is logged (NFR-PRV-09).
 *
 * Why this matters (QA follow-up 2026-11-09): without a read of the 정본 row, S-46 always opened
 * in 문항 설정 상태, so re-opening a written 자기소개서 showed the three default questions and the
 * first [자기소개서 작성 시작] saved them **without an expected version** — overwriting the stored
 * answers. `getApplicationDocument` is what lets the screen open in 작성 상태 and send
 * `expectedUpdatedAt = updated_at`.
 */

/** Every column the screen uses (DM 2.7.3). `body` / `meta` are the stored jsonb as is. */
const DOCUMENT_COLUMNS = "id, user_id, created_at, updated_at, application_project_id, document_kind, body, meta, filled_slot_count, slot_count, first_copied_at";

function isDocumentKind(v: string): v is ApplicationDocumentKind {
  return (APPLICATION_DOCUMENT_KINDS as readonly string[]).includes(v);
}

/**
 * S-46 정본 1행 (DM 7장 25행): `where application_project_id = ? and document_kind = ?`.
 * `null` = no row yet → 문항 설정 상태 (the row is made by the first save, DM 2.5.1).
 * `updated_at` is the next save's `expectedUpdatedAt`.
 */
export async function getApplicationDocument(
  supabase: UserSupabaseClient,
  applicationProjectId: string,
  documentKind: ApplicationDocumentKind = "cover_letter",
): Promise<ApplicationDocument | null> {
  const { data, error } = await supabase
    .from("application_documents")
    .select(DOCUMENT_COLUMNS)
    .eq("application_project_id", applicationProjectId)
    .eq("document_kind", documentKind)
    .maybeSingle();
  if (error) throw mapDbError(error);
  if (!data) return null;
  if (!isDocumentKind(data.document_kind)) throw new AppError("internal_error", undefined, { status: 500 });
  return {
    id: data.id,
    user_id: data.user_id,
    created_at: data.created_at,
    updated_at: data.updated_at,
    application_project_id: data.application_project_id,
    document_kind: data.document_kind,
    // The save RPC owns this shape (DM 2.7.3); it is passed through, never rebuilt here.
    body: data.body as unknown as ApplicationDocument["body"],
    meta: data.meta as unknown as ApplicationDocument["meta"],
    filled_slot_count: data.filled_slot_count,
    // Generated column `jsonb_array_length(body -> 'questions')`; null only if `body` were null (it is not null).
    slot_count: data.slot_count ?? 0,
    first_copied_at: data.first_copied_at,
  };
}

/**
 * S-46 근거 (DM 7장 25행 `evidence_links` where `owner_type = 'application_document'`, `owner_id` =
 * that row), grouped by `item_key` — `{slot}.blocks.{block_id}` for a block's evidence and
 * `{slot}.sources.{n}` for a question's sources (CF-S1). Each list is in `sort_order`.
 *
 * Reuses the shared chip read (`loadEvidenceChips`), so the 변경됨 / 삭제됨 state follows the same
 * rule as insights. A plain record (not a `Map`) so it crosses the Server Action boundary.
 */
export async function listApplicationDocumentEvidence(supabase: UserSupabaseClient, applicationDocumentId: string): Promise<Record<string, EvidenceChip[]>> {
  const byOwner = await loadEvidenceChips(supabase, { ownerType: "application_document", ownerIds: [applicationDocumentId] });
  return Object.fromEntries(byOwner.get(applicationDocumentId) ?? new Map<string, EvidenceChip[]>());
}

export type DocumentSlotCounts = { slot_count: number; filled_slot_count: number };

/**
 * S-39 카드 "자소서 작성 중 / 작성됨" (DM 7장 33행, 2.7.3): every 자기소개서 of the user, keyed by
 * `application_project_id`. No argument — RLS decides the range.
 *
 * Reads the two count columns only, **never `body`** (that is why `slot_count` is a generated
 * column, 2.7.3). The card rule is the screen's: none = no row or `filled = 0`; 작성 중 =
 * `0 < filled < slot`; 작성됨 = `filled = slot`, `slot > 0`.
 *
 * `loadDocumentCounts` (0 / 1, `progress.ts`) stays for its existing callers.
 */
export async function listDocumentSlotCounts(
  supabase: UserSupabaseClient,
  documentKind: ApplicationDocumentKind = "cover_letter",
): Promise<Record<string, DocumentSlotCounts>> {
  const { data, error } = await supabase
    .from("application_documents")
    .select("application_project_id, slot_count, filled_slot_count")
    .eq("document_kind", documentKind);
  if (error) throw mapDbError(error);
  const out: Record<string, DocumentSlotCounts> = {};
  for (const r of data ?? []) out[r.application_project_id] = { slot_count: r.slot_count ?? 0, filled_slot_count: r.filled_slot_count };
  return out;
}
