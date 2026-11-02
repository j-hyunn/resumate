import "server-only";
import { headers } from "next/headers";
import { AppError } from "@/lib/contracts/errors";
import { getPublicEnv } from "@/server/env";

type OriginInput = {
  configured: string | undefined;
  forwardedHost: string | null;
  host: string | null;
  forwardedProto: string | null;
  nodeEnv: string | undefined;
  vercelEnv: string | undefined;
};

/**
 * Production = Vercel production, or a non-Vercel `next start` (NODE_ENV
 * production without VERCEL_ENV). Vercel preview and `next dev` are not.
 */
export function isProductionDeployment(nodeEnv: string | undefined, vercelEnv: string | undefined): boolean {
  if (vercelEnv) return vercelEnv === "production";
  return nodeEnv === "production";
}

/**
 * Pure origin choice for auth redirect URLs (QA-10):
 * - NEXT_PUBLIC_SITE_URL set → always that origin.
 * - unset in production → fail closed (no Host-header origin in production).
 * - unset in development / Vercel preview → request's forwarded host.
 * Supabase Auth's redirect allow-list is the last line either way.
 */
export function resolveSiteOrigin(input: OriginInput): string {
  if (input.configured) return new URL(input.configured).origin;

  if (isProductionDeployment(input.nodeEnv, input.vercelEnv)) {
    throw new AppError("internal_error", undefined, {
      status: 500,
      cause: new Error("NEXT_PUBLIC_SITE_URL is required in production"),
    });
  }

  const host = input.forwardedHost ?? input.host;
  if (!host) return "http://localhost:3000";
  const isLocal = /^(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/.test(host);
  const proto = input.forwardedProto ?? (isLocal ? "http" : "https");
  return `${proto}://${host}`;
}

/** Public origin for auth redirect URLs (magic link emailRedirectTo, OAuth redirectTo). */
export async function getSiteOrigin(): Promise<string> {
  const configured = getPublicEnv().NEXT_PUBLIC_SITE_URL;
  if (configured) return new URL(configured).origin;
  const h = await headers();
  return resolveSiteOrigin({
    configured,
    forwardedHost: h.get("x-forwarded-host"),
    host: h.get("host"),
    forwardedProto: h.get("x-forwarded-proto"),
    nodeEnv: process.env.NODE_ENV,
    vercelEnv: process.env.VERCEL_ENV,
  });
}
