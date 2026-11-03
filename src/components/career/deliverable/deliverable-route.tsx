import { ScreenSuspense } from "@/components/common/screen-suspense"
import { ErrorState } from "@/components/common/state-views"
import { PageShellSkeleton } from "@/components/common/shell/page-shell-skeleton"
import { getPreviewState } from "@/lib/preview-state"
import { getDeliverablePage, getNewDeliverablePage } from "@/lib/data/career-v45"
import { parseRangeParam, routes } from "@/lib/routes"
import { AffiliatedRedirect } from "./affiliated-redirect"
import { DeliverablePage } from "./deliverable-page"

/**
 * S-44 route body (both URLs): `/career/deliverables/{id}` (기존, `?chat=`, C-02 `?range={start}-{end}`) and
 * `/career/projects/{project_id}/deliverables/new` (새 산출물). `?state=` = PAGE_PREVIEW_STATES + `loading`.
 */
type SearchParams = Record<string, string | string[] | undefined>
export type DeliverableRouteTarget = { kind: "existing"; id: string } | { kind: "new"; projectId: string }

export function DeliverableRoute({ target, searchParams }: { target: Promise<DeliverableRouteTarget>; searchParams: Promise<SearchParams> }) {
  return (
    <ScreenSuspense fallback={<PageShellSkeleton />}>
      <Screen target={target} searchParams={searchParams} />
    </ScreenSuspense>
  )
}

async function Screen({ target, searchParams }: { target: Promise<DeliverableRouteTarget>; searchParams: Promise<SearchParams> }) {
  const [t, sp] = await Promise.all([target, searchParams])
  const state = getPreviewState(sp)
  if (state === "loading") return <PageShellSkeleton />
  const chat = typeof sp.chat === "string" ? sp.chat : null
  const load = t.kind === "existing" ? await getDeliverablePage(t.id, { chatId: chat, previewState: state }) : await getNewDeliverablePage(t.projectId, { previewState: state })
  if (load.kind === "affiliated") return <AffiliatedRedirect href={routes.projectPage(load.project_id)} />
  // ST-NOTFOUND (셸 밖) → "커리어로 가기"
  if (load.kind !== "ok") return <ErrorState kind="not-found" inShell={false} />
  return <DeliverablePage key={load.data.project_deliverable_id ?? `new:${load.data.project.id}`} data={load.data} range={t.kind === "existing" ? parseRangeParam(sp.range) : null} />
}
