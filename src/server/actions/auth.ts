"use server";

import {
  SendMagicLinkInput,
  SignInWithGoogleInput,
  type SendMagicLinkResult,
  type SignInWithGoogleResult,
  type SignOutResult,
} from "@/lib/contracts/auth";
import { invalid, runAction, type ActionResult } from "@/lib/contracts/errors";
import { getSiteOrigin } from "@/server/auth/site-url";
import { createSupabaseServerClient } from "@/server/db/server";
import * as auth from "@/server/services/auth";

/** S-02 (F-COM-01). Also used for "재발송" — same call, Supabase rate limit maps to auth_rate_limited. */
export async function sendMagicLink(input: unknown): Promise<ActionResult<SendMagicLinkResult>> {
  const parsed = SendMagicLinkInput.safeParse(input);
  if (!parsed.success) return invalid(parsed.error);
  return runAction(async () => {
    const supabase = await createSupabaseServerClient();
    return auth.sendMagicLink(supabase, parsed.data, await getSiteOrigin());
  });
}

/** S-02 Google button. The client navigates to `data.url`. */
export async function signInWithGoogle(input: unknown): Promise<ActionResult<SignInWithGoogleResult>> {
  const parsed = SignInWithGoogleInput.safeParse(input ?? {});
  if (!parsed.success) return invalid(parsed.error);
  return runAction(async () => {
    const supabase = await createSupabaseServerClient();
    return auth.startGoogleSignIn(supabase, parsed.data, await getSiteOrigin());
  });
}

export async function signOut(): Promise<ActionResult<SignOutResult>> {
  return runAction(async () => {
    const supabase = await createSupabaseServerClient();
    await auth.signOut(supabase);
    return { signedOut: true as const };
  });
}
