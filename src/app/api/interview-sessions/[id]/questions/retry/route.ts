import { z } from "zod";
import { AppError, errorResponse } from "@/lib/contracts/errors";
import { requireConsentedUser } from "@/server/auth/session";
import { interviewStartDeps } from "@/server/interview-routes";
import { retryInterviewQuestions } from "@/server/services/interview/start";

/** The started job's first step may run in this request's after() (C-6). */
export const maxDuration = 60;

/**
 * `POST /api/interview-sessions/{id}/questions/retry` — 남은 질문 다시 만들기 (S-33, AI-05).
 * Only while generation failed; saved questions stay and only the rest is made.
 * 200 `{ data: RetryInterviewQuestionsResponse }`; 409 `interview_generation_not_failed` /
 * connection codes; 404, 401.
 */
export async function POST(_request: Request, ctx: RouteContext<"/api/interview-sessions/[id]/questions/retry">) {
  try {
    const { id } = await ctx.params;
    if (!z.guid().safeParse(id).success) throw new AppError("not_found");
    const { supabase, user } = await requireConsentedUser();
    const data = await retryInterviewQuestions(await interviewStartDeps(supabase, user.id), id);
    return Response.json({ data }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (err) {
    return errorResponse(err);
  }
}
