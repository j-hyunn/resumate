/**
 * (Re)consent rule (04 §2.11.5, v4.2 A20), shared by the mock gate (lib/mock/ai.ts) and
 * get_data_readiness().ai_connection.consent_required (lib/data/ai-connection.ts). Server only.
 *
 * Needed when there is no live consent for (provider, tier), or a disclosure version with
 * `requires_reconsent = true` took effect after the consent was given.
 */
import type { AiProviderName, ConnectionTier } from "@/types/db"
import type { MockDb } from "./fixtures"

export function consentRequired(db: MockDb, provider: AiProviderName, tier: ConnectionTier): boolean {
  const live = [...db.ai_data_use_consents]
    .reverse()
    .find((c) => c.provider === provider && c.connection_tier === tier && !c.withdrawn_at)
  if (!live) return true
  return db.ai_disclosures.some(
    (d) =>
      d.provider === provider &&
      d.connection_tier === tier &&
      d.requires_reconsent &&
      d.version !== live.disclosure_version &&
      d.effective_at > live.agreed_at,
  )
}
