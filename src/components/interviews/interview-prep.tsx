"use client"

/**
 * S-20 면접 준비 (02 S-20, design-system 6 A4): 진입 안내 · 작성 중 세션 배너 · ① 면접 유형 ·
 * ② 질문 수 · 데이터 상태(C-09 / thin 안내) · 시작하기(AiRunButton, C-18 / C-19).
 * The session list below is rendered by the page (SessionList).
 */
import * as React from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { Briefcase, Info, Loader2, Users } from "lucide-react"
import { toast } from "sonner"
import { Alert, AlertTitle } from "@/components/ui/alert"
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
import { Label } from "@/components/ui/label"
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group"
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group"
import { DataInsufficientGate } from "@/components/common/data-gate"
import { WaitJd } from "@/components/common/state-views"
import { AiRunButton } from "@/components/common/ai-run-button"
import { consumeAiReturnParams } from "@/components/common/ai-connect-return"
import { AiErrorNotice } from "@/components/common/ai-error-notice"
import { isAiRejected, notifyAiRejected } from "@/components/common/ai-rejection"
import { useAiConnection } from "@/components/common/ai-connection-context"
import { usePreviewWriteGuard } from "@/components/common/preview-write-guard"
import { consumeBoardStageMove, consumeReturnParams } from "@/components/common/return-target"
import type { AiConnection, AiErrorCode, DataReadiness, InterviewSession, InterviewType, QuestionCount } from "@/types/db"
import { INTERVIEW_TYPE_LABELS, actionFailedMessage } from "@/lib/data/labels"
import { routes } from "@/lib/routes"
import { abandonInterviewSessionAction, restartInterviewSessionAction, startInterviewSessionAction } from "./actions"
import { RelativeTime } from "./session-status"

const QUESTION_COUNTS: QuestionCount[] = [3, 5, 7]

const TYPE_OPTIONS: Array<{ value: InterviewType; icon: typeof Briefcase; description: string }> = [
  // [UI-가정] 유형별 한 줄 설명 문구는 명세에 없음 (design-system 6 A4 "각 한 줄 설명")
  { value: "job", icon: Briefcase, description: "내 경력과 공고 요건으로 실무 역량을 검증하는 질문이에요" },
  { value: "culture_fit", icon: Users, description: "협업·갈등·가치관처럼 조직에 맞는지 보는 질문이에요" },
]

/** S-39 진입 안내: "지원 현황에서 {직무 인터뷰 / 컬처핏} 전형으로 옮겼어요. …" */
const FROM_BOARD_STAGE: Record<InterviewType, string> = { job: "직무 인터뷰", culture_fit: "컬처핏" }

export type InProgressSummary = Pick<
  InterviewSession,
  "id" | "interview_type" | "answered_count" | "question_count" | "last_activity_at"
> & {
  /** 실효 generation_status: `generating` whose job ended counts as failed (S-20) */
  effective_generation_status: InterviewSession["generation_status"]
  saved_question_count: number
}

