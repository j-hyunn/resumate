import { NextResponse, type NextRequest } from "next/server";
import { createSupabaseServerClient } from "@/server/db/server";
import { completeAuthCallback } from "@/server/services/auth";

/**
 * OAuth (Google) and magic-link callback (F-COM-01). Exchanges the code for a
 * session cookie, then redirects to S-03 (consent needed), `next`, or S-08.
 */
export async function GET(request: NextRequest) {
  const { searchParams, origin } = request.nextUrl;
  const supabase = await createSupabaseServerClient();

  const target = await completeAuthCallback(supabase, {
    code: searchParams.get("code"),
    tokenHash: searchParams.get("token_hash"),
    type: searchParams.get("type"),
    next: searchParams.get("next"),
    providerError: searchParams.get("error"),
  });

  const response = NextResponse.redirect(new URL(target, origin));
  response.headers.set("Cache-Control", "private, no-store");
  return response;
}
