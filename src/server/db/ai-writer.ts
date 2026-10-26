import "server-only";
import { createHmac, randomUUID } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import { getServerEnv } from "@/server/env";
import type { Database } from "./database.types";
import type { AiWriterSupabaseClient } from "./types";

/**
 * app_ai_writer client (DM-13). Server-only: AI work reads career data and
 * writes AI result tables as this role, never as the user session.
 *
 * How (decided in S1): a short-lived HS256 JWT signed with SUPABASE_JWT_SECRET,
 * `role = app_ai_writer`, `sub = userId`. PostgREST's authenticator switches
 * into app_ai_writer (granted to authenticator in the S1 migration), and RLS
 * policies still see the user id through the `sub` claim.
 *
 * Grants are per column: always list columns. `select('*')` fails with 42501
 * (e.g. profiles.display_name is never readable — DM A.1).
 */

export const AI_WRITER_ROLE = "app_ai_writer";
/** Token lifetime. One AI step stays under 60 s (T-14); 5 minutes is the ceiling. */
export const AI_WRITER_TOKEN_TTL_SECONDS = 300;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function base64url(input: string | Buffer): string {
  return Buffer.from(input).toString("base64url");
}

export type AiWriterClaims = {
  role: typeof AI_WRITER_ROLE;
  sub: string;
  aud: "authenticated";
  iss: string;
  iat: number;
  exp: number;
  jti: string;
};

/** Pure: builds and signs the JWT. Exported for tests. */
export function signAiWriterToken(
  userId: string,
  options: { secret: string; issuer: string; now?: Date; ttlSeconds?: number },
): string {
  if (!UUID_RE.test(userId)) throw new Error("signAiWriterToken: userId must be a uuid");
  const ttl = Math.min(options.ttlSeconds ?? AI_WRITER_TOKEN_TTL_SECONDS, AI_WRITER_TOKEN_TTL_SECONDS);
  const iat = Math.floor((options.now ?? new Date()).getTime() / 1000);
  const claims: AiWriterClaims = {
    role: AI_WRITER_ROLE,
    sub: userId,
    aud: "authenticated",
    iss: options.issuer,
    iat,
    exp: iat + ttl,
    jti: randomUUID(),
  };
  const header = base64url(JSON.stringify({ alg: "HS256", typ: "JWT" }));
  const payload = base64url(JSON.stringify(claims));
  const signature = createHmac("sha256", options.secret).update(`${header}.${payload}`).digest("base64url");
  return `${header}.${payload}.${signature}`;
}

/**
 * Creates an app_ai_writer client scoped to one user. Create one per job step;
 * the token expires after AI_WRITER_TOKEN_TTL_SECONDS and is re-signed on each
 * request the client makes (accessToken callback), so long steps don't 401.
 */
export function createAiWriterClient(userId: string): AiWriterSupabaseClient {
  const env = getServerEnv();
  const issuer = `${env.NEXT_PUBLIC_SUPABASE_URL.replace(/\/$/, "")}/auth/v1`;
  // Validate eagerly so a bad id fails at creation, not on first query.
  signAiWriterToken(userId, { secret: env.SUPABASE_JWT_SECRET, issuer });

  return createClient<Database>(env.NEXT_PUBLIC_SUPABASE_URL, env.NEXT_PUBLIC_SUPABASE_ANON_KEY, {
    accessToken: async () => signAiWriterToken(userId, { secret: env.SUPABASE_JWT_SECRET, issuer }),
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    global: { headers: { "X-Client-Info": "resumate-ai-writer" } },
  });
}
