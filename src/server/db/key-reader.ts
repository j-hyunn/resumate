import "server-only";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { getServerEnv } from "@/server/env";
import { signRoleToken } from "./ai-writer";
import type { Database } from "./database.types";

/**
 * app_key_reader client (DM 2.11.2, DM §5, NFR-KEY-03/07/08). Server-only.
 *
 * The role has no table privileges; its only grant is EXECUTE on
 * `get_provider_key_secret(ai_job_id)`, which returns a key's ciphertext for a
 * RUNNING job of the same user (JWT `sub`) with a fresh heartbeat. This module
 * exposes only that call — callers never get the raw client.
 *
 * Same mechanism as app_ai_writer (S1): short-lived HS256 JWT,
 * `role = app_key_reader`, `sub = userId`, role granted to authenticator.
 */

export const KEY_READER_ROLE = "app_key_reader";
/** One RPC per provider call; a minute is plenty. */
export const KEY_READER_TOKEN_TTL_SECONDS = 60;

/** bytea columns arrive as PostgREST `\x…` hex strings. */
export type ProviderKeySecretRow = {
  key_id: string;
  key_ciphertext: string;
  key_nonce: string;
  wrapped_dek: string;
  kek_id: string;
  encryption_version: number;
};

export type KeySecretResult =
  | { kind: "found"; row: ProviderKeySecretRow }
  /** The job is fine but the user has no key for its provider (deleted mid-run, D-36 → key_missing). */
  | { kind: "missing" }
  /** RPC refused (job not running / stale heartbeat / other user): P0001 key_not_available. */
  | { kind: "not_available" };

export interface KeySecretReader {
  getProviderKeySecret(aiJobId: string): Promise<KeySecretResult>;
}

export function signKeyReaderToken(userId: string, options: { secret: string; issuer: string; now?: Date }): string {
  return signRoleToken(KEY_READER_ROLE, userId, { ...options, maxTtlSeconds: KEY_READER_TOKEN_TTL_SECONDS });
}

/** Maps the RPC response. Errors carry the DB code only (no row data). Exported for tests. */
export function toKeySecretResult(
  data: unknown,
  error: { code?: string | null; message?: string | null } | null,
): KeySecretResult {
  if (error) {
    if (error.code === "P0001" && error.message === "key_not_available") return { kind: "not_available" };
    throw new KeyReaderError(error.code ?? "unknown");
  }
  const rows = Array.isArray(data) ? (data as ProviderKeySecretRow[]) : [];
  if (rows.length === 0) return { kind: "missing" };
  return { kind: "found", row: rows[0]! };
}

export class KeyReaderError extends Error {
  readonly dbCode: string;
  constructor(dbCode: string) {
    super(`get_provider_key_secret failed (${dbCode})`);
    this.name = "KeyReaderError";
    this.dbCode = dbCode;
  }
}

/** Creates the key reader for one user. Sign per request (accessToken callback). */
export function createKeySecretReader(userId: string): KeySecretReader {
  const env = getServerEnv();
  const issuer = `${env.NEXT_PUBLIC_SUPABASE_URL.replace(/\/$/, "")}/auth/v1`;
  signKeyReaderToken(userId, { secret: env.SUPABASE_JWT_SECRET, issuer });

  const client: SupabaseClient<Database> = createClient<Database>(env.NEXT_PUBLIC_SUPABASE_URL, env.NEXT_PUBLIC_SUPABASE_ANON_KEY, {
    accessToken: async () => signKeyReaderToken(userId, { secret: env.SUPABASE_JWT_SECRET, issuer }),
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    global: { headers: { "X-Client-Info": "resumate-key-reader" } },
  });

  return {
    async getProviderKeySecret(aiJobId) {
      const { data, error } = await client.rpc("get_provider_key_secret", { p_ai_job_id: aiJobId });
      return toKeySecretResult(data, error);
    },
  };
}
