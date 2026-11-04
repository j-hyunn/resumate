import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { ROUTES, isProtectedPath, withNext } from "@/lib/contracts/routes";
import { isDevPath, isPreviewUrl, PREVIEW_REQUEST_HEADER, REQUEST_PATH_HEADER } from "@/lib/contracts/preview";
import { isPreviewEnabled } from "@/lib/preview-state";
import type { Database } from "@/server/db/database.types";
import { getPublicEnv } from "@/server/env";
import { touchLastActiveIfDue } from "./last-active";
import { previewMarkerValue } from "./preview-marker";

/**
 * Runs in src/proxy.ts on every page request:
 * 1. refreshes the Supabase session cookies (Server Components can't write them);
 * 2. optimistic gate: anonymous requests to protected paths → S-02 with `?next=`;
 * 3. marks the request for the page: its path (`?next=` of the consent gate) and, in development
 *    only, whether it is a `?state=` / `/dev/` preview (mock store, no sign-in needed);
 * 4. for a signed-in user, updates profiles.last_active_at (`touch_last_active`, at most every few hours).
 *
 * This is not authorization. Every action, handler, and page still calls
 * requireUser() / requireConsentedUser(). The consent gate is server-side only
 * (needs an RPC), not here.
 */
export async function updateSession(request: NextRequest): Promise<NextResponse> {
  const env = getPublicEnv();
  const { pathname, search } = request.nextUrl;
  // The dev gallery doesn't exist in production: no shell, no session reads (W1, spec-gaps W0 QA).
  if (!isPreviewEnabled && isDevPath(pathname)) return new NextResponse(null, { status: 404 });
  const preview = isPreviewEnabled && isPreviewUrl(pathname, request.nextUrl.searchParams);

  const forwarded = new Headers(request.headers);
  // A client can't set these: both are overwritten or removed here. The preview marker is also a
  // per-process secret (QA-W5-03), so a client value on a path this proxy skips is still not trusted.
  forwarded.delete(PREVIEW_REQUEST_HEADER);
  if (preview) forwarded.set(PREVIEW_REQUEST_HEADER, previewMarkerValue());
  forwarded.set(REQUEST_PATH_HEADER, `${pathname}${search}`);

  let response = NextResponse.next({ request: { headers: forwarded } });

  const supabase = createServerClient<Database>(env.NEXT_PUBLIC_SUPABASE_URL, env.NEXT_PUBLIC_SUPABASE_ANON_KEY, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet, headers) {
        for (const { name, value } of cookiesToSet) request.cookies.set(name, value);
        const cookie = request.headers.get("cookie");
        if (cookie) forwarded.set("cookie", cookie);
        else forwarded.delete("cookie");
        response = NextResponse.next({ request: { headers: forwarded } });
        for (const { name, value, options } of cookiesToSet) response.cookies.set(name, value, options);
        // Responses that set auth cookies must not be cached by a CDN.
        for (const [key, value] of Object.entries(headers)) response.headers.set(key, value);
      },
    },
  });

  // Don't put code between client creation and this call: it refreshes the token.
  const { data } = await supabase.auth.getClaims();
  const sub = typeof data?.claims?.sub === "string" ? data.claims.sub : null;
  const signedIn = Boolean(sub);

  // 4. last access for the inactive account deletion (privacy policy §4), throttled by a cookie.
  if (sub) {
    await touchLastActiveIfDue(supabase, sub, request.cookies, () => response.cookies, request.nextUrl.protocol === "https:");
  }

  if (!signedIn && !preview && isProtectedPath(pathname)) {
    const url = request.nextUrl.clone();
    const target = new URL(withNext(ROUTES.login, `${pathname}${search}`), url.origin);
    const redirect = NextResponse.redirect(target);
    // Keep any cookie changes (e.g. cleared expired session) on the redirect.
    for (const cookie of response.cookies.getAll()) redirect.cookies.set(cookie);
    redirect.headers.set("Cache-Control", "private, no-store");
    return redirect;
  }

  return response;
}
