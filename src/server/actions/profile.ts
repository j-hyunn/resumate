"use server";

import { invalid, runAction, type ActionResult } from "@/lib/contracts/errors";
import { UpdateProfileInput, type ProfileDto } from "@/lib/contracts/profile";
import { requireConsentedUser } from "@/server/auth/session";
import * as profile from "@/server/services/profile";

/** S-04 profile (DM A.1). */
export async function getProfile(): Promise<ActionResult<ProfileDto>> {
  return runAction(async () => {
    const { supabase, user } = await requireConsentedUser();
    return profile.getProfile(supabase, user);
  });
}

/** S-04 save. Only display_name, desired_job_title, total_years_of_experience, interested_industries. */
export async function updateProfile(input: unknown): Promise<ActionResult<ProfileDto>> {
  const parsed = UpdateProfileInput.safeParse(input);
  if (!parsed.success) return invalid(parsed.error);
  return runAction(async () => {
    const { supabase, user } = await requireConsentedUser();
    return profile.updateProfile(supabase, user, parsed.data);
  });
}
