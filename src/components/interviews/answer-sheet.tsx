"use client"

/**
 * S-33 면접 답변지 (02 S-33, FL-12, FL-04, design-system 6 A4).
 * - questions fill in one by one while AI-05 runs (C-04 차례로 채움); answers stay read-only
 *   until generation_status = 'ready' (D-UX-07 (a), T-9) — "질문을 준비하고 있어요"
 * - editable only when answer.status = 'draft' AND session.submitted_at is null AND
 *   generation_status = 'ready' (data-model RLS)
 * - autosave with one C-06 status for the whole sheet; submit once (RPC submit_interview_session)
 *   after the unanswered / short-answer warning
 * - v5.3: whole generation failure → "다시 시도" = same-row retry on the active provider (path ②,
 *   "처음부터 다시" when the job ran elsewhere); partial failure → "남은 질문 다시 만들기" = new job
 *   (path ①). Input-caused failures: no retry, go to S-20 "시작하기" (R-69 / R-76)
 * - v5.3 A8: abandoned session = read-only (text boxes, no C-06 / submit) + "이 자기소개서로 새 면접 시작"
 * - v5.3: question evidence chips (C-01, owner interview_question) before submit
 * - BYOK: writing / autosave work without a key; 제출 = AiRunButton(interview_submit) → C-18 inline
 *   when no key, C-20 key_invalid when the key is invalid (D-36)
 */
import * as React from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { CirclePause, DatabaseZap, Info, Loader2 } from "lucide-react"
import { toast } from "sonner"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card } from "@/components/ui/card"
import { Textarea } from "@/components/ui/textarea"
import { PageHeader } from "@/components/common/basics"
import { CharCount, InputGuide } from "@/components/common/input-guide"
import { SaveStatus, useAutosave } from "@/components/common/save-status"
import { AiErrorNotice, aiErrorFromJob } from "@/components/common/ai-error-notice"
import { EvidenceChips, EvidenceProvider } from "@/components/common/evidence"
import { retryAiJobAction, startRemainingQuestionsAction } from "@/lib/data/actions"
import { usePreviewWriteGuard } from "@/components/common/preview-write-guard"
import { isInputCausedFailure } from "@/lib/data/ai-errors"
import { isInputCausedJdFailure } from "@/lib/data/jd-raw-text"
import type { AiRejected } from "@/lib/data/ai-errors"
import type { EvidenceView } from "@/lib/data/evidence"
import { isAiRejected, notifyAiRejected } from "@/components/common/ai-rejection"
import { AiLock } from "@/components/common/ai-lock"
import { AiProgress } from "@/components/common/ai-progress"
import { useAiConnection } from "@/components/common/ai-connection-context"
import { AiRunButton } from "@/components/common/ai-run-button"
import { PendingBlock } from "@/components/common/streaming"
import type { AiJobView } from "@/lib/data/ai-jobs"
import type { InterviewSessionDetail } from "@/lib/data/interviews"
import type { AiConnection, AiErrorCode, AiProviderName, AiRetryRefusalCode } from "@/types/db"
import { INTERVIEW_TYPE_LABELS, actionFailedMessage } from "@/lib/data/labels"
import { routes } from "@/lib/routes"
import { cn } from "@/lib/utils"
import {
  getAnswerSheetStateAction,
  saveInterviewAnswerAction,
  submitInterviewSessionAction,
} from "./actions"

const POLL_MS = 2_000
/** 03 4.2: 짧은 답변(50자 미만)도 평가하지만 대부분 낮게 평가된다 → 제출 전 경고 */
const SHORT_ANSWER_CHARS = 50
/** 04 A.13 interview_answers.answer_text (≤ 5,000자) — UQ-41 */
const ANSWER_MAX_CHARS = 5_000

type Answers = Record<string, string>

function answersOf(session: InterviewSessionDetail): Answers {
  const out: Answers = {}
  for (const q of session.questions) if (q.answer) out[q.answer.id] = q.answer.answer_text
  return out
}

