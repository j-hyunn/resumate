import { AiJobIdSchema } from "@/lib/contracts/ai";
import { AppError, errorResponse } from "@/lib/contracts/errors";
import { getSiteOrigin } from "@/server/auth/site-url";
import { requireConsentedUser } from "@/server/auth/session";
import { createAppJobRunner } from "@/server/jobs/app-runner";

/** The job's first step runs in this request's after(). */
export const maxDuration = 60;

/**
 * `POST /api/ai-jobs/{id}/retry` — 재시도 버튼 on a failed job (ST-AI-FAILED).
 * Reserves usage again and resumes from the failed step (completed steps kept, C-6).
 * Input-category failures (`not_a_jd`, `insufficient_data`, `input_too_long`) → 409 `ai_job_not_retryable`.
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
