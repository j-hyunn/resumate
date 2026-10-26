import { AiJobIdSchema } from "@/lib/contracts/ai";
import { AppError, errorResponse } from "@/lib/contracts/errors";
import { getSiteOrigin } from "@/server/auth/site-url";
import { requireConsentedUser } from "@/server/auth/session";
import { createAppJobRunner } from "@/server/jobs/app-runner";
import { toAiJobStatusResponse } from "@/server/jobs/status";

/** The continuation fallback may run a job step in this request's after(). */
export const maxDuration = 60;

/**
 * `GET /api/ai-jobs/{id}` — async job status for `useAiJob` (C-6, 2초 폴링).
 * Lazily fails a stalled job (+ releases usage) and resumes a yielded job whose
 * continuation was lost.
 */
export async function GET(_request: Request, ctx: RouteContext<"/api/ai-jobs/[id]">) {
  try {
    const { id } = await ctx.params;
    if (!AiJobIdSchema.safeParse(id).success) throw new AppError("not_found");
    const { user } = await requireConsentedUser();
    const runner = createAppJobRunner(await getSiteOrigin());
    const job = await runner.getStatus({ jobId: id, userId: user.id });
    return Response.json({ data: toAiJobStatusResponse(job) }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (err) {
    return errorResponse(err);
  }
}
