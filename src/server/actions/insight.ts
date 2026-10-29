"use server";

import { GetInsightInput, type InsightView } from "@/lib/contracts/insight";
import { invalid, runAction, type ActionResult } from "@/lib/contracts/errors";
import { requireConsentedUser } from "@/server/auth/session";
import { productionInsightPipeline } from "@/server/jobs/insight";
import { getInsight as readInsight } from "@/server/services/insight/read";

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
