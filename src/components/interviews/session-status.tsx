/**
 * Interview session status badge + small shared bits (design-system 6 A4: S-37 상태 배지).
 * Server- and client-safe.
 */
import { Ban, CircleAlert, CircleCheck, CircleDashed, Loader2 } from "lucide-react"
import { cn } from "@/lib/utils"
import { Badge } from "@/components/ui/badge"
import type { InterviewSession, InterviewSessionStatus } from "@/types/db"
import { formatRelative, SESSION_STATUS_LABELS } from "@/lib/data/labels"
import { routes } from "@/lib/routes"
import {
  APPLICATION_DELETED_BADGE,
  isApplicationDeleted,
  sessionApplicationSegment,
  type DeletedApplicationFields,
} from "@/lib/data/interview-session-view"

export function SessionStatusBadge({ status, className }: { status: InterviewSessionStatus; className?: string }) {
  const label = SESSION_STATUS_LABELS[status]
  switch (status) {
    case "in_progress":
      return (
        <Badge variant="draft" className={className}>
          <CircleDashed aria-hidden />
          {label}
        </Badge>
      )
    case "evaluating":
      return (
        <Badge variant="ai" className={className}>
          <Loader2 className="animate-spin" aria-hidden />
          {label}
        </Badge>
      )
    case "completed":
      return (
        <Badge variant="success" className={className}>
          <CircleCheck aria-hidden />
          {label}
        </Badge>
      )
    case "evaluation_failed":
      return (
        <Badge variant="destructive-subtle" className={className}>
          <CircleAlert aria-hidden />
          {label}
        </Badge>
      )
    case "abandoned":
      return (
        <Badge variant="muted" className={className}>
          <Ban aria-hidden />
          {label}
        </Badge>
      )
  }
}

export function NewResultDot({ className }: { className?: string }) {
  return (
    <span className={cn("inline-flex items-center", className)}>
      <span aria-hidden className="size-2 rounded-full bg-primary" />
      <span className="sr-only">새 결과</span>
    </span>
  )
}

/**
 * Row target (S-20 / S-37 → S-22 / S-33): writing in progress or abandoned → 답변지,
 * submitted (evaluating / completed / evaluation_failed) → 결과.
 * OD-I6 자기소개서 삭제됨 → always S-22 (read-only) under the "deleted" segment ([UI-가정] route).
 */
export function sessionHref(s: Pick<InterviewSession, "id" | "application_project_id" | "status"> & DeletedApplicationFields): string {
  if (isApplicationDeleted(s)) return routes.interviewResult(sessionApplicationSegment(s), s.id)
  return s.status === "in_progress" || s.status === "abandoned"
    ? routes.interviewSession(s.application_project_id, s.id)
    : routes.interviewResult(s.application_project_id, s.id)
}

/** OD-I6 표식 "자기소개서 삭제됨" (S-37 행, S-22 머리) */
export function ApplicationDeletedBadge({ className }: { className?: string }) {
  return (
    <Badge variant="muted" className={className}>
      {APPLICATION_DELETED_BADGE}
    </Badge>
  )
}

/** "3시간 전" — rendered on server and client at slightly different times */
export function RelativeTime({ iso, className }: { iso: string; className?: string }) {
  return (
    <time dateTime={iso} className={className} suppressHydrationWarning>
      {formatRelative(iso)}
    </time>
  )
}
