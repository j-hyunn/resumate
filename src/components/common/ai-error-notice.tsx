"use client"

/**
 * C-20 한도·오류 안내 (02 C-20 v5.3, design-system 3.20 v3) — replaces v1 AiFailed / AiFailedInline.
 *
 *   <AiErrorNotice {...aiErrorFromJob(job)} onRetry={retry} refusal={job.refusal} />   // async job
 *   <AiErrorNotice {...stream.errorInfo} size="inline" requestPath retryLabel="다시 보내기" onRetry={…} />
 *
 * Sizes: block (결과 영역 상단) / inline (실패한 턴·섹션·답변 카드) / field (S-41 ③ 입력란 아래).
 * `canceled` and `insufficient_data` (→ C-09) render nothing.
 *
 * v5.3 (F2–F6):
 * - every retry runs on the provider active **now**; a C-19 badge (active provider) sits right after
 *   the retry button, and a same-row retry whose job ran on another provider / tier adds
 *   "{활성 공급자}로 처음부터 다시 해요" (`sameRow` + `jobTier`, filled by aiErrorFromJob)
 * - input-caused failures (input_too_long / safety_blocked / not_a_jd) have no retry: "{대상}으로 이동"
 *   + "고친 뒤 {rerunLabel}로 새로 실행해 주세요"
 * - key_missing re-reads the connection first; consent needed → consent cause + "동의하기" (C-21) →
 *   then the retry button
 * - `refusal` (retry 409, 04 §2.11.7 ②) swaps only the action row (G-34)
 * - `requestPath` (chat turn / document stream / JD extraction, A14): "{N}초 뒤 다시 보낼 수 있어요"
 *   countdown until `retryAfter`
 * - a retry is consent-gated too (consent_required → C-21 before the request)
 */
import * as React from "react"
import Link from "next/link"
import {
  Ban,
  CalendarClock,
  CircleAlert,
  CloudAlert,
  CreditCard,
  FileWarning,
  Hourglass,
  ArrowLeftRight,
  KeyRound,
  Loader2,
  RefreshCw,
  RotateCcw,
  ScrollText,
  ShieldAlert,
  TextCursorInput,
  TimerOff,
  type LucideIcon,
} from "lucide-react"
import { cn } from "@/lib/utils"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"
import type { AiErrorCode, AiJob, AiProviderName, AiRetryRefusalCode, ConnectionTier } from "@/types/db"
import { errorCategoryOf, isInputCausedFailure, nextQuotaReset, SAME_ROW_RETRY_JOB_TYPES } from "@/lib/data/ai-errors"
import { CONNECTION_TIER_LABELS, directionParticle } from "@/lib/data/labels"
import { AI_PROVIDER_LABELS, AI_PROVIDERS } from "@/lib/mock/ai-providers"
import { routes } from "@/lib/routes"
import { notifyAiConnectionChanged, useAiConnection, useAiConnectionRefresh } from "./ai-connection-context"
import { AiConnectLink } from "./ai-connect-link"
import { SettingsLink } from "./shell/settings-dialog"
import { markAiConnectReturn } from "./ai-connect-return"
import { AI_LOCK_RETRY_TITLE, AiLock, type AiLockEntry } from "./ai-lock"
import { useAiConsentGate } from "./consent-gate"
import { ProviderBadge } from "./provider-badge"

// ---------------------------------------------------------------------------
// time helpers (KST, 3.20 "시각 표기")
// ---------------------------------------------------------------------------

const subscribeSecond = (cb: () => void) => {
  const t = setInterval(cb, 1000)
  return () => clearInterval(t)
}

/** Ticking clock (1 s). Returns 0 on the server / before hydration → time-relative text omitted. */
export function useNow(): number {
  // snapshot is rounded to the second so React sees a stable value between ticks
  return React.useSyncExternalStore(
    subscribeSecond,
    () => Math.floor(Date.now() / 1000) * 1000,
    () => 0,
  )
}

