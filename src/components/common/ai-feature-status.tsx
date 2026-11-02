"use client"

/**
 * C-03 목록·카드 기능 상태 (design-system 3.3 v3 `AiFeatureStatus`). Draws exactly one shape:
 * generating → C-03 축약형 (earlier summary hidden) / present → `children` (the screen's own
 * look) / none → "없음" (or `emptyLabel`), plus the late-failure line (no button, G-30 — the row
 * or card itself opens the feature screen with the full C-20).
 *
 *   <AiFeatureStatus status={app.insight_status} emptyLabel="없음"><InsightCounts … /></AiFeatureStatus>
 */
import * as React from "react"
import { TimerOff } from "lucide-react"
import { cn } from "@/lib/utils"
import type { AiFeatureStatusView } from "@/lib/data/ai-feature-status"
import { AI_PROVIDER_LABELS } from "@/lib/mock/ai-providers"
import { AiProgressInline } from "./ai-progress"
import { aiErrorTitle, copyIconFor } from "./ai-error-notice"

export function AiFeatureStatus({
  status,
  children,
  emptyLabel = "없음",
  className,
}: {
  status: AiFeatureStatusView
  /** ② 있음: the screen's own result look (S-13 icon + count, S-31 status badge + summary) */
  children?: React.ReactNode
  /** ③ 없음 copy (screen spec empty copy when it has one) */
  emptyLabel?: string
  className?: string
}) {
  if (status.kind === "generating") {
    return <AiProgressInline progress={status.progress} jobType={status.job_type} className={className} />
  }
  return (
    <span className={cn("inline-flex flex-col gap-0.5", className)}>
      {status.kind === "present" ? children : <span className="text-sm text-muted-foreground">{emptyLabel}</span>}
      {status.failure ? <AiFeatureFailureLine failure={status.failure} /> : null}
    </span>
  )
}

/** 실패 한 줄 (3.3 v3): tone icon + cause title, line-clamp-1, full sentence in `title` */
export function AiFeatureFailureLine({ failure }: { failure: NonNullable<AiFeatureStatusView["failure"]> }) {
  const stalled = failure.error_code === "stalled"
  const text = stalled
    ? "시간이 오래 걸려 중단됐어요"
    : aiErrorTitle(failure.error_code, { provider: failure.provider ? AI_PROVIDER_LABELS[failure.provider] : undefined })
  const { icon: Icon, tone } = stalled ? { icon: TimerOff, tone: "destructive" as const } : copyIconFor(failure.error_code)
  return (
    <span className="inline-flex min-w-0 items-center gap-1.5 text-sm" title={text}>
      <Icon className={cn("size-3.5 shrink-0", tone === "warning" ? "text-warning" : "text-destructive")} aria-hidden />
      <span className={cn("line-clamp-1", tone === "warning" ? "text-warning-subtle-foreground" : "text-destructive-subtle-foreground")}>
        {text}
      </span>
    </span>
  )
}
