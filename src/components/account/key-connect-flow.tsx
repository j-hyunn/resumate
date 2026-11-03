"use client"

/**
 * S-41 키 연결 단계 (02 S-41, FL-18 / FL-19 / FL-20, design-system 5.7) — focus screen.
 *   (공급자 선택) → ① 등급 → ② 데이터 사용 동의(C-21) → ③ 키 가이드·입력·검증
 *   교체(mode=replace) = ③만 / 등급 변경(mode=tier) = ①②만 (+ activate=1 → 끝나면 활성 지정)
 *
 * On success: completeAiConnectReturn() (FL-19 복귀 대상 → highlight) + notifyAiConnectionChanged().
 * Lives under <ScreenSuspense> (page), so hooks that read `?state=` are fine here.
 */
import * as React from "react"
import { useRouter } from "next/navigation"
import { Check, CircleCheck, CircleHelp, CreditCard, ExternalLink, Gift, Loader2, LockKeyhole, X } from "lucide-react"
import type { AiErrorCode, AiFailureCause, AiProviderKeyPublic, AiProviderName, ConnectionTier } from "@/types/db"
import { cn } from "@/lib/utils"
import { Alert, AlertDescription } from "@/components/ui/alert"
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
import { Card } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group"
import {
  changeProviderTierAction,
  recordDataUseConsentAction,
  setActiveAiProviderAction,
  verifyAndSaveProviderKeyAction,
} from "@/lib/data/actions"
import type { ProviderCardData } from "@/lib/data/ai-connection"
import { CONNECTION_TIER_LABELS, directionParticle, submitFailedMessage } from "@/lib/data/labels"
import { AI_PROVIDER_LABELS, AI_PROVIDERS } from "@/lib/mock/ai-providers"
import { routes } from "@/lib/routes"
import { notifyAiConnectionChanged } from "@/components/common/ai-connection-context"
import { clearAiConnectReturn, completeAiConnectReturn, readAiConnectReturn } from "@/components/common/ai-connect-return"
import { aiErrorTitle, ExternalProviderLink, formatKstTime, useNow } from "@/components/common/ai-error-notice"
import { DataUseConsent } from "@/components/common/data-use-consent"
import { ProviderBadge } from "@/components/common/provider-badge"
import { verifyEta } from "./ai-format"
import { KeyMask, ProviderCardFrame, providerCardState } from "./provider-card"
import { needsDataUseConsentAction } from "@/lib/data/actions"
import { Item } from "@/components/ui/item"

type StepId = "tier" | "consent" | "key"
const STEP_NAMES: Record<StepId, string> = { tier: "등급", consent: "데이터 사용 동의", key: "키 등록" }

type Rejected = { error_code: AiErrorCode; format_error?: boolean }
type Outcome =
  | { kind: "valid"; key: AiProviderKeyPublic; became_active: boolean }
  | { kind: "limited"; key: AiProviderKeyPublic; became_active: boolean; failure_cause: AiFailureCause; quota_resets_at: string | null }
  | { kind: "tier_done"; tier: ConnectionTier; activated: boolean }

/** `?state=` previews for S-41 (dev) */
export type KeyConnectPreview =
  | "step-consent"
  | "step-key"
  | "reconsent"
  | "save-failed"
  | "key-format"
  | "key-rejected"
  | "key-billing"
  | "key-model"
  | "key-limited"
  | "key-quota"
  | "success"
  | "limited"

const PREVIEW_FAIL: Partial<Record<KeyConnectPreview, AiErrorCode>> = {
  "key-rejected": "key_invalid",
  "key-billing": "billing_required",
  "key-model": "model_not_available",
  "key-limited": "rate_limited",
  "key-quota": "daily_quota_exhausted",
}

