import "server-only";
import type { User } from "@supabase/supabase-js";
import { redirect } from "next/navigation";
import { AppError, isAppError } from "@/lib/contracts/errors";
import { ROUTES, withNext } from "@/lib/contracts/routes";
import { createSupabaseServerClient, type UserSupabaseClient } from "@/server/db/server";
import { getConsentStatus } from "@/server/services/consent";

/** What actions and handlers pass to services: the user-session client and the verified user. */
export type AuthContext = { supabase: UserSupabaseClient; user: User };

/**
 * Verifies the session with the Auth server (`getUser`, not `getSession`) and
 * returns the session client. Throws `unauthenticated` when signed out.
 */
export async function requireUser(): Promise<AuthContext> {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.auth.getUser();
  if (error || !data.user) throw new AppError("unauthenticated");
  return { supabase, user: data.user };
}

/**
 * requireUser + the F-COM-02 consent gate. Throws `consent_required` (403)
 * when a required consent is missing or outdated. For Server Actions and
 * Route Handlers that act on user data.
 */
export async function requireConsentedUser(): Promise<AuthContext> {
  const ctx = await requireUser();
  const status = await getConsentStatus(ctx.supabase);
  if (status.needsRequiredConsent) {
    throw new AppError("consent_required", "서비스 이용을 위해 필수 약관에 동의해 주세요.", { status: 403 });
  }
  return ctx;
}

/**
 * For signed-in pages (the UI's dashboard layout calls this at wiring time):
 * redirects to S-02 when signed out and to S-03 when consent is needed.
 * `currentPath` is where the user should land afterwards.
 */
export async function requireConsentedUserOrRedirect(currentPath: string): Promise<AuthContext> {
  let ctx: AuthContext;
  try {
    ctx = await requireUser();
  } catch (err) {
    // Only "signed out" goes to login (QA-07). Anything else (env, network,
    // Auth outage) is a real failure for the error boundary, not a login loop.
    if (isAppError(err) && err.code === "unauthenticated") redirect(withNext(ROUTES.login, currentPath));
    throw err;
  }
  const status = await getConsentStatus(ctx.supabase);
  if (status.needsRequiredConsent) redirect(withNext(ROUTES.consent, currentPath));
  return ctx;
}
