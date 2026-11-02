import { ScreenSuspense } from "@/components/common/screen-suspense"
import { PageCrumbs } from "@/components/common/shell/breadcrumbs"
import { getPreviewState } from "@/lib/preview-state"
import { listEducations, listExperiences } from "@/lib/data/career"
import { routes } from "@/lib/routes"
import { ProjectForm } from "@/components/career/project-form"
import { FreshKey } from "@/components/career/fresh-key"
import { careerPreviewView } from "@/components/career/screen-state"
import { RelatedRequirement } from "@/components/career/related-requirement"

// S-10 프로젝트 편집 (신규). ?experience_id= / ?education_id= pre-selects the affiliation.
type Props = { params: Promise<Record<string, never>>; searchParams: Promise<Record<string, string | string[] | undefined>> }

function one(v: string | string[] | undefined): string | undefined {
  return Array.isArray(v) ? v[0] : v
}

export default function Page({ params, searchParams }: Props) {
  return (
    <ScreenSuspense>
      <Screen params={params} searchParams={searchParams} />
    </ScreenSuspense>
  )
}

async function Screen({ searchParams }: Props) {
  const sp = await searchParams
  const state = getPreviewState(sp)
  const preview = careerPreviewView(state)
  const [experiences, educations] = preview ? [[], []] : await Promise.all([listExperiences(), listEducations()])
  const experience_id = one(sp.experience_id)
  const education_id = one(sp.education_id)
  return (
    <>
      <PageCrumbs items={[{ label: "커리어", href: routes.career() }, { label: "새 프로젝트" }]} />
      {preview ? null : <RelatedRequirement requirementId={one(sp.requirement_id)} />}
      {preview ?? (
        <FreshKey>
          <ProjectForm
            project={null}
            experiences={experiences}
            educations={educations}
            initialAffiliation={{
              experience_id: experiences.some((e) => e.id === experience_id) ? experience_id : undefined,
              education_id: educations.some((e) => e.id === education_id) ? education_id : undefined,
            }}
          />
        </FreshKey>
      )}
    </>
  )
}
