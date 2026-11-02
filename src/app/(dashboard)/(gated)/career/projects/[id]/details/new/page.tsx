import { notFound } from "next/navigation"
import { ScreenSuspense } from "@/components/common/screen-suspense"
import { PageCrumbs } from "@/components/common/shell/breadcrumbs"
import { getPreviewState } from "@/lib/preview-state"
import { getProject } from "@/lib/data/career"
import { routes } from "@/lib/routes"
import { DetailForm } from "@/components/career/detail-form"
import { FreshKey } from "@/components/career/fresh-key"
import { careerPreviewView } from "@/components/career/screen-state"

// S-35 상세 내용 편집 (신규)
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
  const project = preview ? null : await getProject(id)
  if (!preview && !project) notFound()
  return (
    <>
      <PageCrumbs
        items={[
          { label: "커리어", href: routes.career() },
          { label: project?.name ?? "프로젝트", href: routes.project(id) },
          { label: "새 상세 내용" },
        ]}
      />
      {preview ??
        (project ? (
          <FreshKey>
            <DetailForm project={project} detail={null} />
          </FreshKey>
        ) : null)}
    </>
  )
}
