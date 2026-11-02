"use server";

import { GetAiUsageSummaryInputSchema, type AiUsageSummary } from "@/lib/contracts/ai";
import { invalid, runAction, type ActionResult } from "@/lib/contracts/errors";
import { requireConsentedUser } from "@/server/auth/session";
import * as usage from "@/server/services/usage";

/** Usage meter for one KST month (F-AI-07, S-42): by feature + by provider/tier, estimated USD. */
export async function getAiUsageSummary(input: unknown = {}): Promise<ActionResult<AiUsageSummary>> {
  const parsed = GetAiUsageSummaryInputSchema.safeParse(input ?? {});
  if (!parsed.success) return invalid(parsed.error);
  return runAction(async () => {
    const { supabase } = await requireConsentedUser();
    return usage.getAiUsageSummary(supabase, parsed.data);
  });
}
