"use client"

/**
 * C-03 AI 작업 상태 (비동기) — design-system 3.3. Hook + card + compact form.
 *
 *   const { status, progress, job, error, retry, cancel } = useAiJob(jobId)
 *   <AiProgress job={job} title="인사이트 생성" />
 *
 * Hook shape is stable so Realtime can replace polling later (patterns.md §1).
 */
import * as React from "react"
import { Check, Circle, Hourglass, Loader2 } from "lucide-react"
import { cn } from "@/lib/utils"
import { Progress } from "@/components/ui/progress"
import type { AiErrorCode, AiJobProgress, AiJobStatus, AiJobType, AiProgressStage, AiRetryRefusalCode, ConnectionTier } from "@/types/db"
import { AI_STAGE_LABELS, aiStageLabel } from "@/lib/data/labels"
import type { AiJobView } from "@/lib/data/ai-jobs"
import { cancelAiJobAction, getAiJobAction, retryAiJobAction } from "@/lib/data/actions"
import { isAiRejected } from "@/lib/data/ai-errors"
import { notifyAiConnectionChanged, useAiConnection } from "./ai-connection-context"
import { useNow } from "./ai-error-notice"
import { ProviderBadge } from "./provider-badge"

const POLL_MS = 2_000

export interface UseAiJobResult {
  job: AiJobView | null
  status: AiJobStatus | "idle"
  progress: AiJobProgress | null
  /** v4: error_code of the failed job → <AiErrorNotice {...aiErrorFromJob(job)} /> (C-20) */
  error: AiErrorCode | null
  /**
   * v5.3: the last retry was refused (HTTP 409, 04 §2.11.7 ②) → <AiErrorNotice refusal={…} />.
   * Cleared when a retry starts.
   */
  refusal: AiRetryRefusalCode | null
  /** C-20 "다시 시도" (same row, active provider; restarts from `prepare` when the provider changed) */
  retry: () => Promise<void>
  retrying: boolean
  cancel: () => Promise<void>
}

export function useAiJob(jobId: string | null | undefined, opts?: { onDone?: (job: AiJobView) => void }): UseAiJobResult {
  const [job, setJob] = React.useState<AiJobView | null>(null)
  const onDone = React.useRef(opts?.onDone)
  React.useEffect(() => {
    onDone.current = opts?.onDone
  })

  const terminal = (s?: AiJobStatus) => s === "succeeded" || s === "failed" || s === "canceled"

  React.useEffect(() => {
    if (!jobId) return
    let alive = true
    let timer: ReturnType<typeof setTimeout> | undefined
    const tick = async () => {
      const next = await getAiJobAction(jobId)
      if (!alive) return
      setJob(next)
      if (next && terminal(next.status)) {
        if (next.status === "succeeded") onDone.current?.(next)
        return
      }
      timer = setTimeout(tick, POLL_MS)
    }
    void tick()
    return () => {
      alive = false
      if (timer) clearTimeout(timer)
    }
  }, [jobId, job?.retry_count])

  const [refusal, setRefusal] = React.useState<AiRetryRefusalCode | null>(null)
  const [retrying, setRetrying] = React.useState(false)
  const retry = React.useCallback(async () => {
    if (!jobId) return
    setRefusal(null)
    setRetrying(true)
    try {
      const next = await retryAiJobAction(jobId)
      // 409: the server changed nothing → keep the failure, swap the action row (G-34)
      if (isAiRejected(next)) {
        // path ② only yields retry codes; a missing code means "no usable key"
        const code = next.refusal
        setRefusal(!code || code === "ai_not_connected" ? "key_missing" : (code as AiRetryRefusalCode))
        notifyAiConnectionChanged()
        return
      }
      setJob(next)
    } finally {
      setRetrying(false)
    }
  }, [jobId])

  const cancel = React.useCallback(async () => {
    if (!jobId) return
    await cancelAiJobAction(jobId)
  }, [jobId])

  return {
    job,
    status: job?.status ?? (jobId ? "queued" : "idle"),
    progress: job?.progress ?? null,
    error: job?.status === "failed" ? (job.error_code ?? "provider_unavailable") : null,
    refusal,
    retry,
    retrying,
    cancel,
  }
}

/**
 * Ordered stage rows per job type (03 C-6 v4.3). `synthesize_regen` reuses the `synthesize` row and
 * `complete` has no row (all rows done, bar 100 %) — design-system 3.3 (v3).
 */
