import "server-only";
import type { User } from "@supabase/supabase-js";
import { redirect } from "next/navigation";
import { AppError, isAppError } from "@/lib/contracts/errors";
import { ROUTES, withNext } from "@/lib/contracts/routes";
import { createSupabaseServerClient, type UserSupabaseClient } from "@/server/db/server";
import { accountDeletionIncomplete, accountProfileMissing } from "@/server/services/account/state";
import { getConsentStatus } from "@/server/services/consent";
import { loadAccountState } from "./account-state";

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
 * R1 A7: a half-deleted account (no profile + deletion log) is refused before the consent
 * gate with `account_deletion_incomplete` (403) — the screen goes to S-25 "탈퇴 마무리".
 * `profile_missing` [가정] → `account_profile_missing` (500).
 */
async function assertAccountActive(ctx: AuthContext): Promise<void> {
  const state = await loadAccountState(ctx.supabase, ctx.user.id);
  if (state === "deletion_incomplete") throw accountDeletionIncomplete();
  if (state === "profile_missing") throw accountProfileMissing();
}

/**
 * requireUser + the account state (R1 A7), WITHOUT the consent gate: for the S-03 / S-24
 * consent actions (QA-R1-02). A half-deleted account gets `account_deletion_incomplete`
 * (403) instead of writing new consent rows after its deletion request.
 */
export async function requireActiveUser(): Promise<AuthContext> {
  const ctx = await requireUser();
  await assertAccountActive(ctx);
  return ctx;
}

/**
 * requireUser + the account state (R1 A7) + the F-COM-02 consent gate. Throws
 * `account_deletion_incomplete` (403) for a half-deleted account, `consent_required`
 * (403) when a required consent is missing or outdated. For Server Actions and
 * Route Handlers that act on user data.
 */
export async function requireConsentedUser(): Promise<AuthContext> {
  const ctx = await requireUser();
  await assertAccountActive(ctx);
  const status = await getConsentStatus(ctx.supabase);
  if (status.needsRequiredConsent) {
    throw new AppError("consent_required", "서비스 이용을 위해 필수 약관에 동의해 주세요.", { status: 403 });
  }
  return ctx;
}

async function requireUserOrLogin(currentPath: string): Promise<AuthContext> {
  try {
    return await requireUser();
  } catch (err) {
    // Only "signed out" goes to login (QA-07). Anything else (env, network,
    // Auth outage) is a real failure for the error boundary, not a login loop.
    if (isAppError(err) && err.code === "unauthenticated") redirect(withNext(ROUTES.login, currentPath));
    throw err;
  }
}

/**
 * For signed-in pages (the UI's dashboard layout calls this at wiring time):
 * redirects to S-02 when signed out, to S-25 when the account deletion is
 * unfinished (R1 A7 — before the consent gate and the original URL), and to
 * S-03 when consent is needed. `currentPath` is where the user should land afterwards.
 */
export async function requireConsentedUserOrRedirect(currentPath: string): Promise<AuthContext> {
  const ctx = await requireUserOrLogin(currentPath);
  const state = await loadAccountState(ctx.supabase, ctx.user.id);
  if (state === "deletion_incomplete") redirect(ROUTES.accountDeletion);
  if (state === "profile_missing") throw accountProfileMissing();
  const status = await getConsentStatus(ctx.supabase);
  if (status.needsRequiredConsent) redirect(withNext(ROUTES.consent, currentPath));
  return ctx;
}

/**
 * S-25 page (R1 A7): OUTSIDE the consent gate — signed-in only, so a half-deleted account
 * (consents already gone) can open it. Returns the account state for the screen:
 * `deletion_incomplete` → only "탈퇴 마무리하기" + 로그아웃.
 */
export async function requireUserForAccountDeletion(currentPath: string = ROUTES.accountDeletion): Promise<AuthContext & { accountState: "active" | "deletion_incomplete" }> {
  const ctx = await requireUserOrLogin(currentPath);
  const state = await loadAccountState(ctx.supabase, ctx.user.id);
  if (state === "profile_missing") throw accountProfileMissing();
  return { ...ctx, accountState: state };
}

/**
 * S-03 consent page (QA-R1-02): signed-in, no consent gate (that's this page's job), but a
 * half-deleted account is sent to S-25 first (R1 A7, UX FL-07 "다른 메뉴로 갈 수 없음").
 */
export async function requireUserForConsentPage(currentPath: string = ROUTES.consent): Promise<AuthContext> {
  const ctx = await requireUserOrLogin(currentPath);
  const state = await loadAccountState(ctx.supabase, ctx.user.id);
  if (state === "deletion_incomplete") redirect(ROUTES.accountDeletion);
  if (state === "profile_missing") throw accountProfileMissing();
  return ctx;
}
