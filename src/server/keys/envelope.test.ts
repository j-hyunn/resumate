import { randomBytes } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { decryptProviderKey, encryptProviderKey, fromByteaHex, keyLast4, toByteaHex, type KeyBinding } from "./envelope";
import { isPlausibleProviderKey, keyVerificationTarget, uuidV5 } from "./format";
import { EnvKms, KeyCryptoError, createEnvKms, type KmsAdapter } from "./kms";

// Fake keys only (never a real provider key in tests).
const FAKE_KEY = "sk-ant-FAKE-test-key-0000000000000000wxyz";
const KEK = randomBytes(32);
const kms = new EnvKms(KEK, "env-test-v1");
const binding: KeyBinding = {
  userId: "11111111-1111-4111-8111-111111111111",
  provider: "anthropic",
  keyId: "22222222-2222-4222-8222-222222222222",
};

async function cryptoError(p: Promise<unknown>): Promise<string> {
  try {
    await p;
  } catch (err) {
    expect(err).toBeInstanceOf(KeyCryptoError);
    expect(String((err as Error).message)).not.toContain(FAKE_KEY);
    return (err as KeyCryptoError).code;
  }
  throw new Error("expected KeyCryptoError");
}

describe("envelope encryption (DM 2.11.2)", () => {
  it("round-trips and never stores the plaintext", async () => {
    const enc = await encryptProviderKey(FAKE_KEY, binding, kms);
    expect(enc.kekId).toBe("env-test-v1");
    expect(enc.encryptionVersion).toBe(1);
    expect(enc.keyNonce).toHaveLength(12);
    expect(enc.wrappedDek).toHaveLength(1 + 12 + 32 + 16);
    for (const b of [enc.keyCiphertext, enc.keyNonce, enc.wrappedDek]) {
      expect(b.toString("utf8")).not.toContain(FAKE_KEY.slice(0, 12));
      expect(b.toString("hex")).not.toContain(Buffer.from(FAKE_KEY).toString("hex").slice(0, 16));
    }
    expect(await decryptProviderKey(enc, binding, kms)).toBe(FAKE_KEY);
  });

  it("uses a fresh DEK and nonce per encryption", async () => {
    const a = await encryptProviderKey(FAKE_KEY, binding, kms);
    const b = await encryptProviderKey(FAKE_KEY, binding, kms);
    expect(a.keyCiphertext.equals(b.keyCiphertext)).toBe(false);
    expect(a.keyNonce.equals(b.keyNonce)).toBe(false);
    expect(a.wrappedDek.equals(b.wrappedDek)).toBe(false);
  });

  it("fails when the row binding (AAD) differs: other user, provider, or row id", async () => {
    const enc = await encryptProviderKey(FAKE_KEY, binding, kms);
    for (const other of [
      { ...binding, userId: "33333333-3333-4333-8333-333333333333" },
      { ...binding, provider: "openai" },
      { ...binding, keyId: "44444444-4444-4444-8444-444444444444" },
    ]) {
      expect(await cryptoError(decryptProviderKey(enc, other, kms))).toBe("unwrap_failed");
    }
  });

  it("fails when a ciphertext is moved onto another row that has its own valid DEK (swap attack)", async () => {
    const other: KeyBinding = { ...binding, keyId: "55555555-5555-4555-8555-555555555555" };
    const victim = await encryptProviderKey(FAKE_KEY, binding, kms);
    const attacker = await encryptProviderKey("sk-ant-FAKE-other-key-1111111111111111", other, kms);
    // Attacker row keeps its wrapped DEK but gets the victim's ciphertext + nonce.
    const swapped = { ...attacker, keyCiphertext: victim.keyCiphertext, keyNonce: victim.keyNonce };
    expect(await cryptoError(decryptProviderKey(swapped, other, kms))).toBe("decrypt_failed");
  });

  it("fails on tampered ciphertext, tag, nonce, or wrapped DEK", async () => {
    const enc = await encryptProviderKey(FAKE_KEY, binding, kms);
    const flip = (b: Buffer, i: number) => {
      const c = Buffer.from(b);
      c[i] = c[i]! ^ 0x01;
      return c;
    };
    expect(await cryptoError(decryptProviderKey({ ...enc, keyCiphertext: flip(enc.keyCiphertext, 0) }, binding, kms))).toBe("decrypt_failed");
    expect(
      await cryptoError(decryptProviderKey({ ...enc, keyCiphertext: flip(enc.keyCiphertext, enc.keyCiphertext.length - 1) }, binding, kms)),
    ).toBe("decrypt_failed");
    expect(await cryptoError(decryptProviderKey({ ...enc, keyNonce: flip(enc.keyNonce, 0) }, binding, kms))).toBe("decrypt_failed");
    expect(await cryptoError(decryptProviderKey({ ...enc, wrappedDek: flip(enc.wrappedDek, 5) }, binding, kms))).toBe("unwrap_failed");
    expect(await cryptoError(decryptProviderKey({ ...enc, keyNonce: Buffer.alloc(8) }, binding, kms))).toBe("decrypt_failed");
  });

  it("refuses another KEK id and an unknown encryption version", async () => {
    const enc = await encryptProviderKey(FAKE_KEY, binding, kms);
    expect(await cryptoError(decryptProviderKey({ ...enc, kekId: "env-v2" }, binding, kms))).toBe("kek_mismatch");
    expect(await cryptoError(decryptProviderKey({ ...enc, encryptionVersion: 2 }, binding, kms))).toBe("unsupported_version");
    // Same id but a different KEK (rotated without changing the id) still fails.
    const otherKms = new EnvKms(randomBytes(32), "env-test-v1");
    expect(await cryptoError(decryptProviderKey(enc, binding, otherKms))).toBe("unwrap_failed");
  });

  it("zero-fills the DEK it handed to the KMS and the unwrapped DEK", async () => {
    const seen: Buffer[] = [];
    const spy: KmsAdapter = {
      kekId: kms.kekId,
      wrap: async (dek, ctx) => {
        seen.push(dek);
        return kms.wrap(dek, ctx);
      },
      unwrap: async (w, id, ctx) => {
        const dek = await kms.unwrap(w, id, ctx);
        seen.push(dek);
        return dek;
      },
    };
    const enc = await encryptProviderKey(FAKE_KEY, binding, spy);
    await decryptProviderKey(enc, binding, spy, { aiJobId: "66666666-6666-4666-8666-666666666666" });
    expect(seen).toHaveLength(2);
    for (const dek of seen) expect(dek.equals(Buffer.alloc(32))).toBe(true);
  });

  it("zero-fills the decrypted plaintext buffer", async () => {
    const enc = await encryptProviderKey(FAKE_KEY, binding, kms);
    const fills: Buffer[] = [];
    const original = Buffer.prototype.fill;
    const spy = vi.spyOn(Buffer.prototype, "fill").mockImplementation(function (this: Buffer, ...args: unknown[]) {
      fills.push(this);
      return (original as (...a: unknown[]) => Buffer).apply(this, args);
    });
    try {
      await decryptProviderKey(enc, binding, kms);
    } finally {
      spy.mockRestore();
    }
    // DEK + plaintext output buffer, both zeroed.
    expect(fills.length).toBeGreaterThanOrEqual(2);
    for (const b of fills) expect(b.every((x) => x === 0)).toBe(true);
  });

  it("bytea hex helpers round-trip and reject garbage", () => {
    const b = randomBytes(40);
    expect(fromByteaHex(toByteaHex(b)).equals(b)).toBe(true);
    expect(() => fromByteaHex("abcd")).toThrow(KeyCryptoError);
    expect(() => fromByteaHex("\\xzz")).toThrow(KeyCryptoError);
  });

  it("keyLast4 keeps only 4 characters", () => {
    expect(keyLast4(`  ${FAKE_KEY}\n`)).toBe("wxyz");
  });
});

