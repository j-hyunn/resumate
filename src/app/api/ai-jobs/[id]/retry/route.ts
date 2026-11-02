import { AiJobIdSchema } from "@/lib/contracts/ai";
import { AppError, errorResponse } from "@/lib/contracts/errors";
import { getSiteOrigin } from "@/server/auth/site-url";
import { requireConsentedUser } from "@/server/auth/session";
import { createAppJobRunner } from "@/server/jobs/app-runner";

/** The job's first step runs in this request's after(). */
export const maxDuration = 60;

/**
 * `POST /api/ai-jobs/{id}/retry` — 재시도 버튼 on a failed job (ST-AI-FAILED).
 * Runs on the ACTIVE provider + tier at click time (C-11.4, A1 changed in R2): same
 * provider and tier → resumes from the failed step (completed steps kept, C-6); different →
 * starts over and overwrites every result row the job saved (`restarted: true`, R-63).
 * The new run gets fresh C-11.3 retry counts and wait budget. If another job on the same
 * target is in flight, that job is returned (`inProgress: true`).
 * Refusals (409, DM 2.11.7 path ②): `key_missing` (no active provider / key),
 * `ai_consent_required`, `key_invalid`; request-scoped job types → `ai_job_not_retryable`.
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
