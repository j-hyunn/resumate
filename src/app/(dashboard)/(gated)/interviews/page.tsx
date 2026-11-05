import { ScreenSuspense } from "@/components/common/screen-suspense"
import { PageHeader } from "@/components/common/basics"
import { ErrorState, ListSkeleton } from "@/components/common/state-views"
import { PageCrumbs } from "@/components/common/shell/breadcrumbs"
import { InterviewsOverview } from "@/components/interviews/interviews-overview"
import { listApplicationProjects } from "@/lib/data/applications"
import { listInterviewSessions } from "@/lib/data/interviews"
import { getLatestJobFor } from "@/lib/data/ai-jobs"
import { getPreviewState } from "@/lib/preview-state"

/**
 * S-37 모의 면접 (전체 세션).
 * ?state=: loading · error · unauth · empty (세션 없음) · no-jd (자기소개서 없음) · BYOK: ai-locked (새 면접 →
 * C-18 inline, 목록 열람 그대로) · key-invalid (새 면접 → C-20 key_invalid) · key-check (주의 배지)
 */
type Props = {
  params: Promise<Record<string, never>>
  searchParams: Promise<Record<string, string | string[] | undefined>>
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
  const crumbs = <PageCrumbs items={[{ label: "모의 면접" }]} />

  if (state === "loading")
    return (
      <div className="mx-auto max-w-6xl space-y-8">
        {crumbs}
        <PageHeader title="모의 면접" />
        <ListSkeleton rows={5} />
      </div>
    )
  if (state === "error" || state === "unauth")
    return (
      <div className="mx-auto max-w-6xl">
        {crumbs}
        <ErrorState kind={state === "unauth" ? "unauth" : "error"} />
      </div>
    )

  const [sessions, applications] = await Promise.all([listInterviewSessions(), listApplicationProjects()])
  // UQ-558: 채점 실패 행의 retry_after (rate_limited / provider_unavailable) → 메뉴 다시 채점 비활성
  const retryAfter: Record<string, string> = {}
  for (const s of sessions.filter((x) => x.status === "evaluation_failed")) {
    const job = await getLatestJobFor("interview_session", s.id, { jobType: "interview_evaluation", sessionWide: true })
    if (job?.retry_after && (job.error_code === "rate_limited" || job.error_code === "provider_unavailable")) retryAfter[s.id] = job.retry_after
  }
  return (
    <>
      {crumbs}
      <InterviewsOverview
        sessions={state === "empty" || state === "no-jd" ? [] : sessions}
        applications={state === "no-jd" ? [] : applications}
        retryAfter={retryAfter}
      />
    </>
  )
}
