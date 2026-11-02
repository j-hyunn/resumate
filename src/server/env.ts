import "server-only";
import { z } from "zod";
import { AI_PROVIDERS, CONNECTION_TIERS } from "@/lib/contracts/enums";

/**
 * Server-side environment. Import env values only through this module.
 * Values are never logged; validation errors name the key, not the value.
 *
 * Client components must read `process.env.NEXT_PUBLIC_*` as literal property
 * accesses (Next.js inlines them at build time) — do not import this module there.
 */
/**
 * Public Supabase values only. The proxy and the user-session client validate
 * just these (QA-06), so a missing AI or cron secret can't take down every page.
 */
export const PublicEnvSchema = z.object({
  NEXT_PUBLIC_SUPABASE_URL: z.url(),
  NEXT_PUBLIC_SUPABASE_ANON_KEY: z.string().min(1),
  // Public origin for auth redirect URLs (magic link, OAuth). Required in
  // production (checked in getSiteOrigin, QA-10); in development and Vercel
  // preview the request origin is used when unset. Must be on Supabase Auth's
  // redirect allow-list either way.
  NEXT_PUBLIC_SITE_URL: z.url().optional(),
});

export type PublicEnv = z.infer<typeof PublicEnvSchema>;

/**
 * QA-S3b-04: KEK values that are public (a value once shipped in .env.example)
 * or obviously not random (one repeated byte, or fewer than 16 distinct bytes)
 * are refused — with them a DB copy alone would reveal every key (NFR-KEY-02).
 */
const PUBLISHED_EXAMPLE_KEKS = new Set(["ZHVtbXktZHVtbXktZHVtbXktZHVtbXktZHVtbXktMDA="]);
export function isUsableKek(base64: string): boolean {
  if (PUBLISHED_EXAMPLE_KEKS.has(base64)) return false;
  const bytes = Buffer.from(base64, "base64");
  return new Set(bytes).size >= 16;
}

export const ServerEnvSchema = PublicEnvSchema.extend({
  // Signs short-lived app_ai_writer JWTs (DM-13, decided in S1).
  SUPABASE_JWT_SECRET: z.string().min(32),
  // Bearer token Vercel Cron sends to /api/cron/* routes.
  CRON_SECRET: z.string().min(16),
  // Service role key — used ONLY by src/server/jobs/cron.ts (cron,
  // cross-user). Optional so pages and AI work don't depend on it; the sweep
  // fails closed when it's missing.
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(1).optional(),
  // There is no service-wide LLM key (BYOK, D-28/D-34). Development only:
  // one provider + key for local runs before S3b key storage
  // (src/server/jobs/provider-context.ts). Ignored (dropped) in production,
  // and the dev key source throws there.
  AI_DEV_PROVIDER: z.enum(AI_PROVIDERS).optional(),
  AI_DEV_API_KEY: z.string().min(1).optional(),
  AI_DEV_CONNECTION_TIER: z.enum(CONNECTION_TIERS).optional(),
  // BYOK key-encryption key (DM 2.11.2, decisions B-2). PRE-LAUNCH STAND-IN:
  // a 32-byte master key (base64) from an encrypted env var + its id/version
  // written to ai_provider_keys.kek_id. Replace with a cloud KMS before launch
  // (src/server/keys/kms.ts). Optional here so pages don't depend on it; key
  // registration and AI runs fail closed (internal_error) when it's missing.
  AI_KEY_KEK_BASE64: z
    .string()
    .refine((v) => /^[A-Za-z0-9+/]+={0,2}$/.test(v) && Buffer.from(v, "base64").length === 32, "must be 32 bytes, base64")
    .refine((v) => isUsableKek(v), "must be randomly generated (published example / low-entropy value)")
    .optional(),
  AI_KEY_KEK_ID: z.string().regex(/^[A-Za-z0-9._:-]{1,64}$/).optional(),
  // HMAC key for account_deletion_logs.subject_hash (S9, D-DM-02: the log holds
  // only HMAC(user id), never the id or email). At least 32 characters, random.
  // Optional so pages don't depend on it; account deletion fails closed
  // (internal_error, nothing deleted) when it's missing. Changing it only
  // affects new log rows — the hash is never looked up again.
  ACCOUNT_DELETION_HASH_SECRET: z
    .string()
    .min(32)
    .refine((v) => new Set(v).size >= 16, "must be randomly generated (low-entropy value)")
    .optional(),
});

const DEV_ONLY_KEYS = ["AI_DEV_PROVIDER", "AI_DEV_API_KEY", "AI_DEV_CONNECTION_TIER"] as const;

export type ServerEnv = z.infer<typeof ServerEnvSchema>;

export class EnvValidationError extends Error {
  readonly keys: string[];

  constructor(keys: string[], details: string[]) {
    super(`Invalid server environment: ${details.join("; ")}`);
    this.name = "EnvValidationError";
    this.keys = keys;
  }
}

type EnvSource = Record<string, string | undefined>;

function parseWith<S extends typeof PublicEnvSchema | typeof ServerEnvSchema>(schema: S, source: EnvSource): z.infer<S> {
  // Treat empty strings as missing so `KEY=` in .env.local fails loudly.
  const cleaned: EnvSource = {};
  for (const key of Object.keys(schema.shape)) {
    const value = source[key];
    cleaned[key] = value === undefined || value.trim() === "" ? undefined : value;
  }

  const result = schema.safeParse(cleaned);
  if (result.success) return result.data as z.infer<S>;

  const keys = [...new Set(result.error.issues.map((issue) => String(issue.path[0])))];
  // Build messages from path + zod's generic message only; never include input values.
  const details = result.error.issues.map((issue) => {
    const key = String(issue.path[0]);
    return cleaned[key] === undefined ? `${key} is missing` : `${key} is invalid (${issue.message})`;
  });
  throw new EnvValidationError(keys, details);
}

/** Parses an env source. Pure, so it can be tested without touching process.env. */
export function parseServerEnv(source: EnvSource): ServerEnv {
  if (source.NODE_ENV !== "production") return parseWith(ServerEnvSchema, source);
  const withoutDev: EnvSource = { ...source };
  for (const key of DEV_ONLY_KEYS) delete withoutDev[key];
  return parseWith(ServerEnvSchema, withoutDev);
}

/** Parses only the public Supabase keys. */
export function parsePublicEnv(source: EnvSource): PublicEnv {
  return parseWith(PublicEnvSchema, source);
}

let cached: ServerEnv | undefined;
let cachedPublic: PublicEnv | undefined;

/**
 * Lazily parsed and cached server env. Lazy so `next build` and unit tests that
 * never touch env don't need real values.
 */
export function getServerEnv(): ServerEnv {
  cached ??= parseServerEnv(process.env);
  return cached;
}

/**
 * Public Supabase env for the proxy, the user-session client, and auth
 * redirects. Doesn't require AI / cron / JWT secrets.
 */
export function getPublicEnv(): PublicEnv {
  cachedPublic ??= parsePublicEnv(process.env);
  return cachedPublic;
}

/** Test-only: drop the cached env so the next read re-parses process.env. */
export function resetServerEnvCache(): void {
  cached = undefined;
  cachedPublic = undefined;
}
