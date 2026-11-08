import Link from "next/link"
import { notFound } from "next/navigation"
import { Briefcase, KanbanSquare, Plus } from "lucide-react"
import { Button } from "@/components/ui/button"
import { ScreenSuspense } from "@/components/common/screen-suspense"
import { PageHeader } from "@/components/common/basics"
import { EmptyState, ErrorState, ListSkeleton } from "@/components/common/state-views"
import { PageCrumbs } from "@/components/common/shell/breadcrumbs"
import { ApplicationFilters, ApplicationList } from "@/components/applications/application-list"
import { AutoRefresh } from "@/components/applications/shared"
import { getPreviewState } from "@/lib/preview-state"
import { STAGE_ORDER } from "@/lib/data/labels"
import { routes } from "@/lib/routes"
import type { ApplicationStage } from "@/types/db"
import { listApplicationProjects as listApplicationsForScreen } from "@/lib/data/applications"

// S-13 자기소개서 목록 (메뉴: 자기소개서 관리). ?state=: empty · loading · error · not-found · move-failed
type Props = { params: Promise<Record<string, never>>; searchParams: Promise<Record<string, string | string[] | undefined>> }

export default function Page({ params, searchParams }: Props) {
  return (
    <ScreenSuspense>
      <Screen params={params} searchParams={searchParams} />
    </ScreenSuspense>
  )
}

function one(v: string | string[] | undefined) {
  return Array.isArray(v) ? v[0] : v
}

async function Screen({ searchParams }: Props) {
  const sp = await searchParams
  const state = getPreviewState(sp)
  if (state === "not-found") notFound()
  const sort = one(sp.sort) === "deadline" ? "deadline" : "last_activity"
  const stageParam = one(sp.stage)
  const stage = STAGE_ORDER.includes(stageParam as ApplicationStage) ? (stageParam as ApplicationStage) : null

  const header = (
    <PageHeader
      title="자기소개서 관리"
      actions={
        <>
          <Button variant="outline" asChild>
            <Link href={routes.board()}>
              <KanbanSquare aria-hidden />
              보드로 보기
            </Link>
          </Button>
          <Button asChild>
            <Link href={routes.applicationNew()}>
              <Plus aria-hidden />
              자기소개서 추가
            </Link>
          </Button>
        </>
      }
    />
  )

  const body = await (async () => {
    if (state === "loading") return <ListSkeleton rows={5} />
    if (state === "error") return <ErrorState kind="error" />
    if (state === "unauth") return <ErrorState kind="unauth" />
    const all = state === "empty" ? [] : await listApplicationsForScreen({ sort })
    if (all.length === 0)
      return (
        <EmptyState
          icon={Briefcase}
          title="아직 자기소개서가 없어요"
          description="지원하려는 공고를 붙여넣어 첫 자기소개서를 추가해 보세요. 커리어 정리 전에도 추가할 수 있어요"
          actions={
            <Button asChild>
              <Link href={routes.applicationNew()}>
                <Plus aria-hidden />
                자기소개서 추가
              </Link>
            </Button>
          }
        />
      )
    const rows = stage ? all.filter((r) => r.stage === stage) : all
    return (
      <div className="space-y-4">
        <ApplicationFilters sort={sort} stage={stage} />
        {/* v5.3 C-03: 작업 id 없는 인사이트 진행(축약형)은 서버 값 — 진행 중이면 다시 읽는다 */}
        <AutoRefresh active={rows.some((r) => r.insight_status.kind === "generating" && !r.insight_job_id)} />
        {rows.length === 0 ? (
          // [UI-가정] 필터 결과 없음 문구
          <p className="rounded-lg border border-dashed p-6 text-center text-muted-foreground">이 전형 단계의 자기소개서가 없어요</p>
        ) : (
          <ApplicationList rows={rows} failMove={state === "move-failed"} />
        )}
      </div>
    )
  })()

  return (
    <div className="mx-auto max-w-6xl space-y-8">
      <PageCrumbs items={[{ label: "자기소개서 관리" }]} />
      {header}
      {body}
    </div>
  )
}
