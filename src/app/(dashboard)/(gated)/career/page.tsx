import { ScreenSuspense } from "@/components/common/screen-suspense"
import { PageCrumbs } from "@/components/common/shell/breadcrumbs"
import { getPreviewState } from "@/lib/preview-state"
import { getCareerTree, type CareerTree } from "@/lib/data/career"
import { CareerOverview } from "@/components/career/career-overview"
import { careerPreviewView } from "@/components/career/screen-state"

// S-08 커리어 (v5.5 2단: 목록 + 상세). ?state= empty | loading | error | unauth | not-found
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
  const preview = careerPreviewView(state, "split")
  let tree: CareerTree | null = null
  if (!preview) {
    tree = await getCareerTree()
    if (state === "empty") tree = { ...tree, years: [], undated_projects: [], undated_entries: [], active_writing_chats: [], is_empty: true }
  }
  return (
    <>
      <PageCrumbs items={[{ label: "커리어" }]} />
      {preview ?? (tree ? <CareerOverview tree={tree} /> : null)}
    </>
  )
}
