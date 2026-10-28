import "server-only";
import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

/**
 * KMS adapter (DM 2.11.2, NFR-KEY-02, decisions B-2). Wraps / unwraps the
 * per-key data encryption key (DEK) with a key-encryption key (KEK) that never
 * lives in the database.
 *
 * `context` binds a wrapped DEK to its key row (user, provider, row id) — the
 * same idea as KMS "encryption context": unwrapping with another row's context
 * fails, and a real KMS writes it to its audit log (DM 2.11.2 감사).
 *
 * Errors carry a code only — never key material, DEK bytes, or KEK bytes.
 */

export type KmsContext = {
  userId: string;
  provider: string;
  keyId: string;
  /** Set on run-time decryption (audit: which job asked). Not part of the binding. */
  aiJobId?: string;
};

export interface KmsAdapter {
  /** KEK identifier + version written to ai_provider_keys.kek_id (rotation). */
  readonly kekId: string;
  wrap(dek: Buffer, context: KmsContext): Promise<{ wrappedDek: Buffer; kekId: string }>;
  /** Returns a fresh DEK buffer; the caller zeroes it after use. */
  unwrap(wrappedDek: Buffer, kekId: string, context: KmsContext): Promise<Buffer>;
}

export type KeyCryptoErrorCode = "kek_mismatch" | "unwrap_failed" | "decrypt_failed" | "unsupported_version" | "kms_not_configured";

export class KeyCryptoError extends Error {
  readonly code: KeyCryptoErrorCode;
  constructor(code: KeyCryptoErrorCode) {
    // Code only: no bytes, no ids that could help an attacker, no plaintext.
    super(`key crypto error: ${code}`);
    this.name = "KeyCryptoError";
    this.code = code;
  }
}

export const DEK_BYTES = 32;
export const GCM_NONCE_BYTES = 12;
export const GCM_TAG_BYTES = 16;

/** wrapped_dek format of EnvKms: [version 1 byte][nonce 12][ciphertext 32][tag 16]. */
const ENV_WRAP_FORMAT = 1;

/** The binding string used as AAD for the DEK wrap (and the key encryption, see envelope.ts). */
export function bindingOf(context: Pick<KmsContext, "userId" | "provider" | "keyId">): Buffer {
  return Buffer.from(`${context.userId}|${context.provider}|${context.keyId}`, "utf8");
}

/**
 * ⚠️ PRE-LAUNCH STAND-IN — REPLACE WITH A CLOUD KMS BEFORE LAUNCH (decisions B-2,
 * DM 2.11.2 `[가정]`, deployment checklist in _workspace/backend/S3b notes).
 *
 * The KEK is a 32-byte master key from an encrypted environment variable
 * (`AI_KEY_KEK_BASE64`, id `AI_KEY_KEK_ID`). This keeps the database copy
 * useless on its own (NFR-KEY-02), but anyone who can read the server's env
 * can unwrap every DEK — the separation of duties NFR-KEY-07 asks for needs a
 * KMS whose decrypt permission only the runtime identity has, with audit logs.
 * Swap this class for an AWS KMS / GCP KMS adapter with the same interface;
 * rows keep working through `kek_id` (re-wrap DEKs, no key re-encryption).
 */
export class EnvKms implements KmsAdapter {
  readonly kekId: string;
  readonly #kek: Buffer;

  constructor(kek: Buffer, kekId: string) {
    if (kek.length !== DEK_BYTES) throw new KeyCryptoError("kms_not_configured");
    if (!kekId.trim()) throw new KeyCryptoError("kms_not_configured");
    // Own copy, so a caller zeroing its buffer can't break us (and vice versa).
    this.#kek = Buffer.from(kek);
    this.kekId = kekId;
  }

  async wrap(dek: Buffer, context: KmsContext): Promise<{ wrappedDek: Buffer; kekId: string }> {
    const nonce = randomBytes(GCM_NONCE_BYTES);
    const cipher = createCipheriv("aes-256-gcm", this.#kek, nonce);
    cipher.setAAD(bindingOf(context));
    const body = Buffer.concat([cipher.update(dek), cipher.final()]);
    const wrappedDek = Buffer.concat([Buffer.from([ENV_WRAP_FORMAT]), nonce, body, cipher.getAuthTag()]);
    body.fill(0);
    return { wrappedDek, kekId: this.kekId };
  }

  async unwrap(wrappedDek: Buffer, kekId: string, context: KmsContext): Promise<Buffer> {
    if (kekId !== this.kekId) throw new KeyCryptoError("kek_mismatch");
    if (wrappedDek.length !== 1 + GCM_NONCE_BYTES + DEK_BYTES + GCM_TAG_BYTES || wrappedDek[0] !== ENV_WRAP_FORMAT) {
      throw new KeyCryptoError("unwrap_failed");
    }
    const nonce = wrappedDek.subarray(1, 1 + GCM_NONCE_BYTES);
    const body = wrappedDek.subarray(1 + GCM_NONCE_BYTES, 1 + GCM_NONCE_BYTES + DEK_BYTES);
    const tag = wrappedDek.subarray(1 + GCM_NONCE_BYTES + DEK_BYTES);
    // QA-S3b-03: zero the DEK pieces update()/final() return; only the concat copy goes back (caller zeroes it).
    let head: Buffer | null = null;
    let tail: Buffer | null = null;
    try {
      const decipher = createDecipheriv("aes-256-gcm", this.#kek, nonce);
      decipher.setAAD(bindingOf(context));
      decipher.setAuthTag(tag);
      head = decipher.update(body);
      tail = decipher.final();
      return Buffer.concat([head, tail]);
    } catch {
      throw new KeyCryptoError("unwrap_failed");
    } finally {
      head?.fill(0);
      tail?.fill(0);
    }
  }
}

/**
 * Builds the configured KMS from env values. Throws `kms_not_configured`
 * (never echoing the value) when the KEK is missing or not 32 bytes.
 */
export function createEnvKms(env: { AI_KEY_KEK_BASE64?: string; AI_KEY_KEK_ID?: string }): EnvKms {
  if (!env.AI_KEY_KEK_BASE64 || !env.AI_KEY_KEK_ID) throw new KeyCryptoError("kms_not_configured");
  const kek = Buffer.from(env.AI_KEY_KEK_BASE64, "base64");
  try {
    return new EnvKms(kek, env.AI_KEY_KEK_ID);
  } finally {
    kek.fill(0);
  }
}