export interface AnswerSheetPreview {
  /** ?state=ai-pending: show the generating view with half of the questions, no polling */
  generating?: boolean
  /** ?state=ai-failed*: show the generation failure */
  failed?: AiErrorCode | null
  /** ?state=save-failed */
  saveFail?: boolean
  /** ?state=retry-refused-* / retry-connection-changed / retry-not-retryable (path ② action row) */
  refusal?: AiRetryRefusalCode | null
  /** ?state=retry-other-provider: the failed job ran on another provider / tier → "처음부터 다시" */
  otherProvider?: boolean
  /** ?state=ai-waiting: generating, waiting on the provider rate limit (C-03 대기 줄) */
  waiting?: boolean
  /** ?state=raw-edited-stale / raw-edited-no-job (S-15 "이전 실패 안내") */
  stale?: "edited" | "no_job" | null
  /** ?state=generation-canceled (㉚) */
  canceled?: boolean
}

/**
 * S-33 ← S-15 (Q53-2 · 9): what the input-caused failure's button does, and whether the failure is about
 * the 공고 원문 as it was before an edit (then it isn't shown, 04 §2.6.1 지난 실패 표시).
 */
export interface AnswerSheetJd {
  has_requirements: boolean
  raw_text_edited_at: string | null
}

type QuestionEvidence = Record<string, Record<string, EvidenceView[]>>

/** start refusals (path ①) shown through the C-20 action row like retry refusals (G-34) */
function asRetryRefusal(r: AiRejected): AiRetryRefusalCode {
  const code = r.refusal ?? r.rejected
  if (code === "ai_consent_required" || code === "key_invalid" || code === "ai_connection_changed" || code === "ai_job_not_retryable")
    return code
  return "key_missing"
}

/** `?state=retry-other-provider`: a provider other than the active one */
function otherProviderThan(active: AiProviderName | null | undefined): AiProviderName {
  return active === "openai" ? "gemini" : "openai"
}