const kstDate = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Seoul", year: "numeric", month: "2-digit", day: "2-digit" })
const kstTime = new Intl.DateTimeFormat("ko-KR", { timeZone: "Asia/Seoul", hour: "numeric", minute: "2-digit", hour12: true })

/** "오후 4:00 (KST)" / "내일 오후 4:00 (KST)". `now` 0 (before hydration) → no "내일" prefix. */
export function formatKstTime(iso: string, now = 0): string {
  const d = new Date(iso)
  const tomorrow = now > 0 && kstDate.format(d) !== kstDate.format(new Date(now)) && d.getTime() > now
  return `${tomorrow ? "내일 " : ""}${kstTime.format(d)} (KST)`
}

/** "약 3시간 뒤" / "약 12분 뒤" / "곧" */
export function formatRemaining(iso: string, now: number): string {
  const ms = new Date(iso).getTime() - now
  if (ms < 60_000) return "곧"
  const min = Math.round(ms / 60_000)
  if (min < 60) return `약 ${min}분 뒤`
  return `약 ${Math.round(min / 60)}시간 뒤`
}

function minutesUntil(iso: string | null | undefined, now: number): number | null {
  if (!iso || !now) return null
  return Math.max(1, Math.ceil((new Date(iso).getTime() - now) / 60_000))
}

// ---------------------------------------------------------------------------
// copy
// ---------------------------------------------------------------------------

export interface AiErrorInfo {
  code: AiErrorCode
  /** provider the failed job ran on (falls back to the active provider) — used in the copy */
  provider?: AiProviderName | null
  retryAfter?: string | null
  quotaResetsAt?: string | null
  /** v5.3: the failed job's connection_tier (with `provider`, for "처음부터 다시") */
  jobTier?: ConnectionTier | null
  /** v5.3: retry reopens the same job row (insight / interview questions / grading) */
  sameRow?: boolean
}

/** Map an ai_jobs row (or AiJobView) to AiErrorNotice props */
export function aiErrorFromJob(
  job:
    | (Pick<AiJob, "error_code" | "provider" | "retry_after" | "quota_resets_at"> &
        Partial<Pick<AiJob, "connection_tier" | "job_type">>)
    | null
    | undefined,
): AiErrorInfo | null {
  if (!job?.error_code) return null
  return {
    code: job.error_code,
    provider: job.provider,
    retryAfter: job.retry_after,
    quotaResetsAt: job.quota_resets_at,
    jobTier: job.connection_tier ?? null,
    sameRow: job.job_type ? SAME_ROW_RETRY_JOB_TYPES.includes(job.job_type) : false,
  }
}

/** "{N}초 뒤" / "{M}분 {S}초 뒤" (A14 request-path wait, 60초 이상 표기 [UI-가정] G-35) */
export function formatWaitSeconds(sec: number): string {
  if (sec < 60) return `${sec}초 뒤`
  const m = Math.floor(sec / 60)
  const r = sec % 60
  return r ? `${m}분 ${r}초 뒤` : `${m}분 뒤`
}

/** Copy of a retry refusal line (02 C-20 "다시 시도 거부") */
export const RETRY_REFUSAL_COPY: Partial<Record<AiRetryRefusalCode, string>> = {
  ai_connection_changed: "AI 연결이 방금 바뀌었어요. 다시 시도해 주세요.",
  ai_job_not_retryable: "이 작업은 다시 시도할 수 없어요. 입력을 확인한 뒤 새로 실행해 주세요",
}

type Tone = "warning" | "destructive"

interface Copy {
  icon: LucideIcon
  tone: Tone
  title: string
}

/**
 * Title sentence per cause (spec C-20 table). `reduceTarget` fills {줄일 대상} of input_too_long.
 * Exported for toasts and S-41 field errors.
 */
