import { AppError, errorResponse } from "@/lib/contracts/errors";
import { getSiteOrigin } from "@/server/auth/site-url";
import { getServerEnv } from "@/server/env";
import { selfInvokeContinue } from "@/server/jobs/app-runner";
import { isCronAuthorized, runAiJobsCron } from "@/server/jobs/cron";

/**
 * Vercel Cron (`Authorization: Bearer <CRON_SECRET>`), all users:
 * fails AI jobs whose heartbeat stopped (C-6 `stalled`) and wakes queued jobs
 * whose next_run_at has passed (C-11.3 retry / C-12 spacing; B-4 safety net —
 * the status poll is the main path). Each due job continues in its own invocation.
 */
export async function GET(request: Request) {
  try {
    if (!isCronAuthorized(request.headers.get("authorization"), getServerEnv().CRON_SECRET)) {
      throw new AppError("unauthenticated");
    }
    const origin = await getSiteOrigin();
    const result = await runAiJobsCron((ref) => selfInvokeContinue(origin, ref));
    console.info(JSON.stringify({ event: "cron.ai_jobs", ...result }));
    return Response.json({ data: result }, { headers: { "Cache-Control": "no-store" } });
  } catch (err) {
    return errorResponse(err);
  }
}
