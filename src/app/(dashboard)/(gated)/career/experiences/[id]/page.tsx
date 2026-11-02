import { notFound } from "next/navigation"
import { ScreenSuspense } from "@/components/common/screen-suspense"
import { PageCrumbs } from "@/components/common/shell/breadcrumbs"
import { getPreviewState } from "@/lib/preview-state"
import { getExperience } from "@/lib/data/career"
import { routes } from "@/lib/routes"
import { ExperienceForm } from "@/components/career/experience-form"
import { careerPreviewView } from "@/components/career/screen-state"

// S-09 경력 편집
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
  const achievementId = Array.isArray(sp.achievement) ? sp.achievement[0] : sp.achievement
  const preview = careerPreviewView(state)
  const row = preview ? null : await getExperience(id)
  if (!preview && !row) notFound()
  return (
    <>
      <PageCrumbs items={[{ label: "커리어", href: routes.career() }, { label: row?.company_name ?? "경력" }]} />
      {preview ?? (row ? <ExperienceForm key={`${row.id}-${row.updated_at}`} experience={row} openAchievementId={achievementId ?? null} /> : null)}
    </>
  )
}
