/**
 * App paths the auth flow redirects between. Page routes are owned by the UI
 * harness (src/lib/routes.ts); this contract follows them and changes here only.
 */
export const ROUTES = {
  /** S-02 sign-in. */
  login: "/sign-in",
  /** S-03 consent. */
  consent: "/consent",
  /** S-08 career — the default screen after sign-in (F-COM-02, UX S-02/S-03). */
  home: "/career",
  /** Google OAuth callback (Route Handler). */
  authCallback: "/auth/callback",
  /**
   * S-25 회원 탈퇴 — OUTSIDE the consent gate (R1 A7). The page must use
   * `requireUserForAccountDeletion`, not the consented-user gate.
   */
  accountDeletion: "/settings/withdraw",
  /**
   * S-25 탈퇴 마무리 (v5.3 A7): where a half-deleted account goes. Outside the shell and the
   * consent gate. Guards redirect here directly: `/settings/withdraw` sits in the dashboard
   * layout, so a layout guard redirecting to it would loop.
   */
  accountDeletionFinalize: "/settings/withdraw/finalize",
} as const;

/** Paths that need a signed-in user. The proxy redirects anonymous requests to login. */
export const PROTECTED_PREFIXES = [
  "/career",
  "/applications",
  "/interviews",
  "/board",
  "/settings",
  "/consent",
] as const;

/** Error query values `/sign-in?error=` can receive from the server. */
export const LOGIN_ERRORS = ["auth_callback"] as const;
export type LoginError = (typeof LOGIN_ERRORS)[number];

export function isLoginError(value: unknown): value is LoginError {
  return typeof value === "string" && (LOGIN_ERRORS as readonly string[]).includes(value);
}

export function isProtectedPath(pathname: string): boolean {
  return PROTECTED_PREFIXES.some((prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`));
}

const MAX_NEXT_LENGTH = 512;

/**
 * Returns `next` only when it is a same-origin relative path; otherwise `fallback`.
 * Blocks open redirects: absolute URLs, protocol-relative `//host`, backslash
 * tricks (`/\host`), control characters, and auth pages that would loop.
 */
export function safeNextPath(next: string | null | undefined, fallback: string = ROUTES.home): string {
  if (typeof next !== "string" || next.length === 0 || next.length > MAX_NEXT_LENGTH) return fallback;
  if (!next.startsWith("/") || next.startsWith("//") || next.startsWith("/\\")) return fallback;
  if (/[\u0000-\u001f\u007f\\]/.test(next)) return fallback;

  let parsed: URL;
  try {
    parsed = new URL(next, "http://resumate.invalid");
  } catch {
    return fallback;
  }
  if (parsed.origin !== "http://resumate.invalid") return fallback;
  if (parsed.pathname === ROUTES.login || parsed.pathname.startsWith(`${ROUTES.authCallback}`)) return fallback;
  return `${parsed.pathname}${parsed.search}${parsed.hash}`;
}

/** `path?next=<encoded>` — used for login and consent redirects. */
export function withNext(path: string, next: string): string {
  return `${path}?next=${encodeURIComponent(next)}`;
}
