"use server";

import { invalid, runAction, type ActionResult } from "@/lib/contracts/errors";
import {
  SaveProfileBasicsInput,
  type ProfileBasicsViewDto,
  type SaveProfileBasicsResult,
} from "@/lib/contracts/profile";
import { requireConsentedUser } from "@/server/auth/session";
import * as profile from "@/server/services/profile";

/**
 * 설정 "내 정보" (S-24 ① 계정 탭, DM 2.1.1·2.1.2·§7, R13). Read = profiles +
 * profile_job_interests + profile_options; write = RPC `save_profile_basics`
 * (섹션 전체 덮어쓰기, 기대 버전 `expectedUpdatedAt` → `stale_write` 409).
 */

/** S-24 ① read (DM §7 "내 정보 조회"). */
export async function getProfileBasics(): Promise<ActionResult<ProfileBasicsViewDto>> {
  return runAction(async () => {
    const { supabase, user } = await requireConsentedUser();
    return profile.getProfileBasicsView(supabase, user);
  });
}

/** S-24 ① [저장] (DM §7 "내 정보 저장"). Returns the new 기대 버전. */
export async function saveProfileBasics(input: unknown): Promise<ActionResult<SaveProfileBasicsResult>> {
  const parsed = SaveProfileBasicsInput.safeParse(input);
  if (!parsed.success) return invalid(parsed.error);
  return runAction(async () => {
    const { supabase } = await requireConsentedUser();
    return profile.saveProfileBasics(supabase, parsed.data);
  });
}
