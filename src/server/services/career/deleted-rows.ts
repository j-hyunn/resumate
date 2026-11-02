/**
 * QA-W5-06 (2): a create retried with its `client_id` (first response lost) must not bring back a
 * row the user deleted meanwhile in another tab. The DB can't tell a first insert from that retry
 * (no tombstones), so the deleting request leaves the id in a short-lived, user-bound httpOnly
 * cookie of the same browser, and a create with a listed `client_id` answers `not_found` (the
 * screens' `gone`), like a save by id of a deleted row. Other devices aren't covered (spec-gaps).
 * Children of a deleted parent fail on their FK anyway. No Next.js imports.
 */
export const DELETED_ROWS_COOKIE = "resumate_deleted_rows";
/** A lost-response retry comes within seconds; keep a margin. */
export const DELETED_ROWS_MAX_AGE_S = 30 * 60;
/** Bounded so the cookie stays far below the 4 KB limit (40 × 36 chars). */
export const DELETED_ROWS_MAX = 40;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type Payload = { u: string; ids: string[] };

export function decodeDeletedRows(raw: string | undefined, userId: string): string[] {
  if (!raw) return [];
  try {
    const p = JSON.parse(Buffer.from(raw, "base64url").toString("utf8")) as Partial<Payload>;
    if (p.u !== userId || !Array.isArray(p.ids)) return [];
    return p.ids.filter((x): x is string => typeof x === "string" && UUID.test(x)).slice(-DELETED_ROWS_MAX);
  } catch {
    return [];
  }
}

/** Adds `id` (newest last, deduped, bounded). A value of another user is dropped. */
export function encodeDeletedRows(raw: string | undefined, userId: string, id: string): string {
  const ids = [...decodeDeletedRows(raw, userId).filter((x) => x !== id), id].slice(-DELETED_ROWS_MAX);
  return Buffer.from(JSON.stringify({ u: userId, ids } satisfies Payload)).toString("base64url");
}

export function isDeletedRow(raw: string | undefined, userId: string, id: string): boolean {
  return decodeDeletedRows(raw, userId).includes(id);
}
