"use client"

/**
 * C-12 단계 이동 메뉴 + C-13 전형 결과 선택 창 + C-14 인터뷰 전형 팝업
 * (02 C-12~C-14, design-system 3.11~3.13). Foundation-owned (A0 round 1): S-13, S-31, S-39 share it.
 *
 *   const move = useStageMove({ applicationProjectId, name, stage, outcome, origin: "board" })
 *   <StageChip controller={move} />                 // S-31 헤더 단계 칩
 *   <StageCardMenu controller={move} extraItems={…} /> // S-39 / S-13 행·카드 ⋯ 메뉴
 *   {move.dialogs}                                 // C-13 / C-14 / 결과 지우기 확인 / aria-live
 *
 * Flow (FL-15/16): closed → other with a recorded outcome asks first (D-UX-12) →
 * optimistic update → move_application_stage → on failure roll back + ST-MOVE-FAILED toast
 * ("이동하지 못했어요" + 다시 시도) → to = closed opens C-13 → interview stages open C-14.
 * Drag & drop (S-39, A4) calls the same `request(to)`.
 */
import * as React from "react"
import Link from "next/link"
import { ArrowRight, ChevronDown, CircleAlert, CircleX, Info, Loader2, MoreHorizontal, Trophy } from "lucide-react"
import { toast } from "sonner"
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
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { useAiConnection } from "./ai-connection-context"
import { AiLockDialog } from "./ai-lock"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import type { ApplicationStage, InterviewGenerationStatus, InterviewType, MoveApplicationStageResult, StageOutcome } from "@/types/db"
import {
  INTERVIEW_TYPE_LABELS,
  OUTCOME_LABELS,
  STAGE_LABELS,
  STAGE_ORDER,
  directionParticle,
  formatRelative,
  objectParticle,
} from "@/lib/data/labels"
import {
  getInProgressSessionAction,
  moveApplicationStageAction,
  setApplicationOutcomeAction,
} from "@/lib/data/actions"
import { routes } from "@/lib/routes"
import { StatusDot } from "./basics"
import { markBoardStageMove, setNavOrigin, type NavOrigin } from "./return-target"

export function nextStage(stage: ApplicationStage): ApplicationStage | null {
  const i = STAGE_ORDER.indexOf(stage)
  return i >= 0 && i < STAGE_ORDER.length - 1 ? STAGE_ORDER[i + 1] : null
}

// ---------------------------------------------------------------------------
// controller hook
// ---------------------------------------------------------------------------

export interface InterviewPromptState {
  interview_type: InterviewType
  /** v4.2 interview_prompt.in_progress_session (any type — one in-progress session per JD) */
  session: {
    id: string
    interview_type: InterviewType
    answered_count: number
    question_count: number
    generation_status?: InterviewGenerationStatus
    last_activity_at?: string
  } | null
}

export interface StageMoveController {
  applicationProjectId: string
  name: string
  /** optimistic current values */
  stage: ApplicationStage
  outcome: StageOutcome | null
  moving: boolean
  /** move to a stage (menu, "다음 단계로", drag & drop) */
  request: (to: ApplicationStage) => void
  /** C-13 from the card menu "결과 기록" (closed cards) */
  openOutcome: () => void
  /** render once near the trigger(s) */
  dialogs: React.ReactNode
}

