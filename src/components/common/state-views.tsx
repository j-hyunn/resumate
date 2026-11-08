/**
 * ST-xx state views (design-system 4): EmptyState, ErrorState (S-28), skeletons (ST-LOADING),
 * WaitJd (ST-WAIT-JD), 공급자 장애 배너 (S-28). C-20 / C-18 live in ai-error-notice / ai-lock.
 * Server-safe except where noted; interactive pieces take callbacks or hrefs.
 */
import * as React from "react"
import Link from "next/link"
import {
  CircleAlert,
  CloudAlert,
  FileQuestion,
  Layers,
  Loader2,
  LockKeyhole,
  RotateCcw,
  type LucideIcon,
} from "lucide-react"
import { cn } from "@/lib/utils"
import { Alert, AlertTitle } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"
import { routes } from "@/lib/routes"
import { SignInLink } from "./sign-in-link"

// ---------------------------------------------------------------------------
// ST-EMPTY
// ---------------------------------------------------------------------------

export function EmptyState({
  icon: Icon = Layers,
  title,
  description,
  actions,
  className,
}: {
  /** 커리어 Layers, 자기소개서 Briefcase, 보드 KanbanSquare */
  icon?: LucideIcon
  title: React.ReactNode
  description?: React.ReactNode
  /** primary 1 + secondary 1 */
  actions?: React.ReactNode
  className?: string
}) {
  return (
    <section className={cn("mx-auto max-w-md space-y-3 py-16 text-center", className)}>
      <div className="mx-auto grid size-10 place-items-center rounded-full bg-muted">
        <Icon className="size-5 text-muted-foreground" aria-hidden />
      </div>
      <h2 className="text-base leading-6 font-semibold">{title}</h2>
      {description ? <p className="text-base text-muted-foreground">{description}</p> : null}
      {actions ? <div className="flex flex-wrap justify-center gap-2 pt-1">{actions}</div> : null}
    </section>
  )
}

// ---------------------------------------------------------------------------
// S-28 ST-UNAUTH / ST-NOTFOUND / 일반 오류
// ---------------------------------------------------------------------------

export type ErrorKind = "not-found" | "unauth" | "error"

/**
 * Narrow a `?state=` value to an ErrorState kind (A3/A4 request). Returns null for any
 * other state, so pages can write `const errorKind = previewErrorKind(state)`.
 */
export function previewErrorKind(state: string | null | undefined): ErrorKind | null {
  return state === "not-found" || state === "unauth" || state === "error" ? state : null
}

// [UI-가정] S-28 copy is "v3와 같음" and v3 is not in the repo; conservative copy below.
const ERROR_COPY: Record<ErrorKind, { icon: LucideIcon; title: string; description: string }> = {
  "not-found": {
    icon: FileQuestion,
    title: "찾을 수 없는 페이지예요",
    description: "주소가 바뀌었거나 삭제된 항목이에요.",
  },
  unauth: {
    icon: LockKeyhole,
    title: "접근할 수 없는 페이지예요",
    description: "로그인이 필요하거나 이 항목을 볼 권한이 없어요.",
  },
  error: {
    icon: CircleAlert,
    title: "문제가 생겼어요",
    description: "잠시 후 다시 시도해 주세요. 입력한 내용은 저장된 곳까지 남아 있어요.",
  },
}

export function ErrorState({
  kind,
  inShell = true,
  onRetry,
  className,
}: {
  kind: ErrorKind
  /** inside L-01 → content area; outside → page center */
  inShell?: boolean
  /** "error" kind only (client boundaries) */
  onRetry?: () => void
  className?: string
}) {
  const copy = ERROR_COPY[kind]
  const Icon = copy.icon
  return (
    <section
      role={kind === "error" ? "alert" : undefined}
      className={cn(
        "mx-auto max-w-md space-y-3 text-center",
        inShell ? "py-16" : "flex min-h-dvh flex-col items-center justify-center px-4",
        className,
      )}
    >
      <div className="mx-auto grid size-10 place-items-center rounded-full bg-muted">
        <Icon className="size-5 text-muted-foreground" aria-hidden />
      </div>
      <h1 className="text-base leading-6 font-semibold">{copy.title}</h1>
      <p className="text-base text-muted-foreground">{copy.description}</p>
      <div className="flex flex-wrap justify-center gap-2 pt-1">
        {kind === "error" && onRetry ? (
          <Button onClick={onRetry}>
            <RotateCcw aria-hidden />
            다시 시도
          </Button>
        ) : null}
        {kind === "unauth" ? (
          <React.Suspense
            fallback={
              <Button asChild>
                <Link href={routes.signIn()}>로그인</Link>
              </Button>
            }
          >
            <SignInLink />
          </React.Suspense>
        ) : (
          <Button asChild variant={kind === "error" && onRetry ? "outline" : "default"}>
            <Link href={routes.career()}>커리어로 가기</Link>
          </Button>
        )}
      </div>
    </section>
  )
}

// ---------------------------------------------------------------------------
// ST-LOADING — skeletons shaped like the real layout. No full-screen spinners.
// The 300ms delay is CSS-only (opacity animation) so server fallbacks work too.
// ---------------------------------------------------------------------------

