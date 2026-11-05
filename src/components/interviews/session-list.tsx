"use client"

/**
 * Session list shared by S-20 ("이 자기소개서의 세션 목록") and S-37 ("세션 목록").
 * Wide: Table (design-system 5.2). Narrow (<768): card list. Whole row is a link; the ⋯ row
 * menu (삭제 C-05, 자기소개서로 가기) stops propagation by sitting above the stretched link.
 * Evaluating rows show the C-03 축약형 from their running job (stage copy by job type, UQ-411).
 * S-37 ⋯ menu follows row.grading (04 §2.7.1 판정표, same as S-22): "실패한 답변 다시 채점" (채점 실패 행 +
 * 완료인데 실패 답변이 남은 행, Q53-6), "종합 평가 다시 정리" (Q53-5), 입력 원인만 남으면 메뉴 없음 (Q53-3).
 * Both are a new grading job on the active provider (regradeFailedAnswersAction).
 * 질문 0개인 그만둔 세션: 점수·공급자 자리에 "질문을 만들지 못함" (Q53-9).
 * OD-I6 "자기소개서 삭제됨" 행: 스냅샷 이름(application_name, R-OD-12) + 표식, 누르면 S-22 읽기 전용, 메뉴는 "삭제"만.
 */
import * as React from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { MoreHorizontal, RotateCcw } from "lucide-react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Card } from "@/components/ui/card"
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuShortcut,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { DeleteConfirmDialog, type DeleteTarget } from "@/components/common/delete-confirm-dialog"
import { AiProgressInline, useAiJob } from "@/components/common/ai-progress"
import { SessionScoreBadge } from "@/components/common/score-display"
import { connectionLabel, providerRunLabel } from "@/components/common/provider-badge"
import { useAiConnection } from "@/components/common/ai-connection-context"
import { useAiConsentGate } from "@/components/common/consent-gate"
import { AiLockPopup } from "@/components/common/ai-lock"
import { AiErrorNotice, useNow } from "@/components/common/ai-error-notice"
import { isAiRejected, notifyAiRejected } from "@/components/common/ai-rejection"
import { regradeFailedAnswersAction } from "@/lib/data/actions"
import { usePreviewWriteGuard } from "@/components/common/preview-write-guard"
import { gradingInputCauseCopy } from "@/lib/data/interview-grading"
import { actionFailedMessage, countsAsInterview, INTERVIEW_READ_ONLY_MESSAGE } from "@/lib/data/labels"
import { setNavOrigin, type NavOrigin } from "@/components/common/return-target"
import type { InterviewSessionRow } from "@/lib/data/interviews"
import { formatDate, INTERVIEW_TYPE_LABELS } from "@/lib/data/labels"
import { routes } from "@/lib/routes"
import { deleteInterviewSessionAction } from "./actions"
import { isApplicationDeleted } from "@/lib/data/interview-session-view"
import { ApplicationDeletedBadge, NewResultDot, sessionHref, SessionStatusBadge } from "./session-status"

function RunningInline({ jobId }: { jobId: string }) {
  const router = useRouter()
  const { progress, status, job } = useAiJob(jobId, { onDone: () => router.refresh() })
  if (status === "failed" || status === "canceled" || status === "succeeded") return null
  // UQ-411: 채점 prepare "채점 준비 중", 질문 generate "질문 만드는 중 (n/N)", complete 직전 문구 유지
  return <AiProgressInline progress={progress} jobType={job?.job_type} />
}

function StatusCell({ row }: { row: InterviewSessionRow }) {
  return (
    <span className="inline-flex flex-wrap items-center gap-2">
      <SessionStatusBadge status={row.status} />
      {row.status === "evaluating" && row.running_job_id ? <RunningInline jobId={row.running_job_id} /> : null}
    </span>
  )
}

/**
 * C-19 목록 열 "실행 공급자" (design-system 3.19, 02 C-19 "면접 세션의 실행 공급자"):
 * evaluation_provider once grading started, else question_provider; both when they differ.
 * Narrow screens split "질문 … · 채점 …" into two lines. No questions yet → "—".
 * // [UI-가정] sessions carry no model_tier → "기본" (providerRunLabel default)
 */