describe("EnvKms configuration (B-2 pre-launch stand-in)", () => {
  it("requires a 32-byte KEK and an id, without echoing the value", () => {
    const bad = Buffer.from("short").toString("base64");
    expect(() => createEnvKms({ AI_KEY_KEK_BASE64: bad, AI_KEY_KEK_ID: "env-v1" })).toThrow(/kms_not_configured/);
    expect(() => createEnvKms({ AI_KEY_KEK_BASE64: KEK.toString("base64") })).toThrow(/kms_not_configured/);
    try {
      createEnvKms({ AI_KEY_KEK_BASE64: bad, AI_KEY_KEK_ID: "env-v1" });
    } catch (err) {
      expect(String(err)).not.toContain(bad);
    }
    expect(createEnvKms({ AI_KEY_KEK_BASE64: KEK.toString("base64"), AI_KEY_KEK_ID: "env-v1" }).kekId).toBe("env-v1");
  });
});

describe("key format and verification target", () => {
  it("accepts plausible keys per provider and refuses the obviously wrong", () => {
    expect(isPlausibleProviderKey("anthropic", FAKE_KEY)).toBe(true);
    expect(isPlausibleProviderKey("openai", "sk-proj-FAKE000000000000000000")).toBe(true);
    expect(isPlausibleProviderKey("gemini", "AIzaFAKE0000000000000000000000000000000")).toBe(true);
    expect(isPlausibleProviderKey("gemini", FAKE_KEY)).toBe(false);
    expect(isPlausibleProviderKey("openai", "sk-short")).toBe(false);
    expect(isPlausibleProviderKey("openai", "sk-FAKE 0000000000000000000000")).toBe(false);
    expect(isPlausibleProviderKey("openai", `sk-${"a".repeat(600)}`)).toBe(false);
  });

  it("uuidV5 matches RFC 4122 test vector and targets are stable per provider", () => {
    // RFC 4122 / Python uuid.uuid5(NAMESPACE_DNS, "python.org")
    expect(uuidV5("python.org", "6ba7b810-9dad-11d1-80b4-00c04fd430c8")).toBe("886313e1-3b8a-5372-9b90-0c9aee199e5d");
    expect(keyVerificationTarget("gemini")).toEqual(keyVerificationTarget("gemini"));
    expect(keyVerificationTarget("gemini").id).not.toBe(keyVerificationTarget("openai").id);
    expect(keyVerificationTarget("openai").type).toBe("ai_provider");
  });
});
