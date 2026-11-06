"use client"

/**
 * ProviderRow (design-system 5.11.2, UX v5.17 S-40 SD-A1) — S-24 AI 연결 탭의 공급자 라디오 행 3개와
 * S-41 공급자 선택 행. v5.10 `ProviderCard`(카드 3개)를 대체한다.
 *
 *   div.flex flex-col gap-1                           ← 묶음 테두리 없음 (v5.12 원본 화면). S-41만 `bordered`
 *     div#provider-row-{p}.flex items-start gap-2 rounded-lg px-2 py-1.5 min-h-11   (활성 bg-primary/10)
 *       [라디오 size-8 칸 · size="lg"] [1행 이름 w-28 · 플랜 안내 · 배지 / 2행 상태 줄 / 3행 안내] [동작 h-8]
 *
 * The row never reads `?state=` (the settings dialog renders it outside <Suspense>).
 */
import * as React from "react"
import { CircleCheck, CircleHelp, KeyRound, Loader2, PauseCircle, ScrollText, TriangleAlert } from "lucide-react"
import type { AiProviderName, AiProviderKeyPublic, ConnectionTier } from "@/types/db"
import { cn } from "@/lib/utils"
import { Badge } from "@/components/ui/badge"
import { CONNECTION_TIER_LABELS } from "@/lib/data/labels"
import { AI_PROVIDER_LABELS } from "@/lib/mock/ai-providers"
import { failureCauseText, formatKstDateTime, verifyEta } from "./ai-format"
import { PROVIDER_PLAN_NOTES, PROVIDER_ROW_NAMES, PROVIDER_ROW_ORDER } from "./provider-names"

export function sortProviderRows<T extends { info: { provider: AiProviderName } }>(rows: readonly T[]): T[] {
  return [...rows].sort((a, b) => PROVIDER_ROW_ORDER.indexOf(a.info.provider) - PROVIDER_ROW_ORDER.indexOf(b.info.provider))
}

export type ProviderRowState = "unconnected" | "connected" | "invalid" | "needs_check" | "rechecking" | "paused"

export function providerRowState(opts: {
  key: AiProviderKeyPublic | null
  isAvailable: boolean
  rechecking?: boolean
}): ProviderRowState {
  if (!opts.isAvailable) return "paused"
  if (!opts.key) return "unconnected"
  if (opts.rechecking) return "rechecking"
  if (opts.key.status === "invalid") return "invalid"
  if (opts.key.status === "needs_check") return "needs_check"
  return "connected"
}

/**
 * C-19 연결 배지 look (static). S-40 itself is the badge's link target, so the row shows a
 * non-link copy of the badge text (design-system 5.11.2 "상태 배지" — C-19 글자를 그대로 쓴다).
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
      {/* UQ-452: wraps on narrow rows instead of running under the buttons */}
      <span className="sm:whitespace-nowrap">{text}</span>
    </span>
  )
}

export function KeyMask({ last4 }: { last4: string }) {
  return <span className="font-mono">••••{last4}</span>
}

/** 2행 상태 줄 (design-system 5.11.2 공급자 라디오 행 표) */
export function ProviderStatusLine({
  state,
  provider,
  keyRow,
}: {
  state: ProviderRowState
  provider: AiProviderName
  keyRow: AiProviderKeyPublic | null
}) {
  const name = AI_PROVIDER_LABELS[provider]
  switch (state) {
    case "unconnected":
      // 미연결 행은 상태 줄이 없다 (design-system 5.11.2 표)
      return null
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
          <KeyMask last4={keyRow.key_last4} /> · {CONNECTION_TIER_LABELS[keyRow.connection_tier]}
          {keyRow.last_verified_at ? ` · 마지막 확인 ${formatKstDateTime(keyRow.last_verified_at)}` : null}
        </p>
      ) : null
  }
}

/**
 * v5.3 동의 필요 둘째 줄 (02 S-40 공급자 카드 "동의 필요", R-67; design-system 5.7 (v3)): the key status
 * line stays, this line goes under it on the active card while `consent_required = true`.
 */
export function ProviderConsentLine({ provider, tier, reconsent }: { provider: AiProviderName; tier: ConnectionTier; reconsent: boolean }) {
  const name = `${AI_PROVIDER_LABELS[provider]}(${CONNECTION_TIER_LABELS[tier]})`
  return (
    <p className="flex items-start gap-1.5 text-sm">
      <ScrollText className="mt-0.5 size-4 shrink-0 text-warning" aria-hidden />
      {/* Q-15 (v5.13, OD-D1): first consent vs. a changed disclosure */}
      {reconsent ? `${name}의 데이터 사용 고지가 바뀌어 다시 동의해야 AI를 쓸 수 있어요` : `${name}로 AI를 쓰려면 데이터 사용 고지에 동의해 주세요`}
    </p>
  )
}