export function KeyConnectFlow({
  providers,
  initialProvider,
  mode,
  activate,
  preview,
}: {
  providers: ProviderCardData[]
  initialProvider: AiProviderName | null
  mode: "replace" | "tier" | null
  activate: boolean
  preview: KeyConnectPreview | null
}) {
  const router = useRouter()
  const [provider, setProvider] = React.useState<AiProviderName | null>(initialProvider)
  const card = provider ? (providers.find((c) => c.info.provider === provider) ?? null) : null
  const existingKey = card?.key ?? null
  // mode needs an existing key; otherwise the full flow [UI-가정]
  const effectiveMode = mode && existingKey ? mode : null
  // UQ-263: 교체 중 서버가 동의 필요로 거절하면 ②를 단계에 넣는다(②③)
  const [replaceNeedsConsent, setReplaceNeedsConsent] = React.useState(false)
  const steps: StepId[] =
    effectiveMode === "replace"
      ? replaceNeedsConsent
        ? ["consent", "key"]
        : ["key"]
      : effectiveMode === "tier"
        ? ["tier", "consent"]
        : ["tier", "consent", "key"]

  const initialStep: StepId =
    preview === "step-consent" || preview === "reconsent" || preview === "save-failed"
      ? "consent"
      : preview && (preview === "step-key" || preview in PREVIEW_FAIL || preview === "key-format")
        ? "key"
        : steps[0]
  const [step, setStep] = React.useState<StepId>(steps.includes(initialStep) ? initialStep : steps[0])
  const [tier, setTier] = React.useState<ConnectionTier>(existingKey?.connection_tier ?? card?.info.default_tier ?? "free")
  const [consentPending, setConsentPending] = React.useState(false)
  const [consentFailed, setConsentFailed] = React.useState(false)
  const [rawKey, setRawKey] = React.useState(
    preview === "key-format" ? "not-a-key-1234" : preview && preview in PREVIEW_FAIL ? "previewkey-mock-5678" : "",
  )
  const [verifying, setVerifying] = React.useState(false)
  const [verifyFailed, setVerifyFailed] = React.useState(false)
  const [rejected, setRejected] = React.useState<Rejected | null>(
    preview === "key-format"
      ? { error_code: "key_invalid", format_error: true }
      : preview && PREVIEW_FAIL[preview] && !["rate_limited", "daily_quota_exhausted"].includes(PREVIEW_FAIL[preview]!)
        ? { error_code: PREVIEW_FAIL[preview]! }
        : null,
  )
  const [outcome, setOutcome] = React.useState<Outcome | null>(() => previewOutcome(preview, initialProvider, tier0(providers, initialProvider)))
  const [returnHref, setReturnHref] = React.useState<string | null>(null)
  const [returnLabel, setReturnLabel] = React.useState<string | null>(null)
  const [quitOpen, setQuitOpen] = React.useState(false)
  const inputRef = React.useRef<HTMLInputElement>(null)
  const headingRef = React.useRef<HTMLHeadingElement>(null)

  const name = provider ? AI_PROVIDER_LABELS[provider] : null
  const title = name ? `${name} 연결` : "AI 연결"

  // move focus to the step heading when the step changes (A-3)
  const first = React.useRef(true)
  React.useEffect(() => {
    if (first.current) {
      first.current = false
      return
    }
    headingRef.current?.focus()
  }, [step, provider, outcome])

  function leave() {
    // FL-19: 취소 → 원래 화면(잠금 상태), 없으면 S-40. 입력한 키는 버린다(동의 기록만 남음 [가정]).
    const t = readAiConnectReturn()
    if (outcome) {
      router.push(returnHref ?? routes.aiConnection())
      return
    }
    clearAiConnectReturn()
    router.push(t?.href ?? routes.aiConnection())
  }

  function requestQuit() {
    if (rawKey.trim() && !outcome) setQuitOpen(true)
    else leave()
  }

  function finishSuccess() {
    // read the label before completeAiConnectReturn() clears the target
    const t = readAiConnectReturn()
    setReturnLabel(
      t?.feature_label ? `${t.feature_label}${directionParticle(t.feature_label)} 돌아가기` : t ? "원래 화면으로 돌아가기" : null,
    )
    setReturnHref(completeAiConnectReturn())
    notifyAiConnectionChanged()
  }

  async function submitConsent(v: { free_tier_acknowledged: boolean }) {
    if (!provider) return
    setConsentPending(true)
    setConsentFailed(false)
    try {
      await recordDataUseConsentAction({
        provider,
        connection_tier: tier,
        free_tier_acknowledged: v.free_tier_acknowledged,
        fail: preview === "save-failed",
      })
      if (effectiveMode === "tier") {
        await changeProviderTierAction(provider, tier)
        if (activate) await setActiveAiProviderAction(provider)
        notifyAiConnectionChanged()
        setOutcome({ kind: "tier_done", tier, activated: activate })
        // UQ-268: 복귀 대상이 있으면 주 버튼이 그 목적지를 말하고, 도착하면 풀린 버튼을 강조
        finishSuccess()
      } else {
        setStep("key")
      }
    } catch {
      setConsentFailed(true)
    } finally {
      setConsentPending(false)
    }
  }

  async function verify(e?: React.FormEvent) {
    e?.preventDefault()
    if (!provider || !rawKey.trim() || verifying) return
    setVerifying(true)
    setRejected(null)
    setVerifyFailed(false)
    try {
      const fail = preview ? (PREVIEW_FAIL[preview] ?? null) : null
      const res = await verifyAndSaveProviderKeyAction({
        provider,
        connection_tier: tier,
        raw_key: rawKey,
        mock: fail ? { fail } : undefined,
      })
      if (res.outcome === "rejected") {
        setRejected({ error_code: res.error_code, format_error: res.format_error })
        return
      }
      setRawKey("") // 키 원문은 저장 후 다시 보이지 않는다 (NFR-KEY-01·05)
      setOutcome(
        res.outcome === "valid"
          ? { kind: "valid", key: res.key, became_active: res.became_active }
          : { kind: "limited", key: res.key, became_active: res.became_active, failure_cause: res.failure_cause, quota_resets_at: res.quota_resets_at },
      )
      finishSuccess()
    } catch {
      // UQ-263: 동의가 실제로 필요할 때만 ②로, 그 밖의 오류는 저장 실패 줄
      let consentNeeded = false
      try {
        consentNeeded = await needsDataUseConsentAction(provider, tier)
      } catch {
        consentNeeded = false
      }
      if (consentNeeded) {
        if (effectiveMode === "replace") setReplaceNeedsConsent(true)
        setStep("consent")
      } else {
        setVerifyFailed(true)
      }
    } finally {
      setVerifying(false)
    }
  }

  const stepIndex = Math.max(0, steps.indexOf(step))

  return (
    <>
      <header className="flex h-16 shrink-0 items-center gap-4 border-b px-4 md:px-6">
        <Button variant="ghost" size="icon" aria-label="연결 그만두기" onClick={requestQuit}>
          <X aria-hidden />
        </Button>
        <h1 className="text-lg leading-7 font-semibold">{title}</h1>
        {provider && !outcome ? (
          <div className="ml-auto md:mx-auto md:pr-16">
            <StepIndicator steps={steps} current={stepIndex} />
          </div>
        ) : null}
      </header>

      <div className="mx-auto w-full max-w-2xl space-y-6 px-4 py-10 md:px-6">
        {!provider ? (
          <ProviderPick providers={providers} onPick={(p) => {
            setProvider(p)
            const c = providers.find((x) => x.info.provider === p)
            setTier(c?.key?.connection_tier ?? AI_PROVIDERS[p].default_tier)
            setStep("tier")
          }} headingRef={headingRef} />
        ) : card && !card.info.is_available ? (
          <p className="text-base">{name} 연결을 잠시 멈췄어요. 이미 연결한 키는 계속 보관돼요</p>
        ) : outcome ? (
          <OutcomeView
            outcome={outcome}
            provider={provider}
            replace={effectiveMode === "replace"}
            primaryLabel={returnLabel ?? "AI 연결로 돌아가기"}
            onPrimary={leave}
            headingRef={headingRef}
          />
        ) : step === "tier" ? (
          <section className="space-y-6" aria-labelledby="s41-step">
            <h2 id="s41-step" ref={headingRef} tabIndex={-1} className="text-lg leading-7 font-semibold outline-none">
              이 키는 어떤 등급인가요?
            </h2>
            <RadioGroup value={tier} onValueChange={(v) => setTier(v as ConnectionTier)} className="gap-3" aria-label="키 등급">
              <TierOption
                value="free"
                icon={Gift}
                title={CONNECTION_TIER_LABELS.free}
                lines={[
                  "분당·일일 요청 한도가 낮아요",
                  provider === "gemini" ? "데이터 사용 정책이 달라요(입력이 Google 제품 개선에 쓰일 수 있어요)" : "데이터 사용 정책이 유료와 다를 수 있어요",
                ]}
                checked={tier === "free"}
              />
              <TierOption
                value="paid"
                icon={CreditCard}
                title={CONNECTION_TIER_LABELS.paid}
                lines={["사용한 만큼 공급자에 청구돼요", "결제 수단 등록이 필요해요"]}
                checked={tier === "paid"}
              />
            </RadioGroup>
            {/* [UI-가정] 등급 자동 판별 불가 안내 (D-32) */}
            <p className="text-sm text-muted-foreground">Resumate는 키의 등급을 알 수 없어서, 공급자에서 고른 등급을 직접 알려 주세요.</p>
            <ActionRow
              onBack={!initialProvider && !effectiveMode ? () => setProvider(null) : undefined}
              primary={<Button onClick={() => setStep("consent")}>다음</Button>}
            />
          </section>
        ) : step === "consent" ? (
          <section className="space-y-6" aria-labelledby="s41-step">
            <h2 id="s41-step" ref={headingRef} tabIndex={-1} className="text-lg leading-7 font-semibold outline-none">
              데이터 사용 고지·동의
            </h2>
            <DataUseConsent
              key={`${provider}-${tier}`}
              provider={provider}
              tier={tier}
              reconsent={preview === "reconsent" || effectiveMode === "tier" || activate}
              pending={consentPending}
              onBack={steps[0] === "consent" ? undefined : () => setStep("tier")}
              onNext={(v) => void submitConsent(v)}
              footerError={
                consentFailed ? (
                  <p role="alert" className="text-sm text-destructive">
                    {submitFailedMessage("동의 내용")}
                  </p>
                ) : null
              }
            />
          </section>
        ) : (
          <section className="space-y-6" aria-labelledby="s41-step">
            <h2 id="s41-step" ref={headingRef} tabIndex={-1} className="text-lg leading-7 font-semibold outline-none">
              {effectiveMode === "replace" ? `새 ${name} 키 등록` : `${name} 키 등록`}
            </h2>
            <KeyGuide provider={provider} tier={tier} />
            <form onSubmit={verify} noValidate className="space-y-3">
              <div className="space-y-1.5">
                <Label htmlFor="s41-key">API 키</Label>
                <Input
                  ref={inputRef}
                  id="s41-key"
                  type="password"
                  autoComplete="off"
                  spellCheck={false}
                  className="font-mono text-base"
                  value={rawKey}
                  onChange={(e) => {
                    setRawKey(e.target.value)
                    if (rejected) setRejected(null)
                  }}
                  disabled={verifying}
                  aria-invalid={rejected ? true : undefined}
                  aria-describedby={cn("s41-key-note", rejected && "s41-key-error")}
                />
                <p id="s41-key-note" className="flex items-center gap-1.5 text-sm text-muted-foreground">
                  <LockKeyhole className="size-4 shrink-0" aria-hidden />
                  키는 서버에 암호화해 저장하고 다시 보여 주지 않아요
                </p>
                {rejected ? (
                  <KeyFieldError
                    provider={provider}
                    rejected={rejected}
                    replace={effectiveMode === "replace"}
                    onRepaste={() => {
                      inputRef.current?.focus()
                      inputRef.current?.select()
                    }}
                  />
                ) : null}
              </div>
              {verifyFailed ? (
                <p role="alert" className="text-sm text-destructive">
                  {submitFailedMessage("키")}
                </p>
              ) : null}
              {verifying ? (
                <p className="text-sm text-muted-foreground" role="status">
                  키를 확인하고 있어요 · {verifyEta(tier)}
                </p>
              ) : null}
              <ActionRow
                onBack={steps.length > 1 ? () => setStep("consent") : undefined}
                primary={
                  <Button type="submit" disabled={verifying || !rawKey.trim()}>
                    {verifying ? <Loader2 className="animate-spin" aria-hidden /> : null}
                    키 확인
                  </Button>
                }
              />
            </form>
          </section>
        )}
      </div>

      <AlertDialog open={quitOpen} onOpenChange={setQuitOpen}>
        <AlertDialogContent>
          <AlertDialogHeader className="text-left">
            <AlertDialogTitle>연결을 그만둘까요?</AlertDialogTitle>
            <AlertDialogDescription className="text-base text-foreground">입력한 키는 저장되지 않아요</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>계속 연결하기</AlertDialogCancel>
            <Button
              onClick={() => {
                setQuitOpen(false)
                setRawKey("")
                leave()
              }}
            >
              그만두기
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}

function tier0(providers: ProviderCardData[], p: AiProviderName | null): ConnectionTier {
  if (!p) return "free"
  const c = providers.find((x) => x.info.provider === p)
  return c?.key?.connection_tier ?? AI_PROVIDERS[p].default_tier
}

function previewOutcome(preview: KeyConnectPreview | null, p: AiProviderName | null, tier: ConnectionTier): Outcome | null {
  if (!p || (preview !== "success" && preview !== "limited")) return null
  const key: AiProviderKeyPublic = {
    id: "preview",
    provider: p,
    connection_tier: tier,
    key_last4: "1a2b",
    status: preview === "success" ? "valid" : "needs_check",
    last_verified_at: null,
    last_failure_cause: preview === "limited" ? "daily_quota_exhausted" : null,
    last_failure_at: null,
    created_at: "",
    updated_at: "",
  }
  return preview === "success"
    ? { kind: "valid", key, became_active: true }
    : { kind: "limited", key, became_active: true, failure_cause: "daily_quota_exhausted", quota_resets_at: null }
}

// ---------------------------------------------------------------------------

function StepIndicator({ steps, current }: { steps: StepId[]; current: number }) {
  return (
    <>
      <ol className="hidden items-center gap-2 md:flex" aria-label="연결 단계">
        {steps.map((s, i) => {
          const done = i < current
          const now = i === current
          return (
            <li key={s} className="flex items-center gap-2" aria-current={now ? "step" : undefined}>
              {i > 0 ? <span className="h-px w-8 bg-border" aria-hidden /> : null}
              <span
                className={cn(
                  "grid size-7 place-items-center rounded-full text-sm font-semibold",
                  now
                    ? "bg-primary text-primary-foreground"
                    : done
                      ? "bg-primary-subtle text-primary-subtle-foreground"
                      : "border border-input text-muted-foreground",
                )}
              >
                {done ? <Check className="size-4" aria-hidden /> : i + 1}
              </span>
              <span className={cn("text-sm", now && "font-medium")}>
                {STEP_NAMES[s]}
                {done ? <span className="sr-only"> (완료)</span> : null}
              </span>
            </li>
          )
        })}
      </ol>
      <p className="text-sm text-muted-foreground tabular-nums md:hidden">
        {current + 1} / {steps.length} · {STEP_NAMES[steps[current]]}
      </p>
    </>
  )
}

function ProviderPick({
  providers,
  onPick,
  headingRef,
}: {
  providers: ProviderCardData[]
  onPick: (p: AiProviderName) => void
  headingRef: React.RefObject<HTMLHeadingElement | null>
}) {
  return (
    <section className="space-y-6" aria-labelledby="s41-pick">
      <h2 id="s41-pick" ref={headingRef} tabIndex={-1} className="text-lg leading-7 font-semibold outline-none">
        연결할 공급자를 골라 주세요
      </h2>
      <ul className="space-y-3">
        {providers.map((c) => {
          const p = c.info.provider
          const disabled = !c.info.is_available
          return (
            <li key={p}>
              {(() => {
                const card = (
                  <ProviderCardFrame
                    provider={p}
                    description={c.info.description}
                    recommended={c.info.is_recommended}
                    state={providerCardState({ key: null, isAvailable: c.info.is_available })}
                    inButton
                    statusLine={
                      c.key ? (
                        <span className="block text-sm text-muted-foreground">
                          이미 연결됨 · <KeyMask last4={c.key.key_last4} />
                        </span>
                      ) : disabled ? (
                        <span className="block text-sm text-muted-foreground">{AI_PROVIDER_LABELS[p]} 연결을 잠시 멈췄어요</span>
                      ) : null
                    }
                  />
                )
                // UQ-721: a paused provider is not clickable, so it is not an Item. The card's own
                // unavailable state is the only dimming (no extra disabled opacity).
                return disabled ? (
                  card
                ) : (
                  <Item size="none" className="block rounded-lg" onClick={() => onPick(p)}>
                    {card}
                  </Item>
                )
              })()}
            </li>
          )
        })}
      </ul>
    </section>
  )
}

function TierOption({
  value,
  icon: Icon,
  title,
  lines,
  checked,
}: {
  value: ConnectionTier
  icon: typeof Gift
  title: string
  lines: string[]
  checked: boolean
}) {
  const id = `s41-tier-${value}`
  return (
    <Label
      htmlFor={id}
      className={cn(
        "flex cursor-pointer items-start gap-3 rounded-lg border p-4 font-normal",
        checked && "border-primary bg-primary-subtle/40",
      )}
    >
      <RadioGroupItem id={id} value={value} className="mt-1" />
      <Icon className="mt-0.5 size-5 shrink-0 text-muted-foreground" aria-hidden />
      <span className="space-y-0.5">
        <span className="block text-base font-semibold">{title}</span>
        {lines.map((l) => (
          <span key={l} className="block text-sm leading-5 text-muted-foreground">
            {l}
          </span>
        ))}
      </span>
    </Label>
  )
}

function ActionRow({ onBack, primary }: { onBack?: () => void; primary: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-2 pt-2">
      {onBack ? (
        <Button type="button" variant="ghost" onClick={onBack}>
          이전
        </Button>
      ) : (
        <span />
      )}
      {primary}
    </div>
  )
}

// [UI-가정] 가이드 단계 문구 (F-AI-05 (2)~(4), 버전 관리 대상)
const GUIDE_STEPS: Record<AiProviderName, string[]> = {
  gemini: [
    "아래 버튼으로 Google AI Studio의 키 발급 페이지를 열어요(새 탭)",
    "Google 계정으로 로그인해요",
    "'API 키 만들기'를 눌러 새 키를 만들어요",
    "만든 키를 복사해요",
    "이 화면으로 돌아와 아래 입력란에 붙여넣어요",
  ],
  anthropic: [
    "아래 버튼으로 Anthropic Console의 키 페이지를 열어요(새 탭)",
    "결제 수단을 등록한 계정으로 로그인해요",
    "새 키를 만들어 복사한 뒤 아래에 붙여넣어요",
  ],
  openai: [
    "아래 버튼으로 OpenAI Platform의 키 페이지를 열어요(새 탭)",
    "결제 수단을 등록한 계정으로 로그인해요",
    "새 키를 만들어 복사한 뒤 아래에 붙여넣어요",
  ],
}

function KeyGuide({ provider, tier }: { provider: AiProviderName; tier: ConnectionTier }) {
  const info = AI_PROVIDERS[provider]
  const name = AI_PROVIDER_LABELS[provider]
  return (
    <Card className="gap-4 p-5">
      <h3 className="text-base leading-6 font-semibold">{name} 키 만들기</h3>
      <ol className="space-y-3">
        {GUIDE_STEPS[provider].map((s, i) => (
          <li key={s} className="flex items-start gap-3 text-base">
            <span className="grid size-6 shrink-0 place-items-center rounded-full bg-muted text-xs font-semibold">{i + 1}</span>
            {s}
          </li>
        ))}
      </ol>
      <div>
        <Button variant="outline" size="sm" asChild>
          <a href={info.key_issue_url} target="_blank" rel="noopener noreferrer">
            {name} 키 발급 페이지 열기
            <ExternalLink className="size-3.5" aria-hidden />
            <span className="sr-only">(새 탭)</span>
          </a>
        </Button>
      </div>
      {provider === "gemini" && tier === "free" ? (
        <Alert variant="info">
          <AlertDescription>
            무료 등급은 분당·일일 요청 한도가 낮아요. 하루 한도는 한국 시간 오후 4~5시에 다시 채워져요.
          </AlertDescription>
        </Alert>
      ) : provider !== "gemini" ? (
        <Alert variant="info">
          <AlertDescription>결제 수단 등록이 필요해요</AlertDescription>
        </Alert>
      ) : null}
      <p className="text-xs leading-4 text-muted-foreground tabular-nums">
        가이드 v{info.key_guide_version} · 최종 확인 {info.key_guide_checked_at?.replaceAll("-", ".")}
      </p>
    </Card>
  )
}

/** ③ 실패 (저장 안 함) — field형 C-20. The common AiErrorNotice "키 교체" action would loop back here, so S-41 draws its own line. */
function KeyFieldError({
  provider,
  rejected,
  replace,
  onRepaste,
}: {
  provider: AiProviderName
  rejected: Rejected
  replace: boolean
  onRepaste: () => void
}) {
  const name = AI_PROVIDER_LABELS[provider]
  const info = AI_PROVIDERS[provider]
  const text = rejected.format_error
    ? `${name} 키 형식이 아니에요`
    : rejected.error_code === "key_invalid"
      ? // [UI-가정] 등록 중 인증 실패 문구 (C-20 key_invalid 문구는 "더 이상 작동하지 않아요"라 새 키에 맞지 않음)
        `${name}가 이 키를 인증하지 않았어요. 키를 다시 복사해 붙여넣어 주세요`
      : aiErrorTitle(rejected.error_code, { provider: name })
  return (
    <div id="s41-key-error" role="alert" className="space-y-1 text-sm">
      {replace ? <p className="text-muted-foreground">기존 키는 그대로 쓰여요</p> : null}
      <p className="text-destructive">{text}</p>
      <div className="flex flex-wrap items-center gap-x-3">
        <Button type="button" variant="link" size="sm" className="h-auto px-0" onClick={onRepaste}>
          키 다시 붙여넣기
        </Button>
        {rejected.error_code === "billing_required" ? (
          <ExternalProviderLink href={info.billing_url}>{`${name} 결제 설정`}</ExternalProviderLink>
        ) : null}
        {rejected.error_code === "model_not_available" ? (
          <ExternalProviderLink href={info.upgrade_url}>등급 업그레이드 안내</ExternalProviderLink>
        ) : null}
        <ExternalProviderLink href={info.dashboard_url}>{`${name} 대시보드`}</ExternalProviderLink>
      </div>
    </div>
  )
}

function OutcomeView({
  outcome,
  provider,
  replace,
  primaryLabel,
  onPrimary,
  headingRef,
}: {
  outcome: Outcome
  provider: AiProviderName
  replace: boolean
  primaryLabel: string
  onPrimary: () => void
  headingRef: React.RefObject<HTMLHeadingElement | null>
}) {
  const now = useNow()
  const name = AI_PROVIDER_LABELS[provider]
  if (outcome.kind === "tier_done")
    return (
      <div className="space-y-4 py-6 text-center">
        <div className="mx-auto grid size-12 place-items-center rounded-full bg-success-subtle">
          <CircleCheck className="size-6 text-success" aria-hidden />
        </div>
        {/* [UI-가정] 등급 변경 완료 문구 */}
        <h2 ref={headingRef} tabIndex={-1} className="text-lg leading-7 font-semibold outline-none">
          {name} 등급을 {CONNECTION_TIER_LABELS[outcome.tier]}
          {directionParticle(CONNECTION_TIER_LABELS[outcome.tier])} 바꿨어요
        </h2>
        {outcome.activated ? <p className="text-sm text-muted-foreground">활성 공급자로 지정했어요. 다음 실행부터 적용돼요</p> : null}
        <Button onClick={onPrimary}>{primaryLabel}</Button>
      </div>
    )
  const ok = outcome.kind === "valid"
  return (
    <div className="space-y-4 py-6 text-center" role="status">
      <div className={cn("mx-auto grid size-12 place-items-center rounded-full", ok ? "bg-success-subtle" : "bg-warning-subtle")}>
        {ok ? <CircleCheck className="size-6 text-success" aria-hidden /> : <CircleHelp className="size-6 text-warning" aria-hidden />}
      </div>
      <h2 ref={headingRef} tabIndex={-1} className="text-lg leading-7 font-semibold outline-none">
        {ok ? (
          <>
            {replace ? "새 키로 바꿨어요" : "연결됐어요"} · <KeyMask last4={outcome.key.key_last4} />
          </>
        ) : (
          `키는 연결됐어요. 지금은 ${name} 사정으로 확인을 끝내지 못했어요`
        )}
      </h2>
      {!ok && outcome.failure_cause === "daily_quota_exhausted" && outcome.quota_resets_at ? (
        <p className="text-sm">
          <span className="font-medium tabular-nums">{formatKstTime(outcome.quota_resets_at, now)}</span>에 다시 채워져요
        </p>
      ) : null}
      {!ok ? <p className="text-sm text-muted-foreground">그대로 쓸 수 있어요. 나중에 AI 연결에서 &lsquo;다시 확인&rsquo;을 눌러 주세요</p> : null}
      {outcome.became_active ? (
        <div className="flex flex-col items-center gap-2">
          <p className="text-sm text-muted-foreground">활성 공급자로 지정했어요</p>
          <ProviderBadge
            connection={{ active_provider: provider, connection_tier: outcome.key.connection_tier, key_status: outcome.key.status }}
          />
        </div>
      ) : null}
      <div className="pt-2">
        <Button onClick={onPrimary}>{ok ? primaryLabel : "확인"}</Button>
      </div>
    </div>
  )
}
