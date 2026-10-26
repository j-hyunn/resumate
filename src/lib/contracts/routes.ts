/**
 * App paths the auth flow redirects between. Page routes are owned by the UI
 * harness; `/login` and `/onboarding/consent` are assumed names ([가정], S1 plan)
 * and change here only.
 */
export const ROUTES = {
  /** S-02 sign-in. */
  login: "/login",
  /** S-03 consent. */
  consent: "/onboarding/consent",
  /** S-08 career — the default screen after sign-in (F-COM-02, UX S-02/S-03). */
  home: "/career",
  /** OAuth / magic link callback (Route Handler). */
  authCallback: "/auth/callback",
} as const;

/** Paths that need a signed-in user. The proxy redirects anonymous requests to login. */
export const PROTECTED_PREFIXES = [
  "/career",
  "/applications",
  "/interviews",
  "/board",
  "/settings",
  "/onboarding/consent",
] as const;

/** Error query values `/login?error=` can receive from the server. */
export const LOGIN_ERRORS = ["auth_callback"] as const;
export type LoginError = (typeof LOGIN_ERRORS)[number];

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
