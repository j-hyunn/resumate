"use server";

import { z } from "zod";
import { GetInsightInput, StartInsightInput, type InsightView, type StartInsightResponse } from "@/lib/contracts/insight";
import { AppError, invalid, runAction, type ActionResult } from "@/lib/contracts/errors";
import { getSiteOrigin } from "@/server/auth/site-url";
import { requireConsentedUser } from "@/server/auth/session";
import { createAppJobRunner } from "@/server/jobs/app-runner";
import { connections } from "@/server/jobs/connections";
import { productionInsightPipeline } from "@/server/jobs/insight";
import { getInsight as readInsight } from "@/server/services/insight/read";
import { INSUFFICIENT_DATA_MESSAGE, startInsight as startInsightRun } from "@/server/services/insight/start";

/**
 * S6 insight read (S-16; F-P2-04/05/07/09, C-01/C-02/C-03/C-19/C-20). The
 * Server Component can call `services/insight/read.getInsight` directly at
 * wiring time; this action is the same read for client refreshes (after a job
 * finishes). Starting a run is the Route Handler
 * `POST /api/application-projects/{id}/insights`.
 */
export async function getInsight(input: unknown): Promise<ActionResult<InsightView>> {
  const parsed = GetInsightInput.safeParse(input);
  if (!parsed.success) return invalid(parsed.error);
  return runAction(async () => {
    const { supabase } = await requireConsentedUser();
    return readInsight(supabase, parsed.data, { pipeline: productionInsightPipeline });
  });
}

const StartInsightActionInput = z.object({ applicationProjectId: z.guid() }).extend(StartInsightInput.shape).strict();

/**
 * Same as `POST /api/application-projects/{id}/insights` for the wired S-16 button (W3). 422
 * `insufficient_data` keeps the readiness in `details` (C-10).
 */
export async function startInsight(input: unknown): Promise<ActionResult<StartInsightResponse>> {
  const parsed = StartInsightActionInput.safeParse(input);
  if (!parsed.success) return invalid(parsed.error);
  return runAction(async () => {
    const { supabase, user } = await requireConsentedUser();
    const outcome = await startInsightRun(
      {
        userId: user.id,
        user: supabase,
        providerContext: connections().context,
        runner: createAppJobRunner(await getSiteOrigin()),
        pipeline: productionInsightPipeline,
      },
      parsed.data.applicationProjectId,
      { regenerate: parsed.data.regenerate },
    );
    if (outcome.kind === "insufficient_data") throw new AppError("insufficient_data", INSUFFICIENT_DATA_MESSAGE, { status: 422, details: { readiness: outcome.readiness } });
    return outcome.data;
  });
}
