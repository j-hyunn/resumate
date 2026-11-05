"use client"

/**
 * C-21 데이터 사용 고지·동의 (02 C-21, design-system 3.21). Body of S-41 ② and, read-only, the
 * S-40 "데이터 사용 고지 다시 보기" dialog. Copy per provider × tier comes from `@/lib/ai-disclosures`
 * (AI C-7.1 facts, version v2026-11-05 — OD-L2 / OD-L2a).
 *
 *   <DataUseConsent provider="gemini" tier="free" onBack={…} onNext={({ free_tier_acknowledged }) => …} />
 *   <DataUseConsent provider="gemini" tier="free" agreedAt={consent.agreed_at} />   // read-only
 *   <DataUseConsentDialog open provider tier onOpenChange onConsented={continueRun} />   // (v3) 동의 창형
 *
 * v5.3 동의 창형 (design-system 3.21, R-67): opened before an AI run when
 * `ai_connection.consent_required`, on a retry refusal `ai_consent_required`, from the C-20
 * key_missing consent cause and from S-40 "동의하기". Agreeing records the consent, re-reads the
 * connection and calls `onConsented` (the caller continues the run it held). Closing sends nothing.
 */
import * as React from "react"
import { ChevronDown, Loader2, ShieldCheck, TriangleAlert } from "lucide-react"
import { cn } from "@/lib/utils"
import { Alert, AlertTitle } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible"
import { Label } from "@/components/ui/label"
import { Separator } from "@/components/ui/separator"
import type { AiProviderName, ConnectionTier } from "@/types/db"
import { CONNECTION_TIER_LABELS, submitFailedMessage } from "@/lib/data/labels"
import { getDataUseConsentStateAction, recordDataUseConsentAction } from "@/lib/data/actions"
import { readPreviewState } from "@/lib/preview-state"
import { markConsentGiven } from "./ai-connection-context"
import { AI_PROVIDER_FULL_NAMES, AI_PROVIDER_LABELS } from "@/lib/mock/ai-providers"
import { DISCLOSURE_FACTS, SENT_DATA_ITEMS, usesInputsForTraining } from "@/lib/ai-disclosures"
import { ExternalProviderLink } from "./external-link"
import { AI_TRAINING_NOTICE } from "@/lib/data/labels"

/** F-COM-03 v4 Resumate 원칙 — one constant shared with settings / policies (UQ-209) */
export const RESUMATE_AI_PRINCIPLE = AI_TRAINING_NOTICE

export { SENT_DATA_ITEMS }

const FREE_TIER_HEADLINE = "무료 등급에서는 입력한 내용이 Google 제품 개선에 쓰이고 사람이 검토할 수 있어요"
// [UI-가정] 민감정보·회사 기밀 주의 문구 (C-07 G-2 wording reused)
const FREE_TIER_CAUTION = "건강·종교·노조 활동 같은 민감정보, 동료·고객의 개인정보, 회사 기밀은 넣지 마세요"

const kstDateTime = new Intl.DateTimeFormat("ko-KR", {
  timeZone: "Asia/Seoul",
  month: "long",
  day: "numeric",
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
})

/** Gemini 무료 등급 강조 상자 (not collapsible). Checkbox only when `onAcknowledgedChange` is given. */
export function FreeTierNotice({
  acknowledged,
  onAcknowledgedChange,
  className,
}: {
  acknowledged?: boolean
  onAcknowledgedChange?: (v: boolean) => void
  className?: string
}) {
  const id = React.useId()
  return (
    <div className={cn("space-y-3 rounded-lg border-2 border-warning bg-warning-subtle p-4", className)}>
      <div className="flex gap-3">
        <TriangleAlert className="size-5 shrink-0 text-warning" aria-hidden />
        <div className="space-y-1">
          <p className="text-base font-semibold text-warning-subtle-foreground">{FREE_TIER_HEADLINE}</p>
          <p className="text-sm text-warning-subtle-foreground">{FREE_TIER_CAUTION}</p>
        </div>
      </div>
      {onAcknowledgedChange ? (
        <div className="flex items-center gap-2 pl-8">
          <Checkbox
            id={id}
            checked={acknowledged}
            onCheckedChange={(v) => onAcknowledgedChange(v === true)}
            className="border-warning-subtle-foreground/40"
          />
          <Label htmlFor={id} className="text-sm font-medium text-warning-subtle-foreground">
            무료 등급의 데이터 사용 방식을 이해했어요
          </Label>
        </div>
      ) : null}
    </div>
  )
}