function Delayed({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <div
      aria-busy="true"
      aria-live="polite"
      className={cn("animate-in fade-in-0 fill-mode-both delay-300 duration-150", className)}
    >
      <span className="sr-only">불러오는 중</span>
      {children}
    </div>
  )
}

export function ListSkeleton({ rows = 4, className }: { rows?: number; className?: string }) {
  return (
    <Delayed className={cn("space-y-2", className)}>
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} className="flex items-center gap-3 rounded-lg border bg-card px-3 py-2.5">
          <Skeleton className="size-8 rounded-md" />
          <div className="flex-1 space-y-2">
            <Skeleton className="h-4 w-1/3" />
            <Skeleton className="h-3 w-1/2" />
          </div>
        </div>
      ))}
    </Delayed>
  )
}

export function CardGridSkeleton({ cards = 4, className }: { cards?: number; className?: string }) {
  return (
    <Delayed className={cn("grid gap-4 md:grid-cols-2", className)}>
      {Array.from({ length: cards }, (_, i) => (
        <div key={i} className="space-y-3 rounded-lg border bg-card p-5">
          <Skeleton className="h-5 w-1/3" />
          <Skeleton className="h-4 w-2/3" />
          <Skeleton className="h-8 w-20" />
        </div>
      ))}
    </Delayed>
  )
}

export function FormSkeleton({ fields = 5, className }: { fields?: number; className?: string }) {
  return (
    <Delayed className={cn("max-w-3xl space-y-4 rounded-lg border bg-card p-5", className)}>
      {Array.from({ length: fields }, (_, i) => (
        <div key={i} className="space-y-1.5">
          <Skeleton className="h-4 w-24" />
          <Skeleton className="h-10 w-full" />
        </div>
      ))}
    </Delayed>
  )
}

export function TextSkeleton({ lines = 3, className }: { lines?: number; className?: string }) {
  return (
    <div className={cn("space-y-2", className)} aria-hidden>
      {Array.from({ length: lines }, (_, i) => (
        <Skeleton key={i} className={cn("h-4", i === lines - 1 ? "w-2/3" : "w-full")} />
      ))}
    </div>
  )
}

/** Generic page fallback: header + list. Used by (dashboard)/loading.tsx. */
export function PageSkeleton() {
  return (
    <Delayed className="space-y-8">
      <div className="space-y-2">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-4 w-72" />
      </div>
      <div className="space-y-2">
        {Array.from({ length: 4 }, (_, i) => (
          <div key={i} className="rounded-lg border bg-card px-3 py-3">
            <Skeleton className="h-4 w-1/3" />
            <Skeleton className="mt-2 h-3 w-1/2" />
          </div>
        ))}
      </div>
    </Delayed>
  )
}

// ST-AI-FAILED → C-20 AiErrorNotice (ai-error-notice.tsx); ST-LIMIT removed (v2, D-34).
// ST-AI-LOCKED → C-18 AiLock (ai-lock.tsx).
// ---------------------------------------------------------------------------

/**
 * Partial-result line without an error code (stored `status = failed` section, unfinished draft):
 * "이 섹션을 만들지 못했어요 · 다시 생성". When the job's error_code is known use
 * <AiErrorNotice size="inline" /> instead (C-20 cause copy).
 */
export function AiFailedInline({
  message = "답을 받지 못했어요",
  actionLabel = "다시 보내기",
  onRetry,
  className,
}: {
  message?: string
  actionLabel?: string
  onRetry?: () => void
  className?: string
}) {
  return (
    <div className={cn("flex flex-wrap items-center gap-2 text-sm text-destructive", className)} role="status">
      <CircleAlert className="size-4 shrink-0" aria-hidden />
      <span>{message}</span>
      {onRetry ? (
        <Button variant="link" size="sm" className="h-auto px-0" onClick={onRetry}>
          {actionLabel}
        </Button>
      ) : null}
    </div>
  )
}


// ---------------------------------------------------------------------------
// ST-WAIT-JD
// ---------------------------------------------------------------------------

export function WaitJd({ className }: { className?: string }) {
  return (
    <p className={cn("flex items-center gap-2 text-sm text-muted-foreground", className)} role="status">
      <Loader2 className="size-4 animate-spin text-ai" aria-hidden />
      공고 분석이 끝나면 시작할 수 있어요
    </p>
  )
}

// ---------------------------------------------------------------------------
// S-28 공급자 장애 배너 (v2: per provider; dismiss handled by AiOutageBanner client wrapper)
// ---------------------------------------------------------------------------

/** "{공급자}에 일시적인 문제가 있어요. 커리어 입력과 열람, 자기소개서, 지원 현황 보드는 정상이에요" (02 C-20) */
export function aiOutageMessage(providerLabel: string): string {
  return `${providerLabel}에 일시적인 문제가 있어요. 커리어 입력과 열람, 자기소개서, 지원 현황 보드는 정상이에요`
}

export function AiOutageAlert({
  providerLabel,
  action,
  className,
}: {
  /** active provider display name (Gemini / Claude / GPT) */
  providerLabel: string
  /** status-page link + dismiss button */
  action?: React.ReactNode
  className?: string
}) {
  return (
    <Alert variant="warning" className={cn("rounded-none border-x-0 border-t-0", className)}>
      <CloudAlert aria-hidden />
      <AlertTitle className="font-normal">{aiOutageMessage(providerLabel)}</AlertTitle>
      {action}
    </Alert>
  )
}
