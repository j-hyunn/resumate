"use client"

/**
 * S-40 AI 연결 (02 S-40, FL-18~20, design-system 5.7) — shared by the `/settings/ai` page and the
 * settings dialog section "AI 연결" (leader decision).
 *
 * The dialog renders this outside <Suspense>, so the panel never reads `?state=` itself: the page
 * passes `preview` (its awaited ?state=) instead. Hooks that read search params (AiErrorNotice)
 * sit inside local <Suspense> boundaries.
 *
 * preview values (page only): ai-locked · key-invalid · key-check · no-active · paused ·
 * recheck-failed · save-failed · ai-return · consent-required (v5.3 활성 카드 "동의 필요" + "동의하기")
 *
 * v5.3 (02 S-40, R-67 / A1 / A20; design-system 5.7 (v3)):
 * - 활성 카드 "동의 필요" (`ai_connection.consent_required`, key valid / needs_check): C-19 동의 필요형 배지,
 *   둘째 줄 문구, "동의하기"(default sm) → C-21 동의 창(활성 공급자·등급, confirmLabel "동의하기") → 동의 저장 뒤
 *   다시 읽기 → "연결됨". 복귀 대상이 있으면 그때 "돌아가기"가 default가 된다.
 * - 활성 변경 확인 문구 = A1 문구(다시 시도·다시 생성·다시 채점도 새 공급자). 재동의 판정은 서버(A20).
 */
import * as React from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { toast } from "sonner"
import { ChevronRight, CornerUpLeft, Gauge, Loader2, MoreHorizontal, RotateCcw, ShieldCheck, TriangleAlert } from "lucide-react"
import type { AiErrorCode, AiProviderKeyPublic, AiProviderName, ConnectionTier } from "@/types/db"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group"
import { Skeleton } from "@/components/ui/skeleton"
import {
  deleteProviderKeyAction,
  getAiConnectionOverviewAction,
  recheckProviderKeyAction,
  setActiveAiProviderAction,
} from "@/lib/data/actions"
import type { AiConnectionOverview, ProviderCardData } from "@/lib/data/ai-connection"
import { codeForCause } from "@/lib/data/ai-errors"
import { CONNECTION_TIER_LABELS, directionParticle, submitFailedMessage } from "@/lib/data/labels"
import { AI_PROVIDER_LABELS } from "@/lib/mock/ai-providers"
import { routes } from "@/lib/routes"
import { notifyAiConnectionChanged } from "@/components/common/ai-connection-context"
import {
  clearAiConnectReturn,
  completeAiConnectReturn,
  readAiConnectReturn,
  type AiReturnTarget,
} from "@/components/common/ai-connect-return"
import { AiErrorNotice } from "@/components/common/ai-error-notice"
import { DataUseConsent, DataUseConsentDialog } from "@/components/common/data-use-consent"
import { useSettingsDialog } from "@/components/common/shell/settings-dialog"
import { formatUsd } from "./ai-format"
import { needsDataUseConsentAction } from "@/lib/data/actions"
import { DeleteConfirmDialog } from "@/components/common/delete-confirm-dialog"
import {
  ProviderCardFrame,
  ProviderConsentLine,
  ProviderStatusLine,
  StaticConnectionBadge,
  providerCardState,
} from "./provider-card"
import { Item } from "@/components/ui/item"

export const S40_INTRO =
  "AI 기능은 선택이에요. 본인 AI 키를 연결하면 인사이트·서류 초안·모의 면접·AI 작성 대화를 쓸 수 있어요. 비용은 연결한 공급자에 직접 내요"
const S40_PRINCIPLE = "Resumate는 내 데이터를 AI 학습에 쓰지 않아요. 키는 서버에 암호화해 저장하고 화면에는 마지막 4자리만 보여요"

/** `activate=1`: S-41 등급·동의 (mode=tier) 끝나면 활성 공급자로 지정 (routes.aiConnect `activate`) */
export function connectHref(provider: AiProviderName, mode?: "replace" | "tier", activate?: boolean): string {
  return routes.aiConnect({ provider, mode, activate })
}

// ---------------------------------------------------------------------------
// preview overrides (page `?state=` only)
// ---------------------------------------------------------------------------

