import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { ROUTES, isProtectedPath, withNext } from "@/lib/contracts/routes";
import type { Database } from "@/server/db/database.types";
import { getPublicEnv } from "@/server/env";

/**
 * Runs in src/proxy.ts on every page request:
 * 1. refreshes the Supabase session cookies (Server Components can't write them);
 * 2. optimistic gate: anonymous requests to protected paths → S-02 with `?next=`.
 *
 * This is not authorization. Every action, handler, and page still calls
 * requireUser() / requireConsentedUser(). The consent gate is server-side only
 * (needs an RPC), not here.
 */
export async function updateSession(request: NextRequest): Promise<NextResponse> {
  const env = getPublicEnv();
  let response = NextResponse.next({ request });

  const supabase = createServerClient<Database>(env.NEXT_PUBLIC_SUPABASE_URL, env.NEXT_PUBLIC_SUPABASE_ANON_KEY, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet, headers) {
        for (const { name, value } of cookiesToSet) request.cookies.set(name, value);
        response = NextResponse.next({ request });
        for (const { name, value, options } of cookiesToSet) response.cookies.set(name, value, options);
        // Responses that set auth cookies must not be cached by a CDN.
        for (const [key, value] of Object.entries(headers)) response.headers.set(key, value);
      },
    },
  });

  // Don't put code between client creation and this call: it refreshes the token.
  const { data } = await supabase.auth.getClaims();
  const signedIn = Boolean(data?.claims?.sub);

  const { pathname, search } = request.nextUrl;
  if (!signedIn && isProtectedPath(pathname)) {
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
