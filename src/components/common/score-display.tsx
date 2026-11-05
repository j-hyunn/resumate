/**
 * C-17 점수 표시 규칙 (02 S-22 C-17 v5.13 — OD-I1 · OD-I2 · R-OD-3, design-system 3.16).
 * Cross-area: S-20, S-22, S-31, S-37. Scores are never colored good/bad.
 * What a slot shows is decided by lib/data/interview-session-view.ts (pure, tested); this file only renders it.
 */
import * as React from "react"
import { Hourglass, Info } from "lucide-react"
import { cn } from "@/lib/utils"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import type { AnswerScoreStatus, InterviewSession } from "@/types/db"
import { ALL_UNANSWERED_COPY, answerScoreView, scorePoints, sessionScoreView } from "@/lib/data/interview-session-view"

/** C-17 고정 고지 (NFR-AI-03, "합격 예측 아님") — 세션 점수와 질문 점수 둘 다 옆에 둔다 [가정](위치) */
export const SCORE_DISCLAIMER = "입력한 답변 기준 연습 점수예요. 합격 가능성을 뜻하지 않아요"

export function ScoreDisclaimer({ className }: { className?: string }) {
  return (
    <p className={cn("flex items-center gap-1.5 text-sm text-muted-foreground", className)}>
      <Info className="size-4 shrink-0" aria-hidden />
      {SCORE_DISCLAIMER}
    </p>
  )
}

type SessionScoreFields = Pick<
  InterviewSession,
  "score_status" | "score_value" | "score_max" | "score_counted_count" | "unanswered_count" | "question_count"
>

/** "{n}점 / 100" */
function Points({ value, max, large = false }: { value: number; max: number; large?: boolean }) {
  return (
    <span className="tabular-nums">
      <span className={large ? "text-3xl leading-9 font-semibold tracking-tight" : "font-semibold"}>{scorePoints(value)}</span>
      <span className={cn("text-muted-foreground", large && "text-lg")}> / {max}</span>
    </span>
  )
}

/** Compact session score for lists (S-20 / S-31 / S-37 rows). null status → nothing. */
export function SessionScoreBadge({
  session,
}: {
  session: Pick<SessionScoreFields, "score_status" | "score_value" | "score_max" | "unanswered_count" | "question_count"> &
    Partial<Pick<SessionScoreFields, "score_counted_count">>
}) {
  const view = sessionScoreView({ score_counted_count: null, ...session })
  switch (view.kind) {
    case "hidden":
      return null
    case "pending":
      return (
        <Badge variant="outline">
          <Hourglass aria-hidden />
          점수 산정 방식 준비 중
        </Badge>
      )
    case "not_scored":
      return <span className="text-sm text-muted-foreground">점수를 계산하지 못했어요</span>
    case "scored":
      return <Points value={view.value} max={view.max} />
  }
}

/** Large session score (S-22 header). Rationale toggle is the caller's Collapsible. */
export function SessionScore({
  session,
  startNewAction,
  className,
}: {
  /** 모든 질문이 미응답 → "새 면접 시작하기" (C-17, OD-I1). Omit on read-only sessions (OD-I6). */
  startNewAction?: React.ReactNode
  session: SessionScoreFields
  className?: string
}) {
  const view = sessionScoreView(session)
  if (view.kind === "hidden") return null
  return (
    <div className={cn("space-y-1", className)}>
      {view.kind === "scored" ? (
        <>
          <p>
            <Points value={view.value} max={view.max} large />
          </p>
          {view.allUnanswered ? (
            <>
              <p className="text-sm text-muted-foreground tabular-nums">미응답 {view.unanswered}개</p>
              <p className="inline-flex flex-wrap items-center gap-2 text-sm">
                {ALL_UNANSWERED_COPY}
                {startNewAction}
              </p>
            </>
          ) : (
            <p className="text-sm text-muted-foreground tabular-nums">
              반영 질문 {view.counted}개
              {view.unanswered > 0 ? ` · 미응답 ${view.unanswered}개(0점으로 반영)` : ""}
            </p>
          )}
        </>
      ) : (
        <SessionScoreBadge session={session} />
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
  const view = answerScoreView(status, value, max)
  switch (view.kind) {
    case "hidden":
      return null
    case "pending":
      return (
        <Badge variant="outline">
          <Hourglass aria-hidden />
          점수 준비 중
        </Badge>
      )
    case "unanswered":
      return <Badge variant="outline">미응답 · 0점</Badge>
    case "not_scored":
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
    case "scored":
      return <Points value={view.value} max={view.max} />
  }
}