/** 추천 배지 — design-system badge `recommend` */
export function RecommendBadge() {
  return <Badge variant="recommend">추천: 무료로 시작</Badge>
}

/** Stable anchor for deep links to an S-40 row (C-19 경고 → "S-40 해당 행"): `provider-row-gemini` (routes.settings("ai-connection", provider)) */
export function providerRowId(provider: AiProviderName): string {
  return `provider-row-${provider}`
}

/**
 * 행 묶음 (design-system 5.11.5 v5.12): 기본 = 테두리·구분선 없이 행 사이 4px (S-24 AI 연결 탭, 원본 화면).
 * `bordered` = 한 상자 + `divide-y` — 독립 화면 S-41 공급자 선택만.
 */
export function ProviderRowGroup({ className, bordered = false, ...props }: React.ComponentProps<"div"> & { bordered?: boolean }) {
  return (
    <div
      className={cn(bordered ? "divide-y overflow-hidden rounded-lg border bg-card" : "flex flex-col gap-1", className)}
      {...props}
    />
  )
}

/**
 * Row frame shared by S-40 (AI 연결 탭) and S-41 (공급자 선택). `radio` / `badge` / `action` slots are filled
 * by the screen. `inButton` (S-41): the whole row is inside a <button>, so only phrasing content is rendered
 * (spans styled as blocks, no heading) — UQ-264.
 */
export function ProviderRowFrame({
  provider,
  recommended,
  state,
  active,
  radio,
  badge,
  statusLine,
  extra,
  action,
  footer,
  inButton = false,
  anchor = false,
  className,
}: {
  provider: AiProviderName
  /** 추천 배지 (Gemini, 미연결일 때) */
  recommended: boolean
  state: ProviderRowState
  active?: boolean
  radio?: React.ReactNode
  badge?: React.ReactNode
  statusLine?: React.ReactNode
  /** 3행 안내 줄 (그 상태일 때만) */
  extra?: React.ReactNode
  action?: React.ReactNode
  footer?: React.ReactNode
  inButton?: boolean
  /** S-40: give the row its stable id (scroll target) */
  anchor?: boolean
  className?: string
}) {
  const frame = cn(
    // S-41 (inButton, bordered 묶음 안) keeps its roomier row; S-40 follows the 원본 화면 (v5.12)
    inButton ? "flex min-h-16 items-start gap-3 px-4 py-3" : "flex min-h-11 items-start gap-2 rounded-lg px-2 py-1.5",
    active ? "bg-primary/10" : state === "paused" ? "bg-muted/50" : inButton ? "bg-transparent" : undefined,
    className,
  )
  const name = PROVIDER_ROW_NAMES[provider]
  if (inButton)
    return (
      <span className={frame}>
        <span className="flex w-4 shrink-0 pt-1" />
        <span className="block min-w-0 flex-1 space-y-1">
          <span className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
            <span className="w-28 shrink-0 text-base font-normal">{name}</span>
            <span className="text-sm text-muted-foreground">{PROVIDER_PLAN_NOTES[provider]}</span>
            {recommended ? <RecommendBadge /> : null}
          </span>
          {statusLine}
        </span>
      </span>
    )
  return (
    <div id={anchor ? providerRowId(provider) : undefined} className={cn(frame, anchor && "scroll-mt-4")}>
      <div className="flex size-8 shrink-0 items-center justify-center">{radio}</div>
      <div className="min-w-0 flex-1 space-y-1 py-1">
        {/* 이름 열 고정 폭 — 플랜 안내가 세 행에서 같은 x에 선다 (화면). 본문 < 512면 안내·배지가 줄바꿈 */}
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
          <h4 className="w-28 shrink-0 text-base leading-6 font-normal">{name}</h4>
          <span className="text-sm text-muted-foreground">{PROVIDER_PLAN_NOTES[provider]}</span>
          {recommended ? <RecommendBadge /> : null}
          {badge}
        </div>
        {statusLine}
        {extra}
        {footer}
      </div>
      <div className="flex h-8 shrink-0 items-center gap-1">{action}</div>
    </div>
  )
}
