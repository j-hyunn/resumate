import { redirect } from "next/navigation"
import { ScreenSuspense } from "@/components/common/screen-suspense"
import { ErrorState } from "@/components/common/state-views"
import { PageShellSkeleton } from "@/components/common/shell/page-shell-skeleton"
import { RelatedRequirement } from "@/components/career/related-requirement"
import { ProjectPage } from "@/components/career/project-page/project-page"
import { getPreviewState } from "@/lib/preview-state"
import { getNewProjectPage, getProjectPage } from "@/lib/data/career-v45"
import { routes } from "@/lib/routes"
import { parseFocus } from "../_focus"

/**
 * S-10 프로젝트 상세 (UX v5.6 S-10, L-02). `?chat=` = the open panel chat, `?focus=` = a STAR 칸 or `star`
 * (C-09 project_star), `?requirement_id=` = S-16 관련 요건. A standalone project id → S-08 `?item=project:` (S-43).
 * `?state=` (dev): loading · new · dirty · invalid · saving · save-failed · stale · skipped · not-found · standalone ·
 * ai-locked · key-invalid · consent-required · chat-closed · chat-closed-other-tab · invalid-form-snapshot ·
 * ai-stream · needs-review · empty · ai-failed* · return-banner (PAGE_PREVIEW_STATES, career-v45.ts).
 */
type Props = { params: Promise<{ id: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> }
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v)

export default function Page({ params, searchParams }: Props) {
  return (
    <ScreenSuspense fallback={<PageShellSkeleton />}>
      <Screen params={params} searchParams={searchParams} />
    </ScreenSuspense>
  )
}

async function Screen({ params, searchParams }: Props) {
  const { id } = await params
  const sp = await searchParams
  const state = getPreviewState(sp)
  if (state === "loading") return <PageShellSkeleton />
  const load = await getProjectPage(id, { chatId: one(sp.chat) ?? null, previewState: state })
  if (load.kind === "standalone") redirect(routes.careerItem("project", load.project_id))
  if (load.kind !== "ok") return <ErrorState kind="not-found" inShell={false} />
  let data = load.data
  // `?state=new` on an existing id: preview the new-page variant of the same affiliation
  if (state === "new") {
    const fresh = await getNewProjectPage({ [data.parent.type]: data.parent.id }, { previewState: state })
    if (fresh.kind === "ok") data = fresh.data
  }
  const requirementId = one(sp.requirement_id)
  return (
    <ProjectPage
      key={data.project_id ?? "new"}
      data={data}
      initialFocus={parseFocus(one(sp.focus))}
      requirementNotice={requirementId ? <RelatedRequirement requirementId={requirementId} /> : null}
    />
  )
}
