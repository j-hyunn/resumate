import "server-only";
import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { DEK_BYTES, GCM_NONCE_BYTES, GCM_TAG_BYTES, KeyCryptoError, bindingOf, type KmsAdapter, type KmsContext } from "./kms";

/**
 * Envelope encryption of a user's provider API key (DM 2.11.2, NFR-KEY-02/03).
 *
 * - Per key a random 32-byte DEK; the key is encrypted with AES-256-GCM, a
 *   12-byte random nonce, AAD = `${userId}|${provider}|${keyId}` (UTF-8) so a
 *   ciphertext copied onto another row (another user, provider, or row id)
 *   fails to decrypt.
 * - The DEK is wrapped by the KMS (KEK outside the DB) with the same binding.
 * - Plaintext and DEK buffers are zero-filled right after use. The plaintext
 *   string a caller passes in (or gets back) can't be zeroed in JS — keep its
 *   lifetime to one provider call and never store, log, or return it.
 *
 * key_ciphertext = GCM ciphertext || 16-byte tag.
 */

export const ENCRYPTION_VERSION = 1;

export type KeyBinding = { userId: string; provider: string; keyId: string };

export type EncryptedProviderKey = {
  keyCiphertext: Buffer;
  keyNonce: Buffer;
  wrappedDek: Buffer;
  kekId: string;
  encryptionVersion: number;
};

export async function encryptProviderKey(plaintext: string, binding: KeyBinding, kms: KmsAdapter): Promise<EncryptedProviderKey> {
  const dek = randomBytes(DEK_BYTES);
  const input = Buffer.from(plaintext, "utf8");
  try {
    const keyNonce = randomBytes(GCM_NONCE_BYTES);
    const cipher = createCipheriv("aes-256-gcm", dek, keyNonce);
    cipher.setAAD(bindingOf(binding));
    const keyCiphertext = Buffer.concat([cipher.update(input), cipher.final(), cipher.getAuthTag()]);
    const { wrappedDek, kekId } = await kms.wrap(dek, binding);
    return { keyCiphertext, keyNonce, wrappedDek, kekId, encryptionVersion: ENCRYPTION_VERSION };
  } finally {
    input.fill(0);
    dek.fill(0);
  }
}

/**
 * Unwraps the DEK and decrypts. Any mismatch (other row's AAD, tampered bytes,
 * wrong KEK id) throws `KeyCryptoError` with a code only.
 */
export async function decryptProviderKey(
  encrypted: EncryptedProviderKey,
  binding: KeyBinding,
  kms: KmsAdapter,
  audit: Pick<KmsContext, "aiJobId"> = {},
): Promise<string> {
  if (encrypted.encryptionVersion !== ENCRYPTION_VERSION) throw new KeyCryptoError("unsupported_version");
  if (encrypted.keyNonce.length !== GCM_NONCE_BYTES || encrypted.keyCiphertext.length <= GCM_TAG_BYTES) {
    throw new KeyCryptoError("decrypt_failed");
  }
  const dek = await kms.unwrap(encrypted.wrappedDek, encrypted.kekId, { ...binding, ...audit });
  let output: Buffer | null = null;
  try {
    const body = encrypted.keyCiphertext.subarray(0, encrypted.keyCiphertext.length - GCM_TAG_BYTES);
    const tag = encrypted.keyCiphertext.subarray(encrypted.keyCiphertext.length - GCM_TAG_BYTES);
    const decipher = createDecipheriv("aes-256-gcm", dek, encrypted.keyNonce);
    decipher.setAAD(bindingOf(binding));
    decipher.setAuthTag(tag);
    // QA-S3b-03: update()/final() return their own plaintext buffers; zero them too.
    let head: Buffer | null = null;
    let tail: Buffer | null = null;
    try {
      head = decipher.update(body);
      tail = decipher.final();
      output = Buffer.concat([head, tail]);
    } catch {
      throw new KeyCryptoError("decrypt_failed");
    } finally {
      head?.fill(0);
      tail?.fill(0);
    }
    return output.toString("utf8");
  } finally {
    output?.fill(0);
    dek.fill(0);
  }
}

/** Last 4 characters for display (F-AI-01 (3)). The only part of a key that may leave the server. */
export function keyLast4(plaintext: string): string {
  return plaintext.trim().slice(-4);
}

// ---------- PostgREST bytea encoding ----------

/** bytea → PostgREST input (`\x` hex). */
export function toByteaHex(value: Buffer): string {
  return `\\x${value.toString("hex")}`;
}

/** PostgREST bytea output (`\x` hex) → Buffer. */
export function fromByteaHex(value: string): Buffer {
  if (!value.startsWith("\\x")) throw new KeyCryptoError("decrypt_failed");
  const hex = value.slice(2);
  if (hex.length % 2 !== 0 || !/^[0-9a-f]*$/i.test(hex)) throw new KeyCryptoError("decrypt_failed");
  return Buffer.from(hex, "hex");
}
