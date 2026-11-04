"use client"

/**
 * C-19 공급자·등급 배지 (02 C-19, design-system 3.19). Text only — no provider logos (Q-4).
 *
 * - <ProviderBadge connection={…} />      연결 배지: next to AI run buttons, C-03 card head, S-36 top,
 *                                         S-40 active card. Link → settings dialog "AI 연결" (S-40).
 * - <ProviderResultTag provider model_tier model />   결과 배지 "Gemini · 기본로 만든 결과" (S-16/S-19/S-22)
 * - providerRunLabel(session)              목록 열 "실행 공급자" (S-20 / S-37 / S-22)
 */
import * as React from "react"
import { CircleHelp, Cpu, KeyRound, ScrollText, TriangleAlert } from "lucide-react"
import { cn } from "@/lib/utils"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import type { AiConnection, AiProviderName, InterviewSession, ModelTier } from "@/types/db"
import { CONNECTION_TIER_LABELS, MODEL_TIER_LABELS } from "@/lib/data/labels"
import { AI_PROVIDER_LABELS } from "@/lib/mock/ai-providers"
import { SettingsLink } from "@/components/common/shell/settings-dialog"
import { useAiConnection } from "./ai-connection-context"

/** "Gemini · 무료 등급" / "Claude · 유료" */
export function connectionLabel(c: Pick<AiConnection, "active_provider" | "connection_tier">): string {
  if (!c.active_provider) return "AI 연결 안 됨"
  return `${AI_PROVIDER_LABELS[c.active_provider]} · ${CONNECTION_TIER_LABELS[c.connection_tier ?? "paid"]}`
}

/** AiConnection without `consent_required` (older callers build it from key rows) */
export type ConnectionLike = Pick<AiConnection, "active_provider" | "key_status" | "connection_tier"> & {
  consent_required?: boolean | null
}

/** Full C-19 text incl. warning states. v5.3 (G-33): consent needed → "{공급자} · {등급} · 동의 필요" */
export function connectionStatusText(c: ConnectionLike): string {
  if (!c.active_provider) return "AI 연결 안 됨"
  if (c.key_status === "invalid") return `${AI_PROVIDER_LABELS[c.active_provider]} · 키를 확인해 주세요`
  if (c.consent_required) return `${connectionLabel(c)} · 동의 필요`
  if (c.key_status === "needs_check") return `${connectionLabel(c)} · 확인 필요`
  return connectionLabel(c)
}

// [UI-가정] G-18 paid tooltip copy; free copy is the spec's 무료 등급 툴팁
const FREE_TIP = "무료 등급은 입력이 Google 제품 개선에 쓰이고 사람이 검토할 수 있어요. 민감정보·회사 기밀은 넣지 마세요"

function tooltipText(c: ConnectionLike): string {
  if (!c.active_provider) return ""
  if (c.key_status === "invalid") return "키를 확인해 주세요. 눌러서 키를 교체하세요"
  // [UI-가정] G-33 consent badge tooltip
  if (c.consent_required) return "데이터 사용 고지에 동의해야 실행할 수 있어요"
  if (c.key_status === "needs_check") return "키 상태를 확인하지 못했어요(한도 또는 일시 오류)"
  if (c.connection_tier === "free" && c.active_provider === "gemini") return FREE_TIP
  return `연결한 ${AI_PROVIDER_LABELS[c.active_provider]} 키로 실행돼요`
}

/**
 * 연결 배지. Renders nothing when no provider is active (C-18 replaces the run button then).
 * `connection` defaults to the AiConnectionProvider value. Next to retry / re-run buttons it is
 * the provider active **now** (A1), not the job's provider.
 * States: valid / needs_check (주의) / invalid (경고) / v5.3 consent_required (동의 필요, G-33).
 */
export function ProviderBadge({ connection: explicit, className }: { connection?: ConnectionLike | null; className?: string }) {
  const connection = useAiConnection(
    explicit ? ({ consent_required: null, ...explicit } as AiConnection) : explicit === null ? null : undefined,
  )
  if (!connection?.active_provider) return null
  const consent = connection.key_status !== "invalid" && connection.consent_required === true
  const warn = connection.key_status === "invalid" || connection.key_status === "needs_check" || consent
  const Icon =
    connection.key_status === "invalid" ? TriangleAlert : consent ? ScrollText : connection.key_status === "needs_check" ? CircleHelp : KeyRound
  const text = connectionStatusText(connection)
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <SettingsLink
          // UQ-208: warning states go straight to that provider's S-40 card
          section="ai-connection"
          provider={warn ? connection.active_provider : null}
          aria-label={`AI 연결: ${text}. AI 연결 설정 열기`}
          className={cn(
            "inline-flex h-6 shrink-0 items-center gap-1 rounded-full border px-2 text-xs font-medium transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background max-md:h-8",
            warn
              ? "border-transparent bg-warning-subtle text-warning-subtle-foreground hover:bg-warning-subtle/80"
              : "border-border text-muted-foreground hover:bg-accent",
            className,
          )}
        >
          <Icon className="size-3 shrink-0" aria-hidden />
          <span className="whitespace-nowrap">{text}</span>
        </SettingsLink>
      </TooltipTrigger>
      <TooltipContent className="max-w-xs">{tooltipText(connection)}</TooltipContent>
    </Tooltip>
  )
}

/** "Gemini · 기본" */
export function providerTierLabel(provider: AiProviderName, tier: ModelTier | null | undefined): string {
  return `${AI_PROVIDER_LABELS[provider]} · ${MODEL_TIER_LABELS[tier ?? "default"]}`
}

/**
 * 결과 배지 (caption, not a button). The raw model id lives only in the tooltip (focusable).
 * Copy: spec "Gemini · 기본로 만든 결과" (조사 그대로, 기획 확인 P-7).
 */
export function ProviderResultTag({
  provider,
  model_tier,
  model,
  className,
}: {
  provider: AiProviderName | null | undefined
  model_tier?: ModelTier | null
  model?: string | null
  className?: string
}) {
  if (!provider) return null
  const label = `${providerTierLabel(provider, model_tier)}로 만든 결과`
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span
          tabIndex={0}
          className={cn(
            "inline-flex items-center gap-1 rounded-sm text-xs font-medium text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
            className,
          )}
        >
          <Cpu className="size-3.5" aria-hidden />
          {label}
        </span>
      </TooltipTrigger>
      <TooltipContent>{model ? `모델: ${model}` : label}</TooltipContent>
    </Tooltip>
  )
}

/**
 * 세션 목록 "실행 공급자" 열 (04 §2.7 v4.1): evaluation_provider once grading started, else
 * question_provider; both when they differ ("질문 Gemini · 채점 Claude"). No question yet → "—".
 */
export function providerRunLabel(
  s: Pick<InterviewSession, "question_provider" | "evaluation_provider"> & {
    /** InterviewSessionRow (A4 request 2) */
    question_model_tier?: ModelTier | null
    evaluation_model_tier?: ModelTier | null
  },
  tier?: ModelTier,
): string {
  const q = s.question_provider
  const e = s.evaluation_provider
  if (q && e && q !== e) return `질문 ${AI_PROVIDER_LABELS[q]} · 채점 ${AI_PROVIDER_LABELS[e]}`
  const p = e ?? q
  const t = tier ?? (e ? s.evaluation_model_tier : s.question_model_tier) ?? "default"
  return p ? providerTierLabel(p, t) : "—"
}
