/**
 * Temporary placeholder for area screens (A1–A4 replace the route files that use it).
 * Supports the shared ?state= values that need no screen data, so links and ST views
 * can be checked end to end before the area lands.
 */
import { notFound } from "next/navigation"
import { Card } from "@/components/ui/card"
import { PageHeader } from "./basics"
import { EmptyState, ErrorState, PageSkeleton } from "./state-views"
import { PageCrumbs, type Crumb } from "./shell/breadcrumbs"
import { getPreviewState } from "@/lib/preview-state"

export function PlaceholderScreen({
  screenId,
  title,
  area,
  crumbs,
  applicationProjectId,
  searchParams,
}: {
  screenId: string
  title: string
  area: "A1" | "A2" | "A3" | "A4"
  crumbs?: Crumb[]
  applicationProjectId?: string
  /** already-awaited searchParams (the page awaits inside its <ScreenSuspense>) */
  searchParams?: Record<string, string | string[] | undefined>
}) {
  const state = getPreviewState(searchParams ?? null)
  if (state === "not-found") notFound()
  return (
    <div className="mx-auto max-w-6xl space-y-8">
      {crumbs ? <PageCrumbs items={crumbs} applicationProjectId={applicationProjectId} /> : null}
      {state === "loading" ? (
        <PageSkeleton />
      ) : state === "unauth" ? (
        <ErrorState kind="unauth" />
      ) : state === "error" ? (
        <ErrorState kind="error" />
      ) : (
        <>
          <PageHeader title={title} description={`${screenId} · 영역 ${area}에서 구현 예정`} />
          {state === "empty" ? (
            <EmptyState title="빈 상태 미리보기" description="이 화면의 빈 상태 문구는 영역 구현 때 채워져요." />
          ) : (
            <Card className="p-5 text-muted-foreground">
              준비 중인 화면이에요. 라우트와 셸 연결 확인용 자리 표시입니다. 공통 상태(C-03·C-04·C-09·C-18~C-21 등)는{" "}
              <code>/dev/states</code>(개발 모드)에서 확인할 수 있어요.
            </Card>
          )}
        </>
      )}
    </div>
  )
}
