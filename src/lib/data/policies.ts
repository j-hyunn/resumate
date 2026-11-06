/**
 * S-30 AI 데이터 처리 문서(`/policies/ai_data_use`)의 공급자별 요약 원천 (UX v5.17 S-30 SD-A13, DM v4.12 2.1.3 ·
 * 2.11.6): `ai_disclosures` 공급자 × 등급 6행의 현재 행. Server only. 로그인 없이 열리는 페이지라 anon
 * 읽기(`ai_disclosures_select_all`)를 쓴다. 머리글 "버전 · 시행일"은 `getPolicyVersions().ai_data_use`.
 *
 * UI 42 신설 함수 — 새 RPC·액션 없이 기존 서비스(`loadCurrentDisclosureRow`)를 다시 쓴다.
 */
import type { AiDisclosure, AiProviderName, ConnectionTier } from "@/types/db"
import { clone, mockRequest } from "@/lib/mock/store"
import { previewOr } from "./source"
import { createSupabaseServerClient } from "@/server/db/server"
import { loadCurrentDisclosureRow } from "@/server/services/ai-connection/consent"

const COMBOS: ReadonlyArray<[AiProviderName, ConnectionTier]> = [
  ["gemini", "free"],
  ["gemini", "paid"],
  ["openai", "free"],
  ["openai", "paid"],
  ["anthropic", "free"],
  ["anthropic", "paid"],
]

/** 공급자 × 등급마다 지금 시행 중인 고지 행 (없는 조합은 빠진다). 순서 = Gemini → GPT → Claude, 무료 → 유료 */
export async function getCurrentAiDisclosures(): Promise<AiDisclosure[]> {
  return previewOr(
    async () => {
      const db = await mockRequest(0)
      const now = Date.now()
      return clone(
        COMBOS.flatMap(([provider, tier]) => {
          const row = db.ai_disclosures
            .filter((d) => d.provider === provider && d.connection_tier === tier && Date.parse(d.effective_at) <= now)
            .sort((a, b) => b.effective_at.localeCompare(a.effective_at))[0]
          return row ? [row] : []
        }),
      )
    },
    async () => {
      const supabase = await createSupabaseServerClient()
      const rows = await Promise.all(COMBOS.map(([provider, tier]) => loadCurrentDisclosureRow(supabase, provider, tier)))
      return rows.flatMap((row, i) => {
        if (!row) return []
        const [provider, tier] = COMBOS[i]
        return [{ ...row, provider, connection_tier: tier, terms_checked_at: row.terms_checked_at ?? "" } as AiDisclosure]
      })
    },
  )
}