export function aiErrorTitle(
  code: AiErrorCode,
  opts: { provider?: string; retryAfter?: string | null; now?: number; reduceTarget?: string } = {},
): string {
  const p = opts.provider ?? "공급자"
  switch (code) {
    case "rate_limited": {
      const n = minutesUntil(opts.retryAfter, opts.now ?? 0)
      return n ? `요청이 몰려 잠시 쉬어야 해요. ${n}분 뒤 다시 시도해 주세요` : "요청이 몰려 잠시 쉬어야 해요. 잠시 후 다시 시도해 주세요"
    }
    case "daily_quota_exhausted":
      return `오늘 ${p} 무료 한도를 다 썼어요.`
    case "billing_required":
      return `${p} 계정의 결제 수단이나 크레딧을 확인해 주세요`
    case "key_invalid":
      return `${p} 키가 더 이상 작동하지 않아요. 새 키로 바꿔 주세요`
    case "model_not_available":
      return "현재 등급에서 Resumate가 쓰는 모델을 사용할 수 없어요"
    case "provider_unavailable":
      return `${p}에 일시적인 문제가 있어요. 잠시 후 다시 시도해 주세요`
    case "input_too_long":
      return `보낼 내용이 공급자 한도보다 길어요. ${opts.reduceTarget ?? "입력"}을 줄여 주세요`
    case "safety_blocked":
      return "공급자의 안전 정책으로 응답을 받지 못했어요. 표현을 바꾼 뒤 다시 실행해 주세요"
    case "key_missing":
      return "키가 삭제되어 작업을 끝냈어요. 입력은 저장돼 있어요"
    case "timeout":
    case "stalled":
      return "시간이 오래 걸려 중단됐어요"
    case "schema_invalid":
      return "결과를 정리하지 못했어요"
    case "not_a_jd":
      return "채용 공고가 아닌 텍스트로 보여요"
    case "insufficient_data":
      return "커리어가 조금 더 필요해요"
    case "canceled":
      return ""
    default:
      // [UI-가정] server abuse-prevention / unknown → 3.22 "잠시 후 다시 시도해 주세요"
      return "잠시 후 다시 시도해 주세요"
  }
}

/** C-20 tone + icon of a cause (AiFeatureStatus failure line) */
export function copyIconFor(code: AiErrorCode): { icon: LucideIcon; tone: Tone } {
  const c = copyFor(code, "")
  return { icon: c.icon, tone: c.tone }
}

function copyFor(code: AiErrorCode, title: string): Copy {
  const w = (icon: LucideIcon): Copy => ({ icon, tone: "warning", title })
  const d = (icon: LucideIcon): Copy => ({ icon, tone: "destructive", title })
  switch (code) {
    case "rate_limited":
      return w(Hourglass)
    case "daily_quota_exhausted":
      return w(CalendarClock)
    case "billing_required":
      return w(CreditCard)
    case "key_invalid":
    case "key_missing":
      return w(KeyRound)
    case "model_not_available":
      return w(Ban)
    case "provider_unavailable":
      return d(CloudAlert)
    case "input_too_long":
      return w(TextCursorInput)
    case "safety_blocked":
      return w(ShieldAlert)
    case "not_a_jd":
      return w(FileWarning)
    case "timeout":
    case "stalled":
      return d(TimerOff)
    default:
      return d(CircleAlert)
  }
}

// ---------------------------------------------------------------------------
// RetryButton
// ---------------------------------------------------------------------------

