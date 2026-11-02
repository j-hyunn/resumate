import { NextResponse, type NextRequest } from "next/server";
import { updateSession } from "@/server/auth/proxy-session";
import { EnvValidationError } from "@/server/env";

/** Next.js 16 Proxy (formerly middleware): Supabase session refresh + signed-out redirect. */
export async function proxy(request: NextRequest) {
  try {
    return await updateSession(request);
  } catch (err) {
    if (!(err instanceof EnvValidationError)) throw err;
    // Names the keys, never values. Fails closed: no page renders without Supabase env.
    console.error(JSON.stringify({ event: "proxy.env_missing", keys: err.keys }));
    const detail =
      process.env.NODE_ENV === "production"
        ? "Server configuration error."
        : `Supabase environment is missing or invalid: ${err.keys.join(", ")}. Copy .env.example to .env.local and fill in the values from \`pnpm exec supabase status\`.`;
    return new NextResponse(detail, { status: 500, headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" } });
  }
}

export const config = {
  matcher: [
    // Everything except static assets and image optimization.
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico|txt|xml)$).*)",
  ],
};
