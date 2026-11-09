import { mapDbError } from "@/server/db/errors";
import type { UserSupabaseClient } from "@/server/db/types";

/**
 * R15 (CF-A14, DM 2.7.3): the project's 서류 count, which is now **0 or 1** — one
 * `application_documents` row per `(application_project_id, document_kind)` and only
 * `cover_letter` exists (CF-1). A row with no written answer does not count
 * (`filled_slot_count > 0`, DM v4.13 (7) 셈법), so a project whose questions are set up but
 * unanswered still reads 0.
 *
 * Replaces `services/drafts/progress.ts` (`drafts` is dropped).
 */
export async function loadDocumentCounts(user: UserSupabaseClient, ids: readonly string[]): Promise<Map<string, number>> {
  const out = new Map<string, number>();
  if (ids.length === 0) return out;
  const { data, error } = await user
    .from("application_documents")
    .select("application_project_id, filled_slot_count")
    .in("application_project_id", [...new Set(ids)])
    .gt("filled_slot_count", 0);
  if (error) throw mapDbError(error);
  for (const r of data ?? []) out.set(r.application_project_id, (out.get(r.application_project_id) ?? 0) + 1);
  return out;
}
