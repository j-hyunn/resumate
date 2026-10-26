import type { NextRequest } from "next/server";
import { updateSession } from "@/server/auth/proxy-session";

/** Next.js 16 Proxy (formerly middleware): Supabase session refresh + signed-out redirect. */
export async function proxy(request: NextRequest) {
  return updateSession(request);
}

export const config = {
  matcher: [
    // Everything except static assets and image optimization.
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico|txt|xml)$).*)",
  ],
};
