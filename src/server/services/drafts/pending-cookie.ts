import type { DraftOptions } from "@/types/db";

/**
 * W3-2: the settings of a career description whose row AI-03 hasn't written yet
 * wait in a short-lived httpOnly cookie between S-17 and the route. QA-W5-02:
 * the value names the user it belongs to and a read for anyone else is null, so
 * a shared browser never hands the next user the previous user's ids. Sign-out
 * and account deletion clear it (`clearUserScopedCookies`). No Next.js imports.
 */
export const PENDING_CAREER_DESCRIPTION_COOKIE = "resumate_pending_career_description";

/** Long enough to get from S-17 to the first stream event; a stale value only shows a stand-in for its own id. */
export const PENDING_MAX_AGE_S = 30 * 60;

export interface PendingCareerDescription {
  id: string;
  user_id: string;
  application_project_id: string;
  options: DraftOptions;
  regenerated_from_id: string | null;
  /** the stream failed before a row existed: S-19 shows a failed draft instead of "generating" */
  ended: boolean;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const isUuid = (v: unknown): v is string => typeof v === "string" && UUID.test(v);

export function encodePendingCookie(pending: PendingCareerDescription): string {
  return Buffer.from(JSON.stringify(pending)).toString("base64url");
}

/**
 * Null for a missing, broken, foreign (other user) or mismatched (`id`) value.
 * Everything in it is still re-checked under RLS by its readers.
 */
export function decodePendingCookie(raw: string | undefined, userId: string, id?: string): PendingCareerDescription | null {
  if (!raw) return null;
  let value: unknown;
  try {
    value = JSON.parse(Buffer.from(raw, "base64url").toString("utf8"));
  } catch {
    return null;
  }
  if (!value || typeof value !== "object") return null;
  const p = value as Partial<PendingCareerDescription>;
  if (p.user_id !== userId || !isUuid(p.id) || !isUuid(p.application_project_id)) return null;
  if (p.regenerated_from_id != null && !isUuid(p.regenerated_from_id)) return null;
  if (!p.options || typeof p.options !== "object" || Array.isArray(p.options)) return null;
  if (id && p.id !== id) return null;
  return {
    id: p.id,
    user_id: p.user_id,
    application_project_id: p.application_project_id,
    options: p.options as DraftOptions,
    regenerated_from_id: p.regenerated_from_id ?? null,
    ended: p.ended === true,
  };
}
