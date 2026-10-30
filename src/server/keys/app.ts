import "server-only";
import { AppError } from "@/lib/contracts/errors";
import { verifyProviderKey } from "@/server/ai/llm";
import { createAiWriterClient } from "@/server/db/ai-writer";
import { createKeySecretReader } from "@/server/db/key-reader";
import type { UserSupabaseClient } from "@/server/db/types";
import { getServerEnv } from "@/server/env";
import { logJobEvent } from "@/server/jobs/log";
import { createServiceRoleClient } from "@/server/jobs/service-role";
import type { KeySource } from "@/server/jobs/provider-context";
import { createSupabaseJobStore } from "@/server/jobs/supabase-store";
import { createSupabaseUsageStore } from "@/server/jobs/supabase-usage";
import type { KeyVerificationDeps } from "@/server/services/ai-connection/verification";
import { createEnvelopeKeySource } from "./key-source";
import { createEnvKms, KeyCryptoError, type KmsAdapter } from "./kms";

/**
 * Production wiring of BYOK key handling (Next-side; services stay Next-free).
 *
 * KMS: `EnvKms` from AI_KEY_KEK_BASE64 / AI_KEY_KEK_ID — the B-2 PRE-LAUNCH
 * STAND-IN. Replace with a cloud KMS adapter before launch (kms.ts).
 */

let kms: KmsAdapter | undefined;

/** Fails closed with a generic internal error when the KEK isn't configured (never echoes values). */
export function getKms(): KmsAdapter {
  if (kms) return kms;
  try {
    const env = getServerEnv();
    kms = createEnvKms({ AI_KEY_KEK_BASE64: env.AI_KEY_KEK_BASE64, AI_KEY_KEK_ID: env.AI_KEY_KEK_ID });
    return kms;
  } catch (err) {
    logJobEvent("ai_key.kms_unavailable", { code: err instanceof KeyCryptoError ? err.code : "env_invalid" });
    throw new AppError("internal_error", undefined, { status: 500 });
  }
}

/** Run-time key source of one user (app_key_reader → get_provider_key_secret → decrypt). */
export function createAppKeySource(userId: string): KeySource {
  const reader = createKeySecretReader(userId);
  return {
    forJob: (jobId, provider) => createEnvelopeKeySource({ userId, reader, kms: getKms() }).forJob(jobId, provider),
  };
}

/**
 * Deps for register / re-check: user session for key meta and consents, app_ai_writer for job +
 * usage rows, and (R1 A19) the service-role client for the two server-only key RPCs, called with
 * the session user's id after the action's session check.
 */
export function createKeyVerificationDeps(supabase: UserSupabaseClient, userId: string): KeyVerificationDeps {
  const writer = createAiWriterClient(userId);
  let keyRpc: ReturnType<typeof createServiceRoleClient> | undefined;
  return {
    supabase,
    userId,
    keyRpc: () => (keyRpc ??= createServiceRoleClient("resumate-provider-key")),
    store: createSupabaseJobStore(writer),
    usage: createSupabaseUsageStore(writer),
    kms: getKms,
    keySource: createAppKeySource(userId),
    verify: ({ provider, apiKey, signal }) => verifyProviderKey({ provider, apiKey, signal }),
    log: logJobEvent,
  };
}
