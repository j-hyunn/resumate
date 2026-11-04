import { AppError, errorResponse } from "@/lib/contracts/errors";
import { getServerEnv } from "@/server/env";
import { isCronAuthorized } from "@/server/jobs/cron";
import { runInactiveAccountsCron } from "@/server/jobs/inactive-accounts";
import { runRetentionCron } from "@/server/jobs/retention";
import { createServiceRoleClient, deleteAuthUser } from "@/server/jobs/service-role";
import { createGmailSender } from "@/server/mail/gmail";

/** QA-W5-05: same ceiling as the job routes (Fluid compute assumed; see vercel.json). */
export const maxDuration = 60;

function log(event: string, fields: Record<string, unknown>): void {
  console.info(JSON.stringify({ event, ...fields }));
}

/**
 * Vercel Cron (`Authorization: Bearer <CRON_SECRET>`), daily: retention purges
 * across all users (NFR-PRV-06, DM §4.4), then inactive account notices and
 * deletions (privacy policy 2026-11-04 §4). Logs and returns counts only.
 * Each part runs even if the other fails; the run fails if either did.
 */
export async function GET(request: Request) {
  try {
    const env = getServerEnv();
    if (!isCronAuthorized(request.headers.get("authorization"), env.CRON_SECRET)) {
      throw new AppError("unauthenticated");
    }
    const admin = createServiceRoleClient("resumate-cron-retention");
    const now = new Date();
    let firstError: unknown;
    const retention = await runRetentionCron(admin, now, log).catch((err: unknown) => {
      firstError ??= err;
      return null;
    });
    const inactiveAccounts = await runInactiveAccountsCron(
      {
        admin,
        createMailer: () => createGmailSender({ user: env.GMAIL_SMTP_USER, appPassword: env.GMAIL_SMTP_APP_PASSWORD }),
        hashSecret: env.ACCOUNT_DELETION_HASH_SECRET,
        siteOrigin: env.NEXT_PUBLIC_SITE_URL ? new URL(env.NEXT_PUBLIC_SITE_URL).origin : new URL(request.url).origin,
        deleteAuthUser: (userId) => deleteAuthUser(userId, admin),
        log,
      },
      now,
    ).catch((err: unknown) => {
      firstError ??= err;
      return null;
    });
    if (firstError) throw firstError;
    return Response.json({ data: { ...retention, inactiveAccounts } }, { headers: { "Cache-Control": "no-store" } });
  } catch (err) {
    return errorResponse(err);
  }
}
