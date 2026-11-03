import { notFound } from "next/navigation"
import { ScreenSuspense } from "@/components/common/screen-suspense"
import { DevPageShellDemo } from "@/components/common/dev-page-shell-demo"
import { PageShellSkeleton } from "@/components/common/shell/page-shell-skeleton"
import { isPreviewEnabled, getPreviewState } from "@/lib/preview-state"
import { getDeliverablePage, getNewDeliverablePage, getNewProjectPage, getProjectPage } from "@/lib/data/career-v45"

/**
 * Dev-only L-02 foundation demo (A0, 404 in production). `/dev/` runs on the mock store.
 *   ?target=project (default) | deliverable   ?new=1   ?state=new|dirty|saving|save-failed|stale|ai-locked|
 *   chat-closed|ai-stream|draft-streaming|draft-ready|needs-review|empty|not-found|ai-failed*|loading
 */
type Props = { searchParams: Promise<Record<string, string | string[] | undefined>> }

const PROJECT = "00000000-0000-4e03-8000-000000000001"
const EXPERIENCE = "00000000-0000-4e01-8000-000000000001"
const STANDALONE = "00000000-0000-4e03-8000-000000000006"
const DELIVERABLE = "00000000-0000-4e07-8000-000000000001"

export default function Page({ searchParams }: Props) {
  if (!isPreviewEnabled) notFound()
  return (
    <ScreenSuspense fallback={<PageShellSkeleton />}>
      <Screen searchParams={searchParams} />
    </ScreenSuspense>
  )
}

async function Screen({ searchParams }: Props) {
  const sp = await searchParams
  const state = getPreviewState(sp)
  if (state === "loading") return <PageShellSkeleton />
  const deliverable = sp.target === "deliverable"
  const fresh = sp.new === "1" || state === "new"
  const load = deliverable
    ? fresh
      ? await getNewDeliverablePage(STANDALONE, { previewState: state })
      : await getDeliverablePage(DELIVERABLE, { previewState: state })
    : fresh
      ? await getNewProjectPage({ experience: EXPERIENCE }, { previewState: state })
      : await getProjectPage(PROJECT, { previewState: state })
  if (load.kind !== "ok") notFound()
  return <DevPageShellDemo data={load.data} />
}