export function useStageMove({
  applicationProjectId,
  name,
  stage: initialStage,
  outcome: initialOutcome,
  origin,
  failMove = false,
  onMoved,
}: {
  applicationProjectId: string
  /** {회사명 – 포지션명} (screen-reader announcement, C-14 copy) */
  name: string
  stage: ApplicationStage
  outcome: StageOutcome | null
  /** where the user is (C-14 links keep the breadcrumb origin) */
  origin?: NavOrigin
  /** ST-MOVE-FAILED preview (?state=move-failed) */
  failMove?: boolean
  /** after a successful server move (e.g. router.refresh() / re-sort the board column) */
  onMoved?: (result: MoveApplicationStageResult) => void
}): StageMoveController {
  const [stage, setStage] = React.useState(initialStage)
  const [outcome, setOutcome] = React.useState(initialOutcome)
  const [moving, setMoving] = React.useState(false)
  const [confirmTo, setConfirmTo] = React.useState<ApplicationStage | null>(null)
  const [outcomeOpen, setOutcomeOpen] = React.useState(false)
  const [prompt, setPrompt] = React.useState<InterviewPromptState | null>(null)
  const [announcement, setAnnouncement] = React.useState("")

  // follow server values when the parent re-renders with fresh data
  const [synced, setSynced] = React.useState({ initialStage, initialOutcome })
  if (synced.initialStage !== initialStage || synced.initialOutcome !== initialOutcome) {
    setSynced({ initialStage, initialOutcome })
    setStage(initialStage)
    setOutcome(initialOutcome)
  }

  const performRef = React.useRef<(to: ApplicationStage) => Promise<void>>(async () => undefined)
  const perform = React.useCallback(
    async (to: ApplicationStage) => {
      const prev = { stage, outcome }
      // optimistic: leaving closed clears the outcome (D-UX-12)
      setStage(to)
      if (prev.stage === "closed" && to !== "closed") setOutcome(null)
      setMoving(true)
      try {
        const result = await moveApplicationStageAction(applicationProjectId, to, null, { fail: failMove })
        setStage(result.application_project.stage)
        setOutcome(result.application_project.stage_outcome)
        const label = STAGE_LABELS[to]
        setAnnouncement(`${name}${objectParticle(name)} ${label}${directionParticle(label)} 옮겼어요`)
        onMoved?.(result)
        if (to === "closed" && !result.application_project.stage_outcome) setOutcomeOpen(true)
        if (result.interview_prompt) {
          const ips = result.interview_prompt.in_progress_session
          const session = ips
            ? { ...ips, id: ips.session_id }
            : result.interview_prompt.in_progress_session_id
              ? await getInProgressSessionAction(applicationProjectId)
              : null
          setPrompt({ interview_type: result.interview_prompt.interview_type, session })
        }
      } catch {
        // ST-MOVE-FAILED: back to the original column + toast with retry
        setStage(prev.stage)
        setOutcome(prev.outcome)
        toast.error("이동하지 못했어요", { action: { label: "다시 시도", onClick: () => void performRef.current(to) } })
      } finally {
        setMoving(false)
      }
    },
    [applicationProjectId, failMove, name, onMoved, outcome, stage],
  )
  React.useEffect(() => {
    performRef.current = perform
  }, [perform])

  const request = React.useCallback(
    (to: ApplicationStage) => {
      if (to === stage || moving) return
      if (stage === "closed" && to !== "closed" && outcome) {
        setConfirmTo(to)
        return
      }
      void perform(to)
    },
    [moving, outcome, perform, stage],
  )

  const recordOutcome = async (value: StageOutcome | null) => {
    setOutcomeOpen(false)
    if (value === null) return // 나중에 기록 → 결과 미기록 배지
    const before = outcome
    setOutcome(value)
    const saved = await setApplicationOutcomeAction(applicationProjectId, value).catch(() => null)
    if (!saved) {
      setOutcome(before)
      toast.error("결과를 기록하지 못했어요")
      return
    }
    setAnnouncement(`${name} 전형 결과를 ${OUTCOME_LABELS[value]}${directionParticle(OUTCOME_LABELS[value])} 기록했어요`)
  }

  const dialogs = (
    <>
      <p className="sr-only" aria-live="polite">
        {announcement}
      </p>
      <AlertDialog open={confirmTo !== null} onOpenChange={(o) => !o && setConfirmTo(null)}>
        <AlertDialogContent>
          <AlertDialogHeader className="text-left">
            <AlertDialogTitle className="text-lg font-semibold">
              기록한 결과({outcome ? OUTCOME_LABELS[outcome] : ""})를 지울까요?
            </AlertDialogTitle>
            <AlertDialogDescription>
              {/* [UI-가정] 설명 문구는 명세에 없음 */}
              전형 종료가 아닌 단계로 옮기면 결과 배지가 사라져요. 이전 기록은 전형 이력에 남아요.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter className="flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <AlertDialogCancel>취소</AlertDialogCancel>
            <Button
              onClick={() => {
                const to = confirmTo
                setConfirmTo(null)
                if (to) void perform(to)
              }}
            >
              {/* [UI-가정] 확인 버튼 문구 */}
              지우고 옮기기
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      <OutcomeDialog open={outcomeOpen} onSelect={recordOutcome} />
      <InterviewPromptDialog
        open={prompt !== null}
        onOpenChange={(o) => !o && setPrompt(null)}
        applicationProjectId={applicationProjectId}
        name={name}
        prompt={prompt}
        origin={origin}
      />
    </>
  )

  return {
    applicationProjectId,
    name,
    stage,
    outcome,
    moving,
    request,
    openOutcome: () => setOutcomeOpen(true),
    dialogs,
  }
}

// ---------------------------------------------------------------------------
// C-12 menu content + triggers
// ---------------------------------------------------------------------------

