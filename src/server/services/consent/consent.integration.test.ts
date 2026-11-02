import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { REQUIRED_CONSENT_TYPES } from "@/lib/contracts/enums";
import type { Database } from "@/server/db/database.types";
import { getProfile, updateProfile } from "@/server/services/profile";
import { isStackReady, readLocalSupabase } from "@/test/local-supabase";
import { getConsentStatus, submitConsents, withdrawOptionalConsent } from "./index";

/**
 * S1 services against the local stack as a real user session: consent gate
 * before/after record_consents, optional withdrawal, RPC error mapping, and
 * profile read/update through RLS. Skips when the stack isn't running.
 */

const stack = readLocalSupabase();
const ready = stack ? await isStackReady(stack) : false;

describe.skipIf(!ready)("consent + profile services (local stack)", () => {
  const s = stack!;
  let admin: SupabaseClient<Database>;
  let user: SupabaseClient<Database>;
  let userId = "";

  beforeAll(async () => {
    admin = createClient<Database>(s.url, s.serviceRoleKey, { auth: { persistSession: false, autoRefreshToken: false } });
    const email = `consent-${crypto.randomUUID()}@example.test`;
    const password = `pw-${crypto.randomUUID()}`;
    const created = await admin.auth.admin.createUser({ email, password, email_confirm: true });
    if (created.error || !created.data.user) throw new Error(`createUser failed: ${created.error?.code}`);
    userId = created.data.user.id;
    user = createClient<Database>(s.url, s.anonKey, { auth: { persistSession: false } });
    const signIn = await user.auth.signInWithPassword({ email, password });
    if (signIn.error) throw new Error(`signIn failed: ${signIn.error.code}`);
  });

  afterAll(async () => {
    if (userId) await admin.auth.admin.deleteUser(userId);
  });

  it("a new user needs required consent", async () => {
    const status = await getConsentStatus(user);
    expect(status.needsRequiredConsent).toBe(true);
    expect(status.items.map((i) => i.consentType)).toEqual([
      "terms",
      "privacy_required",
      "cross_border_transfer",
      "service_improvement",
      "marketing",
    ]);
  });

  it("missing a required type maps to required_consent_missing", async () => {
    await expect(submitConsents(user, [{ consentType: "terms", agreed: true }], null)).rejects.toMatchObject({
      code: "required_consent_missing",
    });
  });

  it("records consents and opens the gate; versions come from the server", async () => {
    const items = [
      ...REQUIRED_CONSENT_TYPES.map((consentType) => ({ consentType, agreed: true })),
      { consentType: "marketing" as const, agreed: true },
    ];
    const status = await submitConsents(user, items, "Vitest UA");
    expect(status.needsRequiredConsent).toBe(false);
    for (const item of status.items.filter((i) => i.required)) {
      expect(item.agreedVersion).toBe(item.currentVersion);
    }
    expect(status.items.find((i) => i.consentType === "marketing")?.agreedVersion).not.toBeNull();
  });

  it("withdraws an optional consent", async () => {
    const status = await withdrawOptionalConsent(user, "marketing");
    expect(status.items.find((i) => i.consentType === "marketing")?.agreedVersion).toBeNull();
    expect(status.needsRequiredConsent).toBe(false);
  });

  it("reads and updates the profile through RLS", async () => {
    await expect(getProfile(user, { id: userId })).resolves.toMatchObject({ id: userId, displayName: null });
    const updated = await updateProfile(user, { id: userId }, { displayName: "테스트", totalYearsOfExperience: 2 });
    expect(updated).toMatchObject({ displayName: "테스트", totalYearsOfExperience: 2 });
  });

  it("a DB CHECK violation maps to invalid_input", async () => {
    await expect(updateProfile(user, { id: userId }, { totalYearsOfExperience: 99 })).rejects.toMatchObject({
      code: "invalid_input",
    });
  });
});
