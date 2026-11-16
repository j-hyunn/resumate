"use client"

/**
 * A refused AI start (409, 04 §2.11.7) → the C-20 retry-refusal row to show. The server may fold "consent needed"
 * into `key_missing`, so the connection is re-read to pick the row (02 C-20 "다시 시도 거부", G-34).
 * (Moved from the retired `extract-first.tsx` — R17 / v5.21 JR-1 removed the requirements-first extraction.)
 */
import { notifyAiConnectionChanged } from "@/components/common/ai-connection-context"
import type { AiRejected } from "@/lib/data/ai-errors"
import { getAiConnectionAction } from "@/lib/data/actions"
import type { AiRetryRefusalCode } from "@/types/db"

export async function refusalOf(r: AiRejected): Promise<AiRetryRefusalCode> {
  if (r.rejected === "key_invalid") return "key_invalid"
  const fresh = await getAiConnectionAction()
  notifyAiConnectionChanged()
  if (fresh.active_provider && fresh.key_status === "invalid") return "key_invalid"
  if (fresh.active_provider && fresh.consent_required) return "ai_consent_required"
  return "key_missing"
}