/** Label "단계 이동" → 6 stages (current checked) → "다음 단계로" */
export function StageMenuItems({ controller }: { controller: StageMoveController }) {
  const next = nextStage(controller.stage)
  return (
    <>
      <DropdownMenuLabel>단계 이동</DropdownMenuLabel>
      <DropdownMenuRadioGroup value={controller.stage} onValueChange={(v) => controller.request(v as ApplicationStage)}>
        {STAGE_ORDER.map((s) => (
          <DropdownMenuRadioItem key={s} value={s} disabled={controller.moving}>
            <StatusDot stage={s} />
            {STAGE_LABELS[s]}
          </DropdownMenuRadioItem>
        ))}
      </DropdownMenuRadioGroup>
      {next ? (
        <>
          <DropdownMenuSeparator />
          <DropdownMenuItem disabled={controller.moving} onSelect={() => controller.request(next)}>
            <ArrowRight aria-hidden />
            다음 단계로
          </DropdownMenuItem>
        </>
      ) : null}
    </>
  )
}

/** S-31 header stage chip (outline sm + StatusDot + 단계 이름 + ChevronDown). Shows outcome badge when closed. */
export function StageChip({ controller, className }: { controller: StageMoveController; className?: string }) {
  return (
    <span className="inline-flex flex-wrap items-center gap-2">
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="outline" size="sm" className={className} aria-label={`전형 단계: ${STAGE_LABELS[controller.stage]}, 단계 이동`}>
            <StatusDot stage={controller.stage} />
            {STAGE_LABELS[controller.stage]}
            <ChevronDown aria-hidden />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start">
          <StageMenuItems controller={controller} />
        </DropdownMenuContent>
      </DropdownMenu>
      {controller.stage === "closed" ? <OutcomeInline outcome={controller.outcome} /> : null}
    </span>
  )
}

function OutcomeInline({ outcome }: { outcome: StageOutcome | null }) {
  if (outcome === "passed")
    return (
      <Badge variant="success">
        <Trophy aria-hidden />
        {OUTCOME_LABELS.passed}
      </Badge>
    )
  if (outcome === "failed")
    return (
      <Badge variant="destructive-subtle">
        <CircleX aria-hidden />
        {OUTCOME_LABELS.failed}
      </Badge>
    )
  return (
    <Badge variant="muted">
      {OUTCOME_LABELS.none}
    </Badge>
  )
}

/** "단계 이동" submenu for card / row ⋯ menus */
export function StageSubMenu({ controller }: { controller: StageMoveController }) {
  return (
    <DropdownMenuSub>
      <DropdownMenuSubTrigger>단계 이동</DropdownMenuSubTrigger>
      <DropdownMenuSubContent>
        <StageMenuItems controller={controller} />
      </DropdownMenuSubContent>
    </DropdownMenuSub>
  )
}

/**
 * Card / row ⋯ menu (ghost icon-sm + MoreHorizontal, aria-label="카드 메뉴"):
 * 단계 이동 · 결과 기록(closed) · `extraItems` (기업 JD 열기, 삭제 …, owned by the screen).
 * Keyboard: focus the trigger → Enter opens, arrows choose (C-12).
 */
