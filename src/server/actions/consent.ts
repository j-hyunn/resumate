"use server";

import { headers } from "next/headers";
import { SubmitConsentsInput, WithdrawConsentInput, type ConsentStatus, type SubmitConsentsResult } from "@/lib/contracts/consent";
import { invalid, runAction, type ActionResult } from "@/lib/contracts/errors";
import { safeNextPath } from "@/lib/contracts/routes";
import { requireUser } from "@/server/auth/session";
import * as consent from "@/server/services/consent";

/** S-03 / S-24: current consent state (F-COM-02). */
export async function getConsentStatus(): Promise<ActionResult<ConsentStatus>> {
  return runAction(async () => {
    const { supabase } = await requireUser();
    return consent.getConsentStatus(supabase);
  });
}

/**
 * S-03 submit. `next` is the path the user was headed to (from `?next=`);
 * the response's `redirectTo` is that path when safe, else S-08.
 */
export async function submitConsents(input: unknown, next?: string | null): Promise<ActionResult<SubmitConsentsResult>> {
  const parsed = SubmitConsentsInput.safeParse(input);
  if (!parsed.success) return invalid(parsed.error);
  return runAction(async () => {
    const { supabase } = await requireUser();
    const userAgent = (await headers()).get("user-agent");
    const status = await consent.submitConsents(supabase, parsed.data.items, userAgent);
    return { status, redirectTo: safeNextPath(next) };
  });
}

/** S-24: withdraw an optional consent (service_improvement, marketing). */
export async function withdrawConsent(input: unknown): Promise<ActionResult<ConsentStatus>> {
  const parsed = WithdrawConsentInput.safeParse(input);
  if (!parsed.success) return invalid(parsed.error);
  return runAction(async () => {
    const { supabase } = await requireUser();
    return consent.withdrawOptionalConsent(supabase, parsed.data.consentType);
  });
}
