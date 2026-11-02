import { NextResponse, type NextRequest } from "next/server";
import { updateSession } from "@/server/auth/proxy-session";

/** Next.js 16 Proxy (formerly middleware): Supabase session refresh + signed-out redirect. */
export async function proxy(request: NextRequest) {
  // Local UI work on the mock data layer has no Supabase env. Production still fails closed in getPublicEnv().
  if (process.env.NODE_ENV !== "production" && !process.env.NEXT_PUBLIC_SUPABASE_URL) return NextResponse.next();
  return updateSession(request);
}

export const config = {
  matcher: [
    // Everything except static assets and image optimization.
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico|txt|xml)$).*)",
  ],
};
