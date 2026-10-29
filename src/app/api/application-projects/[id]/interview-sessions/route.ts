import { z } from "zod";
import { AppError, errorResponse } from "@/lib/contracts/errors";
import { StartInterviewSessionInput, type InterviewInsufficientDataResponse } from "@/lib/contracts/interview";
import { requireConsentedUser } from "@/server/auth/session";
import { interviewStartDeps } from "@/server/interview-routes";
import { readJsonBody } from "@/server/request-body";
import { INTERVIEW_INSUFFICIENT_DATA_MESSAGE, startInterviewSession } from "@/server/services/interview/start";

/** The job's first step may run in this request's after() (prepare → D-30 extraction, C-6). */
export const maxDuration = 60;

/**
 * `POST /api/application-projects/{id}/interview-sessions` — S-20 시작하기
 * (AI-05 async job, F-P3-01/02/13, D-30). Body `{ interviewType, questionCount? }`.
 *
 * 200 `{ data: StartInterviewSessionResponse }` → S-33, poll `GET /api/ai-jobs/{jobId}`.
 * 422 `{ error: insufficient_data, readiness }` (직무 only), 409 `interview_in_progress`
 * (`error.details.sessionId`), 409 `ai_not_connected` / `key_invalid` / `ai_consent_required`,
 * 404, 401, 400.
 */
export async function POST(request: Request, ctx: RouteContext<"/api/application-projects/[id]/interview-sessions">) {
  try {
    const { id } = await ctx.params;
    if (!z.guid().safeParse(id).success) throw new AppError("not_found");
    const parsed = StartInterviewSessionInput.safeParse(await readJsonBody(request));
    if (!parsed.success) throw new AppError("invalid_input");
    const { supabase, user } = await requireConsentedUser();
    const outcome = await startInterviewSession(await interviewStartDeps(supabase, user.id), id, parsed.data);
    if (outcome.kind === "insufficient_data") {
      const body: InterviewInsufficientDataResponse = { error: { code: "insufficient_data", message: INTERVIEW_INSUFFICIENT_DATA_MESSAGE }, readiness: outcome.readiness };
      return Response.json(body, { status: 422 });
    }
    return Response.json({ data: outcome.data }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (err) {
    return errorResponse(err);
  }
}
