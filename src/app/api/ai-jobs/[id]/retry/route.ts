import { AiJobIdSchema } from "@/lib/contracts/ai";
import { AppError, errorResponse } from "@/lib/contracts/errors";
import { getSiteOrigin } from "@/server/auth/site-url";
import { requireConsentedUser } from "@/server/auth/session";
import { createAppJobRunner } from "@/server/jobs/app-runner";

/** The job's first step runs in this request's after(). */
export const maxDuration = 60;

/**
 * `POST /api/ai-jobs/{id}/retry` — 재시도 버튼 on a failed job (ST-AI-FAILED).
 * Resumes from the failed step with the job's fixed provider (completed steps kept, C-6);
 * the new run gets fresh C-11.3 retry counts and wait budget. If another job on the same
 * target is in flight, that job is returned (`inProgress: true`).
 * Input-category failures (`input_too_long`, `safety_blocked`, `insufficient_data`, `not_a_jd`) → 409 `ai_job_not_retryable`.
 */
export async function POST(_request: Request, ctx: RouteContext<"/api/ai-jobs/[id]/retry">) {
  try {
    const { id } = await ctx.params;
    if (!AiJobIdSchema.safeParse(id).success) throw new AppError("not_found");
    const { user } = await requireConsentedUser();
    const runner = createAppJobRunner(await getSiteOrigin());
    const started = await runner.retryJob({ jobId: id, userId: user.id });
    return Response.json({ data: started }, { status: 202, headers: { "Cache-Control": "private, no-store" } });
  } catch (err) {
    return errorResponse(err);
  }
}
