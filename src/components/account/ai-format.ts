/**
 * A1 AI 연결·사용량 formatting helpers (client-safe). design-system 5.7: 금액 "$" + 소수 2자리,
 * 0 < x < 0.01 → "< $0.01", 토큰 ko-KR 천 단위 구분 [가정], 시각 KST.
 */
import type { AiFailureCause, AiProviderName, ConnectionTier } from "@/types/db"
import { codeForCause } from "@/lib/data/ai-errors"
import { aiErrorTitle } from "@/components/common/ai-error-notice"
import { AI_PROVIDER_LABELS } from "@/lib/mock/ai-providers"

export function formatUsd(n: number): string {
  if (n > 0 && n < 0.01) return "< $0.01"
  return `$${n.toFixed(2)}`
}

// UQ-270: 가격표 단가 — 소수 2자리 이상(최대 3자리)으로 맞춰 열 정렬, 예: 0.10 / 3.00 / 0.075
const unitPriceFmt = new Intl.NumberFormat("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 3 })
export function formatUnitPrice(n: number | null): string {
  return n === null ? "—" : unitPriceFmt.format(n)
}

const tokenFmt = new Intl.NumberFormat("ko-KR")
export function formatTokens(n: number): string {
  return tokenFmt.format(n)
}

const kstDateTime = new Intl.DateTimeFormat("ko-KR", {
  timeZone: "Asia/Seoul",
  month: "long",
  day: "numeric",
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
})
/** "10월 28일 14:02" (KST) */
export function formatKstDateTime(iso: string): string {
  return kstDateTime.format(new Date(iso))
}

const kstDay = new Intl.DateTimeFormat("ko-KR", { timeZone: "Asia/Seoul", year: "numeric", month: "long", day: "numeric" })
/** "2026년 10월 1일" */
export function formatKstDay(iso: string): string {
  return kstDay.format(new Date(iso))
}

/** S-40 무효 카드 원인 문구 (`last_failure_cause` → C-20 title) */
export function failureCauseText(cause: AiFailureCause | null, provider: AiProviderName): string {
  if (!cause) return `${AI_PROVIDER_LABELS[provider]} 키가 더 이상 작동하지 않아요. 새 키로 바꿔 주세요`
  return aiErrorTitle(codeForCause(cause), { provider: AI_PROVIDER_LABELS[provider] })
}

/** 키 확인 예상 시간 (S-41 ③, S-40 다시 확인): 유료 "최대 5초", 무료 "최대 10초 정도" */
export function verifyEta(tier: ConnectionTier): string {
  return tier === "free" ? "최대 10초 정도" : "최대 5초"
}
