"use server";

import type { UsageSummary } from "@/lib/contracts/ai";
import { runAction, type ActionResult } from "@/lib/contracts/errors";
import { requireConsentedUser } from "@/server/auth/session";
import * as usage from "@/server/services/usage";

/** This month's usage per feature (D-17). Screens show "이번 달 {N}회 남음". */
export async function getUsageSummary(): Promise<ActionResult<UsageSummary>> {
  return runAction(async () => {
    const { supabase } = await requireConsentedUser();
    return usage.getUsageSummary(supabase);
  });
}
