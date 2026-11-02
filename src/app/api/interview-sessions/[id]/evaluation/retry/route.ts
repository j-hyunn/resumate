import { z } from "zod";
import { AppError, errorResponse } from "@/lib/contracts/errors";
import { requireConsentedUser } from "@/server/auth/session";
import { interviewStartDeps } from "@/server/interview-routes";
import { retryInterviewEvaluation } from "@/server/services/interview/start";

/** The started job's first step may run in this request's after() (C-6). */
export const maxDuration = 60;

/**
 * `POST /api/interview-sessions/{id}/evaluation/retry` — 다시 채점 (S-22, AI-06/07).
 * Only for `evaluation_failed`, or `completed` with `not_scored` answers.
 * 200 `{ data: RetryInterviewEvaluationResponse }`; 409 `interview_evaluation_not_retryable` /
 * connection codes; 404, 401.
 */
export async function POST(_request: Request, ctx: RouteContext<"/api/interview-sessions/[id]/evaluation/retry">) {
  try {
    const { id } = await ctx.params;
    if (!z.guid().safeParse(id).success) throw new AppError("not_found");
    const { supabase, user } = await requireConsentedUser();
    const data = await retryInterviewEvaluation(await interviewStartDeps(supabase, user.id), id);
    return Response.json({ data }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (err) {
    return errorResponse(err);
  }
}
