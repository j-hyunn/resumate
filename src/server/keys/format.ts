import "server-only";
import { createHash } from "node:crypto";
import type { AiProvider } from "@/lib/contracts/enums";

/**
 * Loose provider key format check before any provider call (S-41 ③ "{공급자} 키
 * 형식이 아니에요"). Loose on purpose: providers change formats, and a real
 * check is the verification call (C-10.5). Only obviously wrong input — empty,
 * whitespace inside, wrong well-known prefix, absurd length — is refused here.
 */
const PREFIX: Record<AiProvider, string> = {
  openai: "sk-",
  anthropic: "sk-ant-",
  gemini: "AIza",
};

export const KEY_MIN_LENGTH = 20;
export const KEY_MAX_LENGTH = 512;

export function isPlausibleProviderKey(provider: AiProvider, key: string): boolean {
  if (key.length < KEY_MIN_LENGTH || key.length > KEY_MAX_LENGTH) return false;
  // Printable ASCII, no whitespace (a pasted key with a space or newline inside is not a key).
  if (!/^[\x21-\x7e]+$/.test(key)) return false;
  return key.startsWith(PREFIX[provider]);
}

/** Trims surrounding whitespace that copy-paste adds. Everything else is kept as typed. */
export function normalizeProviderKey(key: string): string {
  return key.trim();
}

// ---------- key_verification job target (S3a spec-gaps "대상 없는 작업") ----------

/** ai_jobs.target_type of key_verification jobs. */
export const KEY_VERIFICATION_TARGET_TYPE = "ai_provider";

/** Fixed namespace for provider target ids (random v4, generated once for Resumate). */
const PROVIDER_TARGET_NAMESPACE = "5f1d3c7a-8e2b-4f6a-9c1d-2b7e4a9f0c31";

/** RFC 4122 v5 (SHA-1, name-based). */
export function uuidV5(name: string, namespace: string): string {
  const ns = Buffer.from(namespace.replace(/-/g, ""), "hex");
  const hash = createHash("sha1").update(Buffer.concat([ns, Buffer.from(name, "utf8")])).digest();
  const bytes = hash.subarray(0, 16);
  bytes[6] = (bytes[6]! & 0x0f) | 0x50;
  bytes[8] = (bytes[8]! & 0x3f) | 0x80;
  const hex = bytes.toString("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

/**
 * key_verification target: `target_type = 'ai_provider'`, `target_id =
 * uuidv5(provider)`. Same id for every user — the in-flight unique index is
 * per (user_id, job_type, target), so this means one verification in flight
 * per user and provider. Stable across key replacement (the row id isn't).
 */
export function keyVerificationTarget(provider: AiProvider): { type: string; id: string } {
  return { type: KEY_VERIFICATION_TARGET_TYPE, id: uuidV5(provider, PROVIDER_TARGET_NAMESPACE) };
}
