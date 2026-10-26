import { createHmac, timingSafeEqual } from "node:crypto";
import type { JobRef } from "./types";

/**
 * Token for the runner's self-invoke (`POST /api/ai-jobs/{id}/continue`).
 * A yielded job continues in a NEW function invocation so none exceeds the
 * 60 s budget (C-6); the request carries no user cookie, so it proves itself
 * with this HMAC over (jobId, userId, exp).
 *
 * Key: SUPABASE_JWT_SECRET with a domain-separation prefix (no extra env var).
 * The token only lets the holder resume that one queued job of that user —
 * it can't read data or start new work.
 */

export const CONTINUE_TOKEN_TTL_SECONDS = 120;
const DOMAIN = "resumate:ai-job-continue:v1";

type Payload = { j: string; u: string; e: number };

function sign(body: string, secret: string): string {
  return createHmac("sha256", `${DOMAIN}:${secret}`).update(body).digest("base64url");
}

export function signContinueToken(ref: JobRef, secret: string, now = new Date()): string {
  const payload: Payload = { j: ref.jobId, u: ref.userId, e: Math.floor(now.getTime() / 1000) + CONTINUE_TOKEN_TTL_SECONDS };
  const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
  return `${body}.${sign(body, secret)}`;
}

/** Returns the job ref when the token is valid, unexpired, and for `jobId`; else null. */
export function verifyContinueToken(token: string, jobId: string, secret: string, now = new Date()): JobRef | null {
  const [body, sig, extra] = token.split(".");
  if (!body || !sig || extra !== undefined) return null;
  const expected = Buffer.from(sign(body, secret));
  const given = Buffer.from(sig);
  if (expected.length !== given.length || !timingSafeEqual(expected, given)) return null;
  let payload: Payload;
  try {
    payload = JSON.parse(Buffer.from(body, "base64url").toString("utf8")) as Payload;
  } catch {
    return null;
  }
  if (typeof payload.j !== "string" || typeof payload.u !== "string" || typeof payload.e !== "number") return null;
  if (payload.j !== jobId) return null;
  if (payload.e < Math.floor(now.getTime() / 1000)) return null;
  return { jobId: payload.j, userId: payload.u };
}