export function InterviewPrep({
  applicationProjectId,
  applicationName,
  initialType,
  inProgress,
  readiness,
  activeChatId,
  waitJd,
  forceFromBoard,
  needsExtraction = false,
  serverConnection,
  extractionFail = null,
}: {
  applicationProjectId: string
  applicationName: string
  /** `?type=` (C-14 → S-20) — pre-selected but changeable */
  initialType: InterviewType | null
  inProgress: InProgressSummary | null
  readiness: DataReadiness
  activeChatId: string | null
  /** ST-WAIT-JD: JD extraction not finished */
  waitJd: boolean
  /** `?state=from-board` preview of the entry notice */
  forceFromBoard: boolean
  /** JD has no requirements yet (saved without a key / extraction failed): extracted first (D-30) */
  needsExtraction?: boolean
  /** `?state=extract-failed` (dev): the D-30 requirement extraction fails → C-20, nothing is created */
  extractionFail?: AiErrorCode | null
  /** server-loaded ai_connection so the free-tier line and C-18 render on first paint */
  serverConnection?: AiConnection | null
}) {
  const router = useRouter()
  const connection = useAiConnection(serverConnection)
  const freeTier = connection?.active_provider != null && connection.connection_tier === "free"
  const previewWrite = usePreviewWriteGuard()
  // S-20 질문을 만들지 못한 세션 (Q53-9): 실효 generation_status = failed, 원인 무관
  const failedSession = inProgress?.effective_generation_status === "failed" ? inProgress : null
  // "그만두고 새로 시작": 선택이 없으면 실패 세션의 유형·질문 수로 미리 채운다 [가정 명세]
  const [type, setType] = React.useState<InterviewType | null>(initialType ?? failedSession?.interview_type ?? null)
  const [count, setCount] = React.useState<QuestionCount>(failedSession?.question_count ?? 5)
  const [starting, setStarting] = React.useState(false)
  const [restarting, setRestarting] = React.useState(false)
  const [extractionError, setExtractionError] = React.useState<AiErrorCode | null>(null)
  const [abandonOpen, setAbandonOpen] = React.useState(false)
  const [abandoning, setAbandoning] = React.useState(false)

  // C-10 복귀: restore 진행 중 설정 (면접 유형·질문 수) once, then the return target is cleared
  React.useEffect(() => {
    const restore = () => {
      const params = consumeReturnParams(applicationProjectId, "job_interview")
      if (!params) return
      if (params.interview_type === "job" || params.interview_type === "culture_fit") setType(params.interview_type)
      if (params.question_count === 3 || params.question_count === 5 || params.question_count === 7) setCount(params.question_count)
    }
    // FL-19 "설정 복원" (UQ-351): back from AI 연결 → the choices made before leaving
    const restoreConnect = () => {
      const back = consumeAiReturnParams()
      if (!back) return
      if (back.interview_type === "job" || back.interview_type === "culture_fit") setType(back.interview_type)
      if (back.question_count === 3 || back.question_count === 5 || back.question_count === 7) setCount(back.question_count)
    }
    restore()
    restoreConnect()
  }, [applicationProjectId])

  // S-39(C-14 "면접 준비하기")에서 온 그 한 번만: one-time marker consumed on mount (UQ-122)
  const [boardMove, setBoardMove] = React.useState(false)
  React.useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- reads + clears session storage once
    if (consumeBoardStageMove(applicationProjectId)) setBoardMove(true)
  }, [applicationProjectId])
  const fromBoard = initialType !== null && (boardMove || forceFromBoard)

  const jobGate = type === "job" && !readiness.features.job_interview.ready
  const thin =
    type === "culture_fit" &&
    (readiness.features.culture_fit_interview.data_sufficiency === "thin" ||
      readiness.features.culture_fit_interview.data_sufficiency === "none")
  const blockedByInProgress = inProgress !== null
  const canStart = type !== null && !jobGate && !waitJd && !blockedByInProgress && !starting

  const start = async (fromButton = false): Promise<unknown> => {
    if (!type || !canStart) return
    if (extractionFail) {
      // `?state=extract-failed`: D-30 requirement extraction failed → C-20 below the button, nothing created
      setExtractionError(extractionFail)
      return
    }
    if (previewWrite.stop()) return
    setStarting(true)
    setExtractionError(null)
    try {
      const res = await startInterviewSessionAction({
        application_project_id: applicationProjectId,
        interview_type: type,
        question_count: count,
      })
      if (isAiRejected(res)) {
        setStarting(false)
        // v5.3 path ①: returned to AiRunButton (C-18 / C-21 then re-run / key_invalid); the
        // extraction-failure retry below has no button wrapper → toast
        if (!fromButton) notifyAiRejected(res)
        return res
      }
      router.push(routes.interviewSession(applicationProjectId, res.session_id))
    } catch {
      setStarting(false)
      // [UI-가정] 시작 실패(작성 중 세션 충돌 등) 문구는 명세에 없음
      toast.error(actionFailedMessage("면접 시작"))
    }
  }

  /**
   * S-20 "그만두고 새로 시작" (Q53-9, 04 §2.7.1): 시작하기와 같은 판정 (C-09, C-18, C-21, C-20 key_invalid)을
   * 먼저 거치고, 걸리면 세션을 그대로 둔다. AiRunButton handles C-18 / C-21 / key_invalid from `onRun`'s result.
   */
  const restart = async (): Promise<unknown> => {
    if (!failedSession) return
    const t = type ?? failedSession.interview_type
    const dataGate = t === "job" && !readiness.features.job_interview.ready
    if (dataGate) {
      setType(t) // C-09 below; the session stays
      return
    }
    if (previewWrite.stop()) return
    setRestarting(true)
    try {
      const res = await restartInterviewSessionAction(failedSession.id, {
        application_project_id: applicationProjectId,
        interview_type: t,
        question_count: count,
      })
      if (isAiRejected(res)) {
        setRestarting(false)
        return res
      }
      if ("insufficient" in res) {
        setRestarting(false)
        setType(t)
        router.refresh()
        return
      }
      router.push(routes.interviewSession(applicationProjectId, res.session_id))
    } catch {
      // 뒤 호출 실패: 세션은 그만둔 상태일 수 있다 → 다시 읽어 "시작하기"가 있는 S-20으로
      setRestarting(false)
      router.refresh()
      toast.error(actionFailedMessage("면접 시작")) // [UI-가정]
    }
  }

  const abandon = async () => {
    if (!inProgress) return
    if (previewWrite.stop()) {
      setAbandonOpen(false)
      return
    }
    setAbandoning(true)
    try {
      await abandonInterviewSessionAction(inProgress.id)
      setAbandonOpen(false)
      router.refresh()
    } catch {
      // UQ-43 — [UI-가정] 그만두기 실패 문구. 확인 창은 열어 둔다
      toast.error("그만두지 못했어요. 잠시 후 다시 시도해 주세요")
    } finally {
      setAbandoning(false)
    }
  }

  const typeLabelId = React.useId()
  const countLabelId = React.useId()

  return (
    <div className="space-y-8">
      {fromBoard && type ? (
        <Alert variant="info">
          <Info aria-hidden />
          <AlertTitle className="font-normal">
            지원 현황에서 {FROM_BOARD_STAGE[initialType ?? type]} 전형으로 옮겼어요. {INTERVIEW_TYPE_LABELS[initialType ?? type]}이
            선택돼 있어요
          </AlertTitle>
        </Alert>
      ) : null}

      {inProgress ? (
        // UQ-709: in-progress / failed session banner uses the DS warning Alert (not a recolored Card)
        <Alert variant="warning" role={undefined} className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between">
          <p className="flex flex-wrap items-center gap-2 text-base">
            {/* 실패 세션 문구는 02 S-20. 그 밖 배너 문구: [UI-가정] (C-14 변형 문구와 맞춤) */}
            <span className="font-medium">
              {failedSession
                ? failedSession.saved_question_count > 0
                  ? "질문을 다 만들지 못한 면접이 있어요"
                  : "질문을 만들지 못한 면접이 있어요"
                : "작성 중인 면접이 있어요"}
            </span>
            <Badge variant="outline">{INTERVIEW_TYPE_LABELS[inProgress.interview_type]}</Badge>
            <span className="tabular-nums">
              {inProgress.answered_count}/{inProgress.question_count} 작성
            </span>
            <span className="text-sm">
              · 마지막 활동 <RelativeTime iso={inProgress.last_activity_at} />
            </span>
          </p>
          <div className="flex shrink-0 flex-wrap items-start gap-2">
            {failedSession ? (
              <AiRunButton
                connection={connection}
                variant="outline"
                buttonClassName="max-md:h-8"
                lock={{ entry: "interview_new", returnParams: { interview_type: type, question_count: count } }}
                onRun={restart}
                pending={restarting}
                disabled={waitJd}
              >
                그만두고 새로 시작
              </AiRunButton>
            ) : (
              <Button variant="ghost" className="max-md:h-8" onClick={() => setAbandonOpen(true)}>
                그만두기
              </Button>
            )}
            <Button asChild className="max-md:h-8">
              <Link href={routes.interviewSession(applicationProjectId, inProgress.id)}>이어서 쓰기</Link>
            </Button>
          </div>
        </Alert>
      ) : null}

      <section className="space-y-3" aria-labelledby={typeLabelId}>
        <h2 id={typeLabelId} className="text-base leading-6 font-semibold">
          ① 면접 유형 <span className="text-destructive">*</span>
          <span className="sr-only">필수</span>
        </h2>
        <RadioGroup
          value={type ?? ""}
          onValueChange={(v) => setType(v as InterviewType)}
          className="grid gap-3 sm:grid-cols-2"
          aria-labelledby={typeLabelId}
          aria-required
        >
          {TYPE_OPTIONS.map((opt) => {
            const Icon = opt.icon
            const id = `interview-type-${opt.value}`
            return (
              <Label
                key={opt.value}
                htmlFor={id}
                className="flex cursor-pointer items-start gap-3 rounded-lg border p-4 text-base font-normal has-[:checked]:border-primary has-[:checked]:bg-primary-subtle has-data-[state=checked]:border-primary has-data-[state=checked]:bg-primary-subtle has-data-checked:border-primary has-data-checked:bg-primary-subtle"
              >
                <RadioGroupItem value={opt.value} id={id} className="mt-1" />
                <span className="space-y-1">
                  <span className="flex items-center gap-2 font-medium">
                    <Icon className="size-4" aria-hidden />
                    {INTERVIEW_TYPE_LABELS[opt.value]}
                  </span>
                  <span className="block text-sm text-muted-foreground">{opt.description}</span>
                </span>
              </Label>
            )
          })}
        </RadioGroup>
      </section>

      <section className="space-y-3" aria-labelledby={countLabelId}>
        <h2 id={countLabelId} className="text-base leading-6 font-semibold">
          ② 질문 수
        </h2>
        <ToggleGroup
          type="single"
          variant="outline"
          value={String(count)}
          onValueChange={(v) => v && setCount(Number(v) as QuestionCount)}
          aria-labelledby={countLabelId}
        >
          {QUESTION_COUNTS.map((n) => (
            <ToggleGroupItem
              key={n}
              value={String(n)}
              className="h-10 min-w-14 px-4 max-md:h-8 text-base tabular-nums"
              aria-label={`${n}문항`}
            >
              {n}
            </ToggleGroupItem>
          ))}
        </ToggleGroup>
      </section>

      {jobGate ? (
        <DataInsufficientGate
          feature="job_interview"
          featureLabel="직무 면접"
          returnFeature="job_interview"
          readiness={readiness}
          applicationProjectId={applicationProjectId}
          applicationName={applicationName}
          returnHref={routes.interviewPrep(applicationProjectId)}
          returnParams={{ interview_type: type, question_count: count }}
          activeChatId={activeChatId}
          onSwitchToCultureFit={() => setType("culture_fit")}
        />
      ) : null}

      {thin ? (
        <Alert variant="info">
          <Info aria-hidden />
          <AlertTitle className="font-normal">입력된 커리어가 적어 일반 질문 비중이 높아요</AlertTitle>
        </Alert>
      ) : null}

      {/* S-20: 작성 중 세션이 있는 동안 "시작하기"는 숨긴다 [가정 명세] */}
      {jobGate || blockedByInProgress ? null : (
        <section className="space-y-3">
          {freeTier ? (
            // 02 S-20 시작하기 (무료 등급, D-37) · design-system 6 A4: 시작하기 위 Alert info
            <Alert variant="info">
              <Info aria-hidden />
              <AlertTitle className="font-normal">질문을 하나씩 만들어 조금 더 걸려요</AlertTitle>
            </Alert>
          ) : null}
          <AiRunButton
            connection={connection}
            // UQ-351: keep the chosen type and question count across the FL-19 round trip
            lock={{ entry: "interview_new", returnParams: { interview_type: type, question_count: count } }}
            size="lg"
            onRun={() => start(true)}
            pending={starting}
            disabled={!canStart}
            buttonClassName="w-full sm:w-auto"
          >
            시작하기
          </AiRunButton>
          {waitJd ? <WaitJd /> : null}
          {!waitJd && needsExtraction && connection?.active_provider && !extractionError ? (
            // [UI-가정] D-30 안내 문구. 서버가 같은 호출에서 요건 추출을 끝낸 뒤 질문 작업을 만든다
            <p className="text-sm text-muted-foreground" role={starting ? "status" : undefined}>
              {starting ? "공고 요건을 정리하고 있어요. 끝나면 질문을 만들어요" : "공고 요건을 먼저 정리한 뒤 질문을 만들어요"}
            </p>
          ) : null}
          {extractionError ? (
            // C-20 for the extraction step (입력 원인 → S-15 공고 원문 수정, Q53-9). Questions are not created.
            <AiErrorNotice
              code={extractionError}
              provider={connection?.active_provider}
              onRetry={() => void start()}
              retrying={starting}
              // v5.3: extraction is a request-path step (A14 countdown); input-caused → no retry (R-69)
              requestPath
              inputHref={routes.applicationJd(applicationProjectId, { edit: 1, from: "interview" })}
              inputLabel="공고 원문 고치기"
              reduceTarget="공고 원문"
              hidePreserved
            />
          ) : null}
          {!waitJd && type === null ? (
            // [UI-가정] 유형 미선택 안내 문구
            <p className="text-sm text-muted-foreground">면접 유형을 고르면 시작할 수 있어요</p>
          ) : null}
        </section>
      )}
      {blockedByInProgress && !jobGate ? (
        // [UI-가정] 자기소개서당 작성 중 세션 1개(unique) — 새로 시작 불가 안내 문구
        <p className="text-sm text-muted-foreground">작성 중인 면접을 이어 쓰거나 그만두면 새로 시작할 수 있어요</p>
      ) : null}

      <AlertDialog open={abandonOpen} onOpenChange={(o) => !abandoning && setAbandonOpen(o)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            {/* [UI-가정] 그만두기 확인 문구 */}
            <AlertDialogTitle>작성 중인 면접을 그만둘까요?</AlertDialogTitle>
            <AlertDialogDescription>
              그만둔 면접은 채점하지 않아요. 목록의 &lsquo;그만둠&rsquo;에 남고, 언제든 삭제할 수 있어요.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={abandoning}>취소</AlertDialogCancel>
            <Button variant="destructive" className="max-md:h-8" onClick={abandon} disabled={abandoning}>
              {abandoning ? <Loader2 className="animate-spin" aria-hidden /> : null}
              그만두기
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
