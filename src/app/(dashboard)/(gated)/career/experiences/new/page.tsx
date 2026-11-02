import { ScreenSuspense } from "@/components/common/screen-suspense"
import { PageCrumbs } from "@/components/common/shell/breadcrumbs"
import { getPreviewState } from "@/lib/preview-state"
import { routes } from "@/lib/routes"
import { ExperienceForm } from "@/components/career/experience-form"
import { FreshKey } from "@/components/career/fresh-key"
import { careerPreviewView } from "@/components/career/screen-state"

// S-09 경력 편집 (신규)
type Props = { params: Promise<Record<string, never>>; searchParams: Promise<Record<string, string | string[] | undefined>> }

export default function Page({ params, searchParams }: Props) {
  return (
    <ScreenSuspense>
      <Screen params={params} searchParams={searchParams} />
    </ScreenSuspense>
  )
}

async function Screen({ searchParams }: Props) {
  const state = getPreviewState(await searchParams)
  return (
    <>
      <PageCrumbs items={[{ label: "커리어", href: routes.career() }, { label: "새 경력" }]} />
      {careerPreviewView(state) ?? (
        <FreshKey>
          <ExperienceForm experience={null} />
        </FreshKey>
      )}
    </>
  )
}
