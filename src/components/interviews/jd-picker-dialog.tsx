"use client"

/**
 * C-16 기업 JD 선택 다이얼로그 (02 C-16, FL-17, design-system 3.15).
 * Dialog + Command: 이름, 전형 단계, 마감일, 작성 중 세션 여부. 최근 활동순, 검색. 선택 필수.
 * After a pick: in-progress session → "작성 중인 면접이 있어요: 이어서 쓰기 / 그만두고 새로",
 * otherwise → S-20 (breadcrumb origin = 모의 면접).
 */
import * as React from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { Briefcase, CircleDashed, Loader2 } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Command, CommandEmpty, CommandInput, CommandItem, CommandList } from "@/components/ui/command"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { DDay, StageLabel } from "@/components/common/basics"
import { EmptyState } from "@/components/common/state-views"
import { setNavOrigin } from "@/components/common/return-target"
import type { ApplicationSummary } from "@/lib/data/applications"
import { applicationDisplayName, INTERVIEW_TYPE_LABELS } from "@/lib/data/labels"
import { routes } from "@/lib/routes"
import { abandonInterviewSessionAction } from "./actions"
import { toast } from "sonner"

export function JdPickerDialog({
  open,
  onOpenChange,
  applications,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** listApplicationProjects() — already 최근 활동순 */
  applications: ApplicationSummary[]
}) {
  const router = useRouter()
  const [picked, setPicked] = React.useState<ApplicationSummary | null>(null)
  const [busy, setBusy] = React.useState(false)

  const goPrep = (ap: ApplicationSummary) => {
    setNavOrigin("interviews", ap.id)
    onOpenChange(false)
    router.push(routes.interviewPrep(ap.id))
  }

  const choose = (ap: ApplicationSummary) => {
    if (ap.in_progress_session) setPicked(ap)
    else goPrep(ap)
  }

  // UQ-44: "그만두고 새로" asks first, like S-20 "그만두기" (irreversible, design-system 5.6).
  // Shown as a step inside the same dialog (no dialog on top of a dialog).
  const [confirming, setConfirming] = React.useState(false)
  const abandonAndNew = async () => {
    if (!picked?.in_progress_session) return
    setBusy(true)
    try {
      await abandonInterviewSessionAction(picked.in_progress_session.id)
      const ap = picked
      setPicked(null)
      setConfirming(false)
      goPrep(ap)
    } catch {
      // UQ-43 — [UI-가정] 실패 문구. 확인 단계는 그대로 둔다
      toast.error("그만두지 못했어요. 잠시 후 다시 시도해 주세요")
    } finally {
      setBusy(false)
    }
  }

  const close = (o: boolean) => {
    if (busy) return
    if (!o) {
      setPicked(null)
      setConfirming(false)
    }
    onOpenChange(o)
  }

  // UQ-47: when the list is replaced by the branch / confirm step, move focus into the new content
  const stepFocus = React.useRef<HTMLButtonElement & HTMLAnchorElement>(null)
  React.useEffect(() => {
    if (picked) stepFocus.current?.focus()
  }, [picked, confirming])

  const inProgress = picked?.in_progress_session

  return (
    <Dialog open={open} onOpenChange={close}>
      <DialogContent className="max-h-[85dvh] overflow-y-auto sm:max-w-lg">
        {picked && inProgress && confirming ? (
          <>
            <DialogHeader className="text-left">
              {/* [UI-가정] 확인 문구 (S-20 그만두기 확인과 같은 내용) */}
              <DialogTitle className="text-lg font-semibold">작성 중인 면접을 그만둘까요?</DialogTitle>
              <DialogDescription className="text-base text-muted-foreground">
                그만둔 면접은 채점하지 않아요. 목록의 &lsquo;그만둠&rsquo;에 남고, 언제든 삭제할 수 있어요.
              </DialogDescription>
            </DialogHeader>
            <DialogFooter className="flex-col-reverse gap-2 sm:flex-row sm:justify-end">
              {/* A4 UQ-50: irreversible step → initial focus on the safe action */}
              <Button ref={stepFocus} variant="ghost" onClick={() => setConfirming(false)} disabled={busy}>
                취소
              </Button>
              <Button variant="destructive" onClick={abandonAndNew} disabled={busy}>
                {busy ? <Loader2 className="animate-spin" aria-hidden /> : null}
                그만두고 새로 시작
              </Button>
            </DialogFooter>
          </>
        ) : picked && inProgress ? (
          <>
            <DialogHeader className="text-left">
              <DialogTitle className="text-lg font-semibold">작성 중인 면접이 있어요</DialogTitle>
              <DialogDescription className="text-base text-muted-foreground">
                {applicationDisplayName(picked.name, picked.name_source, picked.created_at)}
              </DialogDescription>
            </DialogHeader>
            <p className="flex flex-wrap items-center gap-2 rounded-md bg-muted p-3 text-sm">
              <Badge variant="outline">{INTERVIEW_TYPE_LABELS[inProgress.interview_type]}</Badge>
              <span className="tabular-nums">
                {inProgress.answered_count}/{inProgress.question_count} 작성
              </span>
            </p>
            <DialogFooter className="flex-col-reverse gap-2 sm:flex-row sm:justify-end">
              <Button variant="ghost" className="max-md:h-8" onClick={() => setConfirming(true)}>
                그만두고 새로
              </Button>
              <Button asChild className="max-md:h-8">
                <Link
                  ref={stepFocus}
                  href={routes.interviewSession(picked.id, inProgress.id)}
                  onClick={() => {
                    setNavOrigin("interviews", picked.id)
                    close(false)
                  }}
                >
                  이어서 쓰기
                </Link>
              </Button>
            </DialogFooter>
          </>
        ) : (
          <>
            <DialogHeader className="text-left">
              <DialogTitle className="text-lg font-semibold">기업 JD 선택</DialogTitle>
              {/* [UI-가정] 설명 문구 */}
              <DialogDescription>면접을 연습할 기업 JD를 골라 주세요</DialogDescription>
            </DialogHeader>
            {applications.length === 0 ? (
              <EmptyState
                icon={Briefcase}
                className="py-6"
                title="기업 JD를 먼저 추가해 주세요"
                actions={
                  <Button asChild className="max-md:h-8">
                    <Link href={routes.applicationNew()} onClick={() => close(false)}>
                      기업 JD 추가
                    </Link>
                  </Button>
                }
              />
            ) : (
              <Command className="border">
                <CommandInput placeholder="회사명 또는 포지션 검색" className="text-base" />
                <CommandList className="max-h-[50dvh]">
                  {/* [UI-가정] 검색 결과 없음 문구 */}
                  <CommandEmpty>검색 결과가 없어요</CommandEmpty>
                  {applications.map((ap) => {
                    const name = applicationDisplayName(ap.name, ap.name_source, ap.created_at)
                    const keywords = [ap.job_description?.company_name, ap.job_description?.position_title].filter(
                      (k): k is string => Boolean(k),
                    )
                    return (
                      <CommandItem
                        key={ap.id}
                        value={`${name} ${ap.id}`}
                        keywords={keywords}
                        onSelect={() => choose(ap)}
                        className="min-h-11 flex-col items-start gap-1 py-3"
                      >
                        <span className="text-base font-medium">{name}</span>
                        <span className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
                          <StageLabel stage={ap.stage} />
                          {ap.deadline ? (
                            <>
                              <span aria-hidden>·</span>
                              <DDay deadline={ap.deadline} />
                            </>
                          ) : null}
                          {ap.in_progress_session ? (
                            <Badge variant="draft">
                              <CircleDashed aria-hidden />
                              작성 중 면접
                            </Badge>
                          ) : null}
                        </span>
                      </CommandItem>
                    )
                  })}
                </CommandList>
              </Command>
            )}
          </>
        )}
      </DialogContent>
    </Dialog>
  )
}
