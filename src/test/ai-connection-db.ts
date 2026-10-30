import type { SupabaseClient } from "@supabase/supabase-js";
import type { AiProvider, ConnectionTier } from "@/lib/contracts/enums";
import type { Database } from "@/server/db/database.types";
import { getAiDisclosure, recordAiDataUseConsent } from "@/server/services/ai-connection/consent";

type Client = SupabaseClient<Database>;

/**
 * Test-only (local stack): give a test user a stored key row for `provider`
 * (dummy ciphertext — nothing decrypts it in these tests), a current consent
 * for `tier`, and make it the active provider. R2: `retry_ai_job` reads the
 * active connection from the DB (C-11.4), so job integration tests that call
 * `runner.retryJob` need this.
 *
 * `admin` = service_role (save_provider_key is server-only, R1 A19);
 * `user` = the user's own session (consent insert, set_active_ai_provider).
 */
export async function connectTestProvider(
  admin: Client,
  user: Client,
  userId: string,
  provider: AiProvider,
  tier: ConnectionTier = "paid",
): Promise<void> {
  const disclosure = await getAiDisclosure(user, provider, tier);
  await recordAiDataUseConsent(user, { provider, connectionTier: tier, disclosureVersion: disclosure.version, freeTierAcknowledged: tier === "free" });
  const existing = await user.from("ai_provider_keys_public").select("id").eq("provider", provider).maybeSingle();
  const saved = await admin.rpc("save_provider_key", {
    p_user_id: userId,
    p_provider: provider,
    p_connection_tier: tier,
    p_key_ciphertext: "\\x00",
    p_key_nonce: "\\x00",
    p_wrapped_dek: "\\x00",
    p_kek_id: "test-kek",
    p_key_last4: "0000",
    p_disclosure_version: disclosure.version,
    p_verification_result: "valid",
    p_key_id: existing.data?.id ?? crypto.randomUUID(),
  });
  if (saved.error) throw new Error(`save_provider_key failed: ${saved.error.code} ${saved.error.message}`);
  const active = await user.rpc("set_active_ai_provider", { p_provider: provider });
  if (active.error) throw new Error(`set_active_ai_provider failed: ${active.error.code} ${active.error.message}`);
}

/** Marks the user's key for `provider` invalid (service_role; test-only). */
export async function markTestKeyInvalid(admin: Client, userId: string, provider: AiProvider): Promise<void> {
  const { error } = await admin.rpc("record_provider_key_check", { p_user_id: userId, p_provider: provider, p_result_status: "failed", p_failure_cause: "key_invalid" });
  if (error) throw new Error(`record_provider_key_check failed: ${error.code} ${error.message}`);
}