function applyPreview(o: AiConnectionOverview, preview: string | null): AiConnectionOverview {
  if (!preview) return o
  const now = new Date().toISOString()
  const next: AiConnectionOverview = structuredClone(o)
  const active = next.providers.find((p) => p.is_active) ?? next.providers.find((p) => p.key)
  switch (preview) {
    case "ai-locked":
      next.providers = next.providers.map((p) => ({ ...p, key: null, is_active: false, consent: null }))
      next.connection = { active_provider: null, key_status: null, connection_tier: null, consent_required: null }
      break
    case "key-invalid":
    case "key-check":
      if (active?.key) {
        const invalid = preview === "key-invalid"
        active.key = {
          ...active.key,
          status: invalid ? "invalid" : "needs_check",
          last_failure_cause: invalid ? "key_invalid" : "rate_limited",
          last_failure_at: now,
          last_verified_at: invalid ? active.key.last_verified_at : null,
        }
        next.connection = { ...next.connection, key_status: active.key.status }
      }
      break
    case "no-active":
      next.providers = next.providers.map((p) => ({ ...p, is_active: false }))
      next.connection = { active_provider: null, key_status: null, connection_tier: null, consent_required: null }
      break
    case "consent-required": {
      // 활성 카드의 동의가 필요한 상태 (재동의 고지 게시와 같은 모양)
      const card = active?.key && active.key.status !== "invalid" ? active : next.providers.find((p) => p.key && p.key.status !== "invalid")
      if (card?.key) {
        next.providers = next.providers.map((p) => ({ ...p, is_active: p === card }))
        next.connection = {
          active_provider: card.info.provider,
          key_status: card.key.status,
          connection_tier: card.key.connection_tier,
          consent_required: true,
        }
      }
      break
    }
    case "paused": {
      const claude = next.providers.find((p) => p.info.provider === "anthropic")
      if (claude) claude.info = { ...claude.info, is_available: false }
      break
    }
  }
  return next
}

// ---------------------------------------------------------------------------
// panel
// ---------------------------------------------------------------------------

type Load = { status: "loading" } | { status: "error" } | { status: "ready"; data: AiConnectionOverview }

async function loadOverview(preview: string | null): Promise<{ load: Load; returnTarget: AiReturnTarget | null }> {
  try {
    const data = await getAiConnectionOverviewAction()
    // FL-19 복귀 대상 (browser session); `ai-return` previews a C-18 arrival
    const returnTarget =
      readAiConnectReturn() ??
      (preview === "ai-return" ? { href: routes.career(), feature_label: "인사이트", created_at: new Date().toISOString() } : null)
    return { load: { status: "ready", data: applyPreview(data, preview) }, returnTarget }
  } catch {
    return { load: { status: "error" }, returnTarget: null }
  }
}

