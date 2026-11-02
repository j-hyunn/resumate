import { mapDbError } from "@/server/db/errors";
import type { UserSupabaseClient } from "@/server/db/types";

/**
 * S-13 / S-39 / S-31 기능 진행 "서류 초안 수" (DM §7 보드 조회 `drafts(수)`):
 * every drafts row of the project (career descriptions and cover letters, any status) [가정].
 */
export async function loadDraftCounts(user: UserSupabaseClient, ids: readonly string[]): Promise<Map<string, number>> {
  const out = new Map<string, number>();
  if (ids.length === 0) return out;
  const { data, error } = await user.from("drafts").select("application_project_id").in("application_project_id", [...new Set(ids)]);
  if (error) throw mapDbError(error);
  for (const r of data ?? []) out.set(r.application_project_id, (out.get(r.application_project_id) ?? 0) + 1);
  return out;
}
