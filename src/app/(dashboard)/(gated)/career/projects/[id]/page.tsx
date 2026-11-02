import { notFound } from "next/navigation"
import { ScreenSuspense } from "@/components/common/screen-suspense"
import { PageCrumbs } from "@/components/common/shell/breadcrumbs"
import { getPreviewState } from "@/lib/preview-state"
import { getProject, listEducations, listExperiences } from "@/lib/data/career"
import { routes } from "@/lib/routes"
import { ProjectForm } from "@/components/career/project-form"
import { careerPreviewView } from "@/components/career/screen-state"
import { RelatedRequirement } from "@/components/career/related-requirement"

// S-10 프로젝트 편집. ?focus=fields(&application_project_id=) = C-09 project_fields 도착 (A18)
type Props = { params: Promise<{ id: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> }

export default function Page({ params, searchParams }: Props) {
  return (
    <ScreenSuspense>
      <Screen params={params} searchParams={searchParams} />
    </ScreenSuspense>
  )
}

async function Screen({ params, searchParams }: Props) {
  const { id } = await params
  const sp = await searchParams
  const state = getPreviewState(sp)
  const requirementId = Array.isArray(sp.requirement_id) ? sp.requirement_id[0] : sp.requirement_id
  // v5.3 A18: from C-09 hint project_fields → focus + highlight the empty name / role
  const focusFields = (Array.isArray(sp.focus) ? sp.focus[0] : sp.focus) === "fields"
  const applicationProjectId = Array.isArray(sp.application_project_id) ? sp.application_project_id[0] : sp.application_project_id
  const preview = careerPreviewView(state)
  const [row, experiences, educations] = preview
    ? [null, [], []]
    : await Promise.all([getProject(id), listExperiences(), listEducations()])
  if (!preview && !row) notFound()
  return (
    <>
      <PageCrumbs items={[{ label: "커리어", href: routes.career() }, { label: row?.name ?? "프로젝트" }]} />
      {preview ? null : <RelatedRequirement requirementId={requirementId} />}
      {preview ??
        (row ? (
          <ProjectForm
            key={`${row.id}-${row.updated_at}`}
            project={row}
            experiences={experiences}
            educations={educations}
            focusFields={focusFields ? { applicationProjectId: applicationProjectId ?? null } : null}
          />
        ) : null)}
    </>
  )
}
