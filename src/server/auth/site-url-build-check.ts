/**
 * Build-time guard for NEXT_PUBLIC_SITE_URL, run from next.config.ts.
 *
 * At run time a production deployment without NEXT_PUBLIC_SITE_URL fails
 * closed in getSiteOrigin (QA-10): every Google sign-in start throws, and the
 * deploy itself looks healthy. This check moves that failure to the Vercel
 * production build so a missing or malformed value can't ship.
 *
 * Only Vercel production builds are checked: preview builds use their own
 * request origin, and local `next build` runs without VERCEL_ENV.
 * No imports (next.config.ts loads this file directly, without path aliases).
 */
export function checkSiteUrlForBuild(env: Record<string, string | undefined>): void {
  if (env.VERCEL_ENV !== "production") return;
  const value = env.NEXT_PUBLIC_SITE_URL?.trim();
  if (!value) {
    throw new Error(
      "NEXT_PUBLIC_SITE_URL is required for Vercel production builds (auth redirect origin, e.g. https://www.resumate.me). Add it to the Production environment and redeploy.",
    );
  }
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error("NEXT_PUBLIC_SITE_URL must be an absolute URL (e.g. https://www.resumate.me).");
  }
  if (url.protocol !== "https:") {
    throw new Error("NEXT_PUBLIC_SITE_URL must use https in production.");
  }
}
