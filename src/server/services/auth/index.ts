import type { AuthError } from "@supabase/supabase-js";
import type { AccountState } from "@/lib/contracts/account";
import type { SignInWithGoogleResult } from "@/lib/contracts/auth";
import { AppError } from "@/lib/contracts/errors";
import { LOGIN_ERRORS, ROUTES, safeNextPath, withNext } from "@/lib/contracts/routes";
import type { UserSupabaseClient } from "@/server/db/types";
import { getConsentStatus } from "@/server/services/consent";

/** F-COM-01 auth flows (D-09 변경: Google only). No Next.js imports: callers pass the client and origin. */

type AuthClient = Pick<UserSupabaseClient, "auth" | "rpc">;

/** `${origin}/auth/callback?next=<safe next>` — must be on Supabase Auth's redirect allow-list. */
export function buildCallbackUrl(origin: string, next: string | undefined): string {
  const url = new URL(ROUTES.authCallback, origin);
  url.searchParams.set("next", safeNextPath(next));
  return url.toString();
}

/**
 * Maps Supabase Auth errors (Google OAuth start) to a stable code. Never
 * forwards Auth's English message.
 */
export function mapAuthError(error: AuthError): AppError {
  return new AppError("auth_failed", "로그인을 시작하지 못했습니다. 잠시 후 다시 시도해 주세요.", {
    status: 502,
    cause: error,
  });
}

/**
 * Starts Google OAuth (PKCE). Returns the provider URL for the client to
 * navigate to; the code verifier is stored in a cookie by the SSR client.
 */
export async function startGoogleSignIn(
  supabase: AuthClient,
  input: { next?: string },
  origin: string,
): Promise<SignInWithGoogleResult> {
  const { data, error } = await supabase.auth.signInWithOAuth({
    provider: "google",
    options: { redirectTo: buildCallbackUrl(origin, input.next), skipBrowserRedirect: true },
  });
  if (error) throw mapAuthError(error);
  if (!data.url) throw new AppError("auth_failed", "로그인을 시작하지 못했습니다. 잠시 후 다시 시도해 주세요.", { status: 502 });
  return { url: data.url };
}

export async function signOut(supabase: AuthClient): Promise<void> {
  // scope 'local': this device only. Errors are ignored — cookies are cleared either way.
  await supabase.auth.signOut({ scope: "local" });
}

export type CallbackParams = {
  code: string | null;
  next: string | null;
  /** Set by the provider when the user cancels or OAuth fails. */
  providerError: string | null;
};

/** S-02 with the callback-failure Alert and no `next` (the default destination). */
export const LOGIN_CALLBACK_ERROR = withLoginError(LOGIN_ERRORS[0], ROUTES.home);

/**
 * `/sign-in?error=<code>[&next=<encoded>]` — UQ-732: a callback failure (Google
 * cancel, exchange failure) keeps the original `next` so a retry from S-02 still
 * lands there (02 S-02 "원래 URL"). `next` must already be `safeNextPath`-checked;
 * the default destination is left out, like `routes.signIn` / `withNext`.
 */
export function loginCallbackErrorUrl(next: string): string {
  return withLoginError(LOGIN_ERRORS[0], next);
}

function withLoginError(code: (typeof LOGIN_ERRORS)[number], next: string): string {
  const base = `${ROUTES.login}?error=${code}`;
  return next === ROUTES.home ? base : `${base}&next=${encodeURIComponent(next)}`;
}

/**
 * /auth/callback: exchanges the Google OAuth PKCE code (the only sign-in
 * method, D-09 변경 — token_hash / email OTP links are not accepted), then
 * picks where to go (UX S-02/S-03, L-01 첫 화면):
 * - R1 A7: unfinished account deletion → S-25 "탈퇴 마무리", before the consent
 *   gate and `next`; `profile_missing` [가정] → signed out, S-02 `?error=auth_callback` (+ `next`)
 * - required consent missing/outdated → S-03 with `next`
 * - otherwise → `next` (same-origin path) or S-08
 * - any failure → S-02 with `?error=auth_callback`, keeping a non-default safe `next` (UQ-732)
 * Returns a same-origin path.
 */
export async function completeAuthCallback(
  supabase: AuthClient,
  params: CallbackParams,
  /** R1 A7: own-profile read, then (only without one) the deletion state. Production: `loadAccountState`. */
  accountState?: () => Promise<AccountState>,
): Promise<string> {
  const next = safeNextPath(params.next);
  const failed = loginCallbackErrorUrl(next);
  if (params.providerError) return failed;

  if (!params.code) return failed;
  const { error } = await supabase.auth.exchangeCodeForSession(params.code);
  if (error) return failed;

  if (accountState) {
    let state: AccountState;
    try {
      state = await accountState();
    } catch {
      // Can't judge the account: the gated pages re-check (and fail visibly) — go on as usual.
      state = "active";
    }
    if (state === "deletion_incomplete") return ROUTES.accountDeletionFinalize;
    if (state === "profile_missing") {
      await signOut(supabase);
      return failed;
    }
  }

  try {
    const status = await getConsentStatus(supabase);
    if (status.needsRequiredConsent) return withNext(ROUTES.consent, next);
  } catch {
    // Signed in, but the gate check failed: send to consent. The consent page
    // re-checks, and an already-consented user is passed through from there.
    return withNext(ROUTES.consent, next);
  }
  return next;
}
