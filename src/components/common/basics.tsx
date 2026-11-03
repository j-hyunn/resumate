/**
 * Small shared patterns (design-system 2 "공통 커스텀 패턴"): PageHeader,
 * StatusDot / StageLabel / OutcomeBadge, DDay. Server- and client-safe (no hooks).
 */
import * as React from "react"
import { CircleHelp, CircleX, Clock, Trophy } from "lucide-react"
import { cn } from "@/lib/utils"
import { Badge } from "@/components/ui/badge"
import type { ApplicationStage, StageOutcome } from "@/types/db"
import { OUTCOME_LABELS, STAGE_LABELS } from "@/lib/data/labels"

// ---------------------------------------------------------------------------
// PageHeader — page-title + actions + meta description. One per screen.
// ---------------------------------------------------------------------------

export function PageHeader({
  title,
  description,
  actions,
  status,
  badge,
  className,
}: {
  title: React.ReactNode
  description?: React.ReactNode
  /** right-side action group (primary button at most one per screen) */
  actions?: React.ReactNode
  /** C-06 save status slot (right side, before actions) */
  status?: React.ReactNode
  /** badge next to the title (e.g. 작성 중) */
  badge?: React.ReactNode
  className?: string
}) {
  return (
    <header className={cn("flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between", className)}>
      <div className="min-w-0 space-y-1">
        <div className="flex flex-wrap items-center gap-2">
          <h1 className="text-2xl leading-8 font-bold">{title}</h1>
          {badge}
        </div>
        {description ? <p className="text-sm leading-5 text-muted-foreground">{description}</p> : null}
      </div>
      {status || actions ? (
        <div className="flex shrink-0 flex-wrap items-center gap-2">
          {status}
          {actions}
        </div>
      ) : null}
    </header>
  )
}

// ---------------------------------------------------------------------------
// StatusDot / StageLabel / OutcomeBadge (1.1.4)
// ---------------------------------------------------------------------------

const STAGE_DOT_CLASS: Record<ApplicationStage, string> = {
  before_apply: "bg-stage-before-apply",
  document: "bg-stage-document",
  assignment: "bg-stage-assignment",
  job_interview: "bg-stage-job-interview",
  culture_fit_interview: "bg-stage-culture-fit-interview",
  closed: "bg-stage-closed",
}

/** 8px decorative dot — always pair with the stage name (R-C5) */
export function StatusDot({ stage, className }: { stage: ApplicationStage; className?: string }) {
  return <span aria-hidden className={cn("inline-block size-2 shrink-0 rounded-full", STAGE_DOT_CLASS[stage], className)} />
}

export function StageLabel({ stage, className }: { stage: ApplicationStage; className?: string }) {
  return (
    <span className={cn("inline-flex items-center gap-1.5", className)}>
      <StatusDot stage={stage} />
      {STAGE_LABELS[stage]}
    </span>
  )
}

/** 전형 종료 결과 배지: 최종 합격 / 불합격 / 결과 미기록 */
export function OutcomeBadge({ outcome, className }: { outcome: StageOutcome | null; className?: string }) {
  if (outcome === "passed")
    return (
      <Badge variant="success" className={className}>
        <Trophy aria-hidden />
        {OUTCOME_LABELS.passed}
      </Badge>
    )
  if (outcome === "failed")
    return (
      <Badge variant="destructive-subtle" className={className}>
        <CircleX aria-hidden />
        {OUTCOME_LABELS.failed}
      </Badge>
    )
  return (
    <Badge variant="muted" className={className}>
      <CircleHelp aria-hidden />
      {OUTCOME_LABELS.none}
    </Badge>
  )
}

// ---------------------------------------------------------------------------
// DDay — D-12 / 3일 이내 warning badge "D-2" + Clock / 지남 "마감"
// ---------------------------------------------------------------------------

export function daysUntil(deadline: string, now = new Date()): number {
  const today = Date.UTC(now.getFullYear(), now.getMonth(), now.getDate())
  const [y, m, d] = deadline.slice(0, 10).split("-").map(Number)
  return Math.round((Date.UTC(y, m - 1, d) - today) / 86_400_000)
}

export function DDay({ deadline, className }: { deadline: string | null; className?: string }) {
  if (!deadline) return null
  const days = daysUntil(deadline)
  if (days < 0)
    return <span className={cn("text-sm text-muted-foreground tabular-nums", className)}>마감</span>
  const label = days === 0 ? "D-day" : `D-${days}`
  if (days <= 3)
    return (
      <Badge variant="warning" className={cn("tabular-nums", className)} aria-label={`마감 ${label}`}>
        <Clock aria-hidden />
        {label}
      </Badge>
    )
  return (
    <span className={cn("text-sm tabular-nums", className)} aria-label={`마감 ${label}`}>
      {label}
    </span>
  )
}