const STAGE_SEQUENCE: Partial<Record<AiJobType, AiProgressStage[]>> = {
  insight: ["prepare", "match", "synthesize", "validate"],
  interview_questions: ["prepare", "generate"],
  interview_evaluation: ["prepare", "evaluate", "summarize", "score"],
  career_description: ["generate", "validate"],
  cover_letter: ["rank", "generate", "adjust_length", "validate"],
  draft_source_ranking: ["rank"],
}

/** C-03 문구 for a progress value; pass `jobType` for the job-dependent copy (aiStageLabel) */
export function stageText(progress: AiJobProgress | null | undefined, jobType?: AiJobType | null): string {
  if (!progress) return "준비 중"
  return jobType ? aiStageLabel(jobType, progress) : AI_STAGE_LABELS[progress.stage]
}

/** row index of a stage in the sequence (synthesize_regen → synthesize row, complete → past the end) */
function stageRow(stages: AiProgressStage[], stage: AiProgressStage | undefined): number {
  if (!stage) return 0
  if (stage === "complete") return stages.length
  const i = stages.indexOf(stage === "synthesize_regen" ? "synthesize" : stage)
  return i < 0 ? 0 : i
}

function countText(progress: AiJobProgress | null | undefined) {
  return progress && progress.total ? `${progress.done ?? 0}/${progress.total}` : null
}

/**
 * Paid-tier time estimate per job type (seconds); free tier shows 2× (D-37).
 * // [UI-가정] baseline values — spec only gives the insight example ("1분 30초" on free).
 */
const PAID_ESTIMATE_SEC: Partial<Record<AiJobType, number>> = {
  jd_extraction: 15,
  insight: 45,
  career_description: 40,
  cover_letter: 45,
  draft_source_ranking: 15,
  interview_questions: 30,
  interview_evaluation: 40,
}

function formatDuration(sec: number): string {
  const m = Math.floor(sec / 60)
  const s = sec % 60
  if (!m) return `${s}초`
  return s ? `${m}분 ${s}초` : `${m}분`
}

/** "무료 등급이라 하나씩 처리해요 · 1분 30초 정도 걸려요" */
export function freeTierLine(jobType: AiJobType): string {
  const paid = PAID_ESTIMATE_SEC[jobType]
  return paid ? `무료 등급이라 하나씩 처리해요 · ${formatDuration(paid * 2)} 정도 걸려요` : "무료 등급이라 하나씩 처리해요"
}

/** Seconds left of the provider rate-limit wait (progress.waiting_retry_until), null when not waiting */
export function useRetryWait(progress: AiJobProgress | null | undefined): number | null {
  const now = useNow()
  const until = progress?.waiting_retry_until
  if (!until || !now) return null
  const sec = Math.ceil((new Date(until).getTime() - now) / 1000)
  return sec > 0 ? sec : null
}