export function StageCardMenu({
  controller,
  extraItems,
  label = "카드 메뉴",
}: {
  controller: StageMoveController
  extraItems?: React.ReactNode
  label?: string
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon-sm" aria-label={label}>
          <MoreHorizontal aria-hidden />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <StageSubMenu controller={controller} />
        {controller.stage === "closed" ? (
          <DropdownMenuItem onSelect={() => controller.openOutcome()}>결과 기록</DropdownMenuItem>
        ) : null}
        {extraItems ? (
          <>
            <DropdownMenuSeparator />
            {extraItems}
          </>
        ) : null}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

// ---------------------------------------------------------------------------
// C-13 전형 결과 선택 창
// ---------------------------------------------------------------------------

export function OutcomeDialog({ open, onSelect }: { open: boolean; onSelect: (outcome: StageOutcome | null) => void }) {
  return (
    <Dialog open={open} onOpenChange={(o) => !o && onSelect(null)}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader className="text-left">
          <DialogTitle className="text-lg font-semibold">전형 결과를 기록할까요?</DialogTitle>
          <DialogDescription className="sr-only">최종 합격 또는 불합격을 고르세요</DialogDescription>
        </DialogHeader>
        <div className="grid grid-cols-2 gap-3">
          <Button variant="outline" className="h-auto flex-col gap-2 py-5" onClick={() => onSelect("passed")}>
            <Trophy className="size-6 text-success" aria-hidden />
            최종 합격
          </Button>
          <Button variant="outline" className="h-auto flex-col gap-2 py-5" onClick={() => onSelect("failed")}>
            <CircleX className="size-6 text-destructive" aria-hidden />
            불합격
          </Button>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onSelect(null)}>
            나중에 기록
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

// ---------------------------------------------------------------------------
// C-14 인터뷰 전형 팝업 (AI 실행 없음, 사용량 안내 없음)
// ---------------------------------------------------------------------------

export function InterviewPromptDialog({
  open,
  onOpenChange,
  applicationProjectId,
  name,
  prompt,
  origin,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  applicationProjectId: string
  name: string
  prompt: InterviewPromptState | null
  origin?: NavOrigin
}) {
  if (!prompt) return <Dialog open={false} />
  return (
    <InterviewPromptBody
      open={open}
      onOpenChange={onOpenChange}
      applicationProjectId={applicationProjectId}
      name={name}
      prompt={prompt}
      origin={origin}
    />
  )
}

function InterviewPromptBody({
  open,
  onOpenChange,
  applicationProjectId,
  name,
  prompt,
  origin,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  applicationProjectId: string
  name: string
  prompt: InterviewPromptState
  origin?: NavOrigin
}) {
  const connection = useAiConnection()
  const job = prompt.interview_type === "job"
  const session = prompt.session
  // v5 C-14 키 없음 변형 (3.18 팝업형): no active key and nothing to continue → AiLockDialog.
  // 작성 중 세션 이어 쓰기는 키 없이 가능 (D-36) → normal popup.
  if (connection && !connection.active_provider && !session)
    return (
      <AiLockDialog
        open={open}
        onOpenChange={onOpenChange}
        interviewType={prompt.interview_type}
        returnHref={routes.interviewPrep(applicationProjectId, prompt.interview_type)}
        // UQ-326: the connect round trip keeps the breadcrumb origin and S-20's "지원 현황에서 … 옮겼어요"
        onConnect={() => {
          if (origin) setNavOrigin(origin, applicationProjectId)
          if (origin === "board") markBoardStageMove(applicationProjectId)
        }}
      />
    )
  const go = () => {
    if (origin) setNavOrigin(origin, applicationProjectId)
    // only a move made on the board shows S-20's "지원 현황에서 … 옮겼어요" (UQ-122)
    if (origin === "board" && !session) markBoardStageMove(applicationProjectId)
    onOpenChange(false)
  }
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader className="text-left">
          <DialogTitle className="text-lg font-semibold">{job ? "직무 인터뷰를 준비할까요?" : "컬처핏 면접을 준비할까요?"}</DialogTitle>
          <DialogDescription className="text-base text-muted-foreground">
            {/* [UI-가정] 컬처핏 설명은 명세에서 "…"로 생략됨 → 직무와 같은 형식 */}
            {name}
            {directionParticle(name)} {job ? "직무 면접" : "컬처핏 면접"} 연습을 시작합니다
          </DialogDescription>
        </DialogHeader>
        {session ? (
          // v5.3 C-14 (3.13 v3): 유형 · n/N 작성 · 마지막 활동 + generation_status line
          <div className="space-y-1.5 rounded-md bg-muted p-3 text-sm">
            <p className="font-medium">이 기업 JD에 작성 중인 면접이 있어요</p>
            <p className="flex flex-wrap items-center gap-x-2 gap-y-1">
              <Badge variant="outline">{INTERVIEW_TYPE_LABELS[session.interview_type]}</Badge>
              <span className="tabular-nums">
                {session.answered_count}/{session.question_count} 작성
              </span>
              {session.last_activity_at ? (
                <span className="text-muted-foreground">· 마지막 활동 {formatRelative(session.last_activity_at)}</span>
              ) : null}
            </p>
            {session.generation_status === "generating" ? (
              <p className="flex items-center gap-1.5 text-ai-subtle-foreground">
                <Loader2 className="size-3.5 animate-spin text-ai" aria-hidden />
                질문을 만드는 중이에요
              </p>
            ) : session.generation_status === "failed" ? (
              <p className="flex items-center gap-1.5 text-warning-subtle-foreground">
                <CircleAlert className="size-3.5 text-warning" aria-hidden />
                질문 생성이 끝나지 않았어요
              </p>
            ) : null}
          </div>
        ) : null}
        {session && session.interview_type !== prompt.interview_type ? (
          // v5.3 C-14: the in-progress session's type differs from the column it was moved to
          <p className="flex gap-2 text-sm text-muted-foreground">
            <Info className="mt-0.5 size-4 shrink-0" aria-hidden />
            <span>
              작성 중인 면접은 <span className="font-medium text-foreground">{INTERVIEW_TYPE_LABELS[session.interview_type]}</span>이에요.
              이어 쓰거나 면접 준비에서 그만두고{" "}
              <span className="font-medium text-foreground">{INTERVIEW_TYPE_LABELS[prompt.interview_type]}</span>
              {objectParticle(INTERVIEW_TYPE_LABELS[prompt.interview_type])} 새로 시작할 수 있어요
            </span>
          </p>
        ) : null}
        <DialogFooter className="flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            나중에
          </Button>
          <Button asChild>
            <Link
              href={
                session
                  ? routes.interviewSession(applicationProjectId, session.id)
                  : routes.interviewPrep(applicationProjectId, prompt.interview_type)
              }
              onClick={go}
            >
              {session ? "이어서 쓰기" : "면접 준비하기"}
            </Link>
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
