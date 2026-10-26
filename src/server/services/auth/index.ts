import type { AuthError, EmailOtpType } from "@supabase/supabase-js";
import type { SendMagicLinkResult, SignInWithGoogleResult } from "@/lib/contracts/auth";
import { AppError } from "@/lib/contracts/errors";
import { LOGIN_ERRORS, ROUTES, safeNextPath, withNext } from "@/lib/contracts/routes";
import type { UserSupabaseClient } from "@/server/db/types";
import { getConsentStatus } from "@/server/services/consent";

/** F-COM-01 auth flows (D-09). No Next.js imports: callers pass the client and origin. */

type AuthClient = Pick<UserSupabaseClient, "auth" | "rpc">;

/** `${origin}/auth/callback?next=<safe next>` — must be on Supabase Auth's redirect allow-list. */
export function buildCallbackUrl(origin: string, next: string | undefined): string {
  const url = new URL(ROUTES.authCallback, origin);
  url.searchParams.set("next", safeNextPath(next));
  return url.toString();
}

/** Maps Supabase Auth errors to stable codes. Never forwards Auth's English message. */
export function mapAuthError(error: AuthError): AppError {
  if (error.status === 429 || error.code === "over_email_send_rate_limit" || error.code === "over_request_rate_limit") {
    return new AppError("auth_rate_limited", "잠시 후 다시 시도해 주세요. 메일 발송 요청이 너무 잦습니다.", {
      status: 429,
      cause: error,
    });
  }
  if (error.code === "email_address_invalid" || error.code === "validation_failed") {
    return new AppError("invalid_input", "이메일 주소를 확인해 주세요.", { cause: error });
  }
  return new AppError("auth_failed", "로그인을 시작하지 못했습니다. 잠시 후 다시 시도해 주세요.", {
    status: 502,
    cause: error,
  });
}

/** Sends (or resends — same call) the magic link. New emails sign up (S-02 covers both). */
export async function sendMagicLink(
  supabase: AuthClient,
  input: { email: string; next?: string },
  origin: string,
): Promise<SendMagicLinkResult> {
  const { error } = await supabase.auth.signInWithOtp({
    email: input.email,
    options: { emailRedirectTo: buildCallbackUrl(origin, input.next), shouldCreateUser: true },
  });
  if (error) throw mapAuthError(error);
  return { sent: true };
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

const EMAIL_OTP_TYPES: readonly EmailOtpType[] = ["magiclink", "signup", "email", "invite", "recovery", "email_change"];

export type CallbackParams = {
  code: string | null;
  tokenHash: string | null;
  type: string | null;
  next: string | null;
  /** Set by the provider when the user cancels or OAuth fails. */
  providerError: string | null;
};

export const LOGIN_CALLBACK_ERROR = withLoginError(LOGIN_ERRORS[0]);

function withLoginError(code: (typeof LOGIN_ERRORS)[number]): string {
  return `${ROUTES.login}?error=${code}`;
}

/**
 * /auth/callback: exchanges the PKCE code (OAuth and magic link) or verifies a
 * token_hash link, then picks where to go (UX S-02/S-03):
 * - required consent missing/outdated → S-03 with `next`
 * - otherwise → `next` (same-origin path) or S-08
 * - any failure → S-02 with `?error=auth_callback`
 * Returns a same-origin path.
 */
export async function completeAuthCallback(supabase: AuthClient, params: CallbackParams): Promise<string> {
  const next = safeNextPath(params.next);
  if (params.providerError) return LOGIN_CALLBACK_ERROR;

  if (params.code) {
    const { error } = await supabase.auth.exchangeCodeForSession(params.code);
    if (error) return LOGIN_CALLBACK_ERROR;
  } else if (params.tokenHash && params.type && (EMAIL_OTP_TYPES as readonly string[]).includes(params.type)) {
    const { error } = await supabase.auth.verifyOtp({ token_hash: params.tokenHash, type: params.type as EmailOtpType });
    if (error) return LOGIN_CALLBACK_ERROR;
  } else {
    return LOGIN_CALLBACK_ERROR;
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
