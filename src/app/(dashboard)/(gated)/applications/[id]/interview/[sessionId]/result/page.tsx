import { notFound, redirect } from "next/navigation"
import { ScreenSuspense } from "@/components/common/screen-suspense"
import { ResultScreen } from "@/components/interviews/result-screen"
import { getInterviewSessionLocation } from "@/lib/data/interviews"
import { DELETED_APPLICATION_SEGMENT } from "@/lib/data/interview-session-view"
import { getPreviewState, withPreviewState } from "@/lib/preview-state"
import { routes } from "@/lib/routes"

/**
 * S-22 면접 결과 (`?state=` list: components/interviews/result-screen.tsx).
 * U36-1: a 자기소개서 삭제됨 session (the run 36 temporary `/applications/deleted/…` path, or the old 자기소개서's id)
 * → `/interviews/{sessionId}/result`.
 */
type Props = {
  params: Promise<{ id: string; sessionId: string }>
  searchParams: Promise<Record<string, string | string[] | undefined>>
}

export default function Page({ params, searchParams }: Props) {
  return (
    <ScreenSuspense>
      <Screen params={params} searchParams={searchParams} />
    </ScreenSuspense>
  )
}

async function Screen({ params, searchParams }: Props) {
  const { id, sessionId } = await params
  const state = getPreviewState(await searchParams)
  if (state === "not-found") notFound()
  if (id === DELETED_APPLICATION_SEGMENT || (await getInterviewSessionLocation(sessionId))?.application_project_id === null)
    redirect(withPreviewState(routes.interviewDeletedResult(sessionId), state))
  return <ResultScreen applicationProjectId={id} sessionId={sessionId} state={state} />
}
