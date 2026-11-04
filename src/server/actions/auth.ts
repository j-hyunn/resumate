"use server";

import {
  SignInWithGoogleInput,
  type SignInWithGoogleResult,
  type SignOutResult,
} from "@/lib/contracts/auth";
import { invalid, runAction, type ActionResult } from "@/lib/contracts/errors";
import { getSiteOrigin } from "@/server/auth/site-url";
import { clearUserScopedCookies } from "@/server/auth/user-cookies";
import { createSupabaseServerClient } from "@/server/db/server";
import * as auth from "@/server/services/auth";

/** S-02 Google button — the only sign-in method (F-COM-01, D-09 변경). The client navigates to `data.url`. */
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
    try {
      await auth.signOut(supabase);
    } finally {
      // QA-W5-02: per-user app cookies (W3-2 pending generation) don't outlive the session.
      await clearUserScopedCookies();
    }
    return { signedOut: true as const };
  });
}
