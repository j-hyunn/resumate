"use client"

/**
 * S-22 면접 결과 (02 S-22 + C-17, 03 AI-06/AI-07, design-system 6 A4).
 * 머리 카드: C-17 세션 점수 + 고지 + unanswered_count + 다룬 보완 요건 + data_sufficiency 안내
 * → 종합 피드백(session_feedbacks.result) → 답변별 카드(질문 · 내 답변 · 참고 평가 기준 · 잘한 점 ·
 * 개선점 · 질문 의도 · 개선 답변 예시 + C-01). Evaluating → C-03 with finished cards first.
 * No scoring formula here (D-14 undecided): scores render only from the stored score_* slots.
 */
import * as React from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { ChevronDown, Info, Loader2, MessageCircleWarning, RotateCcw } from "lucide-react"
import { toast } from "sonner"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card } from "@/components/ui/card"
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible"
import { Separator } from "@/components/ui/separator"
import { Skeleton } from "@/components/ui/skeleton"
import { AiProgress, useAiJob } from "@/components/common/ai-progress"
import { EvidenceChips, EvidenceProvider } from "@/components/common/evidence"
import { PlaceholderText } from "@/components/common/placeholders"
import { AnswerScore, SessionScore } from "@/components/common/score-display"
import { AiRunButton } from "@/components/common/ai-run-button"
import { useAiConnection } from "@/components/common/ai-connection-context"
import { useAiConsentGate } from "@/components/common/consent-gate"
import { ProviderResultTag, providerRunLabel } from "@/components/common/provider-badge"
import { AI_ERROR_PRESERVED, AiErrorNotice, copyIconFor, formatKstTime, useNow } from "@/components/common/ai-error-notice"
import { isAiRejected, notifyAiRejected } from "@/components/common/ai-rejection"
import { usePreviewWriteGuard } from "@/components/common/preview-write-guard"
import { AiFailedInline } from "@/components/common/state-views"
import type { AiJobView } from "@/lib/data/ai-jobs"
import type { EvidenceView } from "@/lib/data/evidence"
import { clearsNewResultOnView, gradingInputCauseCopy, isInputCausedGrading } from "@/lib/data/interview-grading"
import type { InterviewSessionDetail } from "@/lib/data/interviews"
import type { AiConnection, AiErrorCode, AiJobProgress, CriterionGrade, CriterionKey, InterviewType } from "@/types/db"
import { formatDate, GRADE_LABELS, INTERVIEW_TYPE_LABELS, actionFailedMessage } from "@/lib/data/labels"
import { routes } from "@/lib/routes"
import { cn } from "@/lib/utils"
import { markInterviewResultViewedAction, regradeFailedAnswersAction } from "@/lib/data/actions"

/** 03 4.2 참고 평가 기준 항목 이름 */
const CRITERION_LABELS: Record<CriterionKey, string> = {
  specificity: "구체성",
  intent_fit: "질문 의도 부합",
  structure: "구조",
  job_relevance: "JD 연관성",
}
const CULTURE_FIT_RELEVANCE = "직무·조직 연결"

const GRADE_VARIANT: Record<CriterionGrade, "success" | "info" | "warning" | "destructive-subtle" | "muted"> = {
  excellent: "success",
  good: "info",
  fair: "warning",
  poor: "destructive-subtle",
  not_applicable: "muted",
}

export interface ResultPreview {
  /** ?state=ai-pending: evaluating view (no polling) */
  pending?: boolean
  /** ?state=ai-failed*: evaluation failed view */
  failed?: AiErrorCode | null
  /** any ?state= preview is active: no side effects on the real row (UQ-552 — no 새 결과 표식 clearing) */
  active?: boolean
}

type Evidence = Record<string, Record<string, EvidenceView[]>>