/** Full card: 결과가 나올 자리 맨 위 (ST-AI-PENDING) */
export function AiProgress({
  jobType,
  progress,
  title,
  connectionTier,
  showLeaveNote = true,
  hideBadge,
  className,
}: {
  jobType: AiJobType
  progress: AiJobProgress | null
  /** "{작업 이름} 진행 중" */
  title: string
  /** job.connection_tier (pinned at start); defaults to the active connection's tier */
  connectionTier?: ConnectionTier | null
  showLeaveNote?: boolean
  /** C-19 badge in the card head (default shown) */
  hideBadge?: boolean
  className?: string
}) {
  const connection = useAiConnection()
  const free = (connectionTier ?? connection?.connection_tier) === "free"
  const waitSec = useRetryWait(progress)
  const stages = STAGE_SEQUENCE[jobType] ?? (progress && progress.stage !== "complete" ? [progress.stage] : [])
  const currentIndex = stageRow(stages, progress?.stage)
  const complete = progress?.stage === "complete"
  // interview questions put n/N in the row text ("질문 만드는 중 (n/N)")
  const countInLabel = jobType === "interview_questions"
  const count = countInLabel ? null : countText(progress)
  const percent =
    stages.length === 0 || complete
      ? complete ? 100 : 0
      : ((Math.max(0, currentIndex) + (progress?.total ? (progress.done ?? 0) / progress.total : 0)) / stages.length) * 100

  return (
    <section
      className={cn("space-y-3 rounded-lg border border-ai/30 bg-ai-subtle p-4", className)}
      aria-busy="true"
    >
      {/* UQ-6 / A-6: announce once; polling updates below are not live */}
      <p className="sr-only" role="status">
        {title} 진행 중
      </p>
      <div className="flex items-center gap-2">
        <Loader2 className="size-4 animate-spin text-ai" aria-hidden />
        <h3 className="text-base leading-6 font-semibold text-ai-subtle-foreground">{title} 진행 중</h3>
        <div className="ml-auto flex items-center gap-2">
          {hideBadge ? null : <ProviderBadge />}
          {count ? <span className="text-xs font-medium tabular-nums text-ai-subtle-foreground">{count}</span> : null}
        </div>
      </div>
      {free ? <p className="text-xs text-ai-subtle-foreground">{freeTierLine(jobType)}</p> : null}
      {stages.length > 0 ? (
        <Progress
          value={percent}
          aria-label={`${title} 진행률`}
          className="h-1.5 bg-ai/15 [&>[data-slot=progress-indicator]]:bg-ai"
        />
      ) : null}
      <ol className="space-y-1 text-sm">
        {stages.map((stage, i) => {
          const state = i < currentIndex ? "done" : i === currentIndex ? "current" : "pending"
          return (
            <li key={stage} className={cn("flex items-center gap-2", state === "current" && "font-medium")}>
              {state === "done" ? (
                <Check className="size-4 text-success" aria-hidden />
              ) : state === "current" && waitSec ? (
                <Hourglass className="size-4 text-ai" aria-hidden />
              ) : state === "current" ? (
                <Loader2 className="size-4 animate-spin text-ai" aria-hidden />
              ) : (
                <Circle className="size-4 text-muted-foreground" aria-hidden />
              )}
              {state === "current" && waitSec ? (
                // A-11: countdown not announced (polling region is not live)
                <span className="tabular-nums">공급자 요청 한도로 잠시 기다리는 중 ({waitSec}초)</span>
              ) : (
                <span className={countInLabel ? "tabular-nums" : undefined}>
                  {rowLabel(jobType, stage, state, progress)}
                  {state === "current" && count ? ` (${count})` : ""}
                </span>
              )}
              <span className="sr-only">{state === "done" ? "완료" : state === "current" ? "진행 중" : "대기"}</span>
            </li>
          )
        })}
      </ol>
      {showLeaveNote ? (
        // [UI-가정] design-system 3.3: 문구 위치만 가정, 문구는 명세 토스트와 짝
        <p className="text-sm text-muted-foreground">화면을 나가도 계속 진행돼요. 끝나면 알려 드릴게요</p>
      ) : null}
    </section>
  )
}

/** One row's text: the current / last row follows the live progress (n/N, complete keeps it) */
function rowLabel(
  jobType: AiJobType,
  stage: AiProgressStage,
  state: "done" | "current" | "pending",
  progress: AiJobProgress | null,
): string {
  if (jobType === "interview_questions" && stage === "generate") {
    const live = progress && (progress.stage === "generate" || progress.stage === "complete") ? progress : null
    return aiStageLabel(jobType, live ?? { stage: "generate", done: state === "done" ? progress?.total : 0, total: progress?.total })
  }
  return aiStageLabel(jobType, { stage })
}

/** 축약형 (S-37 행, S-13 기능 진행 칸, S-36 "정리 중"). Pass `jobType` for v5.3 job-dependent copy */
export function AiProgressInline({
  progress,
  label,
  jobType,
  className,
}: {
  progress?: AiJobProgress | null
  /** override stage text (e.g. "정리 중") */
  label?: string
  /** job type → "채점 준비 중" / "질문 만드는 중 (n/N)" / complete keeps the previous copy */
  jobType?: AiJobType | null
  className?: string
}) {
  const count = jobType === "interview_questions" || progress?.stage === "complete" ? null : countText(progress)
  const waitSec = useRetryWait(progress)
  return (
    <span className={cn("inline-flex items-center gap-1.5 text-sm text-ai-subtle-foreground", className)} role="status">
      {waitSec ? (
        <Hourglass className="size-3.5 text-ai" aria-hidden />
      ) : (
        <Loader2 className="size-3.5 animate-spin text-ai" aria-hidden />
      )}
      {label ?? stageText(progress, jobType)}
      {count ? <span className="tabular-nums">{count}</span> : null}
      {waitSec ? <span className="tabular-nums" aria-hidden> · 대기 {waitSec}초</span> : null}
    </span>
  )
}