export function DataUseConsent({
  provider,
  tier,
  onBack,
  onNext,
  pending,
  reconsent,
  agreedAt,
  footerError,
  mode = "step",
  confirmLabel,
  className,
}: {
  provider: AiProviderName
  tier: ConnectionTier
  onBack?: () => void
  onNext?: (v: { free_tier_acknowledged: boolean }) => void
  /** "step" (S-41 ②: 이전 / 다음) or "dialog" (v3 동의 창형: 닫기 / {confirmLabel}) */
  mode?: "step" | "dialog"
  /** dialog mode confirm text — default "동의하고 계속" ([UI-가정] G-36), S-40 passes "동의하기" */
  confirmLabel?: string
  pending?: boolean
  /** 공급자·등급·고지 버전이 바뀌어 다시 동의 */
  reconsent?: boolean
  /** read-only mode (S-40 "데이터 사용 고지 다시 보기"): show "동의함 · {agreed_at}" instead of checkboxes */
  agreedAt?: string | null
  /** ST-SAVE-FAILED line for the consent submit (submitFailedMessage) */
  footerError?: React.ReactNode
  className?: string
}) {
  const p = AI_PROVIDER_LABELS[provider]
  const tierLabel = CONNECTION_TIER_LABELS[tier]
  const facts = DISCLOSURE_FACTS[provider][tier]
  const needsFreeAck = usesInputsForTraining(provider, tier) // R-OD-15
  const readOnly = agreedAt !== undefined
  const [agree, setAgree] = React.useState(false)
  const [ack, setAck] = React.useState(false)
  const agreeId = React.useId()
  const reasonId = React.useId()
  const ready = agree && (!needsFreeAck || ack)

  return (
    <div className={cn("max-w-prose-edit space-y-5", className)}>
      {reconsent ? (
        <Alert variant="info">
          {/* C-21 재동의 알림 (v5.13, OD-D1 B-7) */}
          <AlertTitle className="font-normal">데이터 사용 고지가 바뀌어 다시 동의가 필요해요</AlertTitle>
        </Alert>
      ) : null}

      <section className="space-y-2">
        <h3 className="text-base leading-6 font-semibold">{p}로 보내는 내용</h3>
        <p className="text-sm text-muted-foreground">AI 기능을 쓰면 다음 내용이 {p}로 전송돼요</p>
        <ul className="list-disc space-y-1 pl-5 text-base">
          {SENT_DATA_ITEMS.map((x) => (
            <li key={x}>{x}</li>
          ))}
        </ul>
      </section>

      <dl className="grid grid-cols-[7rem_1fr] gap-y-2 text-sm">
        <dt className="text-muted-foreground">공급자</dt>
        <dd>
          {AI_PROVIDER_FULL_NAMES[provider]} · {tierLabel}
        </dd>
        <dt className="text-muted-foreground">처리 국가</dt>
        <dd>{facts.country}</dd>
      </dl>

      <Collapsible>
        <CollapsibleTrigger asChild>
          <Button variant="ghost" size="sm" className="group -ml-2">
            공급자 정책 자세히
            <ChevronDown className="transition-transform group-data-[state=open]:rotate-180" aria-hidden />
          </Button>
        </CollapsibleTrigger>
        <CollapsibleContent className="space-y-2 pt-2">
          <dl className="grid grid-cols-[7rem_1fr] gap-y-2 text-sm">
            <dt className="text-muted-foreground">학습 사용</dt>
            <dd>{facts.training}</dd>
            <dt className="text-muted-foreground">사람 검토</dt>
            <dd>{facts.human_review}</dd>
            <dt className="text-muted-foreground">보관 기간</dt>
            <dd>{facts.retention}</dd>
          </dl>
          <ExternalProviderLink href={facts.terms_url}>{`${p} 약관`}</ExternalProviderLink>
        </CollapsibleContent>
      </Collapsible>

      {needsFreeAck ? (
        <FreeTierNotice acknowledged={ack} onAcknowledgedChange={readOnly ? undefined : setAck} />
      ) : null}

      <p className="flex items-start gap-1.5 text-sm leading-5 text-muted-foreground">
        <ShieldCheck className="mt-0.5 size-4 shrink-0" aria-hidden />
        {RESUMATE_AI_PRINCIPLE}
      </p>

      <Separator />

      {readOnly ? (
        <p className="text-sm leading-5 text-muted-foreground tabular-nums">
          동의함{agreedAt ? ` · ${kstDateTime.format(new Date(agreedAt))}` : ""}
        </p>
      ) : (
        <>
          <div className="flex items-start gap-2">
            <Checkbox id={agreeId} checked={agree} onCheckedChange={(v) => setAgree(v === true)} className="mt-1" />
            <Label htmlFor={agreeId} className="text-base leading-6 font-normal">
              위 내용을 확인했고 {p}({tierLabel})로 데이터를 보내는 데 동의해요
            </Label>
          </div>
          <div className="space-y-2">
            {!ready ? (
              <p id={reasonId} className="text-sm leading-5 text-muted-foreground">
                동의 항목을 모두 체크해 주세요
              </p>
            ) : null}
            {footerError}
            <div
              className={cn(
                "flex flex-wrap justify-end gap-2",
                // dialog: narrow screens stack, confirm on top (3.21)
                mode === "dialog" && "max-sm:flex-col-reverse max-sm:[&>button]:w-full",
              )}
            >
              {onBack ? (
                <Button variant="ghost" onClick={onBack} disabled={mode === "dialog" && pending}>
                  {mode === "dialog" ? "닫기" : "이전"}
                </Button>
              ) : null}
              <Button disabled={!ready || pending} aria-describedby={!ready ? reasonId : undefined} onClick={() => onNext?.({ free_tier_acknowledged: needsFreeAck && ack })}>
                {pending ? <Loader2 className="animate-spin" aria-hidden /> : null}
                {mode === "dialog" ? (confirmLabel ?? "동의하고 계속") : "다음"}
              </Button>
            </div>
          </div>
        </>
      )}
    </div>
  )
}

