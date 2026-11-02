import { ScreenSuspense } from "@/components/common/screen-suspense"
import { PageCrumbs } from "@/components/common/shell/breadcrumbs"
import { getPreviewState } from "@/lib/preview-state"
import { getCareerTree, type CareerTree } from "@/lib/data/career"
import { listAbandonedWritingChats } from "@/lib/data/writing-chats"
import type { WritingChat } from "@/types/db"
import { CareerTreeScreen } from "@/components/career/career-tree"
import { careerPreviewView } from "@/components/career/screen-state"

// S-08 커리어 (기본 첫 화면). ?state= empty | loading | error | unauth | not-found
type Props = { params: Promise<Record<string, never>>; searchParams: Promise<Record<string, string | string[] | undefined>> }

/** request time for relative labels (server render, after connection()) */
function requestTime(): number {
  return Date.now()
}

export default function Page({ params, searchParams }: Props) {
  return (
    <ScreenSuspense>
      <Screen params={params} searchParams={searchParams} />
    </ScreenSuspense>
  )
}

async function Screen({ searchParams }: Props) {
  const state = getPreviewState(await searchParams)
  const preview = careerPreviewView(state, "list")
  let tree: CareerTree | null = null
  let abandoned: WritingChat[] = []
  if (!preview) {
    // v5.3 A6: "그만둔 대화 N개" (abandoned, not yet auto-cleaned)
    ;[tree, abandoned] = await Promise.all([getCareerTree(), listAbandonedWritingChats()])
    if (state === "empty") {
      tree = { ...tree, years: [], undated_projects: [], active_writing_chats: [], is_empty: true }
      abandoned = []
    }
  }
  return (
    <>
      <PageCrumbs items={[{ label: "커리어" }]} />
      {preview ?? (tree ? <CareerTreeScreen tree={tree} abandonedChats={abandoned} now={requestTime()} /> : null)}
    </>
  )
}
