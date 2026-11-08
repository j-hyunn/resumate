"use client"

/**
 * S-31 헤더: 이름(AI 추출 배지) + 인라인 수정(이름·마감일, F-AP-04 MVP 범위) + 회사·포지션 +
 * 마감일 D-day + 전형 단계 칩(C-12 → C-13) + 삭제(C-05).
 */
import * as React from "react"
import { useRouter } from "next/navigation"
import { CircleAlert, Loader2, MoreHorizontal, Pencil, Sparkles, Trash2 } from "lucide-react"
import { toast } from "sonner"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card } from "@/components/ui/card"
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { DDay } from "@/components/common/basics"
import { StageChip, useStageMove } from "@/components/common/stage-menu"
import type { ApplicationSummary } from "@/lib/data/applications"
import { applicationDisplayName, formatDate, submitFailedMessage } from "@/lib/data/labels"
import { routes } from "@/lib/routes"
import { readNavOrigin } from "@/components/common/return-target"
import { updateApplicationAction } from "@/app/(dashboard)/(gated)/applications/_lib/actions"
import { useDeleteApplication } from "./shared"

export function HubHeader({ ap, failMove = false, failSave = false }: { ap: ApplicationSummary; failMove?: boolean; failSave?: boolean }) {
  const router = useRouter()
  const name = applicationDisplayName(ap.name, ap.name_source, ap.created_at)
  const move = useStageMove({
    applicationProjectId: ap.id,
    name,
    stage: ap.stage,
    outcome: ap.stage_outcome,
    failMove,
    onMoved: () => router.refresh(),
  })
  // UQ-125: back to where the user came from (S-39 when the breadcrumb starts with 지원 현황, else S-13)
  // [UI-가정] FL-06 "출발 화면으로" = the list S-31 was opened from (기획 확인 K-29)
  const del = useDeleteApplication({
    after: () => router.push(readNavOrigin(ap.id) === "board" ? routes.board() : routes.applications()),
  })
  const [editing, setEditing] = React.useState(false)
  const [draftName, setDraftName] = React.useState(ap.name ?? "")
  const [draftDeadline, setDraftDeadline] = React.useState(ap.deadline ?? "")
  const [saving, setSaving] = React.useState(false)
  const [failed, setFailed] = React.useState(false)
  const editRef = React.useRef<HTMLButtonElement>(null)

  const startEdit = () => {
    setDraftName(ap.name ?? "")
    setDraftDeadline(ap.deadline ?? "")
    setFailed(false)
    setEditing(true)
  }
  const cancel = () => {
    setEditing(false)
    requestAnimationFrame(() => editRef.current?.focus())
  }
  const save = async (e: React.FormEvent) => {
    e.preventDefault()
    setSaving(true)
    setFailed(false)
    try {
      // A3 UQ-75: send only changed fields so a deadline-only edit keeps name_source ('ai' → "AI 추출" 배지)
      const patch: { name?: string; deadline?: string | null } = {}
      const nextName = draftName.trim()
      if (nextName && nextName !== (ap.name ?? "")) patch.name = nextName
      if ((draftDeadline || null) !== (ap.deadline ?? null)) patch.deadline = draftDeadline || null
      if (Object.keys(patch).length > 0) await updateApplicationAction(ap.id, patch, { fail: failSave })
      setEditing(false)
      // [UI-가정] 저장 완료 토스트 문구
      toast.success("저장했어요")
      router.refresh()
    } catch {
      setFailed(true)
    } finally {
      setSaving(false)
    }
  }

  const jd = ap.job_description
  return (
    <Card className="gap-3 p-5">
      {editing ? (
        <form onSubmit={save} className="space-y-3" onKeyDown={(e) => e.key === "Escape" && cancel()}>
          <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_12rem]">
            <div className="space-y-1.5">
              <Label htmlFor="hub-name">이름</Label>
              <Input id="hub-name" value={draftName} maxLength={100} onChange={(e) => setDraftName(e.target.value)} autoFocus />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="hub-deadline">마감일</Label>
              <Input id="hub-deadline" type="date" value={draftDeadline} onChange={(e) => setDraftDeadline(e.target.value)} />
            </div>
          </div>
          {failed ? (
            <p className="flex items-center gap-1.5 text-sm text-destructive" role="alert">
              <CircleAlert className="size-4" aria-hidden />
              {submitFailedMessage("이름·마감일")}
            </p>
          ) : null}
          <div className="flex justify-end gap-2">
            <Button type="button" variant="outline" size="sm" onClick={cancel}>
              취소
            </Button>
            <Button type="submit" size="sm" disabled={saving}>
              {saving ? <Loader2 className="animate-spin" aria-hidden /> : null}
              저장
            </Button>
          </div>
        </form>
      ) : (
        <div className="flex items-start gap-3">
          <div className="min-w-0 flex-1 space-y-1">
            <div className="flex flex-wrap items-center gap-2">
              <h1 className={ap.name ? "text-2xl leading-8 font-bold" : "text-2xl leading-8 font-bold text-muted-foreground"}>
                {name}
                {/* 02 L-01 (CR-23) 허브 제목 "{회사명 – 포지션명} 자기소개서". (v5.14, U36-7) 이름에 이미 "자기소개서"가 있으면
                    (기본 이름 "새 자기소개서 (날짜)" 등) 붙이지 않음 */}
                {name.includes("자기소개서") ? null : " 자기소개서"}
              </h1>
              {ap.name_source === "ai" ? (
                <Badge variant="ai">
                  <Sparkles aria-hidden />
                  AI 추출
                </Badge>
              ) : null}
              <Button ref={editRef} variant="ghost" size="icon-sm" aria-label="이름·마감일 수정" onClick={startEdit}>
                <Pencil aria-hidden />
              </Button>
            </div>
            {jd?.company_name || jd?.position_title ? (
              <p className="text-sm text-muted-foreground">{[jd.company_name, jd.position_title].filter(Boolean).join(" · ")}</p>
            ) : null}
          </div>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon-sm" aria-label="자기소개서 메뉴">
                <MoreHorizontal aria-hidden />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem variant="destructive" onSelect={() => del.open(ap.id, name)}>
                <Trash2 aria-hidden />
                삭제
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      )}
      <div className="flex flex-wrap items-center gap-3 text-sm">
        <StageChip controller={move} />
        {ap.deadline ? (
          <span className="inline-flex items-center gap-2">
            <span className="text-muted-foreground">마감</span>
            <DDay deadline={ap.deadline} />
            <span className="text-muted-foreground tabular-nums">{formatDate(ap.deadline)}</span>
          </span>
        ) : (
          <span className="text-muted-foreground">마감일 없음</span>
        )}
      </div>
      {move.dialogs}
      {del.dialog}
    </Card>
  )
}
