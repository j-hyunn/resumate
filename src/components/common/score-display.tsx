/**
 * C-17 점수 표시 규칙 (02 S-22, design-system 3.16). Cross-area: S-20, S-22, S-31, S-37.
 * Scores are never colored good/bad.
 */
import * as React from "react"
import { Hourglass, Info } from "lucide-react"
import { cn } from "@/lib/utils"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import type { AnswerScoreStatus, InterviewSession, SessionScoreStatus } from "@/types/db"

export const SCORE_DISCLAIMER = "입력한 답변 기준 연습 점수예요. 합격 가능성을 뜻하지 않아요"

export function ScoreDisclaimer({ className }: { className?: string }) {
  return (
    <p className={cn("flex items-center gap-1.5 text-sm text-muted-foreground", className)}>
      <Info className="size-4 shrink-0" aria-hidden />
      {SCORE_DISCLAIMER}
    </p>
  )
}

/** Compact session score for lists (S-20 / S-31 / S-37 rows). null status → nothing. */
export function SessionScoreBadge({
  session,
  startNewAction,
}: {
  session: Pick<InterviewSession, "score_status" | "score_value" | "score_max" | "unanswered_count" | "question_count">
  /** 응답 0개일 때 "새 면접 시작하기" (UQ-20) — pass a Button/Link */
  startNewAction?: React.ReactNode
}) {
  const status: SessionScoreStatus | null = session.score_status
  if (!status) return null
  if (status === "pending_method")
    return (
      <Badge variant="outline">
        <Hourglass aria-hidden />
        점수 산정 방식 준비 중
      </Badge>
    )
  if (status === "not_scored")
    return (
      <span className="inline-flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
        {session.unanswered_count === session.question_count ? "답변이 없어 평가할 내용이 없어요" : "점수를 계산하지 못했어요"}
        {session.unanswered_count === session.question_count ? startNewAction : null}
      </span>
    )
  return (
    <span className="tabular-nums">
      <span className="font-semibold">{session.score_value}</span>
      <span className="text-muted-foreground"> / {session.score_max}</span>
    </span>
  )
}

/** Large session score (S-22 header). Rationale toggle is the caller's Collapsible. */
export function SessionScore({
  session,
  startNewAction,
  className,
}: {
  /** 응답 0개 → "새 면접 시작하기" */
  startNewAction?: React.ReactNode
  session: Pick<InterviewSession, "score_status" | "score_value" | "score_max" | "score_counted_count" | "unanswered_count" | "question_count">
  className?: string
}) {
  if (!session.score_status) return null
  return (
    <div className={cn("space-y-1", className)}>
      {session.score_status === "scored" ? (
        <>
          <p>
            <span className="text-3xl leading-9 font-semibold tracking-tight tabular-nums">{session.score_value}</span>
            <span className="text-lg text-muted-foreground tabular-nums"> / {session.score_max}</span>
          </p>
          <p className="text-sm text-muted-foreground tabular-nums">반영 질문 {session.score_counted_count ?? 0}개</p>
        </>
      ) : (
        <SessionScoreBadge session={session} startNewAction={startNewAction} />
      )}
      <ScoreDisclaimer />
    </div>
  )
}

/** Per-answer score (S-22 cards) */
export function AnswerScore({
  status,
  value,
  max,
  onRescore,
}: {
  status: AnswerScoreStatus | null
  value: number | null
  max: number | null
  /** not_scored → "다시 채점" */
  onRescore?: () => void
}) {
  if (!status) return null
  if (status === "pending_method")
    return (
      <Badge variant="outline">
        <Hourglass aria-hidden />
        점수 준비 중
      </Badge>
    )
  if (status === "unanswered") return <Badge variant="outline">미응답</Badge>
  if (status === "not_scored")
    return (
      <span className="inline-flex items-center gap-2">
        <Badge variant="destructive-subtle">채점 실패</Badge>
        {onRescore ? (
          <Button variant="link" size="sm" className="h-auto px-0" onClick={onRescore}>
            다시 채점
          </Button>
        ) : null}
      </span>
    )
  return (
    <span className="tabular-nums">
      <span className="font-semibold">{value}</span>
      <span className="text-muted-foreground"> / {max}</span>
    </span>
  )
}
