import { ScreenSuspense } from "@/components/common/screen-suspense"
import { PageShellSkeleton } from "@/components/common/shell/page-shell-skeleton"
import { RelatedRequirement } from "@/components/career/related-requirement"
import { ProjectPage } from "@/components/career/project-page/project-page"
import { RedirectNotice } from "@/components/career/project-page/redirect-notice"
import { getPreviewState } from "@/lib/preview-state"
import { getNewProjectPage } from "@/lib/data/career-v45"
import { routes } from "@/lib/routes"

/**
 * S-10 새 프로젝트 (UX v5.6 S-10 URL [가정]): `?experience={id}` | `?education={id}` (legacy `experience_id` /
 * `education_id` accepted). No row until the first "저장하기" / first AI message. An unknown, foreign or missing
 * affiliation → S-08 + toast "찾을 수 없는 항목이에요" [가정]. `?requirement_id=` = S-16 관련 요건.
 */
type Props = { searchParams: Promise<Record<string, string | string[] | undefined>> }
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v)

export default function Page({ searchParams }: Props) {
  return (
    <ScreenSuspense fallback={<PageShellSkeleton />}>
      <Screen searchParams={searchParams} />
    </ScreenSuspense>
  )
}

async function Screen({ searchParams }: Props) {
  const sp = await searchParams
  const state = getPreviewState(sp)
  if (state === "loading") return <PageShellSkeleton />
  const experience = one(sp.experience) ?? one(sp.experience_id) ?? null
  const education = experience ? null : (one(sp.education) ?? one(sp.education_id) ?? null)
  const load = state === "not-found" ? ({ kind: "not_found" } as const) : await getNewProjectPage({ experience, education }, { previewState: state })
  if (load.kind !== "ok") return <RedirectNotice href={routes.career()} message="찾을 수 없는 항목이에요" />
  const requirementId = one(sp.requirement_id)
  return (
    <ProjectPage
      data={load.data}
      requirementNotice={requirementId ? <RelatedRequirement requirementId={requirementId} /> : null}
    />
  )
}
