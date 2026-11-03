"use client"

/**
 * S-13 기업 JD 목록 — filter row, wide table / narrow card list, row menu (C-12 단계 이동 + C-05 삭제).
 * Rows link to S-31; the ⋯ menu stops propagation (design-system 5.2).
 */
import * as React from "react"
import Link from "next/link"
import { usePathname, useRouter, useSearchParams } from "next/navigation"
import { FileText, Lightbulb, MessagesSquare } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Card } from "@/components/ui/card"
import { DropdownMenuItem } from "@/components/ui/dropdown-menu"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { DDay, OutcomeBadge, StageLabel } from "@/components/common/basics"
import { StageCardMenu, useStageMove, type StageMoveController } from "@/components/common/stage-menu"
import type { ApplicationStage } from "@/types/db"
import type { ApplicationSummary } from "@/lib/data/applications"
import type { ApplicationSummary as ApplicationListRow } from "@/lib/data/applications"
import { AI_STAGE_LABELS, STAGE_LABELS, STAGE_ORDER, applicationDisplayName, formatDate, formatRelative } from "@/lib/data/labels"
import { routes } from "@/lib/routes"
import { cn } from "@/lib/utils"
import { JobInline, useDeleteApplication } from "./shared"
import { AiFeatureFailureLine, AiFeatureStatus } from "@/components/common/ai-feature-status"
import { AiProgressInline } from "@/components/common/ai-progress"

// ---------------------------------------------------------------------------
// filters (query: sort, stage — non-personal values only)
// ---------------------------------------------------------------------------

