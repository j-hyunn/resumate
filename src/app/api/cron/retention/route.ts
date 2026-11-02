import { AppError, errorResponse } from "@/lib/contracts/errors";
import { getServerEnv } from "@/server/env";
import { isCronAuthorized } from "@/server/jobs/cron";
import { runRetentionCron } from "@/server/jobs/retention";
import { createServiceRoleClient } from "@/server/jobs/service-role";

/** QA-W5-05: same ceiling as the job routes (Fluid compute assumed; see vercel.json). */
export const maxDuration = 60;

/**
 * Vercel Cron (`Authorization: Bearer <CRON_SECRET>`), daily: retention purges
 * across all users (NFR-PRV-06, DM §4.4). Logs and returns counts only.
 */
export async function GET(request: Request) {
  try {
    if (!isCronAuthorized(request.headers.get("authorization"), getServerEnv().CRON_SECRET)) {
      throw new AppError("unauthenticated");
    }
    const result = await runRetentionCron(createServiceRoleClient("resumate-cron-retention"), new Date(), (event, fields) =>
      console.info(JSON.stringify({ event, ...fields })),
    );
    return Response.json({ data: result }, { headers: { "Cache-Control": "no-store" } });
  } catch (err) {
    return errorResponse(err);
  }
}