export function AnswerSheet({
  applicationProjectId,
  applicationName,
  initialSession,
  initialJob,
  initialEvidence = {},
  preview = {},
  serverConnection,
  jd,
}: {
  applicationProjectId: string
  applicationName: string
  jd: AnswerSheetJd
  initialSession: InterviewSessionDetail
  /** latest AI-05 job for this session (null for fixtures without one) */
  initialJob: AiJobView | null
  /** question id → item_key → evidence (owner interview_question) */
  initialEvidence?: QuestionEvidence
  preview?: AnswerSheetPreview
  serverConnection?: AiConnection | null
}) {
  const router = useRouter()
  // UQ-324: server-loaded ai_connection → 제출 is locked on the first render (before the client
  // context loads); ?state= overrides still apply through useAiConnection
  const connection = useAiConnection(serverConnection)
  const locked = connection !== null && !connection.active_provider
  const previewWrite = usePreviewWriteGuard()
  const [previewWaitUntil] = React.useState(() => new Date(Date.now() + 12_000).toISOString())
  const [session, setSession] = React.useState(initialSession)
  const [job, setJob] = React.useState(initialJob)
  const [evidence, setEvidence] = React.useState<QuestionEvidence>(initialEvidence)
  /** C-20 action-row swap after a refused retry / 남은 질문 다시 만들기 */
  const [refusal, setRefusal] = React.useState<AiRetryRefusalCode | null>(preview.refusal ?? null)
  const [answers, setAnswers] = React.useState<Answers>(() => answersOf(initialSession))
  const [retrying, setRetrying] = React.useState(false)
  const [confirmOpen, setConfirmOpen] = React.useState(false)
  const [submitting, setSubmitting] = React.useState(false)
  const [submitRejected, setSubmitRejected] = React.useState<AiErrorCode | null>(null)
  const [announcement, setAnnouncement] = React.useState("")
  /** after "다시 시도" the ?state=ai-failed preview override no longer applies */
  const [previewRetried, setPreviewRetried] = React.useState(false)
  const saved = React.useRef<Answers>(answersOf(initialSession))
  const lastSaveFailed = React.useRef(false)

  const abandoned = session.status === "abandoned"
  const jobRunning = job?.status === "queued" || job?.status === "running"
  // ㉚: the user stopped the generation. Not a provider failure, and its row can't be retried: a new job picks up (path ①)
  const canceledJob = job?.status === "canceled" || (Boolean(preview.canceled) && !previewRetried)
  const canceledGeneration = !abandoned && canceledJob && !jobRunning && !preview.generating && !preview.failed && session.generation_status !== "ready"
  // v5.3: a new 남은 질문 job runs while the row may still say generation_status = 'failed'
  const generatingNow =
    !abandoned && (preview.generating || jobRunning || (session.generation_status === "generating" && job?.status !== "failed" && !canceledJob))
  const failedCategory: AiErrorCode | null = abandoned
    ? null
    : ((previewRetried ? null : preview.failed) ??
      (job?.status === "failed"
        ? (job.error_code ?? "provider_unavailable")
        : session.generation_status === "failed" && !jobRunning && !canceledJob
          ? "provider_unavailable"
          : null))
  const sheetOpen =
    !preview.generating && !failedCategory && !canceledGeneration && session.generation_status === "ready" && session.submitted_at === null && !abandoned

  // --- polling while AI-05 generates questions ------------------------------------
  // UQ-42: poll only while generation is actually running — a running job, or a generating
  // session without a job row. A failed session with no running job shows ST-AI-FAILED only.
  const polling =
    !preview.generating &&
    (!preview.failed || previewRetried) &&
    session.generation_status !== "ready" &&
    (job ? jobRunning : session.generation_status === "generating")
  React.useEffect(() => {
    if (!polling) return
    let alive = true
    let timer: ReturnType<typeof setTimeout> | undefined
    const tick = async () => {
      const next = await getAnswerSheetStateAction(applicationProjectId, session.id)
      if (!alive) return
      if (next.job) setJob(next.job)
      setEvidence(next.evidence)
      if (next.session) {
        // retryAiJob now resets generation_status to 'generating' on the row (UQ-49)
        const fresh = next.session
        setSession(fresh)
        // add answer rows created with new questions; never overwrite local edits
        setAnswers((prev) => ({ ...answersOf(fresh), ...prev }))
        for (const [id, text] of Object.entries(answersOf(fresh))) if (!(id in saved.current)) saved.current[id] = text
        if (fresh.generation_status === "ready") {
          // [UI-가정] 생성 완료 안내 문구
          setAnnouncement("질문이 모두 준비됐어요. 답변을 쓸 수 있어요")
          return
        }
      }
      timer = setTimeout(tick, POLL_MS)
    }
    timer = setTimeout(tick, POLL_MS)
    return () => {
      alive = false
      if (timer) clearTimeout(timer)
    }
  }, [polling, applicationProjectId, session.id])

  /**
   * Whole failure "다시 시도": the same AI-05 job row on the active provider (04 §2.9.1 (1), path ②).
   * Partial failure "남은 질문 다시 만들기": a new interview_questions job (04 §2.9.1 (2), path ①).
   * Refusals swap only the C-20 action row (G-34). Without a job row (fixtures) a new job starts.
   */
  const rerun = async (mode: "same_row" | "remaining") => {
    if (previewWrite.stop()) return
    setRetrying(true)
    setRefusal(null)
    try {
      const next =
        mode === "same_row" && job
          ? await retryAiJobAction(job.id)
          : await startRemainingQuestionsAction(session.id)
      if (isAiRejected(next)) {
        setRefusal(asRetryRefusal(next))
        return
      }
      if (next) setJob(next)
      setPreviewRetried(true)
      setSession((s) => ({ ...s, generation_status: "generating" }))
    } catch {
      // [UI-가정] 재시도 요청 실패 문구
      toast.error(actionFailedMessage(mode === "same_row" ? "다시 시도" : "남은 질문 다시 만들기"))
    } finally {
      setRetrying(false)
    }
  }

  /** ㉚ `startRemainingQuestionsAction`. Its result goes to AiRunButton, which handles a refusal (C-18 / C-21 / C-20). */
  const restartCanceled = async () => {
    if (previewWrite.stop()) return
    setRetrying(true)
    try {
      const next = await startRemainingQuestionsAction(session.id)
      if (isAiRejected(next)) return next
      if (next) {
        setJob(next)
        setPreviewRetried(true)
        setSession((s) => ({ ...s, generation_status: "generating" }))
        return
      }
      // no new job: the row moved on elsewhere (another tab restarted it, or generation finished)
      const fresh = await getAnswerSheetStateAction(applicationProjectId, session.id)
      if (fresh.job) setJob(fresh.job)
      if (fresh.session) setSession(fresh.session)
    } catch {
      toast.error(actionFailedMessage(questions.length ? "남은 질문 다시 만들기" : "질문 다시 만들기"))
    } finally {
      setRetrying(false)
    }
  }

  // --- autosave -----------------------------------------------------------------------
  const autosave = useAutosave<Answers>({
    save: async (values) => {
      try {
        for (const [id, text] of Object.entries(values)) {
          if (saved.current[id] === text) continue
          await saveInterviewAnswerAction(id, text, { fail: preview.saveFail })
          saved.current[id] = text
        }
        lastSaveFailed.current = false
      } catch (e) {
        lastSaveFailed.current = true
        throw e
      }
    },
  })

  const change = (answerId: string, text: string) => {
    setAnswers((prev) => {
      const next = { ...prev, [answerId]: text }
      autosave.schedule(next)
      return next
    })
  }

  // --- submit ------------------------------------------------------------------------
  const questions = session.questions
  const total = session.question_count
  const answeredCount = questions.filter((q) => q.answer && (answers[q.answer.id] ?? "").trim() !== "").length
  const unansweredCount = questions.length - answeredCount
  const shortCount = questions.filter((q) => {
    const t = q.answer ? (answers[q.answer.id] ?? "").trim() : ""
    return t !== "" && t.length < SHORT_ANSWER_CHARS
  }).length

  const askSubmit = async () => {
    await autosave.flush()
    if (lastSaveFailed.current) {
      // [UI-가정] 저장 실패 상태에서 제출을 막는 안내 문구
      toast.error("저장하지 못한 답변이 있어요. 다시 시도한 뒤 제출해 주세요")
      return
    }
    setConfirmOpen(true)
  }

  const submit = async () => {
    if (previewWrite.stop()) {
      setConfirmOpen(false)
      return
    }
    setSubmitting(true)
    try {
      const res = await submitInterviewSessionAction(session.id)
      // UQ-320: refused before any change (key missing / invalid) → stay on the sheet
      if (isAiRejected(res)) {
        setSubmitting(false)
        setConfirmOpen(false)
        // ST-AI-KEY-MISSING / key_invalid: C-20 inline in the submit bar (answers kept) + re-read
        // the connection so the button becomes C-18 / the warning badge
        setSubmitRejected(res.rejected)
        return notifyAiRejected(res)
      }
      setSubmitRejected(null)
      router.push(routes.interviewResult(applicationProjectId, session.id))
    } catch {
      setSubmitting(false)
      // [UI-가정] 제출 실패 문구
      toast.error(actionFailedMessage("제출"))
    }
  }

  const doneCount = preview.generating ? Math.ceil(total / 2) : questions.length
  const visibleQuestions = preview.generating ? questions.slice(0, doneCount) : questions
  const pendingCount = generatingNow ? Math.max(0, total - visibleQuestions.length) : 0
  const typeLabel = INTERVIEW_TYPE_LABELS[session.interview_type]
  /** some questions were saved before the failure → "남은 질문 다시 만들기" (new job) */
  const partialFailure = Boolean(failedCategory) && questions.length > 0 && questions.length < total
  const failedInfo = aiErrorFromJob(job)
  /**
   * S-15 "이전 실패 안내": 저장 시점부터 그 전에 끝난 실패는 안내하지 않는다. A job row settles it by
   * finished_at; without one there is nothing to compare ("질문을 만들지 못했어요").
   */
  const editedAt = jd.raw_text_edited_at
  const staleFailure: "edited" | "no_job" | null =
    preview.stale ??
    (!failedCategory || !editedAt || preview.failed
      ? null
      : !job
        ? "no_job"
        : job.finished_at && job.finished_at < editedAt
          ? "edited"
          : null)
  const inputCausedJd = isInputCausedJdFailure(failedCategory)

  return (
    <EvidenceProvider>
    <div className="mx-auto max-w-[42rem] space-y-6 pb-4">
      <PageHeader
        title="면접 답변지"
        description={`${applicationName} · ${typeLabel} · 질문 ${total}개`}
        status={sheetOpen ? <SaveStatus state={autosave.state} savedAt={autosave.savedAt} onRetry={autosave.retry} /> : null}
      />
      <p className="sr-only" aria-live="polite">
        {announcement}
      </p>

      {abandoned ? (
        // 02 S-33 v5.3 A8 / design-system 6 A4 (v3): read-only, no submit; AI 실행이 아니라 배지 없음
        <Alert>
          <CirclePause aria-hidden />
          <AlertTitle>{questions.length === 0 ? "질문을 만들지 못한 면접이에요" : "그만둔 면접이에요. 답변은 볼 수만 있어요"}</AlertTitle>
          <AlertDescription>
            <Button asChild size="sm" className="mt-1 max-md:h-8">
              <Link href={routes.interviewPrep(applicationProjectId)}>이 자기소개서로 새 면접 시작</Link>
            </Button>
          </AlertDescription>
        </Alert>
      ) : null}

      {staleFailure ? (
        // S-15 "이전 실패 안내" (Q53-2): the 공고 was fixed after this failure; its button no longer applies
        <Alert>
          <Info aria-hidden />
          <AlertTitle>{staleFailure === "edited" ? "공고를 고쳤어요. 이 면접은 질문을 만들지 못했어요" : "질문을 만들지 못했어요"}</AlertTitle>
          <AlertDescription>
            <Button asChild size="sm" variant="outline" className="mt-1 max-md:h-8">
              <Link href={routes.interviewPrep(applicationProjectId)}>면접 준비로</Link>
            </Button>
          </AlertDescription>
        </Alert>
      ) : failedCategory === "insufficient_data" ? (
        // UQ-550: insufficient_data is not a C-20 (AiErrorNotice draws nothing) — Q53-9: S-20의 C-09
        <InsufficientDataNotice
          hasQuestions={questions.length > 0}
          href={routes.interviewPrep(applicationProjectId, session.interview_type)}
        />
      ) : canceledGeneration ? (
        // [UI-가정] 문구 전부 (C-20은 canceled를 표시하지 않는다)
        <Card className="gap-3 p-5" role="status">
          <p className="font-semibold">질문 만들기를 중단했어요</p>
          <p className="text-sm text-muted-foreground">
            {questions.length ? "만든 질문과 답변은 그대로 있어요. 남은 질문을 이어서 만들 수 있어요" : "다시 만들면 처음부터 시작해요"}
          </p>
          <AiRunButton lock={{ entry: "interview_new" }} rerun pending={retrying} onRun={restartCanceled}>
            {questions.length ? "남은 질문 다시 만들기" : "질문 다시 만들기"}
          </AiRunButton>
        </Card>
      ) : failedCategory ? (
        // C-20 in the 생성 영역 (02 C-20 표시 위치 "면접 질문 생성(S-33)"). Questions and answers
        // already saved stay (D-36). Retry button + C-19 badge (active provider) + token note come from
        // AiErrorNotice; input-caused failures have no retry — Q53-9: one button to S-15.
        <div className="space-y-2">
          <AiErrorNotice
            code={failedCategory}
            // UQ-325: previews without a job row fall back to the active connection's provider
            provider={preview.otherProvider ? otherProviderThan(connection?.active_provider) : (job?.provider ?? connection?.active_provider)}
            retryAfter={job?.retry_after}
            quotaResetsAt={job?.quota_resets_at}
            // "처음부터 다시" only for the same-row retry (the new 남은 질문 job always starts fresh)
            jobTier={preview.otherProvider ? "paid" : failedInfo?.jobTier}
            sameRow={!partialFailure && (preview.otherProvider || Boolean(failedInfo?.sameRow))}
            onRetry={locked && failedCategory !== "key_missing" ? undefined : () => void rerun(partialFailure ? "remaining" : "same_row")}
            retrying={retrying}
            retryLabel={partialFailure ? "남은 질문 다시 만들기" : "다시 시도"}
            refusal={refusal}
            lockEntry="interview_new"
            rerunLabel={inputCausedJd ? "요건 정리하기" : "시작하기"}
            hideFixCaption={inputCausedJd && jd.has_requirements}
            // Q53-9: 입력 원인 → S-15 (요건이 없으면 공고 원문 수정, 있으면 "요건이 있는 공고" 안내)
            inputHref={
              failedCategory === "key_missing"
                ? undefined
                : inputCausedJd
                  ? jd.has_requirements
                    ? routes.applicationJd(applicationProjectId, { from: "interview", cause: failedCategory as "not_a_jd" | "input_too_long" | "safety_blocked" })
                    : routes.applicationJd(applicationProjectId, { edit: 1, from: "interview" })
                  : routes.interviewPrep(applicationProjectId)
            }
            inputLabel={inputCausedJd ? (jd.has_requirements ? "공고 확인하기" : "공고 원문 고치기") : "면접 준비로"}
            reduceTarget="공고 원문"
          />
          {locked && failedCategory !== "key_missing" && !isInputCausedFailure(failedCategory) ? (
            // UQ-556: the C-18 names the blocked action — 남은 질문 다시 만들기 (partial) / 다시 시도 (whole).
            // Input-caused failures re-run from S-20, so no C-18 here. [UI-가정] 설명 문구
            <AiLock
              size="inline"
              entry="interview_new"
              description={
                partialFailure
                  ? "남은 질문을 만들려면 AI를 연결해 주세요. 만든 질문과 답변은 그대로 있어요"
                  : "질문을 다시 만들려면 AI를 연결해 주세요"
              }
              actionName={partialFailure ? "남은 질문 다시 만들기" : "다시 시도"}
            />
          ) : null}
        </div>
      ) : null}

      {generatingNow && !failedCategory ? (
        // C-03 card: C-19 연결 배지 + 무료 등급 순차 줄 + 요청 한도 대기 줄 (D-37); questions below
        // fill in one by one (C-04 차례로 채움)
        <AiProgress
          jobType="interview_questions"
          title="면접 질문 생성"
          progress={
            preview.generating
              ? { stage: "generate", done: visibleQuestions.length, total, waiting_retry_until: preview.waiting ? previewWaitUntil : null }
              : (job?.progress ?? { stage: "generate", done: visibleQuestions.length, total })
          }
          connectionTier={job?.connection_tier ?? connection?.connection_tier}
        />
      ) : null}

      {sheetOpen ? <InputGuide guide="G-2" /> : null}

      <ol className="space-y-6" aria-busy={generatingNow && !failedCategory}>
        {visibleQuestions.map((q, i) => {
          const answer = q.answer
          const text = answer ? (answers[answer.id] ?? "") : ""
          const editable = sheetOpen && answer?.status === "draft"
          const fieldId = `answer-${q.id}`
          const latest = generatingNow && i === visibleQuestions.length - 1
          return (
            <li key={q.id}>
              <Card className="gap-3 p-5">
                <div className="flex items-center gap-2">
                  <span className="text-xs font-medium text-muted-foreground tabular-nums">
                    질문 {q.sequence}/{total}
                  </span>
                  <Badge variant="outline">{typeLabel}</Badge>
                </div>
                <label
                  htmlFor={abandoned ? undefined : fieldId}
                  className={latest ? "border-l-2 border-ai pl-3 text-base leading-[1.75] font-medium" : "text-base leading-[1.75] font-medium"}
                >
                  {q.question_text}
                </label>
                {/* 02 S-33 v5.3: 질문 근거 칩은 제출 전에도 (의도·좋은 답 신호는 S-22에서만) */}
                <EvidenceChips items={Object.values(evidence[q.id] ?? {}).flat()} />
                {abandoned ? (
                  // (v3) 그만둔 세션: 글자만 보이는 상자, 글자 수·C-06·제출 막대 없음
                  <div
                    id={fieldId}
                    className={cn(
                      "rounded-md bg-muted/50 px-4 py-3 text-base leading-[1.75] whitespace-pre-wrap",
                      text.trim() === "" && "text-muted-foreground",
                    )}
                  >
                    {/* [UI-가정] P-12 빈 답변 문구 */}
                    {text.trim() === "" ? "답변 없음" : text}
                  </div>
                ) : (
                <>
                <Textarea
                  id={fieldId}
                  value={text}
                  readOnly={!editable}
                  disabled={generatingNow || Boolean(failedCategory) || canceledGeneration}
                  maxLength={ANSWER_MAX_CHARS}
                  onChange={(e) => answer && change(answer.id, e.target.value.slice(0, ANSWER_MAX_CHARS))}
                  onBlur={() => void autosave.flush()}
                  placeholder={generatingNow ? "질문을 준비하고 있어요" : editable ? "답변을 써 주세요" : undefined}
                  className="min-h-40 text-base leading-[1.75] read-only:bg-muted/40"
                  aria-describedby={`${fieldId}-count`}
                />
                <p className="text-right">
                  <CharCount id={`${fieldId}-count`} count={text.length} limit={ANSWER_MAX_CHARS} suffix="자" />
                </p>
                </>
                )}
              </Card>
            </li>
          )
        })}
        {Array.from({ length: pendingCount }, (_, i) => (
          <li key={`pending-${i}`}>
            <Card className="gap-3 p-5">
              <span className="text-xs font-medium text-muted-foreground tabular-nums">
                질문 {visibleQuestions.length + i + 1}/{total}
              </span>
              <PendingBlock />
              <span className="sr-only">질문을 준비하고 있어요</span>
            </Card>
          </li>
        ))}
      </ol>

      {sheetOpen ? (
        <div className="sticky bottom-0 -mx-4 flex flex-wrap items-center justify-between gap-3 border-t bg-background px-4 py-3">
          <div className="space-y-0.5">
            <p className="text-sm text-muted-foreground tabular-nums">
              답변 {answeredCount}/{total}
            </p>
          </div>
          {submitRejected === "key_missing" && locked ? (
            // UQ-320 / ST-AI-KEY-MISSING: the key was deleted (e.g. in another tab) → submit refused
            // before any change. C-20 key_missing replaces the submit slot; answers stay editable.
            <AiErrorNotice size="inline" code="key_missing" className="min-w-0 justify-end" />
          ) : (
            <AiRunButton
              connection={connection}
              lock={{ entry: "interview_submit" }}
              onRun={askSubmit}
              pending={submitting}
              buttonClassName="max-md:h-8"
            >
              제출
            </AiRunButton>
          )}
        </div>
      ) : null}

      <AlertDialog open={confirmOpen} onOpenChange={(o) => !submitting && setConfirmOpen(o)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            {/* [UI-가정] 제출 확인·미응답·짧은 답변 경고 문구는 명세에 없음 (FL-12 "미응답·짧은 답변 경고 → 확인") */}
            <AlertDialogTitle>답변을 제출할까요?</AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="space-y-2 text-base text-foreground">
                <p>제출하면 답변을 고칠 수 없어요.</p>
                {unansweredCount === questions.length ? (
                  <p className="text-warning-subtle-foreground">답변이 하나도 없어 평가할 내용이 없어요.</p>
                ) : unansweredCount > 0 ? (
                  <p className="text-warning-subtle-foreground tabular-nums">
                    답변하지 않은 질문 {unansweredCount}개는 미응답으로 처리되고 평가하지 않아요.
                  </p>
                ) : null}
                {shortCount > 0 ? (
                  <p className="text-warning-subtle-foreground tabular-nums">
                    {SHORT_ANSWER_CHARS}자보다 짧은 답변이 {shortCount}개 있어요. 짧은 답변은 낮게 평가될 수 있어요.
                  </p>
                ) : null}
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={submitting}>계속 쓰기</AlertDialogCancel>
            <Button onClick={submit} disabled={submitting} className="max-md:h-8">
              {submitting ? <Loader2 className="animate-spin" aria-hidden /> : null}
              제출하기
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
    </EvidenceProvider>
  )
}

/**
 * UQ-550: question generation ended with `insufficient_data` (R-76: no retry). Warning-tone notice
 * with the C-20 shape: cause, 보존 줄 when questions exist, "면접 준비로" (S-20 shows C-09) and the
 * re-run caption. // [UI-가정] 제목·설명 문구 (02 C-20 "(입력) insufficient_data → C-09")
 */
function InsufficientDataNotice({ hasQuestions, href }: { hasQuestions: boolean; href: string }) {
  const title = "커리어 데이터가 부족해 질문을 만들지 못했어요"
  return (
    <Alert variant="warning" className="gap-x-3 p-4">
      <DatabaseZap className="size-5" aria-hidden />
      <AlertTitle className="text-base leading-6 font-semibold">{title}</AlertTitle>
      <AlertDescription className="space-y-2 text-sm">
        <p className="sr-only" role="status">
          {title}
        </p>
        {hasQuestions ? <p>만든 질문과 답변은 그대로 있어요</p> : null}
        <p>면접 준비에서 부족한 커리어를 확인할 수 있어요</p>
        <div className="flex flex-wrap items-center gap-2 pt-1">
          <Button asChild variant="outline" size="sm" className="max-md:h-8">
            <Link href={href}>면접 준비로</Link>
          </Button>
        </div>
        <p className="text-xs text-muted-foreground">채운 뒤 시작하기로 새로 실행해 주세요</p>
      </AlertDescription>
    </Alert>
  )
}
