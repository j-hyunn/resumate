import "server-only";
import { AiError, ProviderError } from "@/server/ai/errors";
import type { KeySecretReader } from "@/server/db/key-reader";
import type { KeySource } from "@/server/jobs/provider-context";
import { decryptProviderKey, fromByteaHex } from "./envelope";
import type { KmsAdapter } from "./kms";

/**
 * Run-time key for one provider call (DM 2.11.2 복호화 경로, NFR-KEY-03):
 * app_key_reader → `get_provider_key_secret(ai_job_id)` → KMS unwrap → AES-GCM
 * decrypt, per call, nothing cached. The plaintext goes straight to the
 * adapter call (createLlm) and is dropped after it.
 *
 * - no key row (deleted mid-run, D-36) → `ProviderError("key_missing")`
 * - RPC refused (job no longer running / heartbeat stale / not this user's):
 *   the runner has lost the job → `AiError("stalled")`, no provider call.
 * - decryption failure (tampered row, wrong KEK) → `KeyCryptoError`
 *   (code only); the runner records `stalled`.
 */
export function createEnvelopeKeySource(options: { userId: string; reader: KeySecretReader; kms: KmsAdapter }): KeySource {
  return {
    async forJob(jobId, provider) {
      // The runner always binds the job's provider; without it the AAD can't be built.
      if (!provider) throw new AiError("stalled", { retryable: false });
      const secret = await options.reader.getProviderKeySecret(jobId);
      if (secret.kind === "missing") throw new ProviderError("key_missing", { provider: null });
      if (secret.kind === "not_available") throw new AiError("stalled", { retryable: false });
      const row = secret.row;
      return decryptProviderKey(
        {
          keyCiphertext: fromByteaHex(row.key_ciphertext),
          keyNonce: fromByteaHex(row.key_nonce),
          wrappedDek: fromByteaHex(row.wrapped_dek),
          kekId: row.kek_id,
          encryptionVersion: row.encryption_version,
        },
        { userId: options.userId, provider, keyId: row.key_id },
        options.kms,
        { aiJobId: jobId },
      );
    },
  };
}
