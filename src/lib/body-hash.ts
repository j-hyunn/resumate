/**
 * `base_body_hash` (DM 2.5.0, v4.11 OD-P5): shared by the server (src/server/ai/context-pack/deliverable-chat.ts)
 * and the browser (the deliverable draft card compares the current form body before [본문 교체]).
 *
 * No Node or DOM imports here, so it bundles for both. The digest uses Web Crypto (`globalThis.crypto.subtle`,
 * available in browsers and Node 20+). The server keeps a sync variant over `node:crypto` that hashes the same
 * normalized string — the two are checked for parity in body-hash.test.ts.
 */

export const BODY_HASH_PREFIX = "sha256:"

/**
 * Whitespace normalization before hashing (DM 2.5.0 steps 1–4):
 *   1. `\r\n` and lone `\r` → `\n`
 *   2. trailing spaces (U+0020) and tabs (U+0009) removed from every line
 *   3. 3+ consecutive `\n` (2+ blank lines) → `\n\n` (one blank line)
 *   4. trailing newlines at the very end removed
 * Leading indentation, spaces inside a line, other whitespace characters (NBSP, full-width space, …) and
 * Unicode normalization (NFC etc.) are left untouched — markdown list / code-block meaning is preserved.
 * Leading newlines at the start of the body are also kept (the rule doesn't list them).
 */
export function normalizeBodyForHash(body: string): string {
  return body
    .replace(/\r\n?/g, "\n")
    .replace(/[ \t]+$/gm, "")
    .replace(/\n{3,}/g, "\n\n")
    .replace(/\n+$/, "")
}

/** `"sha256:" + lowercase hex(SHA-256(UTF-8(normalizeBodyForHash(body))))` — DM 2.5.0 step 5. */
export async function computeBodyHash(body: string): Promise<string> {
  const bytes = new TextEncoder().encode(normalizeBodyForHash(body))
  const digest = await globalThis.crypto.subtle.digest("SHA-256", bytes)
  return BODY_HASH_PREFIX + Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("")
}
