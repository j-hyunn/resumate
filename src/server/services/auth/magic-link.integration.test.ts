import { createClient } from "@supabase/supabase-js";
import { afterAll, describe, expect, it } from "vitest";
import type { Database } from "@/server/db/database.types";
import { isStackReady, readLocalSupabase } from "@/test/local-supabase";
import { completeAuthCallback, sendMagicLink } from "./index";

/**
 * QA-05 against the local stack: the magic link email (supabase/templates/magic_link.html)
 * carries a token_hash link to /auth/callback, and a *different* client — no PKCE
 * code verifier, like another device's browser — can complete sign-in with it.
 * Skips when the stack or Mailpit isn't available.
 */

const stack = readLocalSupabase();
const ready = stack ? await isStackReady(stack) : false;
const MAILPIT = process.env.MAILPIT_URL ?? "http://127.0.0.1:54324";

async function latestLinkFor(email: string): Promise<URL> {
  for (let attempt = 0; attempt < 20; attempt++) {
    const list = (await (await fetch(`${MAILPIT}/api/v1/search?query=${encodeURIComponent(`to:"${email}"`)}`)).json()) as {
      messages: { ID: string }[];
    };
    const id = list.messages[0]?.ID;
    if (id) {
      const msg = (await (await fetch(`${MAILPIT}/api/v1/message/${id}`)).json()) as { HTML: string };
      const href = /href="([^"]+)"/.exec(msg.HTML)?.[1];
      if (href) return new URL(href.replaceAll("&amp;", "&"));
    }
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error("magic link email not found");
}

describe.skipIf(!ready)("magic link across devices (local stack)", () => {
  const s = stack!;
  const email = `magic-${crypto.randomUUID()}@example.test`;

  afterAll(async () => {
    const admin = createClient<Database>(s.url, s.serviceRoleKey, { auth: { persistSession: false, autoRefreshToken: false } });
    const { data } = await admin.auth.admin.listUsers({ perPage: 200 });
    const user = data.users.find((u) => u.email === email);
    if (user) await admin.auth.admin.deleteUser(user.id);
  });

  it("sends a token_hash link that another browser can use", async () => {
    // Device A: requests the link (PKCE client, like @supabase/ssr).
    const deviceA = createClient<Database>(s.url, s.anonKey, { auth: { persistSession: false, flowType: "pkce" } });
    await sendMagicLink(deviceA, { email, next: "/board" }, "http://localhost:3000");

    const link = await latestLinkFor(email);
    expect(`${link.origin}${link.pathname}`).toBe("http://localhost:3000/auth/callback");
    expect(link.searchParams.get("next")).toBe("/board");
    expect(link.searchParams.get("type")).toBe("email");
    expect(link.searchParams.get("token_hash")).toBeTruthy();
    expect(link.searchParams.get("code")).toBeNull();

    // Device B: fresh client, no code verifier. New user → consent page, next kept.
    const deviceB = createClient<Database>(s.url, s.anonKey, { auth: { persistSession: false, flowType: "pkce" } });
    const target = await completeAuthCallback(deviceB, {
      code: link.searchParams.get("code"),
      tokenHash: link.searchParams.get("token_hash"),
      type: link.searchParams.get("type"),
      next: link.searchParams.get("next"),
      providerError: null,
    });
    expect(target).toBe("/onboarding/consent?next=%2Fboard");
    const { data } = await deviceB.auth.getUser();
    expect(data.user?.email).toBe(email);
  });
});