/**
 * (v3) 동의 창형 C-21 (design-system 3.21). Title "{공급자}({등급}) 데이터 사용 동의" and the confirm
 * text are [UI-가정] (G-36, P-14). No toast after agreeing. Save failure shows ST-SAVE-FAILED above
 * the buttons. `provider` / `tier` = the **active** provider and key tier (R-67, A20).
 */
export function DataUseConsentDialog({
  open,
  onOpenChange,
  provider,
  tier,
  onConsented,
  confirmLabel,
  reconsent: reconsentProp,
  fail,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  provider: AiProviderName
  tier: ConnectionTier
  /** called after the consent is saved and the dialog closed — continue the held run here */
  onConsented?: () => void
  confirmLabel?: string
  /** override the 재동의 Alert (default: read from the server) */
  reconsent?: boolean
  /** mock: make the save fail (ST-SAVE-FAILED preview) */
  fail?: boolean
}) {
  const [pending, setPending] = React.useState(false)
  const [failed, setFailed] = React.useState(false)
  const [reconsent, setReconsent] = React.useState<boolean>(reconsentProp ?? false)
  const p = AI_PROVIDER_LABELS[provider]
  const tierLabel = CONNECTION_TIER_LABELS[tier]

  React.useEffect(() => {
    if (!open || reconsentProp !== undefined) return
    let alive = true
    void getDataUseConsentStateAction(provider, tier).then((s) => {
      if (alive) setReconsent(s.reconsent)
    })
    return () => {
      alive = false
    }
  }, [open, provider, tier, reconsentProp])

  const agree = async ({ free_tier_acknowledged }: { free_tier_acknowledged: boolean }) => {
    setPending(true)
    setFailed(false)
    try {
      // `?state=` previews lift the simulated consent for this page only — no row in the store.
      // Read at click time: the settings dialog sits outside <Suspense> (no useSearchParams).
      if (!readPreviewState(new URLSearchParams(window.location.search))) {
        await recordDataUseConsentAction({ provider, connection_tier: tier, free_tier_acknowledged, fail })
      }
      markConsentGiven(provider, tier)
      onOpenChange(false)
      onConsented?.()
    } catch {
      setFailed(true)
    } finally {
      setPending(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={(o) => (!pending ? onOpenChange(o) : undefined)}>
      <DialogContent className="max-w-[calc(100%-2rem)] sm:max-w-lg">
        <DialogHeader className="text-left">
          {/* [UI-가정] G-36 / P-14 dialog title */}
          <DialogTitle className="text-lg leading-7 font-semibold">
            {p}({tierLabel}) 데이터 사용 동의
          </DialogTitle>
          <DialogDescription className="sr-only">
            AI를 실행하기 전에 {p}로 보내는 데이터와 공급자 정책을 확인하고 동의해 주세요
          </DialogDescription>
        </DialogHeader>
        <div className="max-h-[70dvh] overflow-y-auto pr-1">
          <DataUseConsent
            key={`${provider}:${tier}:${open}`}
            provider={provider}
            tier={tier}
            mode="dialog"
            reconsent={reconsent}
            confirmLabel={confirmLabel}
            pending={pending}
            onBack={() => onOpenChange(false)}
            onNext={(v) => void agree(v)}
            footerError={
              failed ? (
                <p className="text-sm text-destructive" role="alert">
                  {submitFailedMessage("동의")}
                </p>
              ) : null
            }
            className="max-w-none"
          />
        </div>
      </DialogContent>
    </Dialog>
  )
}
