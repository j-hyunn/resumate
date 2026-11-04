"use client"

/**
 * ProviderCard (design-system 5.7) — S-40 공급자 카드와 S-41 공급자 선택 카드.
 *
 *   grid grid-cols-[auto_1fr_auto]: [라디오 자리] [이름 · 추천 배지 / 설명 / 상태 줄] [동작]
 *
 * The card never reads `?state=` (the settings dialog renders it outside <Suspense>).
 */
import * as React from "react"
import { Circle, CircleCheck, CircleHelp, KeyRound, Loader2, PauseCircle, ScrollText, TriangleAlert } from "lucide-react"
import type { AiProviderName, AiProviderKeyPublic, ConnectionTier } from "@/types/db"
import { cn } from "@/lib/utils"
import { Badge } from "@/components/ui/badge"
import { CONNECTION_TIER_LABELS } from "@/lib/data/labels"
import { AI_PROVIDER_FULL_NAMES, AI_PROVIDER_LABELS } from "@/lib/mock/ai-providers"
import { failureCauseText, formatKstDateTime, verifyEta } from "./ai-format"

export type ProviderCardState = "unconnected" | "connected" | "invalid" | "needs_check" | "rechecking" | "paused"

export function providerCardState(opts: {
  key: AiProviderKeyPublic | null
  isAvailable: boolean
  rechecking?: boolean
}): ProviderCardState {
  if (!opts.isAvailable) return "paused"
  if (!opts.key) return "unconnected"
  if (opts.rechecking) return "rechecking"
  if (opts.key.status === "invalid") return "invalid"
  if (opts.key.status === "needs_check") return "needs_check"
  return "connected"
}

/** 추천 배지 — design-system badge `recommend` */
export function RecommendBadge() {
  return <Badge variant="recommend">추천: 무료로 시작</Badge>
}

/**
 * C-19 연결 배지 look (static). S-40 itself is the badge's link target, so the card shows a
 * non-link copy of the badge text [UI-가정].
 * v5.3 `consent` (active card, `ai_connection.consent_required`, key valid / needs_check): 동의 필요형
 * "{공급자} · {등급} · 동의 필요" + ScrollText (design-system 3.19 / 5.7 (v3), G-33 — same text as ProviderBadge).
 */
export function StaticConnectionBadge({
  provider,
  tier,
  status,
  consent = false,
}: {
  provider: AiProviderName
  tier: ConnectionTier
  status: AiProviderKeyPublic["status"]
  consent?: boolean
}) {
  const needsConsent = consent && status !== "invalid"
  const warn = status !== "valid" || needsConsent
  const Icon =
    status === "invalid" ? TriangleAlert : needsConsent ? ScrollText : status === "needs_check" ? CircleHelp : KeyRound
  const text =
    status === "invalid"
      ? `${AI_PROVIDER_LABELS[provider]} · 키를 확인해 주세요`
      : `${AI_PROVIDER_LABELS[provider]} · ${CONNECTION_TIER_LABELS[tier]}${needsConsent ? " · 동의 필요" : status === "needs_check" ? " · 확인 필요" : ""}`
  return (
    <span
      className={cn(
        "inline-flex min-h-6 max-w-full items-center gap-1 rounded-full border px-2 py-0.5 text-xs font-medium sm:shrink-0",
        warn ? "border-transparent bg-warning-subtle text-warning-subtle-foreground" : "border-border text-muted-foreground",
      )}
    >
      <Icon className="size-3 shrink-0" aria-hidden />
      {/* UQ-452: wraps on narrow cards instead of running under the buttons */}
      <span className="sm:whitespace-nowrap">{text}</span>
    </span>
  )
}

export function KeyMask({ last4 }: { last4: string }) {
  return <span className="font-mono">••••{last4}</span>
}

/** 상태 줄 (design-system 5.7 표) */
export function ProviderStatusLine({
  state,
  provider,
  keyRow,
}: {
  state: ProviderCardState
  provider: AiProviderName
  keyRow: AiProviderKeyPublic | null
}) {
  const name = AI_PROVIDER_LABELS[provider]
  switch (state) {
    case "unconnected":
      return (
        <p className="flex items-center gap-1.5 text-sm text-muted-foreground">
          <Circle className="size-4 shrink-0" aria-hidden />
          연결 안 됨
        </p>
      )
    case "paused":
      return (
        <p className="flex items-start gap-1.5 text-sm text-muted-foreground">
          <PauseCircle className="mt-0.5 size-4 shrink-0" aria-hidden />
          {name} 연결을 잠시 멈췄어요. 이미 연결한 키는 계속 보관돼요
        </p>
      )
    case "rechecking":
      return (
        <p className="flex items-center gap-1.5 text-sm" role="status">
          <Loader2 className="size-4 shrink-0 animate-spin text-ai" aria-hidden />
          다시 확인 중… {verifyEta(keyRow?.connection_tier ?? "paid")}
        </p>
      )
    case "invalid":
      return (
        <div className="space-y-0.5 text-sm">
          <p className="flex items-start gap-1.5">
            <TriangleAlert className="mt-0.5 size-4 shrink-0 text-warning" aria-hidden />
            {failureCauseText(keyRow?.last_failure_cause ?? null, provider)}
          </p>
          {keyRow?.last_failure_at ? (
            <p className="pl-5.5 text-muted-foreground tabular-nums">{formatKstDateTime(keyRow.last_failure_at)} 확인</p>
          ) : null}
        </div>
      )
    case "needs_check":
      return (
        <div className="space-y-0.5 text-sm">
          <p className="flex items-start gap-1.5">
            <CircleHelp className="mt-0.5 size-4 shrink-0 text-warning" aria-hidden />
            키는 인증됐지만 한도 때문에 확인을 끝내지 못했어요. 그대로 쓸 수 있어요
          </p>
          {keyRow ? (
            <p className="pl-5.5 text-muted-foreground tabular-nums">
              <KeyMask last4={keyRow.key_last4} /> · {CONNECTION_TIER_LABELS[keyRow.connection_tier]}
            </p>
          ) : null}
        </div>
      )
    case "connected":
      return keyRow ? (
        <p className="flex flex-wrap items-center gap-x-1.5 text-sm tabular-nums">
          <CircleCheck className="size-4 shrink-0 text-success" aria-hidden />
          연결됨 · <KeyMask last4={keyRow.key_last4} /> · {CONNECTION_TIER_LABELS[keyRow.connection_tier]}
          {keyRow.last_verified_at ? ` · 마지막 확인 ${formatKstDateTime(keyRow.last_verified_at)}` : null}
        </p>
      ) : null
  }
}

