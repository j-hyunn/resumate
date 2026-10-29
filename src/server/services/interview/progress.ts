import { mapDbError } from "@/server/db/errors";
import type { UserSupabaseClient } from "@/server/db/types";

/**
 * S-13 / S-39 / S-31 기능 진행 (plan "계약 — API" 5): per project the number
 * of interview sessions (abandoned ones included — they stay listed, F-P3-15)
 * and whether one is `in_progress` (작성 중).
 */
export async function loadInterviewProgress(
  user: UserSupabaseClient,
  ids: readonly string[],
): Promise<Map<string, { interviewCount: number; interviewInProgress: boolean }>> {
  const out = new Map<string, { interviewCount: number; interviewInProgress: boolean }>();
  if (ids.length === 0) return out;
  const { data, error } = await user.from("interview_sessions").select("application_project_id, status").in("application_project_id", [...new Set(ids)]);
  if (error) throw mapDbError(error);
  for (const row of data ?? []) {
    const cur = out.get(row.application_project_id) ?? { interviewCount: 0, interviewInProgress: false };
    cur.interviewCount += 1;
    if (row.status === "in_progress") cur.interviewInProgress = true;
    out.set(row.application_project_id, cur);
  }
  return out;
}
