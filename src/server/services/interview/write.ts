import { AppError } from "@/lib/contracts/errors";
import type {
  AbandonInterviewSessionResult,
  DeleteInterviewSessionResult,
  InterviewSessionStatus,
  MarkInterviewResultViewedResult,
  SaveInterviewAnswerResult,
} from "@/lib/contracts/interview";
import { INTERVIEW_SESSION_STATUSES } from "@/lib/contracts/interview";
import { mapDbError } from "@/server/db/errors";
import type { UserSupabaseClient } from "@/server/db/types";

/**
 * S8 Server Action services (no key needed, plan "계약 — API" 3): answer
 * auto-save (RLS-guarded update of `answer_text` only), abandon (RPC; cancels
 * a running generation), delete (RLS delete of any session, F-P3-15 [가정 4];
 * the delete trigger cancels its jobs), mark result viewed (RPC).
 */

const answerNotFound = () => new AppError("not_found", "답변을 찾을 수 없습니다. 새로고침 후 다시 시도해 주세요.", { status: 404 });
const sessionNotFound = () => new AppError("not_found", "면접 세션을 찾을 수 없습니다. 새로고침 후 다시 시도해 주세요.", { status: 404 });

const statusOf = (v: unknown): InterviewSessionStatus =>
  typeof v === "string" && (INTERVIEW_SESSION_STATUSES as readonly string[]).includes(v) ? (v as InterviewSessionStatus) : "in_progress";

/**
 * S-33 자동 저장. The RLS policy filters rows outside the edit condition
 * (answer `draft` + session `in_progress`, not submitted, generation `ready`),
 * so 0 updated rows → read why and answer with a specific 409.
 */
export async function saveInterviewAnswer(user: UserSupabaseClient, input: { answerId: string; answerText: string }): Promise<SaveInterviewAnswerResult> {
  const { data, error } = await user.from("interview_answers").update({ answer_text: input.answerText }).eq("id", input.answerId).select("id, session_id, updated_at");
  if (error) throw mapDbError(error);
  const row = data?.[0];
  if (!row) throw await whyNotEditable(user, input.answerId);
  const { data: session, error: sError } = await user.from("interview_sessions").select("answered_count, last_activity_at").eq("id", row.session_id).maybeSingle();
  if (sError) throw mapDbError(sError);
  return {
    answerId: row.id,
    sessionId: row.session_id,
    updatedAt: row.updated_at,
    answeredCount: session?.answered_count ?? 0,
    lastActivityAt: session?.last_activity_at ?? null,
  };
}

async function whyNotEditable(user: UserSupabaseClient, answerId: string): Promise<AppError> {
  const { data: answer, error } = await user.from("interview_answers").select("id, session_id, status").eq("id", answerId).maybeSingle();
  if (error) return mapDbError(error);
  if (!answer) return answerNotFound();
  const { data: session, error: sError } = await user.from("interview_sessions").select("status, generation_status, submitted_at").eq("id", answer.session_id).maybeSingle();
  if (sError) return mapDbError(sError);
  if (!session) return answerNotFound();
  if (session.submitted_at || answer.status !== "draft") return new AppError("interview_already_submitted", "이미 제출한 면접이에요. 결과 화면에서 확인해 주세요.", { status: 409 });
  if (session.status !== "in_progress") return new AppError("interview_not_in_progress", "이미 제출했거나 그만둔 면접이에요.", { status: 409 });
  if (session.generation_status !== "ready") return new AppError("interview_not_ready", "질문을 모두 만든 뒤에 답변을 쓸 수 있어요.", { status: 409 });
  return new AppError("conflict");
}

export async function abandonInterviewSession(user: UserSupabaseClient, input: { sessionId: string }): Promise<AbandonInterviewSessionResult> {
  const { data, error } = await user.rpc("abandon_interview_session", { p_session_id: input.sessionId });
  if (error) throw mapDbError(error);
  const r = (data ?? {}) as { session_id?: string; status?: string; abandoned_at?: string | null };
  return { sessionId: r.session_id ?? input.sessionId, status: statusOf(r.status ?? "abandoned"), abandonedAt: r.abandoned_at ?? null };
}

export async function deleteInterviewSession(user: UserSupabaseClient, input: { sessionId: string }): Promise<DeleteInterviewSessionResult> {
  const { data, error } = await user.from("interview_sessions").delete().eq("id", input.sessionId).select("id");
  if (error) throw mapDbError(error);
  if (!data || data.length === 0) throw sessionNotFound();
  return { sessionId: input.sessionId, deleted: true };
}

export async function markInterviewResultViewed(user: UserSupabaseClient, input: { sessionId: string }): Promise<MarkInterviewResultViewedResult> {
  const { data, error } = await user.rpc("mark_interview_result_viewed", { p_session_id: input.sessionId });
  if (error) throw mapDbError(error);
  const r = (data ?? {}) as { session_id?: string; result_viewed_at?: string | null };
  return { sessionId: r.session_id ?? input.sessionId, resultViewedAt: r.result_viewed_at ?? null };
}
