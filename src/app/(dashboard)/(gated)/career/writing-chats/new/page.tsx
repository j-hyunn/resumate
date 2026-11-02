import { ScreenSuspense } from "@/components/common/screen-suspense"
import { PageCrumbs } from "@/components/common/shell/breadcrumbs"
import { getPreviewState } from "@/lib/preview-state"
import { getProject, listEducations, listExperiences } from "@/lib/data/career"
import { getDataReadiness, insufficientReadinessPreview } from "@/lib/data/readiness"
import { getApplicationProject } from "@/lib/data/applications"
import { applicationDisplayName } from "@/lib/data/labels"
import { routes } from "@/lib/routes"
import type { ReturnTargetFeature, WritingChatMode } from "@/types/db"
import { ChatStart } from "@/components/career/writing-chat/chat-start"
import { FreshKey } from "@/components/career/fresh-key"
import { careerPreviewView } from "@/components/career/screen-state"

// S-36 AI 작성 대화 — 시작 영역 (새 대화).
// ?mode=new_project|augment_project &project_id &experience_id &education_id
// &application_project_id &feature (C-09 게이트 진입). ?state= ai-locked | key-invalid | insufficient | loading | error
type Props = { params: Promise<Record<string, never>>; searchParams: Promise<Record<string, string | string[] | undefined>> }

const FEATURES: ReturnTargetFeature[] = ["insight", "career_description", "cover_letter", "job_interview"]
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
  const preview = careerPreviewView(state, "chat")
  const crumbs = <PageCrumbs items={[{ label: "커리어", href: routes.career() }, { label: "AI 작성 대화" }]} />
  if (preview)
    return (
      <>
        {crumbs}
        {preview}
      </>
    )
  const projectId = one(sp.project_id)
  const mode: WritingChatMode = one(sp.mode) === "augment_project" && projectId ? "augment_project" : "new_project"
  const apId = one(sp.application_project_id)
  const featureRaw = one(sp.feature) as ReturnTargetFeature | undefined
  const feature = featureRaw && FEATURES.includes(featureRaw) ? featureRaw : undefined
  const [project, experiences, educations, readinessBase, ap] = await Promise.all([
    mode === "augment_project" && projectId ? getProject(projectId) : Promise.resolve(null),
    listExperiences(),
    listEducations(),
    getDataReadiness(),
    apId && feature ? getApplicationProject(apId) : Promise.resolve(null),
  ])
  const readiness = state === "insufficient" ? insufficientReadinessPreview(readinessBase) : readinessBase
  const experienceId = one(sp.experience_id)
  const educationId = one(sp.education_id)
  return (
    <>
      {crumbs}
      <FreshKey>
        <ChatStart
          mode={mode}
          project={project}
          experiences={experiences.map((e) => ({ id: e.id, company_name: e.company_name }))}
          educations={educations.map((e) => ({ id: e.id, institution_name: e.institution_name }))}
          defaultExperienceId={experiences.some((e) => e.id === experienceId) ? experienceId : undefined}
          defaultEducationId={educations.some((e) => e.id === educationId) ? educationId : undefined}
          gate={
            ap && feature
              ? { application_project_id: ap.id, feature, application_name: applicationDisplayName(ap.name, ap.name_source, ap.created_at) }
              : null
          }
          readiness={readiness}
        />
      </FreshKey>
    </>
  )
}