function RunProvider({ row, split = false }: { row: InterviewSessionRow; split?: boolean }) {
  const label = providerRunLabel(row)
  if (!split || !label.startsWith("질문 ")) return <>{label}</>
  const [q, e] = label.split(" · ")
  return (
    <>
      <span className="block">{q}</span>
      <span className="block">{e}</span>
    </>
  )
}

const NO_QUESTIONS_LABEL = "질문을 만들지 못함"
const noQuestions = (row: InterviewSessionRow) => !countsAsInterview(row, row.saved_question_count)

function rowLabel(row: InterviewSessionRow, showApplication: boolean) {
  const base = `${INTERVIEW_TYPE_LABELS[row.interview_type]} ${formatDate(row.created_at)}`
  return showApplication ? `${row.application_name} ${base}` : base
}

export function SessionList({
  rows,
  showApplication,
  origin,
  emptyText,
  caption,
  retryAfter = {},
}: {
  rows: InterviewSessionRow[]
  /** S-37: 자기소개서 이름 열 + 행 메뉴 "자기소개서로 가기" */
  showApplication: boolean
  /** S-37: remember the breadcrumb origin when leaving toward an application sub-screen */
  origin?: NavOrigin
  emptyText?: string
  /** table caption (sr-only) */
  caption: string
  /** UQ-558: session id → retry_after of the failed grading job (rate_limited / provider_unavailable) */
  retryAfter?: Record<string, string>
}) {
  const router = useRouter()
  const [target, setTarget] = React.useState<DeleteTarget | null>(null)
  const connection = useAiConnection()
  const consent = useAiConsentGate()
  const previewWrite = usePreviewWriteGuard()
  /** C-18 팝업형 for 다시 채점 without a key (design-system 6 A4 (v3) [가정]) */
  const [lockFor, setLockFor] = React.useState<InterviewSessionRow | null>(null)
  /** UQ-559: C-20 key_invalid (키 교체) when 다시 채점 is chosen with an invalid key */
  const [invalidOpen, setInvalidOpen] = React.useState(false)
  const now = useNow()
  /** seconds until the row's 다시 채점 may be sent (0 = now) */
  const waitSec = (row: InterviewSessionRow) => {
    const at = retryAfter[row.id]
    return at && now ? Math.max(0, Math.ceil((new Date(at).getTime() - now) / 1000)) : 0
  }

  /** 다시 채점 / 종합 평가 다시 정리 (S-22와 같은 동작: 새 채점 작업, 현재 활성 공급자) */
  const runRegrade = async (row: InterviewSessionRow): Promise<void> => {
    if (previewWrite.stop()) return
    try {
      const next = await regradeFailedAnswersAction(row.id)
      if (isAiRejected(next)) {
        if ((next.refusal ?? next.rejected) === "ai_consent_required") consent.open(() => void runRegrade(row))
        else notifyAiRejected(next)
        return
      }
      // 낡은 메뉴 (S-22 "버튼이 없을 때"): 다시 읽어 메뉴를 치운다. [UI-가정] 문구
      if ("refused" in next) {
        const { title, body } = gradingInputCauseCopy(next.cause)
        toast(
          next.refused === "interview_evaluation_input_only"
            ? `${title} ${body}`
            : next.refused === "interview_session_read_only"
              ? INTERVIEW_READ_ONLY_MESSAGE
              : "다시 채점할 답변이 없어요",
        )
      }
      router.refresh()
    } catch {
      toast.error(actionFailedMessage("다시 채점"))
    }
  }
  const regrade = (row: InterviewSessionRow) => {
    if (connection && !connection.active_provider) {
      setLockFor(row)
      return
    }
    if (connection?.key_status === "invalid") {
      setInvalidOpen(true)
      return
    }
    consent.guard(() => void runRegrade(row))
  }

  const remember = (row: InterviewSessionRow) => {
    if (origin && !isApplicationDeleted(row)) setNavOrigin(origin, row.application_project_id)
  }

  const menu = (row: InterviewSessionRow) => (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon-sm" className="relative z-10 max-md:size-8" aria-label={`${rowLabel(row, showApplication)} 메뉴`}>
          <MoreHorizontal aria-hidden />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        {showApplication && !isApplicationDeleted(row) ? (
          <DropdownMenuItem asChild>
            <Link href={routes.application(row.application_project_id)} onClick={() => remember(row)}>
              자기소개서로 가기
            </Link>
          </DropdownMenuItem>
        ) : null}
        {showApplication && !isApplicationDeleted(row) && (row.grading.kind === "regrade" || row.grading.kind === "resummarize") ? (
          // UQ-558: disabled with the remaining time until retry_after, like S-22
          <DropdownMenuItem onSelect={() => regrade(row)} disabled={waitSec(row) > 0}>
            <RotateCcw aria-hidden />
            {row.grading.kind === "resummarize" ? "종합 평가 다시 정리" : "실패한 답변 다시 채점"}
            {waitSec(row) > 0 ? (
              <span className="tabular-nums">
                ({Math.floor(waitSec(row) / 60)}:{String(waitSec(row) % 60).padStart(2, "0")})
              </span>
            ) : null}
            {connection?.active_provider ? (
              // (v3) 메뉴 안에는 배지 대신 활성 공급자 글자 [UI-가정] G-41
              <DropdownMenuShortcut className="tracking-normal">{connectionLabel(connection)}</DropdownMenuShortcut>
            ) : null}
          </DropdownMenuItem>
        ) : null}
        <DropdownMenuItem
          variant="destructive"
          onSelect={() =>
            setTarget({ kind: "interview_session", entity_id: row.id, label: rowLabel(row, showApplication) })
          }
        >
          삭제
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )

  if (rows.length === 0) {
    return emptyText ? <p className="py-6 text-center text-base text-muted-foreground">{emptyText}</p> : null
  }

  return (
    <>
      {/* wide: table */}
      <div className="hidden md:block">
        <Table>
          <caption className="sr-only">{caption}</caption>
          <TableHeader>
            <TableRow>
              {showApplication ? <TableHead className="text-sm font-medium text-muted-foreground">자기소개서</TableHead> : null}
              <TableHead className="text-sm font-medium text-muted-foreground">유형</TableHead>
              <TableHead className="text-sm font-medium text-muted-foreground">날짜</TableHead>
              {showApplication ? null : <TableHead className="text-sm font-medium text-muted-foreground">질문 수</TableHead>}
              <TableHead className="text-sm font-medium text-muted-foreground">상태</TableHead>
              <TableHead className="text-sm font-medium text-muted-foreground">점수</TableHead>
              <TableHead className="text-sm font-medium text-muted-foreground">실행 공급자</TableHead>
              <TableHead className="w-12">
                <span className="sr-only">메뉴</span>
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((row) => (
              <TableRow key={row.id} interactive className="relative h-12 text-base">
                {showApplication ? (
                  <TableCell className="max-w-[18rem]">
                    <span className="flex min-w-0 items-center gap-2">
                      {row.has_new_result ? <NewResultDot className="shrink-0" /> : null}
                      <Link
                        href={sessionHref(row)}
                        onClick={() => remember(row)}
                        className="min-w-0 truncate font-medium after:absolute after:inset-0 focus-visible:outline-none focus-visible:after:ring-2 focus-visible:after:ring-ring"
                      >
                        {row.application_name}
                      </Link>
                      {isApplicationDeleted(row) ? <ApplicationDeletedBadge className="relative z-10 shrink-0" /> : null}
                    </span>
                  </TableCell>
                ) : null}
                <TableCell>
                  {showApplication ? (
                    INTERVIEW_TYPE_LABELS[row.interview_type]
                  ) : (
                    <span className="flex items-center gap-2">
                      {row.has_new_result ? <NewResultDot className="shrink-0" /> : null}
                      <Link
                        href={sessionHref(row)}
                        onClick={() => remember(row)}
                        className="font-medium after:absolute after:inset-0 focus-visible:outline-none focus-visible:after:ring-2 focus-visible:after:ring-ring"
                      >
                        {INTERVIEW_TYPE_LABELS[row.interview_type]}
                      </Link>
                    </span>
                  )}
                </TableCell>
                <TableCell className="tabular-nums text-muted-foreground">{formatDate(row.created_at)}</TableCell>
                {showApplication ? null : <TableCell className="tabular-nums">{row.question_count}개</TableCell>}
                <TableCell>
                  <StatusCell row={row} />
                </TableCell>
                {noQuestions(row) ? (
                  <TableCell colSpan={2} className="text-sm text-muted-foreground">
                    {NO_QUESTIONS_LABEL}
                  </TableCell>
                ) : (
                  <>
                    <TableCell>
                      <SessionScoreBadge session={row} />
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground">
                      <RunProvider row={row} />
                    </TableCell>
                  </>
                )}
                <TableCell className="text-right">{menu(row)}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      {/* narrow: cards */}
      <ul className="space-y-2 md:hidden" aria-label={caption}>
        {rows.map((row) => (
          <li key={row.id}>
            <Card interactive className="relative gap-2 p-4">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0 space-y-0.5">
                  <p className="flex min-w-0 items-center gap-2">
                    {row.has_new_result ? <NewResultDot className="shrink-0" /> : null}
                    <Link
                      href={sessionHref(row)}
                      onClick={() => remember(row)}
                      className="min-w-0 truncate font-medium after:absolute after:inset-0 focus-visible:outline-none focus-visible:after:rounded-lg focus-visible:after:ring-2 focus-visible:after:ring-ring"
                    >
                      {showApplication ? row.application_name : INTERVIEW_TYPE_LABELS[row.interview_type]}
                    </Link>
                    {showApplication && isApplicationDeleted(row) ? <ApplicationDeletedBadge className="relative z-10 shrink-0" /> : null}
                  </p>
                  <p className="text-sm text-muted-foreground tabular-nums">
                    {showApplication ? `${INTERVIEW_TYPE_LABELS[row.interview_type]} · ` : ""}
                    {formatDate(row.created_at)} · 질문 {row.question_count}개
                  </p>
                  {noQuestions(row) ? (
                    <p className="text-sm text-muted-foreground">{NO_QUESTIONS_LABEL}</p>
                  ) : (
                    <p className="text-sm text-muted-foreground">
                      <span className="sr-only">실행 공급자: </span>
                      <RunProvider row={row} split />
                    </p>
                  )}
                </div>
                {menu(row)}
              </div>
              <div className="flex flex-wrap items-center gap-2 text-sm">
                <StatusCell row={row} />
                {noQuestions(row) ? null : <SessionScoreBadge session={row} />}
              </div>
            </Card>
          </li>
        ))}
      </ul>

      <DeleteConfirmDialog
        target={target}
        open={target !== null}
        onOpenChange={(o) => !o && setTarget(null)}
        onConfirm={async () => {
          if (!target) return
          const { gone } = await deleteInterviewSessionAction(target.entity_id)
          // [UI-가정] 삭제 완료 토스트 문구는 명세에 없음
          toast(gone ? "이미 삭제된 면접 세션이에요" : "면접 세션을 삭제했어요")
          router.refresh()
        }}
      />
      {consent.dialog}
      {/* C-18 팝업형 (foundation AiLockPopup) — [UI-가정] 제목·설명 문구 */}
      <AiLockPopup
        open={lockFor !== null}
        onOpenChange={(o) => !o && setLockFor(null)}
        title="다시 채점은 AI 연결 후 사용할 수 있어요"
        description="다시 채점하면 연결한 AI로 채점해요. 작성한 답변은 저장돼 있어요"
        entry="interview_submit"
        returnHref={lockFor ? sessionHref(lockFor) : undefined}
      />
      <Dialog open={invalidOpen} onOpenChange={setInvalidOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            {/* [UI-가정] UQ-559: 키 무효 C-20 key_invalid(키 교체)를 담는 창 제목 */}
            <DialogTitle>다시 채점하려면 키를 바꿔 주세요</DialogTitle>
            <DialogDescription className="sr-only">AI 키가 작동하지 않아 다시 채점할 수 없어요</DialogDescription>
          </DialogHeader>
          <AiErrorNotice code="key_invalid" size="inline" />
        </DialogContent>
      </Dialog>
    </>
  )
}
