import { ScreenSuspense } from "@/components/common/screen-suspense"
import { PageCrumbs } from "@/components/common/shell/breadcrumbs"
import { getPreviewState } from "@/lib/preview-state"
import { getCareerTree, type CareerTree } from "@/lib/data/career"
import { listProjectDeliverables } from "@/lib/data/career-v45"
import { CareerOverview, type DeliverableLists } from "@/components/career/career-overview"
import { careerPreviewView } from "@/components/career/screen-state"

// S-08 커리어 (v5.5 2단: 목록 + 상세). ?state= empty | loading | error | unauth | not-found | deliverable-limit (S-43 산출물 50개)
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
  const deliverables: DeliverableLists = {}
  if (!preview) {
    tree = await getCareerTree()
    if (state === "empty") tree = { ...tree, years: [], undated_projects: [], undated_entries: [], active_writing_chats: [], is_empty: true }
    // S-43 산출물 섹션: one read per standalone project (v5.6)
    const standalone = [...new Set([...tree.years.flatMap((y) => y.other_projects), ...tree.undated_projects].map((p) => p.id))]
    const lists = await Promise.all(standalone.map((id) => listProjectDeliverables(id, { previewState: state }).catch(() => null)))
    standalone.forEach((id, i) => (deliverables[id] = lists[i]))
  }
  return (
    <>
      <PageCrumbs items={[{ label: "커리어" }]} />
      {preview ?? (tree ? <CareerOverview tree={tree} deliverables={deliverables} /> : null)}
    </>
  )
}
