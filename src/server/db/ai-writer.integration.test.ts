import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { isStackReady, readLocalSupabase } from "@/test/local-supabase";
import { resetServerEnvCache } from "@/server/env";
import type { Database } from "./database.types";
import { createAiWriterClient } from "./ai-writer";

/**
 * DM-13 against the local Supabase stack: an app_ai_writer client signed by
 * createAiWriterClient can read the allowed profile columns of its own user,
 * cannot read display_name, cannot read other users, and cannot read consents.
 * Skips when `supabase start` isn't running or migrations aren't applied.
 */

const stack = readLocalSupabase();
const ready = stack ? await isStackReady(stack) : false;

describe.skipIf(!ready)("app_ai_writer client (local stack)", () => {
  const s = stack!;
  let admin: SupabaseClient<Database>;
  const users: { id: string; email: string }[] = [];

  // R13 (DM 2.1.1): the three old 내 정보 columns are dropped; display_name is what is left.
  async function createUser(label: string, displayName: string) {
    const email = `ai-writer-${label}-${crypto.randomUUID()}@example.test`;
    const password = `pw-${crypto.randomUUID()}`;
    const { data, error } = await admin.auth.admin.createUser({ email, password, email_confirm: true });
    if (error || !data.user) throw new Error(`createUser failed: ${error?.code ?? "no user"}`);
    users.push({ id: data.user.id, email });

    // Write as the user session (career/profile writes go through the user, DM-13).
    const userClient = createClient<Database>(s.url, s.anonKey, { auth: { persistSession: false } });
    const signIn = await userClient.auth.signInWithPassword({ email, password });
    if (signIn.error) throw new Error(`signIn failed: ${signIn.error.code}`);
    const upd = await userClient
      .from("profiles")
      .update({ display_name: displayName })
      .eq("id", data.user.id);
    if (upd.error) throw new Error(`profile update failed: ${upd.error.code}`);
    return data.user.id;
  }

  let userA = "";
  let userB = "";

  // vitest `unstubEnvs` resets env before each test, so stub per test.
  beforeEach(() => {
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", s.url);
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY", s.anonKey);
    vi.stubEnv("SUPABASE_JWT_SECRET", s.jwtSecret);
    vi.stubEnv("CRON_SECRET", "test-cron-secret-0000");
    resetServerEnvCache();
  });

  beforeAll(async () => {
    // Service role is used only to create and delete test users.
    admin = createClient<Database>(s.url, s.serviceRoleKey, { auth: { persistSession: false, autoRefreshToken: false } });
    userA = await createUser("a", "홍길동");
    userB = await createUser("b", "김철수");
  });

  afterAll(async () => {
    for (const u of users) await admin.auth.admin.deleteUser(u.id);
    resetServerEnvCache();
  });

  // R13 (DM 2.1.5, SD-6 / migration ⑬): 남은 app_ai_writer 컬럼 grant는 `id`·`career_data_updated_at`·
  // `updated_at`뿐이다 (`active_ai_provider`는 grant 목록에 없다 — 게이트는 RPC가 본다).
  it("reads the allowed profile columns of its own user", async () => {
    const ai = createAiWriterClient(userA);
    const { data, error } = await ai.from("profiles").select("id, career_data_updated_at, updated_at");
    expect(error).toBeNull();
    expect(data).toHaveLength(1);
    expect(data?.[0]).toMatchObject({ id: userA });
  });

  it("cannot read the 내 정보 columns, the pair table, or the option table (SD-6)", async () => {
    const ai = createAiWriterClient(userA);
    for (const columns of ["display_name", "active_ai_provider", "job_search_status", "interested_company_type", "interested_industry", "highest_education_school_name"]) {
      const res = await ai.from("profiles").select(columns);
      expect(res.error?.code, columns).toBe("42501");
    }
    expect((await ai.from("profile_job_interests").select("sort_order")).error?.code).toBe("42501");
    expect((await ai.from("profile_options").select("code")).error?.code).toBe("42501");
  });

  it("cannot read display_name (column grant)", async () => {
    const ai = createAiWriterClient(userA);
    const { data, error } = await ai.from("profiles").select("display_name");
    expect(data).toBeNull();
    expect(error?.code).toBe("42501");
  });

  it("cannot select * (includes display_name)", async () => {
    const ai = createAiWriterClient(userA);
    const { error } = await ai.from("profiles").select("*");
    expect(error?.code).toBe("42501");
  });

  it("sees only the user in `sub`, not other users", async () => {
    const ai = createAiWriterClient(userA);
    const { data, error } = await ai.from("profiles").select("id").eq("id", userB);
    expect(error).toBeNull();
    expect(data).toEqual([]);

    const aiB = createAiWriterClient(userB);
    const own = await aiB.from("profiles").select("id, career_data_updated_at");
    expect(own.data).toEqual([{ id: userB, career_data_updated_at: null }]);
  });

  it("cannot read consents", async () => {
    const ai = createAiWriterClient(userA);
    const { data, error } = await ai.from("consents").select("id");
    expect(data).toBeNull();
    expect(error?.code).toBe("42501");
  });

  it("cannot update profiles", async () => {
    const ai = createAiWriterClient(userA);
    const { error } = await ai.from("profiles").update({ display_name: "changed" }).eq("id", userA);
    expect(error?.code).toBe("42501");
  });

  it("is rejected when signed with the wrong secret", async () => {
    vi.stubEnv("SUPABASE_JWT_SECRET", "wrong-secret-wrong-secret-wrong-secret-00");
    resetServerEnvCache();
    try {
      const ai = createAiWriterClient(userA);
      const { error } = await ai.from("profiles").select("id");
      expect(error).not.toBeNull();
    } finally {
      resetServerEnvCache();
    }
  });
});
