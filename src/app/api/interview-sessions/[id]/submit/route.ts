import { z } from "zod";
import { AppError, errorResponse } from "@/lib/contracts/errors";
import { requireConsentedUser } from "@/server/auth/session";
import { interviewStartDeps } from "@/server/interview-routes";
import { submitInterviewSession } from "@/server/services/interview/start";

/** The started job's first step may run in this request's after() (C-6). */
export const maxDuration = 60;

/**
 * `POST /api/interview-sessions/{id}/submit` — 1회 제출 (S-33, F-P3-04; v5 key needed).
 * 200 `{ data: SubmitInterviewSessionResponse }` (`jobId: null` when nothing was answered);
 * 409 `interview_already_submitted` / `interview_not_ready` / `interview_not_in_progress` /
 * connection codes; 404, 401.
 */
export async function POST(_request: Request, ctx: RouteContext<"/api/interview-sessions/[id]/submit">) {
  try {
    const { id } = await ctx.params;
    if (!z.guid().safeParse(id).success) throw new AppError("not_found");
    const { supabase, user } = await requireConsentedUser();
    const data = await submitInterviewSession(await interviewStartDeps(supabase, user.id), id);
    return Response.json({ data }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (err) {
    return errorResponse(err);
  }
}
