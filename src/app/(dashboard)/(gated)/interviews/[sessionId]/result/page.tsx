import { notFound, redirect } from "next/navigation"
import { ScreenSuspense } from "@/components/common/screen-suspense"
import { ResultScreen } from "@/components/interviews/result-screen"
import { getInterviewSessionLocation } from "@/lib/data/interviews"
import { getPreviewState, withPreviewState } from "@/lib/preview-state"
import { routes } from "@/lib/routes"

/**
 * S-22 면접 결과 of a "자기소개서 삭제됨" session (OD-I6, U36-1): under the 모의 면접 menu (L-01), same content as
 * S-22 read-only. Such a session has no S-33 / S-20 address. A session whose 자기소개서 still exists is redirected to
 * its normal S-22 (`/applications/{id}/interview/{sessionId}/result`).
 * ?state=: the S-22 values (components/interviews/result-screen.tsx), e.g. loading · error · not-found.
 */
type Props = {
  params: Promise<{ sessionId: string }>
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
  const { sessionId } = await params
  const state = getPreviewState(await searchParams)
  if (state === "not-found") notFound()
  const location = await getInterviewSessionLocation(sessionId)
  if (!location) notFound()
  if (location.application_project_id !== null)
    redirect(withPreviewState(routes.interviewResult(location.application_project_id, sessionId), state))
  return <ResultScreen applicationProjectId={null} sessionId={sessionId} state={state} />
}