function formatCountdown(ms: number): string {
  const s = Math.max(0, Math.ceil(ms / 1000))
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`
}

/**
 * "다시 시도" — disabled with a "(2:41)" countdown while `retryAfter` is in the future (3.20).
 * The countdown is not announced; `aria-describedby` gives the time once (A-11).
 */
export function RetryButton({
  onRetry,
  href,
  retryAfter,
  retrying,
  label = "다시 시도",
  variant = "outline",
  size = "sm",
  className,
}: {
  onRetry?: () => void
  /** server-rendered alternative to onRetry */
  href?: string
  retryAfter?: string | null
  retrying?: boolean
  label?: string
  variant?: "outline" | "link" | "default"
  size?: "sm" | "default"
  className?: string
}) {
  const now = useNow()
  const descId = React.useId()
  const waitMs = retryAfter && now ? new Date(retryAfter).getTime() - now : 0
  // before hydration (now = 0) a future retryAfter still disables the button
  const waiting = retryAfter ? (now ? waitMs > 0 : true) : false
  const text = waiting && now ? `${label} (${formatCountdown(waitMs)})` : label
  const icon = retrying ? <Loader2 className="animate-spin" aria-hidden /> : variant === "link" ? null : <RotateCcw aria-hidden />
  const linkish = variant === "link" ? "h-auto px-0" : undefined
  return (
    <>
      {href && !waiting ? (
        <Button variant={variant} size={size} asChild className={cn(linkish, className)}>
          <Link href={href}>
            {icon}
            {label}
          </Link>
        </Button>
      ) : (
        <Button
          variant={variant}
          size={size}
          onClick={onRetry}
          disabled={waiting || retrying || (!onRetry && !href)}
          aria-label={waiting ? label : undefined}
          aria-describedby={waiting ? descId : undefined}
          className={cn("tabular-nums", linkish, className)}
        >
          {icon}
          {text}
        </Button>
      )}
      {waiting && retryAfter ? (
        <span id={descId} className="sr-only">
          {formatKstTime(retryAfter, now)}부터 다시 시도할 수 있어요
        </span>
      ) : null}
    </>
  )
}

// External link (3.20 외부 링크 규칙) lives in ./external-link (no import cycle with C-21)
export { ExternalProviderLink } from "./external-link"
import { ExternalProviderLink } from "./external-link"

// ---------------------------------------------------------------------------
// AiErrorNotice
// ---------------------------------------------------------------------------


export const AI_ERROR_PRESERVED = "입력과 지금까지 만든 결과는 그대로 있어요"
export const AI_RETRY_TOKEN_NOTE = "다시 시도하면 토큰을 다시 써요"

/**
 * UQ-492: the token note follows the button's verb — "다시 보내기" → "다시 보내면 토큰을 다시 써요",
 * "다시 채점" → "다시 채점하면 …", "다시 생성" → "다시 생성하면 …". [UI-가정] (02 C-20 gives only 다시 시도)
 */
export function retryTokenNote(label: string): string {
  const verb = label.replace(/\s*\(.*\)$/, "").trim()
  if (verb === "다시 시도") return AI_RETRY_TOKEN_NOTE
  // "…기" verbs: 보내기 → 보내면, 만들기 → 만들면, 정리하기 → 정리하면 (UQ-557); nouns: 채점 → 채점하면
  if (verb.endsWith("기") && verb.length > 1) {
    const stem = verb.slice(0, -1)
    const code = stem.charCodeAt(stem.length - 1) - 0xac00
    const coda = code >= 0 && code < 11172 ? code % 28 : 0
    // no final consonant or ㄹ (8) → "면", other finals → "으면"
    return `${stem}${coda === 0 || coda === 8 ? "면" : "으면"} 토큰을 다시 써요`
  }
  return `${verb}하면 토큰을 다시 써요`
}

export interface AiErrorNoticeProps extends AiErrorInfo {
  size?: "block" | "inline" | "field"
  onRetry?: () => void
  retryHref?: string
  retrying?: boolean
  /** "다시 시도" (default) / "다시 보내기" (대화 턴) / "다시 채점" */
  retryLabel?: string
  /** input_rejected / not_a_jd / key_missing: "{대상}으로 이동" / "입력 화면으로" / "입력으로 돌아가기" */
  inputHref?: string
  onFocusInput?: () => void
  inputLabel?: string
  /** input_too_long {줄일 대상} (e.g. "공고 원문") */
  reduceTarget?: string
  /** block: hide the 보존 줄 (e.g. nothing was entered yet) */
  hidePreserved?: boolean
  /**
   * v5.3 input-caused failures: the run button to press after fixing the input — "고친 뒤
   * {rerunLabel}로 새로 실행해 주세요" (인사이트 "다시 생성", 면접 질문 S-20 "시작하기", 요건 "요건 정리하기" …)
   */
  rerunLabel?: string
  /** no "고친 뒤 …" caption: the input can't be fixed here (S-33 → S-15 "요건이 있는 공고", Q53-9) */
  hideFixCaption?: boolean
  /** v5.3 A14: request-path failure (chat turn / document stream / JD extraction) — countdown line */
  requestPath?: boolean
  /** v5.3: a same-row retry was refused (HTTP 409, 04 §2.11.7 ②) — swaps the action row only */
  refusal?: AiRetryRefusalCode | null
  /** C-18 entry used when the refusal is key_missing (default "insight") */
  lockEntry?: AiLockEntry
  /** hide the C-19 badge next to the retry button (e.g. the badge is already beside it) */
  hideRetryBadge?: boolean
  /**
   * v5.3 (UQ-400): the retry re-runs AI on the active provider (default). `false` for retries that
   * are not an AI run (S-40 key "다시 확인" = key check of that card's provider): no consent gate,
   * no active-provider badge, no "처음부터 다시" line.
   */
  aiRetry?: boolean
  /**
   * v5.3 (A3 request 5): block form — first description line (`font-medium`) above the 시각·보존 줄,
   * e.g. S-19 경력기술서 실패 "생성에 실패했어요. 다시 시도하면 새 초안으로 처음부터 만들어요".
   */
  lead?: React.ReactNode
  className?: string
}

export function AiErrorNotice({
  code,
  provider: providerProp,
  retryAfter,
  quotaResetsAt,
  jobTier,
  sameRow,
  size = "block",
  onRetry: onRetryProp,
  retryHref,
  retrying,
  retryLabel = "다시 시도",
  inputHref,
  onFocusInput,
  inputLabel,
  reduceTarget,
  hidePreserved,
  rerunLabel,
  hideFixCaption,
  requestPath,
  refusal,
  lockEntry = "insight",
  hideRetryBadge,
  aiRetry = true,
  lead,
  className,
}: AiErrorNoticeProps) {
  const ctxConnection = useAiConnection()
  const now = useNow()
  const consent = useAiConsentGate()
  // key_missing: "먼저 readiness를 다시 읽는다" (02 C-20) — consent cause vs no key. Skeleton from the
  // first frame (UQ-403).
  const isKeyMissing = code === "key_missing"
  const [refreshing, refreshConnection, freshConnection] = useAiConnectionRefresh(isKeyMissing)
  const connection = ctxConnection ?? freshConnection
  React.useEffect(() => {
    if (isKeyMissing) refreshConnection()
  }, [isKeyMissing, refreshConnection])

  // retry refusals that need a side effect (G-34: only the action row changes). Fires when the
  // refusal value changes (callers clear it before each retry).
  const { open: openConsent } = consent
  const retryRef = React.useRef(onRetryProp)
  React.useEffect(() => {
    retryRef.current = onRetryProp
  })
  React.useEffect(() => {
    if (refusal === "ai_consent_required") openConsent(() => retryRef.current?.())
    if (refusal === "ai_connection_changed" || refusal === "key_missing" || refusal === "key_invalid") notifyAiConnectionChanged()
  }, [refusal, openConsent])

  if (code === "canceled" || code === "insufficient_data") return null

  // every retry is consent-gated (R-67): consent_required → C-21 before the request
  const onRetry = onRetryProp ? (aiRetry ? () => void consent.guard(onRetryProp) : onRetryProp) : undefined

  const provider = providerProp ?? connection?.active_provider ?? null
  const pName = provider ? AI_PROVIDER_LABELS[provider] : undefined
  const info = provider ? AI_PROVIDERS[provider] : null
  const active = connection?.active_provider ?? null
  const activeName = active ? AI_PROVIDER_LABELS[active] : null
  const consentCause = isKeyMissing && !refreshing && Boolean(active && connection?.key_status !== "invalid" && connection?.consent_required)
  const inputCaused = isInputCausedFailure(code)
  const waitCode = code === "rate_limited" || code === "provider_unavailable"
  const waitSec = requestPath && waitCode && retryAfter && now ? Math.ceil((new Date(retryAfter).getTime() - now) / 1000) : 0

  let title = aiErrorTitle(code, { provider: pName, retryAfter, now, reduceTarget })
  if (consentCause && activeName && connection?.connection_tier)
    title = `${activeName}(${CONNECTION_TIER_LABELS[connection.connection_tier]}) 사용 동의가 필요해 작업을 멈췄어요. 입력은 저장돼 있어요`
  // [UI-가정] A14 request path: the wait goes to the countdown line, not the title
  else if (requestPath && code === "rate_limited") title = "요청이 몰려 잠시 쉬어야 해요."
  const copy = consentCause ? ({ icon: ScrollText, tone: "warning", title } as Copy) : copyFor(code, title)
  // UQ-202 / A-6: announce once with a title that does not change over time (no {N}분, no
  // countdown); the visible block itself is not a live region.
  const announce = (
    <p className="sr-only" role="status">
      {consentCause || (requestPath && code === "rate_limited") ? title : aiErrorTitle(code, { provider: pName, reduceTarget })}
    </p>
  )
  const Icon = copy.icon
  const category = errorCategoryOf(code)

  // ① 시각 줄
  let timeLine: React.ReactNode = null
  // [UI-가정] previews pass only the code → fall back to the Gemini rule (next KST 16:00)
  const resets = code === "daily_quota_exhausted" ? (quotaResetsAt ?? (now ? nextQuotaReset(now) : null)) : null
  if (resets) {
    timeLine = (
      <p>
        <span className="font-medium tabular-nums">{formatKstTime(resets, now)}</span>에 다시 채워져요
        {now ? ` · ${formatRemaining(resets, now)}` : null}
      </p>
    )
  } else if (waitSec > 0) {
    // A14 / 3.20: "{N}초 뒤 다시 보낼 수 있어요" — not announced (A-11), removed at 0
    timeLine = <p className="tabular-nums">{formatWaitSeconds(waitSec)} 다시 보낼 수 있어요</p>
  }

  const inline = size !== "block"
  const btn = inline ? "link" : "outline"
  const canRetry = Boolean(onRetry || retryHref)
  // ③ 동작
  const retry = (variant: "outline" | "link") =>
    canRetry ? (
      <>
        <RetryButton
          onRetry={onRetry}
          href={retryHref}
          retryAfter={waitCode ? retryAfter : null}
          retrying={retrying}
          label={retryLabel}
          variant={variant}
        />
        {/* v5.3 A1: the provider active at click time */}
        {hideRetryBadge || !aiRetry ? null : <ProviderBadge />}
      </>
    ) : null
  const dash = info && pName ? <ExternalProviderLink href={info.dashboard_url}>{`${pName} 대시보드`}</ExternalProviderLink> : null
  const toS40 = (label: string, variant: "outline" | "link") => (
    <Button variant={variant} size="sm" asChild className={variant === "link" ? "h-auto px-0" : undefined}>
      <SettingsLink section="ai-connection" onClick={() => markAiConnectReturn()}>
        {label}
      </SettingsLink>
    </Button>
  )
  const inputAction = (label: string, variant: "outline" | "link") =>
    onFocusInput ? (
      <Button variant={variant} size="sm" onClick={onFocusInput} className={variant === "link" ? "h-auto px-0" : undefined}>
        {label}
      </Button>
    ) : inputHref ? (
      <Button variant={variant} size="sm" asChild className={variant === "link" ? "h-auto px-0" : undefined}>
        <Link href={inputHref}>{label}</Link>
      </Button>
    ) : null

  /** a usable key is active now (not invalid) — key_missing / key_invalid failures can be retried */
  const reconnected = Boolean(active && connection?.key_status !== "invalid")
  let actions: React.ReactNode
  let hasRetry = false
  switch (code) {
    case "rate_limited":
      actions = (
        <>
          {retry(btn)}
          {dash}
        </>
      )
      hasRetry = true
      break
    case "daily_quota_exhausted":
      actions = (
        <>
          {toS40("유료 등급·다른 공급자 연결", btn)}
          {dash}
        </>
      )
      break
    case "billing_required":
      actions = (
        <>
          {info && pName ? <ExternalProviderLink href={info.billing_url}>{`${pName} 결제 설정`}</ExternalProviderLink> : null}
          {retry(btn)}
        </>
      )
      hasRetry = true
      break
    case "key_invalid":
      // the key was replaced (or another provider activated) since the job failed → retry (FL-21)
      if (reconnected && canRetry) {
        actions = <>{retry(btn)}</>
        hasRetry = true
        break
      }
      actions = (
        <>
          <Button variant={inline ? "link" : "default"} size="sm" asChild className={inline ? "h-auto px-0" : undefined}>
            <Link href={routes.aiConnect({ provider: provider ?? undefined, mode: "replace" })} onClick={() => markAiConnectReturn()}>
              키 교체
            </Link>
          </Button>
          {dash}
        </>
      )
      break
    case "model_not_available":
      actions = (
        <>
          {info ? <ExternalProviderLink href={info.upgrade_url}>등급 업그레이드 안내</ExternalProviderLink> : null}
          {toS40("다른 공급자 연결", btn)}
        </>
      )
      break
    case "provider_unavailable":
      actions = (
        <>
          {retry(btn)}
          {info && pName ? <ExternalProviderLink href={info.status_url}>{`${pName} 상태 페이지`}</ExternalProviderLink> : null}
        </>
      )
      hasRetry = true
      break
    case "input_too_long":
    case "safety_blocked":
      // v5.3 R-69: no retry for input-caused failures — fix the input, then run again
      actions = inputAction(inputLabel ?? `${reduceTarget ?? "입력"}으로 이동`, btn)
      break
    case "key_missing":
      if (refreshing) {
        // 3.20: no wrong "AI 연결하기" flash while the connection is re-read
        actions = <Skeleton className="h-8 w-40" />
        break
      }
      if (consentCause) {
        actions = (
          <>
            <Button variant={inline ? "link" : "default"} size="sm" className={inline ? "h-auto px-0" : undefined} onClick={() => consent.open()}>
              동의하기
            </Button>
            {inputAction(inputLabel ?? "입력으로 돌아가기", "link")}
          </>
        )
        break
      }
      // FL-21 "모든 원인 → 다시 시도": once a usable key is connected again (after the FL-19 round
      // trip) the same job can resume — RetryButton replaces "AI 연결하기" (UQ-321)
      if (reconnected && canRetry) {
        actions = (
          <>
            {retry(btn)}
            {inputAction(inputLabel ?? "입력으로 돌아가기", "link")}
          </>
        )
        hasRetry = true
        break
      }
      // UQ-404 (02 C-20 ③④⑤): a usable, consented key is active (e.g. right after agreeing) but this
      // place has no retry → no "AI 연결하기" loop; the user runs again from the input / run button
      if (reconnected && !connection?.consent_required) {
        actions = inputAction(inputLabel ?? "입력으로 돌아가기", "link")
        break
      }
      actions = (
        <>
          <Button variant={inline ? "link" : "default"} size="sm" asChild className={inline ? "h-auto px-0" : undefined}>
            <AiConnectLink onClick={() => markAiConnectReturn()}>
              AI 연결하기
            </AiConnectLink>
          </Button>
          {inputAction(inputLabel ?? "입력으로 돌아가기", "link")}
        </>
      )
      break
    case "not_a_jd":
      actions = inputAction(inputLabel ?? "입력 화면으로", "link")
      break
    default:
      // system (timeout / stalled / schema_invalid / unknown)
      actions = retry(btn)
      hasRetry = true
  }
  hasRetry = hasRetry && canRetry && !inputCaused

  // v5.3 retry refusal (G-34): only the action row changes
  let refusalLine: React.ReactNode = null
  if (refusal && hasRetry) {
    switch (refusal) {
      case "key_missing":
        actions = <AiLock entry={lockEntry} size="inline" title={AI_LOCK_RETRY_TITLE} className="w-full" />
        hasRetry = false
        break
      case "key_invalid":
        refusalLine = <AiErrorNotice code="key_invalid" size="inline" />
        break
      case "ai_connection_changed":
        refusalLine = (
          <p className="flex items-center gap-1.5 text-sm" role="status">
            <RefreshCw className="size-3.5 shrink-0 text-info" aria-hidden />
            {RETRY_REFUSAL_COPY.ai_connection_changed}
          </p>
        )
        break
      case "ai_job_not_retryable":
        actions = (
          <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm" role="status">
            <CircleAlert className="size-3.5 shrink-0 text-warning" aria-hidden />
            {RETRY_REFUSAL_COPY.ai_job_not_retryable}
            {inputAction(inputLabel ?? "입력으로 이동", "link")}
          </p>
        )
        hasRetry = false
        break
      // ai_consent_required: the row stays; C-21 opened by the effect above
    }
  }

  // v5.3 "처음부터 다시": same-row retry on another provider / tier than the job row (A1, R-73)
  const restartLine =
    hasRetry && aiRetry && sameRow && active && provider && (active !== provider || (jobTier && connection?.connection_tier !== jobTier)) ? (
      <p className="flex items-center gap-1.5 text-sm">
        <ArrowLeftRight className="size-3.5 shrink-0" aria-hidden />
        {activeName}로 처음부터 다시 해요
      </p>
    ) : null
  // [UI-가정] G-35 input-caused caption
  const fixCaption = inputCaused && !hideFixCaption ? (
    <p className="text-xs text-muted-foreground">{rerunLabel ? `고친 뒤 ${rerunLabel}${directionParticle(rerunLabel)} 새로 실행해 주세요` : "고친 뒤 다시 실행해 주세요"}</p>
  ) : null

  if (size === "field") {
    const destructive = code === "key_invalid" || category === "input"
    return (
      <div className={cn("space-y-1 text-sm", className)}>
        {announce}
        <p className={cn("flex items-start gap-1.5", destructive ? "text-destructive" : "text-warning-subtle-foreground")}>
          <Icon className="mt-0.5 size-4 shrink-0" aria-hidden />
          <span>{copy.title}</span>
        </p>
        {timeLine ? <div className="text-xs text-muted-foreground">{timeLine}</div> : null}
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1">{actions}</div>
        {consent.dialog}
      </div>
    )
  }

  if (size === "inline") {
    return (
      <div className={cn("space-y-1", className)}>
        {announce}
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm">
          <Icon className={cn("size-4 shrink-0", copy.tone === "warning" ? "text-warning" : "text-destructive")} aria-hidden />
          <span className={copy.tone === "warning" ? "text-warning-subtle-foreground" : "text-destructive-subtle-foreground"}>
            {copy.title}
          </span>
          {actions}
        </div>
        {timeLine ? <div className="text-xs text-muted-foreground">{timeLine}</div> : null}
        {refusalLine}
        {restartLine}
        {hasRetry ? <p className="text-xs text-muted-foreground">{retryTokenNote(retryLabel)}</p> : null}
        {fixCaption}
        {consent.dialog}
      </div>
    )
  }

  return (
    <Alert
      variant={copy.tone}
      className={cn("gap-x-3 p-4 has-[>svg]:gap-x-3", className)}
      role={undefined}
    >
      <Icon className="size-5" aria-hidden />
      <AlertTitle className="text-base leading-6 font-semibold">{copy.title}</AlertTitle>
      <AlertDescription className="space-y-2 text-sm">
        {announce}
        {lead ? <p className="font-medium">{lead}</p> : null}
        {timeLine}
        {hidePreserved ? null : <p>{AI_ERROR_PRESERVED}</p>}
        {actions ? <div className="flex flex-wrap items-center gap-2 pt-1">{actions}</div> : null}
        {refusalLine}
        {restartLine}
        {hasRetry ? <p className="text-xs text-muted-foreground">{retryTokenNote(retryLabel)}</p> : null}
        {fixCaption}
        {consent.dialog}
      </AlertDescription>
    </Alert>
  )
}