export function AiConnectionPanel({
  variant = "page",
  onNavigate,
  preview = null,
}: {
  /** "section" = settings dialog / `/settings` card, "page" = S-40 route */
  variant?: "page" | "section"
  /** closes the dialog when a link leaves it */
  onNavigate?: () => void
  /** page-only `?state=` value (the dialog passes nothing) */
  preview?: string | null
}) {
  const router = useRouter()
  const { openSettings } = useSettingsDialog()
  const [load, setLoad] = React.useState<Load>({ status: "loading" })
  const [returnTarget, setReturnTarget] = React.useState<AiReturnTarget | null>(null)
  const [rechecking, setRechecking] = React.useState<AiProviderName | null>(null)
  const [recheckError, setRecheckError] = React.useState<{ provider: AiProviderName; code: AiErrorCode } | null>(null)
  const [switchTo, setSwitchTo] = React.useState<ProviderCardData | null>(null)
  const [switching, setSwitching] = React.useState(false)
  const [switchFailed, setSwitchFailed] = React.useState(false)
  const [deleteTarget, setDeleteTarget] = React.useState<ProviderCardData | null>(null)
  const [disclosureOf, setDisclosureOf] = React.useState<ProviderCardData | null>(null)
  // v5.3 S-40 "동의하기" → C-21 동의 창 (활성 공급자·등급)
  const [consentOpen, setConsentOpen] = React.useState(false)
  /** provider:tier agreed in this panel — lifts the `consent-required` preview after agreeing */
  const [agreedHere, setAgreedHere] = React.useState<string[]>([])
  const failWrites = preview === "save-failed"

  const fetchData = React.useCallback(async () => {
    const res = await loadOverview(preview)
    setLoad(res.load)
    setReturnTarget(res.returnTarget)
  }, [preview])

  React.useEffect(() => {
    let alive = true
    void loadOverview(preview).then((res) => {
      if (!alive) return
      setLoad(res.load)
      setReturnTarget(res.returnTarget)
    })
    return () => {
      alive = false
    }
  }, [preview])

  // UQ-267: `/settings/ai#provider-card-{provider}` — cards load on the client, so scroll once they exist
  const ready = load.status === "ready"
  React.useEffect(() => {
    if (!ready || variant !== "page") return
    const id = window.location.hash.slice(1)
    if (!id.startsWith("provider-card-")) return
    document.getElementById(id)?.scrollIntoView({ block: "start" })
  }, [ready, variant])

  const leave = () => onNavigate?.()

  if (load.status === "loading")
    return (
      <div className="space-y-3" aria-busy="true">
        <span className="sr-only">AI 연결을 불러오는 중</span>
        {[0, 1, 2].map((i) => (
          <Skeleton key={i} className="h-28 w-full rounded-lg" />
        ))}
      </div>
    )
  if (load.status === "error")
    return (
      <div className="space-y-3" role="alert">
        {/* [UI-가정] 불러오기 실패 문구 */}
        <p className="text-sm text-destructive">AI 연결 정보를 불러오지 못했어요.</p>
        <Button variant="outline" size="sm" onClick={() => void fetchData()}>
          <RotateCcw aria-hidden />
          다시 불러오기
        </Button>
      </div>
    )

  const data = load.data
  const anyKey = data.providers.some((p) => p.key)
  const activeCard = data.providers.find((p) => p.is_active) ?? null
  const connected = !!activeCard && activeCard.key?.status !== "invalid"
  // v5.3 R-67: 활성 카드 "동의 필요" (키가 valid · needs_check 일 때만, design-system 5.7 (v3))
  const consentRequired =
    !!activeCard?.key &&
    activeCard.key.status !== "invalid" &&
    data.connection.active_provider === activeCard.info.provider &&
    data.connection.consent_required === true &&
    !agreedHere.includes(`${activeCard.info.provider}:${activeCard.key.connection_tier}`)

  async function recheck(card: ProviderCardData) {
    const p = card.info.provider
    setRechecking(p)
    setRecheckError(null)
    try {
      const key = await recheckProviderKeyAction(p, preview === "recheck-failed" ? { fail: "key_invalid" } : undefined)
      if (key) {
        updateKey(p, key)
        if (key.status !== "valid" && key.last_failure_cause)
          setRecheckError({ provider: p, code: codeForCause(key.last_failure_cause) })
        // [UI-가정] 다시 확인 결과 알림
        else toast("키를 확인했어요", { description: `${AI_PROVIDER_LABELS[p]} 키가 정상이에요` })
      }
      notifyAiConnectionChanged()
    } catch {
      toast.error(submitFailedMessage("키 확인 결과"))
    } finally {
      setRechecking(null)
    }
  }

  function updateKey(p: AiProviderName, key: AiProviderKeyPublic) {
    setLoad((l) =>
      l.status === "ready"
        ? { status: "ready", data: { ...l.data, providers: l.data.providers.map((c) => (c.info.provider === p ? { ...c, key } : c)) } }
        : l,
    )
  }

  async function confirmSwitch() {
    if (!switchTo?.key) return
    const p = switchTo.info.provider
    setSwitching(true)
    setSwitchFailed(false)
    try {
      if (failWrites) throw new Error("preview save-failed")
      // 등급·고지 버전이 다르면 C-21 재동의 → S-41 ①② (FL-20)
      if (await needsDataUseConsentAction(p, switchTo.key.connection_tier)) {
        setSwitchTo(null)
        leave()
        router.push(connectHref(p, "tier", true))
        return
      }
      await setActiveAiProviderAction(p)
      notifyAiConnectionChanged()
      setSwitchTo(null)
      // [UI-가정] 전환 완료 알림
      toast(`활성 공급자를 ${AI_PROVIDER_LABELS[p]}로 바꿨어요`)
      await fetchData()
    } catch {
      setSwitchFailed(true)
    } finally {
      setSwitching(false)
    }
  }

  return (
    <div className="space-y-6">
      {returnTarget ? (
        <Alert variant="info">
          <CornerUpLeft aria-hidden />
          <AlertTitle className="font-normal">
            {returnTarget.feature_label
              ? `${returnTarget.feature_label}${directionParticle(returnTarget.feature_label)} 돌아가려면 AI를 연결해 주세요`
              : "원래 화면으로 돌아가려면 AI를 연결해 주세요"}
          </AlertTitle>
          <AlertDescription className="pt-1">
            {connected ? (
              <Button
                size="sm"
                // v5.3: 동의가 남아 있으면 강조하지 않는다 — 동의하면 default (design-system 5.7 (v3))
                variant={consentRequired ? "outline" : "default"}
                onClick={() => {
                  const href = completeAiConnectReturn() ?? returnTarget.href
                  leave()
                  router.push(href)
                }}
              >
                돌아가기
              </Button>
            ) : (
              // [UI-가정] 연결 전에는 연결 없이 돌아가는 보조 동작 (FL-19 "취소 → 잠금 화면")
              <Button
                size="sm"
                variant="ghost"
                className="-ml-2"
                onClick={() => {
                  clearAiConnectReturn()
                  leave()
                  router.push(returnTarget.href)
                }}
              >
                연결하지 않고 돌아가기
              </Button>
            )}
          </AlertDescription>
        </Alert>
      ) : null}

      <p className="text-base leading-[1.6] text-muted-foreground">{S40_INTRO}</p>

      {anyKey && !activeCard ? (
        <Alert variant="warning">
          <TriangleAlert aria-hidden />
          <AlertTitle className="font-normal">AI 기능이 잠겨 있어요. 사용할 공급자를 골라 주세요</AlertTitle>
        </Alert>
      ) : null}

      <RadioGroup
        aria-label="활성 공급자"
        value={activeCard?.info.provider ?? ""}
        onValueChange={(v) => {
          const card = data.providers.find((c) => c.info.provider === v)
          if (card && !card.is_active) {
            setSwitchFailed(false)
            setSwitchTo(card)
          }
        }}
        className="gap-3"
      >
        {data.providers.map((card) => {
          const p = card.info.provider
          const state = providerCardState({ key: card.key, isAvailable: card.info.is_available, rechecking: rechecking === p })
          const selectable = !!card.key && card.info.is_available && card.key.status !== "invalid"
          return (
            <ProviderCardFrame
              key={p}
              anchor
              provider={p}
              description={card.info.description}
              recommended={card.info.is_recommended}
              state={state}
              active={card.is_active}
              radio={
                selectable || (card.key && card.is_active) ? (
                  <RadioGroupItem
                    value={p}
                    aria-label={`${AI_PROVIDER_LABELS[p]}를 활성 공급자로`}
                    disabled={!selectable || rechecking !== null}
                  />
                ) : null
              }
              badge={
                card.is_active && card.key ? (
                  <StaticConnectionBadge
                    provider={p}
                    tier={card.key.connection_tier}
                    status={card.key.status}
                    consent={card.is_active && consentRequired}
                  />
                ) : null
              }
              statusLine={
                card.is_active && consentRequired && card.key && state !== "rechecking" ? (
                  <>
                    <ProviderStatusLine state={state} provider={p} keyRow={card.key} />
                    <ProviderConsentLine provider={p} tier={card.key.connection_tier} />
                  </>
                ) : (
                  <ProviderStatusLine state={state} provider={p} keyRow={card.key} />
                )
              }
              action={
                <CardActions
                  card={card}
                  state={state}
                  busy={rechecking !== null}
                  consentRequired={card.is_active && consentRequired}
                  onConsent={() => setConsentOpen(true)}
                  onNavigate={leave}
                  onRecheck={() => void recheck(card)}
                  onDelete={() => setDeleteTarget(card)}
                  onDisclosure={() => setDisclosureOf(card)}
                />
              }
              footer={
                recheckError?.provider === p ? (
                  <React.Suspense fallback={null}>
                    <AiErrorNotice code={recheckError.code} provider={p} size="inline" aiRetry={false} onRetry={() => void recheck(card)} />
                  </React.Suspense>
                ) : null
              }
            />
          )
        })}
      </RadioGroup>

      {/* 사용량 입구 — 다이얼로그에서는 섹션만 바꾼다 (5.7) */}
      {variant === "section" ? (
        <Item variant="outline" size="lg" className="justify-between gap-3" onClick={() => openSettings("ai-usage")}>
          <UsageEntryText cost={data.month_estimated_cost_usd} />
        </Item>
      ) : (
        <Item asChild variant="outline" size="lg" className="justify-between gap-3">
          <Link href={routes.aiUsage()}>
            <UsageEntryText cost={data.month_estimated_cost_usd} />
          </Link>
        </Item>
      )}

      <p className="flex items-start gap-1.5 text-sm leading-5 text-muted-foreground">
        <ShieldCheck className="mt-0.5 size-4 shrink-0" aria-hidden />
        {S40_PRINCIPLE}
      </p>

      {/* 활성 전환 확인 (F-AI-03) */}
      <AlertDialog open={!!switchTo} onOpenChange={(o) => !switching && !o && setSwitchTo(null)}>
        <AlertDialogContent>
          <AlertDialogHeader className="text-left">
            {/* [UI-가정] 제목 */}
            <AlertDialogTitle>활성 공급자를 바꿀까요?</AlertDialogTitle>
            <AlertDialogDescription className="text-base text-foreground">
              {switchTo?.key
                ? switchConfirmText(switchTo.info.provider, switchTo.key.connection_tier)
                : null}
            </AlertDialogDescription>
          </AlertDialogHeader>
          {switchFailed ? (
            <p role="alert" className="text-sm text-destructive">
              {submitFailedMessage("활성 공급자")}
            </p>
          ) : null}
          <AlertDialogFooter>
            <AlertDialogCancel disabled={switching}>취소</AlertDialogCancel>
            <Button onClick={() => void confirmSwitch()} disabled={switching}>
              {switching ? <Loader2 className="animate-spin" aria-hidden /> : null}
              바꾸기
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* v5.3 S-40 "동의하기" → C-21 동의 창 (활성 공급자·등급, R-67). 동의 뒤 토스트 없음 (G-36) */}
      {activeCard?.key ? (
        <DataUseConsentDialog
          open={consentOpen}
          onOpenChange={setConsentOpen}
          provider={activeCard.info.provider}
          tier={activeCard.key.connection_tier}
          confirmLabel="동의하기"
          // preview: the spec copy is "고지가 바뀌어" → show the 재동의 Alert (real data: read from the server)
          reconsent={preview === "consent-required" ? true : undefined}
          fail={failWrites}
          onConsented={() => {
            const k = activeCard.key
            if (k) setAgreedHere((a) => [...a, `${activeCard.info.provider}:${k.connection_tier}`])
            void fetchData()
          }}
        />
      ) : null}

      {/* C-05 "API 키 삭제" — shared DeleteConfirmDialog (api_key target) */}
      <DeleteConfirmDialog
        target={deleteTarget ? { kind: "api_key", entity_id: deleteTarget.info.provider, is_active: deleteTarget.is_active } : null}
        open={!!deleteTarget}
        onOpenChange={(o) => !o && setDeleteTarget(null)}
        onConfirm={async () => {
          if (!deleteTarget) return
          if (failWrites) throw new Error("preview save-failed")
          await deleteProviderKeyAction(deleteTarget.info.provider)
          // [UI-가정] 삭제 완료 알림
          toast(`${AI_PROVIDER_LABELS[deleteTarget.info.provider]} 키를 삭제했어요`)
          setDeleteTarget(null)
          notifyAiConnectionChanged()
          await fetchData()
        }}
      />

      <Dialog open={!!disclosureOf} onOpenChange={(o) => !o && setDisclosureOf(null)}>
        <DialogContent className="max-h-[85dvh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>데이터 사용 고지</DialogTitle>
            <DialogDescription>
              {disclosureOf?.key
                ? `${AI_PROVIDER_LABELS[disclosureOf.info.provider]} · ${CONNECTION_TIER_LABELS[disclosureOf.key.connection_tier]}에 동의한 내용이에요`
                : null}
            </DialogDescription>
          </DialogHeader>
          {disclosureOf?.key ? (
            <DataUseConsent
              provider={disclosureOf.info.provider}
              tier={disclosureOf.consent?.connection_tier ?? disclosureOf.key.connection_tier}
              agreedAt={disclosureOf.consent?.agreed_at ?? null}
            />
          ) : null}
        </DialogContent>
      </Dialog>
    </div>
  )
}

