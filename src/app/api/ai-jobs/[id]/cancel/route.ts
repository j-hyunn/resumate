import { AiJobIdSchema, type CancelAiJobResponse } from "@/lib/contracts/ai";
import type { AiJobStatus } from "@/lib/contracts/enums";
import { AppError, errorResponse } from "@/lib/contracts/errors";
import { getSiteOrigin } from "@/server/auth/site-url";
import { requireConsentedUser } from "@/server/auth/session";
import { createAppJobRunner } from "@/server/jobs/app-runner";
import { requestCancel } from "@/server/services/ai-jobs";

export const maxDuration = 60;

/**
 * `POST /api/ai-jobs/{id}/cancel` — the stop button (C-04 / C-03).
 * Sets cancel_requested_at through the user-session RPC; a running job stops
 * at its next heartbeat check, a queued job is finished as canceled here.
 * Usage is released either way.
 */
export async function POST(_request: Request, ctx: RouteContext<"/api/ai-jobs/[id]/cancel">) {
  try {
    const { id } = await ctx.params;
    if (!AiJobIdSchema.safeParse(id).success) throw new AppError("not_found");
    const { supabase, user } = await requireConsentedUser();
    const requested = await requestCancel(supabase, id);
    let status = requested.status as AiJobStatus;
    if (status === "queued") {
      const runner = createAppJobRunner(await getSiteOrigin());
      const job = await runner.settleCancelIfQueued({ jobId: id, userId: user.id });
      if (job) status = job.status;
    }
    const body: CancelAiJobResponse = { jobId: id, status, cancelRequested: true };
    return Response.json({ data: body }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (err) {
    return errorResponse(err);
  }
}
