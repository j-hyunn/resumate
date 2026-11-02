import { notFound } from "next/navigation"
import { ScreenSuspense } from "@/components/common/screen-suspense"
import { PageCrumbs } from "@/components/common/shell/breadcrumbs"
import { getPreviewState } from "@/lib/preview-state"
import { getProjectDetail } from "@/lib/data/career"
import { routes } from "@/lib/routes"
import type { ProjectDetailField } from "@/types/db"
import { DetailForm } from "@/components/career/detail-form"
import { careerPreviewView } from "@/components/career/screen-state"

// S-35 상세 내용 편집. ?focus={STAR 필드} (C-02 "원본으로 이동")
type Props = {
  params: Promise<{ id: string; detailId: string }>
  searchParams: Promise<Record<string, string | string[] | undefined>>
}

const FIELDS: ProjectDetailField[] = ["title", "situation", "task", "action", "result", "learnings"]

export default function Page({ params, searchParams }: Props) {
  return (
    <ScreenSuspense>
      <Screen params={params} searchParams={searchParams} />
    </ScreenSuspense>
  )
}

async function Screen({ params, searchParams }: Props) {
  const { id, detailId } = await params
  const sp = await searchParams
  const state = getPreviewState(sp)
  const preview = careerPreviewView(state)
  const data = preview ? null : await getProjectDetail(id, detailId)
  if (!preview && !data) notFound()
  const focusRaw = Array.isArray(sp.focus) ? sp.focus[0] : sp.focus
  const focus = FIELDS.includes(focusRaw as ProjectDetailField) ? (focusRaw as ProjectDetailField) : null
  const achievementId = Array.isArray(sp.achievement) ? sp.achievement[0] : sp.achievement
  return (
    <>
      <PageCrumbs
        items={[
          { label: "커리어", href: routes.career() },
          { label: data?.project.name ?? "프로젝트", href: routes.project(id) },
          { label: data?.detail.title ?? "상세 내용" },
        ]}
      />
      {preview ??
        (data ? (
          <DetailForm key={`${data.detail.id}-${data.detail.updated_at}`} project={data.project} detail={data.detail} focus={focus} openAchievementId={achievementId ?? null} />
        ) : null)}
    </>
  )
}