/** 02 S-40 활성 공급자 선택 확인 문구 (v5.3 A1: 모든 재실행이 새 활성 공급자) */
export function switchConfirmText(provider: AiProviderName, tier: ConnectionTier): string {
  const name = AI_PROVIDER_LABELS[provider]
  return `다음 실행부터 ${name}(${CONNECTION_TIER_LABELS[tier]})로 실행돼요. 다시 시도·다시 생성·다시 채점도 ${name}${directionParticle(name)} 해요. 진행 중인 작업만 원래 공급자로 끝까지 해요`
}

function UsageEntryText({ cost }: { cost: number }) {
  return (
    <>
      <span className="flex items-center gap-2 text-base">
        <Gauge className="size-4 shrink-0 text-muted-foreground" aria-hidden />
        <span className="tabular-nums">이번 달 Resumate에서 약 {formatUsd(cost)} (예상치)</span>
      </span>
      <ChevronRight className="size-4 shrink-0 text-muted-foreground" aria-hidden />
    </>
  )
}

/** [3열] 미연결: 연결하기 / 무효: 키 교체 / 확인 필요: 다시 확인 + ⋯ 카드 메뉴 */
function CardActions({
  card,
  state,
  busy,
  consentRequired = false,
  onConsent,
  onNavigate,
  onRecheck,
  onDelete,
  onDisclosure,
}: {
  card: ProviderCardData
  state: ReturnType<typeof providerCardState>
  busy: boolean
  /** v5.3 활성 카드 동의 필요 → "동의하기" (default sm, 3열 앞) */
  consentRequired?: boolean
  onConsent?: () => void
  onNavigate: () => void
  onRecheck: () => void
  onDelete: () => void
  onDisclosure: () => void
}) {
  const p = card.info.provider
  const name = AI_PROVIDER_LABELS[p]
  if (!card.key) {
    if (state === "paused")
      return (
        <Button size="sm" variant="outline" disabled>
          연결하기
        </Button>
      )
    return (
      <Button size="sm" variant={card.info.is_recommended ? "default" : "outline"} asChild>
        <Link href={connectHref(p)} onClick={onNavigate} aria-label={`${name} 연결하기`}>
          연결하기
        </Link>
      </Button>
    )
  }
  return (
    <>
      {consentRequired && state !== "invalid" ? (
        <Button size="sm" onClick={onConsent} disabled={busy || state === "rechecking"} aria-label={`${name} 데이터 사용 동의하기`}>
          동의하기
        </Button>
      ) : null}
      {state === "invalid" ? (
        <Button size="sm" asChild>
          <Link href={connectHref(p, "replace")} onClick={onNavigate}>
            키 교체
          </Link>
        </Button>
      ) : state === "needs_check" ? (
        <Button size="sm" variant="outline" onClick={onRecheck} disabled={busy}>
          다시 확인
        </Button>
      ) : null}
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="icon-sm" aria-label={`${name} 카드 메뉴`} disabled={state === "rechecking"}>
            <MoreHorizontal aria-hidden />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          {state !== "paused" ? (
            <>
              <DropdownMenuItem asChild>
                <Link href={connectHref(p, "replace")} onClick={onNavigate}>
                  키 교체
                </Link>
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={onRecheck} disabled={busy}>
                다시 확인
              </DropdownMenuItem>
              <DropdownMenuItem asChild>
                <Link href={connectHref(p, "tier")} onClick={onNavigate}>
                  등급 변경
                </Link>
              </DropdownMenuItem>
            </>
          ) : null}
          <DropdownMenuItem onSelect={onDisclosure}>데이터 사용 고지 다시 보기</DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem onSelect={onDelete} variant="destructive">
            키 삭제
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </>
  )
}