export function ApplicationFilters({ sort, stage }: { sort: "last_activity" | "deadline"; stage: ApplicationStage | null }) {
  const router = useRouter()
  const pathname = usePathname()
  const params = useSearchParams()
  const set = (key: string, value: string | null) => {
    const next = new URLSearchParams(params.toString())
    if (value) next.set(key, value)
    else next.delete(key)
    const qs = next.toString()
    router.replace(qs ? `${pathname}?${qs}` : pathname)
  }
  return (
    <div className="flex flex-wrap items-center gap-2">
      <Select value={sort} onValueChange={(v) => set("sort", v === "last_activity" ? null : v)}>
        <SelectTrigger size="sm" className="w-40" aria-label="정렬">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="last_activity">최근 활동순</SelectItem>
          <SelectItem value="deadline">마감일순</SelectItem>
        </SelectContent>
      </Select>
      {/* [UI-가정] 전형 단계로 거르기 (02 S-13 [가정]) */}
      <Select value={stage ?? "all"} onValueChange={(v) => set("stage", v === "all" ? null : v)}>
        <SelectTrigger size="sm" className="w-44" aria-label="전형 단계로 거르기">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="all">모든 전형 단계</SelectItem>
          {STAGE_ORDER.map((s) => (
            <SelectItem key={s} value={s}>
              {STAGE_LABELS[s]}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  )
}

// ---------------------------------------------------------------------------
// list
// ---------------------------------------------------------------------------

const WIDE_QUERY = "(min-width: 768px)"
function subscribeWide(cb: () => void) {
  const mq = window.matchMedia(WIDE_QUERY)
  mq.addEventListener("change", cb)
  return () => mq.removeEventListener("change", cb)
}
/** one layout at a time so each row has a single stage-move state (A3 UQ-81). Server: wide. */
function useWide() {
  return React.useSyncExternalStore(subscribeWide, () => window.matchMedia(WIDE_QUERY).matches, () => true)
}

export function ApplicationList({ rows, failMove = false }: { rows: ApplicationListRow[]; failMove?: boolean }) {
  const del = useDeleteApplication()
  const wide = useWide()
  if (!wide)
    return (
      <>
        <ul className="space-y-2">
          {rows.map((row) => (
            <ApplicationRow key={row.id} row={row} failMove={failMove} onDelete={del.open} layout="card" />
          ))}
        </ul>
        {del.dialog}
      </>
    )
  return (
    <>
      {/* wide: table */}
      <div className="rounded-lg border bg-card">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-[34%]">기업 JD</TableHead>
              <TableHead>전형 단계</TableHead>
              <TableHead>마감</TableHead>
              <TableHead>기능 진행</TableHead>
              <TableHead>최근 활동</TableHead>
              <TableHead className="w-12">
                <span className="sr-only">행 메뉴</span>
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((row) => (
              <ApplicationRow key={row.id} row={row} failMove={failMove} onDelete={del.open} layout="table" />
            ))}
          </TableBody>
        </Table>
      </div>
      {del.dialog}
    </>
  )
}

function ApplicationRow({
  row,
  failMove,
  onDelete,
  layout,
}: {
  row: ApplicationListRow
  failMove: boolean
  onDelete: (id: string, name: string) => void
  layout: "table" | "card"
}) {
  const router = useRouter()
  const name = applicationDisplayName(row.name, row.name_source, row.created_at)
  const move = useStageMove({
    applicationProjectId: row.id,
    name,
    stage: row.stage,
    outcome: row.stage_outcome,
    failMove,
    onMoved: () => router.refresh(),
  })
  const href = routes.application(row.id)
  const menu = (
    <span onClick={(e) => e.stopPropagation()} onKeyDown={(e) => e.stopPropagation()}>
      <RowMenu name={name} controller={move} onOpen={() => router.push(href)} onDelete={() => onDelete(row.id, name)} />
      {/* portals bubble React events to the row → keep dialogs inside the stopPropagation wrapper */}
      {move.dialogs}
    </span>
  )

  if (layout === "table")
    return (
      <TableRow interactive className="h-12" onClick={() => router.push(href)}>
        <TableCell className="max-w-0">
          <NameCell row={row} name={name} href={href} />
        </TableCell>
        <TableCell>
          <StageCell stage={move.stage} outcome={move.outcome} />
        </TableCell>
        <TableCell>
          <DeadlineCell deadline={row.deadline} />
        </TableCell>
        <TableCell>
          <ProgressCell row={row} />
        </TableCell>
        <TableCell className="text-sm text-muted-foreground tabular-nums">{formatRelative(row.last_activity_at)}</TableCell>
        <TableCell>{menu}</TableCell>
      </TableRow>
    )

  return (
    <li>
      <Card size="sm" interactive className="relative gap-2 px-4">
        <div className="flex items-start gap-2">
          <div className="min-w-0 flex-1">
            <NameCell row={row} name={name} href={href} stretched />
          </div>
          <div className="relative z-10">{menu}</div>
        </div>
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
          <StageCell stage={move.stage} outcome={move.outcome} />
          <DeadlineCell deadline={row.deadline} />
        </div>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <ProgressCell row={row} />
          <span className="text-sm text-muted-foreground tabular-nums">{formatRelative(row.last_activity_at)}</span>
        </div>
      </Card>
    </li>
  )
}

function RowMenu({ name, controller, onOpen, onDelete }: { name: string; controller: StageMoveController; onOpen: () => void; onDelete: () => void }) {
  return (
    <StageCardMenu
      controller={controller}
      label={`${name} 메뉴`} // UQ-124: which 기업 JD
      extraItems={
        <>
          <DropdownMenuItem onSelect={onOpen}>기업 JD 열기</DropdownMenuItem>
          <DropdownMenuItem variant="destructive" onSelect={onDelete}>
            삭제
          </DropdownMenuItem>
        </>
      }
    />
  )
}

function NameCell({ row, name, href, stretched }: { row: ApplicationListRow; name: string; href: string; stretched?: boolean }) {
  const jd = row.job_description
  const analyzing = jd?.extraction_status === "running"
  // v5 (D-30): JD registered without a key — requirements not organised yet (no job)
  const notOrganised = jd?.extraction_status === "pending"
  return (
    <div className="min-w-0 space-y-0.5">
      <Link
        href={href}
        onClick={(e) => e.stopPropagation()}
        className={cn(
          "block truncate font-medium hover:underline focus-visible:rounded-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
          !row.name && "text-muted-foreground",
          stretched && "after:absolute after:inset-0",
        )}
        title={name}
      >
        {name}
      </Link>
      {notOrganised ? (
        // [UI-가정] S-13 행의 "요건 정리 전" 표시 (S-31 요건 상태와 같은 말)
        <span className="text-sm text-muted-foreground">요건 정리 전</span>
      ) : analyzing ? (
        // [UI-가정] 목록에서 추출 대기 표시. C-03 prepare 문구를 쓴다 (S-15·S-31과 같음).
        // Q-18: 02 "공고 요건 정리 중" ↔ 03 AI-01 "공고를 분석하고 있어요" 미결
        <span className="text-sm text-muted-foreground">{AI_STAGE_LABELS.prepare}</span>
      ) : jd?.company_name || jd?.position_title ? (
        <p className="truncate text-sm text-muted-foreground">{[jd.company_name, jd.position_title].filter(Boolean).join(" · ")}</p>
      ) : null}
    </div>
  )
}

function StageCell({ stage, outcome }: { stage: ApplicationStage; outcome: ApplicationSummary["stage_outcome"] }) {
  return (
    <span className="inline-flex flex-wrap items-center gap-2 text-sm">
      <StageLabel stage={stage} />
      {stage === "closed" ? <OutcomeBadge outcome={outcome} /> : null}
    </span>
  )
}

function DeadlineCell({ deadline }: { deadline: string | null }) {
  if (!deadline) return <span className="text-sm text-muted-foreground">—</span>
  return (
    <span className="inline-flex items-center gap-2 text-sm">
      <DDay deadline={deadline} />
      <span className="text-muted-foreground tabular-nums">{formatDate(deadline)}</span>
    </span>
  )
}

/**
 * 기능 진행: 인사이트(없음/생성 중/있음) · 서류 초안 수 · 면접 세션 수·작성 중.
 * v5.3 C-03 진행 표시 우선순위 (AiFeatureStatus): 작업이 대기·실행 중이면 이전 결과가 있어도 "생성 중"(C-03
 * 축약형, live), 아니면 있음 / 없음 + 결과보다 늦게 끝난 실패 한 줄(버튼 없음, G-30).
 */
function ProgressCell({ row }: { row: ApplicationListRow }) {
  const insight = row.insight_status
  const interview = row.interview_status
  return (
    <span className="flex flex-wrap items-center gap-3 text-sm">
      {insight.kind === "generating" && row.insight_job_id ? (
        // A3 UQ-74: only the AI-02 job (재생성 중 포함), polled live
        <span onClick={(e) => e.stopPropagation()}>
          <span className="sr-only">인사이트</span>
          <JobInline jobId={row.insight_job_id} />
        </span>
      ) : (
        <span className={cn("inline-flex items-start gap-1", insight.kind === "none" && "text-muted-foreground/70")}>
          <Lightbulb className="mt-0.5 size-3.5 shrink-0" aria-hidden />
          <span className="sr-only">인사이트</span>
          <AiFeatureStatus status={insight}>
            <span>있음</span>
          </AiFeatureStatus>
        </span>
      )}
      <span className="inline-flex items-center gap-1 tabular-nums">
        <FileText className="size-3.5" aria-hidden />
        <span className="sr-only">서류 초안</span>
        {row.draft_count}
      </span>
      <span className="inline-flex flex-wrap items-center gap-1 tabular-nums">
        <MessagesSquare className="size-3.5" aria-hidden />
        <span className="sr-only">면접 세션</span>
        {row.interview_session_count}
        {row.in_progress_session ? (
          <Badge variant="draft" className="ml-1">
            작성 중
          </Badge>
        ) : null}
        {interview.kind === "generating" ? (
          <AiProgressInline progress={interview.progress} jobType={interview.job_type} className="ml-1" />
        ) : interview.failure ? (
          <AiFeatureFailureLine failure={interview.failure} />
        ) : null}
      </span>
    </span>
  )
}
