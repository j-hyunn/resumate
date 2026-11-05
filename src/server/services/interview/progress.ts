import { mapDbError } from "@/server/db/errors";
import type { UserSupabaseClient } from "@/server/db/types";

export type InterviewProgress = { interviewCount: number; interviewInProgress: boolean };

/**
 * "면접 세션 수" (S-13 · S-31 · S-39, Q53-9): an abandoned session with no saved
 * question isn't counted (02 S-20 / S-37 "질문 0개 그만둔 세션 … 면접 수 제외").
 * Same rule as `countsAsInterview` in `src/lib/data/labels.ts` (mock and S-31).
 */
export function countsTowardInterviews(status: string, savedQuestions: number): boolean {
  return !(status === "abandoned" && savedQuestions === 0);
}

/** Pure fold over session rows + per-session saved question counts (unit-tested). */
export function foldInterviewProgress(
  sessions: readonly { application_project_id: string | null; status: string; id: string }[],
  savedQuestions: ReadonlyMap<string, number>,
): Map<string, InterviewProgress> {
  const out = new Map<string, InterviewProgress>();
  for (const row of sessions) {
    // R11 OD-I6: a detached session (project deleted) belongs to no project's progress.
    if (row.application_project_id === null) continue;
    const cur = out.get(row.application_project_id) ?? { interviewCount: 0, interviewInProgress: false };
    if (countsTowardInterviews(row.status, savedQuestions.get(row.id) ?? 0)) cur.interviewCount += 1;
    if (row.status === "in_progress") cur.interviewInProgress = true;
    out.set(row.application_project_id, cur);
  }
  return out;
}

/**
 * S-13 / S-39 / S-31 기능 진행 (plan "계약 — API" 5): per project the number
 * of interview sessions (abandoned ones with ≥1 saved question included — they
 * stay listed, F-P3-15; abandoned 0-question ones excluded, Q53-9) and whether
 * one is `in_progress` (작성 중).
 */
export async function loadInterviewProgress(user: UserSupabaseClient, ids: readonly string[]): Promise<Map<string, InterviewProgress>> {
  if (ids.length === 0) return new Map();
  const { data, error } = await user.from("interview_sessions").select("id, application_project_id, status").in("application_project_id", [...new Set(ids)]);
  if (error) throw mapDbError(error);
  const sessions = data ?? [];
  // Only abandoned sessions need their question count (the others always count).
  const abandoned = sessions.filter((s) => s.status === "abandoned").map((s) => s.id);
  const counts = new Map<string, number>();
  if (abandoned.length > 0) {
    const q = await user.from("interview_questions").select("session_id").in("session_id", abandoned);
    if (q.error) throw mapDbError(q.error);
    for (const row of q.data ?? []) counts.set(row.session_id, (counts.get(row.session_id) ?? 0) + 1);
  }
  return foldInterviewProgress(sessions, counts);
}
