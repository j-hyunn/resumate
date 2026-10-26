import { AppError, errorResponse } from "@/lib/contracts/errors";
import { getServerEnv } from "@/server/env";
import { isCronAuthorized, sweepStalledJobs } from "@/server/jobs/stalled-sweep";

/**
 * Vercel Cron: fail AI jobs whose heartbeat stopped (C-6 `stalled`) and
 * release their usage, across all users. `Authorization: Bearer <CRON_SECRET>`.
 */
export async function GET(request: Request) {
  try {
    if (!isCronAuthorized(request.headers.get("authorization"), getServerEnv().CRON_SECRET)) {
      throw new AppError("unauthenticated");
    }
    const result = await sweepStalledJobs();
    console.info(JSON.stringify({ event: "cron.stalled_jobs", failed: result.failed }));
    return Response.json({ data: result }, { headers: { "Cache-Control": "no-store" } });
  } catch (err) {
    return errorResponse(err);
  }
}
