import { NextResponse, type NextRequest } from "next/server";
import { loadAccountState } from "@/server/auth/account-state";
import { createSupabaseServerClient } from "@/server/db/server";
import { completeAuthCallback } from "@/server/services/auth";

/**
 * OAuth (Google) and magic-link callback (F-COM-01). Exchanges the code for a
 * session cookie, then redirects to S-25 (unfinished deletion, R1 A7), S-03
 * (consent needed), `next`, or S-08.
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
  }, async () => {
    const { data, error } = await supabase.auth.getUser();
    if (error || !data.user) return "active"; // the consent step / gated pages handle a lost session
    return loadAccountState(supabase, data.user.id);
  });

  const response = NextResponse.redirect(new URL(target, origin));
  response.headers.set("Cache-Control", "private, no-store");
  return response;
}