export function ResultView({
  applicationProjectId,
  applicationName,
  session,
  evidence,
  weakRequirements,
  job,
  methodChanged,
  preview = {},
  serverConnection,
}: {
  applicationProjectId: string
  applicationName: string
  session: InterviewSessionDetail
  /** answer_evaluation id → item_key → evidence */
  evidence: Evidence
  /** weak_requirement_ids → jd_requirements.content */
  weakRequirements: Array<{ id: string; content: string }>
  /** latest interview_evaluation job (evaluating / evaluation_failed) */
  job: AiJobView | null
  /** score_method_version differs from the previous scored session [가정] */
  methodChanged: boolean
  preview?: ResultPreview
  serverConnection?: AiConnection | null
}) {
  const router = useRouter()
  // UQ-40: the watched job is state, so "다시 채점" can start watching a job even when the page
  // loaded in evaluation_failed / completed (useAiJob only polls a non-null id).
  // `nonce` remounts the watcher after each re-run so polling restarts.
  const [watch, setWatch] = React.useState<{ id: string; nonce: number } | null>(() =>
    session.status === "evaluating" && !preview.pending && job ? { id: job.id, nonce: 0 } : null,
  )
  const [live, setLive] = React.useState<LiveJob | null>(null)
  // UQ-324: server-loaded ai_connection → 다시 채점 locked / badge right on the first render
  const connection = useAiConnection(serverConnection)
  const consent = useAiConsentGate(serverConnection)
  const previewWrite = usePreviewWriteGuard()
  /** 04 §2.7.1 판정표 (lib/data/interview-grading.ts): 버튼·안내는 이 값만 본다. Re-read after every job. */
  const grading = session.grading
  const locked = connection !== null && !connection.active_provider
  const keyInvalid = connection?.key_status === "invalid"
  /** C-20 key_invalid under the 다시 채점 row when an answer card's 다시 채점 is clicked with an invalid key */
  const [invalidTried, setInvalidTried] = React.useState(false)
  const [retrying, setRetrying] = React.useState(false)
  const [rerun, setRerun] = React.useState(false)
  const liveRunning = live ? live.status === "queued" || live.status === "running" : watch !== null
  const evaluatingNow =
    preview.pending || (watch !== null && liveRunning) || (!rerun && watch === null && session.status === "evaluating")
  const failed: AiErrorCode | null =
    (rerun ? null : preview.failed) ??
    (watch && live?.error ? live.error : null) ??
    (!rerun && session.status === "evaluation_failed" ? (job?.error_code ?? "provider_unavailable") : null)
  /** v5.3 A9: grading in progress (first grading or 다시 채점) → C-03, score skeleton, dimmed summary */
  const regrading = Boolean(evaluatingNow && !failed)

  // 새 결과 표식 해제 (A9 · Q53-10): completed, or a failed session with nothing left to do. Grading
  // screens and failures that can still be re-run keep it.
  const clearsMark = clearsNewResultOnView(session.status, grading)
  React.useEffect(() => {
    if (preview.active) return
    if (clearsMark && session.result_viewed_at === null && !regrading)
      // UQ-584: the L-01 badge drops right away instead of on the next poll
      void markInterviewResultViewedAction(session.id).then(() => window.dispatchEvent(new Event("resumate:ai-jobs-changed")))
  }, [session.id, clearsMark, session.result_viewed_at, regrading, preview.active])

  const failedJob = live?.job ?? job
  /** 04 §2.7.1 {n} = 다시 채점 대상 수 */
  const failedCount = grading.kind === "regrade" ? grading.count : 0
  // 02 S-22 판정표: 다시 채점 / 종합 평가 다시 정리만 버튼이 있다 (입력 원인·실패 없음은 없음)
  const canRegrade = Boolean(session.submitted_at) && !regrading && (grading.kind === "regrade" || grading.kind === "resummarize")
  // C-20 key_missing with no key: the notice itself offers "AI 연결하기" — no second C-18 lock below
  const showRegradeRow = canRegrade && !(locked && failed === "key_missing")
  /** S-22 "입력 원인 실패": 세션 전체가 채점 실패로 끝났고 다시 할 것이 없다 → 원인 + 새 면접 */
  const inputOnlyFailed = grading.kind === "input_only" && session.status === "evaluation_failed" && !regrading
  /** 다른 원인 답변이 섞인 세션도 작업 원인이 입력 원인일 수 있다: 원인만 (새 면접 버튼은 다시 할 것이 없을 때만) */
  const inputCausedJob = !inputOnlyFailed && isInputCausedGrading(failed)

  /**
   * 다시 채점 / 종합 평가 다시 정리 (02 S-22, 04 §2.7.1): a **new** evaluation job on the active
   * provider (regradeFailedAnswersAction, path ①) — never a same-row retryAiJob (UQ-413).
   * Returns the action result so AiRunButton handles a start refusal (C-18 / C-21 / key_invalid).
   */
  const runRegrade = async (): Promise<unknown> => {
    if (previewWrite.stop()) return null
    setRetrying(true)
    try {
      const next = await regradeFailedAnswersAction(session.id)
      if (isAiRejected(next)) return next
      if ("refused" in next) {
        // 낡은 버튼 (S-22 "버튼이 없을 때"): 세션을 다시 읽어 버튼을 치운다. input_only면 다시 읽은 화면이 원인을 보인다
        if (next.refused === "interview_evaluation_not_retryable") toast(REGRADE_NOT_NEEDED)
        router.refresh()
        return null
      }
      setRerun(true)
      setInvalidTried(false)
      setLive({ status: next.status, progress: next.progress, error: null, job: next })
      setWatch((w) => ({ id: next.id, nonce: (w?.nonce ?? 0) + 1 }))
      return next
    } catch {
      // [UI-가정] 재채점 요청 실패 문구
      toast.error(actionFailedMessage("다시 채점"))
      return null
    } finally {
      setRetrying(false)
    }
  }

  /** answer card "다시 채점" — same session-wide action (02 S-22 "답변 카드의 다시 채점도 같은 동작") */
  const regradeFromCard = () => {
    if (keyInvalid) {
      setInvalidTried(true)
      return
    }
    consent.guard(() => {
      void runRegrade().then((r) => {
        if (!isAiRejected(r)) return
        if ((r.refusal ?? r.rejected) === "ai_consent_required") consent.open(() => regradeFromCard())
        else notifyAiRejected(r)
      })
    })
  }

  const typeLabel = INTERVIEW_TYPE_LABELS[session.interview_type]
  // sessions carry no model_tier; the evaluation rows do (AiOutputMeta)
  const resultTier =
    (session.evaluation_provider ? session.evaluation_model_tier : session.question_model_tier) ??
    session.questions.find((q) => q.evaluation?.model_tier)?.evaluation?.model_tier ??
    null
  // v5.3 A9: the summary is always rebuilt on 다시 채점 — the previous one stays visible, dimmed
  const feedback =
    session.feedback?.result && (session.feedback.status === "succeeded" || (regrading && session.feedback.status === "pending"))
      ? session.feedback.result
      : null
  const feedbackStale = Boolean(feedback && regrading)
  const total = session.question_count
  const thin = session.data_sufficiency === "thin" || session.data_sufficiency === "none"
  const startNew = (
    <Button asChild variant="link" size="sm" className="h-auto px-0 max-md:min-h-11">
      <Link href={routes.interviewPrep(applicationProjectId, session.interview_type)}>새 면접 시작하기</Link>
    </Button>
  )

  return (
    <EvidenceProvider>
      <div className="mx-auto max-w-[42rem] space-y-8">
        <header className="space-y-1">
          <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-1">
            <h1 className="text-2xl leading-8 font-bold">면접 결과</h1>
            {/* C-19 결과 배지: 채점한 공급자·모델 (없으면 질문 공급자). 원래 모델 ID는 툴팁에만 */}
            <ProviderResultTag
              provider={session.evaluation_provider ?? session.question_provider}
              model_tier={resultTier}
              model={session.evaluation_model ?? session.question_model}
              className="mt-2"
            />
          </div>
          <p className="text-sm text-muted-foreground tabular-nums">
            {applicationName} · {typeLabel} · {formatDate(session.created_at)} · 질문 {total}개
          </p>
          {session.question_provider && session.evaluation_provider && session.question_provider !== session.evaluation_provider ? (
            // 02 C-19 "둘이 다르면 질문 Gemini · 채점 Claude처럼 둘 다"
            <p className="text-sm text-muted-foreground">실행 공급자: {providerRunLabel(session)}</p>
          ) : null}
        </header>

        {watch ? (
          <EvaluationWatcher
            key={`${watch.id}-${watch.nonce}`}
            jobId={watch.id}
            onChange={setLive}
            onDone={() => router.refresh()}
            // UQ-553: a failed 다시 채점 also re-reads the session (evaluation_failed, no score, new n)
            onFailed={() => router.refresh()}
          />
        ) : null}
        {inputOnlyFailed ? (
          <InputCausedGradingNotice
            cause={grading.kind === "input_only" ? grading.cause : null}
            newInterviewHref={routes.interviewPrep(applicationProjectId)}
          />
        ) : inputCausedJob ? (
          <InputCausedGradingNotice cause={failed} />
        ) : failed ? (
          // C-20 at the top of S-22 (cause only); graded answer cards below stay (보존).
          // v5.3: no same-row retry here — the only re-run is "실패한 답변 {n}개 다시 채점" in the head card.
          <AiErrorNotice
            code={failed}
            // UQ-325: previews without a job row use the active connection's provider
            provider={failedJob?.provider ?? connection?.active_provider}
            retryAfter={failedJob?.retry_after}
            quotaResetsAt={failedJob?.quota_resets_at}
            lockEntry="interview_submit"
          />
        ) : null}
        {regrading ? (
          <AiProgress
            jobType="interview_evaluation"
            progress={preview.pending ? { stage: "evaluate", done: 1, total: Math.max(1, session.answered_count) } : (live?.progress ?? job?.progress ?? null)}
            title="면접 채점"
            connectionTier={(live?.job ?? job)?.connection_tier ?? connection?.connection_tier}
          />
        ) : null}

        {/* 머리 카드 */}
        <Card className="gap-4 p-5">
          {regrading ? (
            // (v3) 채점 중: 세션 점수 자리는 Skeleton
            <Skeleton className="h-8 w-24" aria-hidden />
          ) : session.score_status ? (
            <ScoreBlock session={session} startNew={startNew} />
          ) : (
            // 제출 후 채점 전: 점수 자리 표시 안 함(C-17 null), 고지만 남김
            <p className="text-sm text-muted-foreground">채점이 끝나면 점수 자리가 표시돼요</p>
          )}
          {methodChanged ? (
            <p className="flex items-center gap-1.5 text-sm text-muted-foreground">
              <Info className="size-4 shrink-0" aria-hidden />
              다른 산정 방식으로 계산된 점수예요
            </p>
          ) : null}
          <dl className="grid gap-3 text-base sm:grid-cols-2">
            <div className="space-y-1">
              <dt className="text-sm font-medium text-muted-foreground">미응답</dt>
              <dd className="tabular-nums">{session.unanswered_count}문항</dd>
            </div>
            <div className="space-y-1">
              <dt className="text-sm font-medium text-muted-foreground">다룬 보완 요건</dt>
              <dd className="flex flex-wrap gap-1">
                {weakRequirements.length > 0 ? (
                  weakRequirements.map((r) => (
                    <Badge key={r.id} variant="secondary" className="h-auto max-w-full whitespace-normal text-left">
                      {r.content}
                    </Badge>
                  ))
                ) : (
                  <span className="text-muted-foreground">없음</span>
                )}
              </dd>
            </div>
          </dl>
          {thin ? (
            <Alert variant="info">
              <Info aria-hidden />
              {/* 03 4.1 F-P3-13: 결과 화면 안내 */}
              <AlertTitle className="font-normal">커리어 정리를 하면 내 경험을 짚는 질문이 늘어나요</AlertTitle>
            </Alert>
          ) : null}
          {showRegradeRow ? (
            <>
              <Separator />
              <RegradeRow
                summaryOnly={grading.kind === "resummarize"}
                count={failedCount}
                code={failed}
                retryAfter={failedJob?.retry_after ?? null}
                connection={connection}
                pending={retrying}
                onRun={runRegrade}
              />
              {invalidTried && keyInvalid ? <AiErrorNotice code="key_invalid" size="inline" /> : null}
            </>
          ) : null}
        </Card>

        {/* 종합 피드백 (AI-07) — v5.3 A9: dimmed while it is being rebuilt */}
        {feedback ? (
          <section className="space-y-4" aria-labelledby="feedback-title" aria-busy={feedbackStale || undefined}>
            <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1">
              <h2 id="feedback-title" className="text-lg leading-7 font-semibold">
                종합 피드백
              </h2>
              {feedbackStale ? (
                <span className="inline-flex items-center gap-1.5 text-sm text-ai-subtle-foreground" role="status">
                  <Loader2 className="size-3.5 animate-spin text-ai" aria-hidden />
                  종합 평가를 다시 정리하는 중
                </span>
              ) : null}
            </div>
            <div className={cn("space-y-4", feedbackStale && "text-muted-foreground")}>
              <p className="text-base leading-[1.75]">{feedback.headline}</p>
              <div className="grid gap-4 sm:grid-cols-2">
                <TextList title="강점" items={feedback.overall_strengths.map((s) => s.text)} />
                <TextList title="보완할 점" items={feedback.overall_weaknesses.map((s) => s.text)} />
              </div>
              {feedback.unanswered_note ? <p className="text-sm text-muted-foreground">{feedback.unanswered_note}</p> : null}
              {feedback.next_practice.length > 0 ? (
                <div className="space-y-2">
                  <h3 className="text-base leading-6 font-semibold">다음 연습</h3>
                  <ul className="space-y-2">
                    {feedback.next_practice.map((p, i) => (
                      <li key={i} className="flex flex-col gap-1 rounded-md border p-3 sm:flex-row sm:items-center sm:justify-between">
                        <span className="text-base">{p.text}</span>
                        {feedbackStale ? null : p.type === "focus_session" ? (
                          <NextLink href={routes.interviewPrep(applicationProjectId, p.interview_type ?? session.interview_type)} label="면접 준비로" />
                        ) : p.type === "add_data" ? (
                          // [UI-가정] add_data 이동 대상: 커리어(S-08)
                          <NextLink href={routes.career()} label="커리어에 기록하기" />
                        ) : null}
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null}
            </div>
          </section>
        ) : null}

        {/* 답변별 카드 */}
        <section className="space-y-4" aria-labelledby="answers-title">
          <h2 id="answers-title" className="text-lg leading-7 font-semibold">
            답변별 평가
          </h2>
          <ol className="space-y-6">
            {session.questions.map((q) => (
              <li key={q.id}>
                <AnswerCard
                  q={q}
                  total={total}
                  interviewType={session.interview_type}
                  evidence={q.evaluation ? (evidence[q.evaluation.id] ?? {}) : {}}
                  evaluating={regrading}
                  // [UI-가정] no key → the card link is hidden; the head row shows C-18 inline
                  // 입력 원인 답변 카드에는 다시 채점 없음 (Q53-3), 종합만 다시 정리하는 세션도 카드 버튼 없음
                  onRescore={grading.kind === "regrade" && canRegrade && !locked && q.answer && !isInputCausedGrading(q.evaluation?.error_code) ? regradeFromCard : undefined}
                  rescoring={retrying}
                />
              </li>
            ))}
          </ol>
        </section>
        {consent.dialog}
      </div>
    </EvidenceProvider>
  )
}

/**
 * Session-level "실패한 답변 {n}개 다시 채점" / "종합 평가 다시 정리" (02 S-22 / design-system 6 A4 (v3)):
 * AiRunButton (default, RotateCcw) + C-19 badge (active provider) + 토큰 안내; key-less → C-18 inline.
 * Disabled with a countdown until retry_after for rate_limited / provider_unavailable.
 */
function RegradeRow({
  summaryOnly,
  count,
  code,
  retryAfter,
  connection,
  pending,
  onRun,
}: {
  /** Q53-5: 다시 채점 대상 없음 + 종합만 실패 — 답변 평가는 다시 부르지 않는다 */
  summaryOnly: boolean
  count: number
  code: AiErrorCode | null
  retryAfter: string | null
  connection?: AiConnection | null
  pending: boolean
  onRun: () => unknown
}) {
  const now = useNow()
  const waitMs =
    (code === "rate_limited" || code === "provider_unavailable") && retryAfter && now
      ? new Date(retryAfter).getTime() - now
      : 0
  const sec = Math.ceil(waitMs / 1000)
  const base = summaryOnly ? "종합 평가 다시 정리" : `실패한 답변 ${count}개 다시 채점`
  const label = sec > 0 ? `${base} (${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, "0")})` : base
  const waitId = React.useId()
  // UQ-353 / A-11: the accessible name stays fixed; the time is given once via aria-describedby
  return (
    <>
      {sec > 0 && retryAfter ? (
        <span id={waitId} className="sr-only">
          {formatKstTime(retryAfter, now)}부터 {summaryOnly ? "다시 정리할" : "다시 채점할"} 수 있어요
        </span>
      ) : null}
      <AiRunButton
        connection={connection}
        aria-label={base}
        aria-describedby={sec > 0 ? waitId : undefined}
        lock={{ entry: "interview_submit", actionName: summaryOnly ? "종합 평가 다시 정리" : "다시 채점", description: summaryOnly ? RESUMMARIZE_LOCK_DESCRIPTION : RESCORE_LOCK_DESCRIPTION }}
        onRun={onRun}
        pending={pending}
        disabled={sec > 0}
        buttonClassName="max-md:h-11 tabular-nums"
        rerun
        rerunNote={summaryOnly ? RESUMMARIZE_TOKEN_NOTE : REGRADE_TOKEN_NOTE}
      >
        {pending ? null : <RotateCcw aria-hidden />}
        {label}
      </AiRunButton>
    </>
  )
}

interface LiveJob {
  status: string
  progress: AiJobProgress | null
  error: AiErrorCode | null
  job: AiJobView | null
}

// [UI-가정] 다시 채점 잠금 설명 (C-18 표에 다시 채점 행이 없어 면접 제출 문구를 바꿔 씀)
const RESCORE_LOCK_DESCRIPTION = "다시 채점하면 연결한 AI로 채점해요. 작성한 답변은 저장돼 있어요"
/** 02 S-22 v5.3 버튼 행 주석 */
const REGRADE_TOKEN_NOTE = "다시 채점하면 공급자 토큰을 다시 써요"
/** 02 S-22 "종합만 실패" */
const RESUMMARIZE_TOKEN_NOTE = "다시 정리하면 공급자 토큰을 다시 써요"
// [UI-가정] 종합 평가 다시 정리 잠금 설명
const RESUMMARIZE_LOCK_DESCRIPTION = "다시 정리하면 연결한 AI로 종합 평가를 만들어요. 채점된 답변은 그대로 있어요"
// [UI-가정] interview_evaluation_not_retryable 안내
const REGRADE_NOT_NEEDED = "다시 채점할 답변이 없어요"

/** Polls one evaluation job (C-03) and reports its state upward; remount to restart polling. */
function EvaluationWatcher({
  jobId,
  onChange,
  onDone,
  onFailed,
}: {
  jobId: string
  onChange: (v: LiveJob) => void
  onDone: () => void
  onFailed: () => void
}) {
  const { job, status, progress, error } = useAiJob(jobId, { onDone })
  React.useEffect(() => {
    onChange({ status, progress, error, job })
  }, [status, progress, error, job, onChange])
  const failedRef = React.useRef(onFailed)
  React.useEffect(() => {
    failedRef.current = onFailed
  })
  React.useEffect(() => {
    if (status === "failed") failedRef.current()
  }, [status])
  return null
}

/**
 * S-22 "입력 원인 실패" (Q53-3): C-20 look (tone, icon, 보존 줄), S-22 copy, no 다시 채점 — the same answer
 * fails the same way and submitted answers are read-only. `newInterviewHref` only when nothing else is left.
 */
function InputCausedGradingNotice({ cause, newInterviewHref }: { cause: AiErrorCode | null; newInterviewHref?: string }) {
  const { icon: Icon, tone } = copyIconFor(cause ?? "input_too_long")
  const { title, body } = gradingInputCauseCopy(cause)
  return (
    <Alert variant={tone} className="gap-x-3 p-4">
      <Icon className="size-5" aria-hidden />
      <AlertTitle className="text-base leading-6 font-semibold">{title}</AlertTitle>
      <AlertDescription className="space-y-2 text-sm">
        <p className="sr-only" role="status">
          {title}
        </p>
        <p>{body}</p>
        <p>{AI_ERROR_PRESERVED}</p>
        {newInterviewHref ? (
          <div className="pt-1">
            <Button asChild variant="outline" size="sm" className="max-md:h-11">
              <Link href={newInterviewHref}>이 기업 JD로 새 면접 시작</Link>
            </Button>
          </div>
        ) : null}
      </AlertDescription>
    </Alert>
  )
}

function ScoreBlock({ session, startNew }: { session: InterviewSessionDetail; startNew: React.ReactNode }) {
  return (
    <div className="space-y-2">
      <SessionScore session={session} startNewAction={startNew} />
      {session.score_status === "scored" && session.score_rationale ? (
        <Collapsible>
          <CollapsibleTrigger asChild>
            <Button variant="ghost" size="sm" className="group px-0 max-md:h-11">
              산정 근거 보기
              <ChevronDown className="transition-transform group-data-[state=open]:rotate-180" aria-hidden />
            </Button>
          </CollapsibleTrigger>
          <CollapsibleContent className="pt-1 text-base leading-[1.75] text-muted-foreground">{session.score_rationale}</CollapsibleContent>
        </Collapsible>
      ) : null}
    </div>
  )
}

function NextLink({ href, label }: { href: string; label: string }) {
  return (
    <Button asChild variant="outline" size="sm" className="shrink-0 max-md:h-11">
      <Link href={href}>{label}</Link>
    </Button>
  )
}

function TextList({ title, items }: { title: string; items: string[] }) {
  if (items.length === 0) return null
  return (
    <div className="space-y-1.5">
      <h3 className="text-base leading-6 font-semibold">{title}</h3>
      <ul className="list-disc space-y-1 pl-5 text-base leading-[1.75]">
        {items.map((t, i) => (
          <li key={i}>{t}</li>
        ))}
      </ul>
    </div>
  )
}

function AnswerCard({
  q,
  total,
  interviewType,
  evidence,
  evaluating,
  onRescore,
  rescoring,
}: {
  q: InterviewSessionDetail["questions"][number]
  total: number
  interviewType: InterviewType
  evidence: Record<string, EvidenceView[]>
  evaluating: boolean
  /** session-wide "실패한 답변 다시 채점" (same action as the head row, v5.3 A9) */
  onRescore?: () => void
  rescoring?: boolean
}) {
  const answer = q.answer
  const unanswered = answer?.status === "unanswered" || answer?.score_status === "unanswered"
  const result = q.evaluation?.status === "succeeded" ? q.evaluation.result : null
  const [open, setOpen] = React.useState(true)
  /** A9 "실패한 답변": submitted without a successful evaluation */
  const answerFailed = answer?.status === "submitted" && !result && !evaluating

  return (
    <Card className="gap-4 p-5">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-xs font-medium text-muted-foreground tabular-nums">
          질문 {q.sequence}/{total}
        </span>
        <Badge variant="outline">{INTERVIEW_TYPE_LABELS[interviewType]}</Badge>
        <span className="ml-auto inline-flex flex-wrap items-center gap-2">
          <AnswerScore status={answer?.score_status ?? null} value={answer?.score_value ?? null} max={answer?.score_max ?? null} />
          {answerFailed && onRescore ? (
            // (v3) C-17 "채점 실패" 옆 link — 세션 단위 다시 채점, 배지는 머리 버튼 줄에만
            // UQ-555: the accessible name names the card and that it re-grades every failed answer
            <Button
              variant="link"
              size="sm"
              className="h-auto px-0 max-md:min-h-11"
              onClick={onRescore}
              disabled={rescoring}
              aria-label={`질문 ${q.sequence} 다시 채점 (실패한 답변 모두)`}
            >
              다시 채점
            </Button>
          ) : null}
        </span>
      </div>
      <p className="text-base leading-[1.75] font-medium">{q.question_text}</p>

      {unanswered ? (
        // [UI-가정] 미응답 카드 문구
        <p className="rounded-md bg-muted p-3 text-sm text-muted-foreground">답변하지 않은 질문이에요. 평가하지 않았어요</p>
      ) : (
        <Collapsible open={open} onOpenChange={setOpen}>
          <CollapsibleTrigger asChild>
            <Button variant="ghost" size="sm" className="group px-0 max-md:h-11">
              내 답변
              <ChevronDown className="transition-transform group-data-[state=open]:rotate-180" aria-hidden />
            </Button>
          </CollapsibleTrigger>
          <CollapsibleContent className="pt-1 text-base leading-[1.75] whitespace-pre-wrap text-muted-foreground">
            {answer?.answer_text}
          </CollapsibleContent>
        </Collapsible>
      )}

      {!unanswered && !result ? (
        evaluating ? (
          <div className="space-y-2" aria-hidden>
            <Skeleton className="h-4 w-full" />
            <Skeleton className="h-4 w-2/3" />
          </div>
        ) : isInputCausedGrading(q.evaluation?.error_code) ? (
          // Q53-3: 답변 카드는 원인만 (다시 채점 없음)
          <AiFailedInline message={`${gradingInputCauseCopy(q.evaluation?.error_code ?? null).title} ${gradingInputCauseCopy(q.evaluation?.error_code ?? null).body}`} />
        ) : q.evaluation_error ? (
          // C-20 inline (실패한 답변 카드) with the cause; 다시 채점 is the session-wide action
          <AiErrorNotice
            size="inline"
            lockEntry="interview_submit"
            code={q.evaluation_error.error_code ?? "provider_unavailable"}
            provider={q.evaluation_error.provider}
            retryAfter={q.evaluation_error.retry_after}
            quotaResetsAt={q.evaluation_error.quota_resets_at}
          />
        ) : q.evaluation?.status === "failed" ? (
          // [UI-가정] cause unknown (no failed job row): one line; 다시 채점 in the card head
          <AiFailedInline message="이 답변은 채점하지 못했어요" />
        ) : (
          // [UI-가정] 평가 행이 없는 완료 세션(모의 데이터 공백 등)
          <p className="text-sm text-muted-foreground">평가 내용이 아직 없어요</p>
        )
      ) : null}

      {result ? (
        <div className="space-y-5">
          {result.intent_reveal || q.intent ? (
            <Block title="질문 의도">
              <p>{result.intent_reveal || q.intent}</p>
            </Block>
          ) : null}

          {/* 참고 평가 기준 (03 4.2). 표시 여부는 D-14 결과에 따름 — 기획 확인 필요 */}
          <Block title="참고 평가 기준">
            <ul className="space-y-3">
              {result.criteria.map((c) => (
                <li key={c.key} className="space-y-1">
                  <p className="flex flex-wrap items-center gap-2">
                    <span className="text-sm font-medium">
                      {c.key === "job_relevance" && interviewType === "culture_fit" ? CULTURE_FIT_RELEVANCE : CRITERION_LABELS[c.key]}
                    </span>
                    <Badge variant={GRADE_VARIANT[c.grade]}>
                      {GRADE_LABELS[c.grade]}
                    </Badge>
                  </p>
                  <p className="text-sm leading-6 text-muted-foreground">
                    {c.reason}
                    {c.missing ? ` · 빠진 점: ${c.missing}` : ""}
                  </p>
                  <EvidenceChips items={evidence[`criteria.${c.key}`]} className="mt-1" />
                </li>
              ))}
            </ul>
          </Block>

          {result.strengths.length > 0 ? (
            <Block title="잘한 점">
              <ul className="list-disc space-y-1 pl-5">
                {result.strengths.map((s, i) => (
                  <li key={i}>{s.text}</li>
                ))}
              </ul>
            </Block>
          ) : null}

          {result.improvements.length > 0 ? (
            <Block title="개선할 점">
              <ul className="space-y-3">
                {result.improvements.map((imp, i) => (
                  <li key={i} className="space-y-1">
                    <p className="font-medium">{imp.text}</p>
                    <p className="text-muted-foreground">{imp.how}</p>
                    <EvidenceChips items={evidence[imp.item_key ?? `improvements.${i}`]} className="mt-1" />
                  </li>
                ))}
              </ul>
            </Block>
          ) : null}

          <Block title="개선 답변 예시">
            <p className="rounded-md bg-muted/60 p-3">
              <PlaceholderText text={result.model_answer.text} placeholders={result.model_answer.placeholders} />
            </p>
            {result.model_answer.suggestions_if_true.length > 0 ? (
              <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-muted-foreground">
                {result.model_answer.suggestions_if_true.map((s, i) => (
                  <li key={i}>{s}</li>
                ))}
              </ul>
            ) : null}
            <EvidenceChips items={evidence["model_answer"]} />
          </Block>

          {result.consistency_notes.length > 0 ? (
            <Alert variant="info">
              <MessageCircleWarning aria-hidden />
              {/* [UI-가정] 일관성 메모 제목 */}
              <AlertTitle>등록한 커리어와 다른 점</AlertTitle>
              <ul className="col-start-2 list-disc space-y-2 pl-5 text-sm">
                {result.consistency_notes.map((n, i) => (
                  <li key={i} className="space-y-1">
                    <p>{n.text}</p>
                    {n.answer_quotes.map((q, j) => (
                      <blockquote key={j} className="border-l-2 pl-2 text-muted-foreground">
                        {q}
                      </blockquote>
                    ))}
                    {/* ㉘ */}
                    <EvidenceChips items={evidence[`consistency_notes.${i}`]} />
                  </li>
                ))}
              </ul>
            </Alert>
          ) : null}
        </div>
      ) : null}
    </Card>
  )
}

function Block({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1.5">
      <h3 className="text-base leading-6 font-semibold">{title}</h3>
      <div className="text-base leading-[1.75]">{children}</div>
    </div>
  )
}
