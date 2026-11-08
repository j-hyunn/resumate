import Link from "next/link"
import { KanbanSquare, Plus } from "lucide-react"
import { ScreenSuspense } from "@/components/common/screen-suspense"
import { PageHeader } from "@/components/common/basics"
import { EmptyState, ErrorState } from "@/components/common/state-views"
import { PageCrumbs } from "@/components/common/shell/breadcrumbs"
import { Button } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"
import { KanbanBoard, type BoardData } from "@/components/board/kanban-board"
import { getBoard } from "@/lib/data/applications"
import { STAGE_ORDER } from "@/lib/data/labels"
import { getPreviewState } from "@/lib/preview-state"
import { routes } from "@/lib/routes"

/**
 * S-39 지원 현황 보드 — 4열 (v5.19, RM-2: C-14 팝업 없음, 보드에 AI 잠금 상태 없음).
 * ?state=: loading · error · unauth · empty · move-failed (모든 이동이 실패 → 원위치 + 토스트)
 */
type Props = {
  params: Promise<Record<string, never>>
  searchParams: Promise<Record<string, string | string[] | undefined>>
}

export default function Page({ params, searchParams }: Props) {
  return (
    <ScreenSuspense>
      <Screen params={params} searchParams={searchParams} />
    </ScreenSuspense>
  )
}

function BoardSkeleton() {
  return (
    <div className="flex gap-3 overflow-hidden" aria-hidden>
      {STAGE_ORDER.slice(0, 4).map((s) => (
        <div key={s} className="w-72 shrink-0 space-y-2 rounded-xl bg-muted/60 p-2">
          <Skeleton className="h-6 w-32" />
          <Skeleton className="h-24 w-full" />
          <Skeleton className="h-24 w-full" />
        </div>
      ))}
    </div>
  )
}

async function Screen({ searchParams }: Props) {
  const state = getPreviewState(await searchParams)
  const crumbs = <PageCrumbs items={[{ label: "지원 현황" }]} />
  const header = <PageHeader title="지원 현황" />

  if (state === "loading")
    return (
      <div className="space-y-6">
        {crumbs}
        {header}
        <BoardSkeleton />
      </div>
    )
  if (state === "error" || state === "unauth")
    return (
      <div>
        {crumbs}
        <ErrorState kind={state === "unauth" ? "unauth" : "error"} />
      </div>
    )

  const raw = await getBoard()
  const board: BoardData =
    state === "empty" ? (Object.fromEntries(STAGE_ORDER.map((s) => [s, []])) as unknown as BoardData) : raw
  const total = STAGE_ORDER.reduce((n, s) => n + board[s].length, 0)

  return (
    <div className="space-y-6">
      {crumbs}
      {header}
      {total === 0 ? (
        <EmptyState
          icon={KanbanSquare}
          title="자기소개서를 추가하면 여기서 전형 단계를 관리할 수 있어요"
          actions={
            <>
              <Button asChild className="max-md:h-8">
                <Link href={routes.applicationNew({ from: "board" })}>
                  <Plus aria-hidden />
                  자기소개서 추가
                </Link>
              </Button>
              <Button asChild variant="outline" className="max-md:h-8">
                <Link href={routes.applications()}>자기소개서 관리로</Link>
              </Button>
            </>
          }
        />
      ) : (
        <KanbanBoard board={board} failMove={state === "move-failed"} />
      )}
    </div>
  )
}

