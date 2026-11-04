import { z } from "zod";

/** F-COM-01: Google login only (D-09 변경, decisions 3.11). Shared with the S-02 sign-in screen. */

/** Optional path to return to after sign-in; the server re-checks it with safeNextPath. */
const NextPath = z.string().max(512).optional();

export const SignInWithGoogleInput = z.object({
  next: NextPath,
});
export type SignInWithGoogleInput = z.input<typeof SignInWithGoogleInput>;

/** The client navigates to `url` (Google consent screen via Supabase Auth). */
export type SignInWithGoogleResult = { url: string };

export type SignOutResult = { signedOut: true };

/** Auth-specific error codes, beyond the generic ones in errors.ts. */
export const AUTH_ERROR_CODES = [
  // Google OAuth start failed for a reason the user can't fix.
  "auth_failed",
  // Signed in, but required consents (F-COM-02) are missing or outdated.
  "consent_required",
] as const;
export type AuthErrorCode = (typeof AUTH_ERROR_CODES)[number];
