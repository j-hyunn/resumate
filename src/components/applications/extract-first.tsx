"use client"

/**
 * v5.3 A13 요건 선행 추출 (FL-03, 02 S-17·S-18, design-system 6장 A3 "S-17·S-18 요건 선행 추출").
 * R17: retired — `useRequirementsFirst` is a pass-through (see below). `refusalOf` stays (shared).
 * When the JD has no requirements yet (registered without a key), the run button first calls AI-01 as a
 * separate request ("공고 요건 정리 중"), waits for it to finish, and only then runs the generation step
 * (AI-11 / 초안 생성 / 문항 생성). A failed extraction shows C-20 inline in the same place and **nothing
 * is created** (no draft row).
 *
 *   const req = useRequirementsFirst(apId, { needed: extractFirst, rerunLabel: "초안 생성" })
 *   <AiRunButton onRun={() => req.run(generate)} disabled={req.busy} … />
 *   {req.slot}
 */
import type * as React from "react"
import { notifyAiConnectionChanged } from "@/components/common/ai-connection-context"
import type { AiRejected } from "@/lib/data/ai-errors"
import { getAiConnectionAction } from "@/lib/data/actions"
import type { AiErrorCode, AiRetryRefusalCode } from "@/types/db"

/**
 * Path ⑤ refusal (요건 추출·서류 = request-scoped work): the server folds "consent needed" into key_missing →
 * re-read the connection to pick the C-20 retry-refusal row (02 C-20 "다시 시도 거부", G-34).
 */
export async function refusalOf(r: AiRejected): Promise<AiRetryRefusalCode> {
  if (r.rejected === "key_invalid") return "key_invalid"
  const fresh = await getAiConnectionAction()
  notifyAiConnectionChanged()
  if (fresh.active_provider && fresh.key_status === "invalid") return "key_invalid"
  if (fresh.active_provider && fresh.consent_required) return "ai_consent_required"
  return "key_missing"
}

export interface RequirementsFirst {
  /** extraction is running (button disabled, "공고 요건 정리 중") */
  busy: boolean
  /** requirements still need extracting before the next run */
  needed: boolean
  /** run AI-01 first when needed, then `next` (its result is returned so AiRunButton handles refusals) */
  run: (next: () => unknown) => Promise<unknown>
  /** status line / C-20 inline under the run button */
  slot: React.ReactNode
}

/**
 * R17 (2026-11-14): there is no requirement extraction (AI-01) any more — the JD is used as raw text —
 * so nothing has to run first: `run(next)` calls `next` right away, never busy, no slot. The hook keeps
 * its signature so the callers compile; removing it from the screens is a UI request.
 */
export function useRequirementsFirst(
  applicationProjectId: string,
  opts: {
    needed: boolean
    rerunLabel: string
    previewFail?: AiErrorCode | null
    jdEditFrom?: { from: "insight" | "cover_letter" }
  },
): RequirementsFirst {
  void applicationProjectId
  void opts
  return { busy: false, needed: false, run: async (next) => next(), slot: null }
}
