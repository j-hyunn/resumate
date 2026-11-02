import { notFound } from "next/navigation"
import { ScreenSuspense } from "@/components/common/screen-suspense"
import { PageCrumbs } from "@/components/common/shell/breadcrumbs"
import { getPreviewState } from "@/lib/preview-state"
import { getEducation } from "@/lib/data/career"
import { routes } from "@/lib/routes"
import { EducationForm } from "@/components/career/education-form"
import { careerPreviewView } from "@/components/career/screen-state"

// S-34 교육 편집
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
  const state = getPreviewState(await searchParams)
  const preview = careerPreviewView(state)
  const row = preview ? null : await getEducation(id)
  if (!preview && !row) notFound()
  return (
    <>
      <PageCrumbs items={[{ label: "커리어", href: routes.career() }, { label: row?.institution_name ?? "교육" }]} />
      {preview ?? (row ? <EducationForm key={`${row.id}-${row.updated_at}`} education={row} /> : null)}
    </>
  )
}