/**
 * v5.3 동의 필요 둘째 줄 (02 S-40 공급자 카드 "동의 필요", R-67; design-system 5.7 (v3)): the key status
 * line stays, this line goes under it on the active card while `consent_required = true`.
 */
export function ProviderConsentLine({ provider, tier }: { provider: AiProviderName; tier: ConnectionTier }) {
  return (
    <p className="flex items-start gap-1.5 text-sm">
      <ScrollText className="mt-0.5 size-4 shrink-0 text-warning" aria-hidden />
      {AI_PROVIDER_LABELS[provider]}({CONNECTION_TIER_LABELS[tier]})의 데이터 사용 고지가 바뀌어 다시 동의해야 AI를 쓸 수 있어요
    </p>
  )
}

const BORDER: Record<ProviderCardState, string> = {
  unconnected: "",
  connected: "",
  rechecking: "",
  invalid: "border-warning",
  needs_check: "border-warning/60",
  paused: "bg-muted/50",
}

/** Stable anchor for deep links to an S-40 card (UQ-267, C-19 경고 → "S-40 해당 카드"): `provider-card-gemini` (routes.settings("ai-connection", provider)) */
export function providerCardId(provider: AiProviderName): string {
  return `provider-card-${provider}`
}

/**
 * Card frame shared by S-40 and S-41. `radio` / `action` slots are filled by the screen.
 * `inButton` (S-41 공급자 선택): the whole card is a <button>, so only phrasing content is
 * rendered (spans styled as blocks, no heading) — UQ-264.
 */
export function ProviderCardFrame({
  provider,
  description,
  recommended,
  state,
  active,
  radio,
  badge,
  statusLine,
  action,
  footer,
  inButton = false,
  anchor = false,
  className,
}: {
  provider: AiProviderName
  description: string
  recommended: boolean
  state: ProviderCardState
  active?: boolean
  radio?: React.ReactNode
  badge?: React.ReactNode
  statusLine?: React.ReactNode
  action?: React.ReactNode
  footer?: React.ReactNode
  inButton?: boolean
  /** S-40: give the card its stable id (scroll target) */
  anchor?: boolean
  className?: string
}) {
  const frame = cn(
    // inButton: the wrapping Item paints hover/background, so the frame stays transparent (UQ-721)
    "grid grid-cols-[auto_1fr_auto] gap-x-3 gap-y-2 rounded-lg border p-4",
    inButton ? "bg-transparent" : "bg-card",
    active ? "border-primary bg-primary-subtle/40" : BORDER[state],
    className,
  )
  if (inButton)
    return (
      <span className={frame}>
        <span className="flex w-4 items-start pt-1" />
        <span className="block min-w-0 space-y-1">
          <span className="flex flex-wrap items-center gap-2">
            <span className="text-base leading-6 font-semibold">{AI_PROVIDER_FULL_NAMES[provider]}</span>
            {recommended ? <RecommendBadge /> : null}
          </span>
          <span className="block text-sm leading-5 text-muted-foreground">{description}</span>
          {statusLine}
        </span>
        <span />
      </span>
    )
  return (
    <div id={anchor ? providerCardId(provider) : undefined} className={cn(frame, anchor && "scroll-mt-24")}>
      <div className="flex w-4 items-start pt-1">{radio}</div>
      <div className="min-w-0 space-y-1">
        <div className="flex flex-wrap items-center gap-2">
          <h3 className="text-base leading-6 font-semibold">{AI_PROVIDER_FULL_NAMES[provider]}</h3>
          {recommended ? <RecommendBadge /> : null}
          {badge}
        </div>
        <p className="text-sm leading-5 text-muted-foreground">{description}</p>
        {statusLine}
      </div>
      <div className="flex items-start gap-1">{action}</div>
      {footer ? <div className="col-span-3 col-start-1 sm:col-span-2 sm:col-start-2">{footer}</div> : null}
    </div>
  )
}
