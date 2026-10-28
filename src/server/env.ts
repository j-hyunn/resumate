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
