import { createHash } from "node:crypto";
import type { ConsentStatus, ConsentStatusItem } from "@/lib/contracts/consent";
import { CONSENT_TYPES, type ConsentType, type OPTIONAL_CONSENT_TYPES } from "@/lib/contracts/enums";
import { AppError } from "@/lib/contracts/errors";
import { mapDbError } from "@/server/db/errors";
import type { UserSupabaseClient } from "@/server/db/types";

type OptionalConsentType = (typeof OPTIONAL_CONSENT_TYPES)[number];

/** F-COM-02 consent gate and recording. RPCs: get_consent_status, record_consents (DM A.2). */

type RpcClient = Pick<UserSupabaseClient, "rpc">;

type ConsentStatusRow = {
  consent_type: string;
  required: boolean;
  current_version: string | null;
  agreed_version: string | null;
  needs_consent: boolean;
};

function isConsentType(value: string): value is ConsentType {
  return (CONSENT_TYPES as readonly string[]).includes(value);
}

export function toConsentStatus(rows: readonly ConsentStatusRow[]): ConsentStatus {
  const items: ConsentStatusItem[] = [];
  for (const row of rows) {
    // An unknown type means migrations and enums.ts drifted — fail loudly, not silently skip.
    if (!isConsentType(row.consent_type)) {
      throw new AppError("internal_error", undefined, { status: 500, cause: new Error(`unknown consent_type ${row.consent_type}`) });
    }
    items.push({
      consentType: row.consent_type,
      required: row.required,
      currentVersion: row.current_version ?? null,
      agreedVersion: row.agreed_version ?? null,
      needsConsent: row.needs_consent,
    });
  }
  return { items, needsRequiredConsent: items.some((i) => i.required && i.needsConsent) };
}

export async function getConsentStatus(supabase: RpcClient): Promise<ConsentStatus> {
  const { data, error } = await supabase.rpc("get_consent_status");
  if (error) throw mapDbError(error);
  return toConsentStatus(data ?? []);
}

/** SHA-256 of the User-Agent (NFR-PRV-02 audit trail without storing the raw string). */
export function hashUserAgent(userAgent: string | null | undefined): string | null {
  if (!userAgent) return null;
  return createHash("sha256").update(userAgent).digest("hex");
}

/**
 * Records one row per item. Versions are chosen by the server (record_consents),
 * never sent by the client.
 */
export async function submitConsents(
  supabase: RpcClient,
  items: readonly { consentType: ConsentType; agreed: boolean }[],
  userAgent: string | null,
): Promise<ConsentStatus> {
  const userAgentHash = hashUserAgent(userAgent);
  const { data, error } = await supabase.rpc("record_consents", {
    items: items.map((i) => ({ consent_type: i.consentType, agreed: i.agreed })),
    ...(userAgentHash ? { user_agent_hash: userAgentHash } : {}),
  });
  if (error) throw mapDbError(error);
  return toConsentStatus(data ?? []);
}

/**
 * Withdraws the user's active agreement to an optional consent (S-24). No RPC:
 * RLS + column grant allow `withdrawn_at` on own, agreed, not-yet-withdrawn
 * optional rows only. Idempotent: nothing active → no-op.
 */
export async function withdrawOptionalConsent(
  supabase: Pick<UserSupabaseClient, "from" | "rpc">,
  consentType: OptionalConsentType,
): Promise<ConsentStatus> {
  const { error } = await supabase
    .from("consents")
    .update({ withdrawn_at: new Date().toISOString() })
    .eq("consent_type", consentType)
    .eq("agreed", true)
    .is("withdrawn_at", null);
  if (error) throw mapDbError(error);
  return getConsentStatus(supabase);
}
