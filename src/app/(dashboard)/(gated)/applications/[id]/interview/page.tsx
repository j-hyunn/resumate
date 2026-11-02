import { notFound } from "next/navigation"
import { ScreenSuspense } from "@/components/common/screen-suspense"
import { PageHeader } from "@/components/common/basics"
import { ErrorState, FormSkeleton, ListSkeleton } from "@/components/common/state-views"
import { PageCrumbs } from "@/components/common/shell/breadcrumbs"
import { InterviewPrep } from "@/components/interviews/interview-prep"
import { SessionList } from "@/components/interviews/session-list"
import { getApplicationProject } from "@/lib/data/applications"
import { listInterviewSessions } from "@/lib/data/interviews"
import { getDataReadiness, insufficientReadinessPreview } from "@/lib/data/readiness"
import { listActiveWritingChats } from "@/lib/data/writing-chats"
import { getAiConnection } from "@/lib/data/ai-connection"
import { applicationDisplayName } from "@/lib/data/labels"
import { getPreviewState } from "@/lib/preview-state"
import { routes } from "@/lib/routes"
import type { InterviewType } from "@/types/db"

/**
 * S-20 면접 준비. `?type=job|culture_fit` pre-selects the interview type (C-14 → S-20).
 * ?state=: loading · error · unauth · not-found · empty · insufficient · insufficient-no-experience · insufficient-project-fields ·
 * ai-locked · key-invalid · key-check · wait-jd · from-board · consent-required ·
 * extract-failed (D-30 요건 추출 실패 → C-20 not_a_jd, 질문 생성 안 함) ·
 * failed-session / failed-session-partial (Q53-9 "그만두고 새로 시작" 배너). 미리보기는 세션을 만들지 않는다.
 * 질문 생성 실패·대기 줄은 S-33의 같은 ?state= 로 본다
 */
type Props = {
  params: Promise<{ id: string }>
  searchParams: Promise<Record<string, string | string[] | undefined>>
}

export default function Page({ params, searchParams }: Props) {
  return (
    <ScreenSuspense>
      <Screen params={params} searchParams={searchParams} />
    </ScreenSuspense>
  )
}

/** preview banner link target */
function sessionId(rows: Array<{ id: string }>): string {
  return rows[0]?.id ?? "preview"
}

function readType(value: string | string[] | undefined): InterviewType | null {
  const v = Array.isArray(value) ? value[0] : value
  return v === "job" || v === "culture_fit" ? v : null
}

async function Screen({ params, searchParams }: Props) {
  const { id } = await params
  const query = await searchParams
  const state = getPreviewState(query)
  if (state === "not-found") notFound()

  const ap = await getApplicationProject(id)
  if (!ap) notFound()
  const name = applicationDisplayName(ap.name, ap.name_source, ap.created_at)
  const crumbs = (
    <PageCrumbs
      items={[
        { label: "기업 JD 관리", href: routes.applications() },
        { label: name, href: routes.application(id) },
        { label: "면접 준비" },
      ]}
      applicationProjectId={id}
    />
  )

  if (state === "loading")
    return (
      <div className="mx-auto max-w-3xl space-y-8">
        {crumbs}
        <FormSkeleton fields={3} />
        <ListSkeleton rows={3} />
      </div>
    )
  if (state === "error" || state === "unauth")
    return (
      <div className="mx-auto max-w-3xl">
        {crumbs}
        <ErrorState kind={state === "unauth" ? "unauth" : "error"} />
      </div>
    )

  const [sessionsRaw, readinessRaw, activeChats, aiConnection] = await Promise.all([
    listInterviewSessions({ application_project_id: id }),
    getDataReadiness(),
    listActiveWritingChats(),
    getAiConnection(),
  ])
  const readiness =
    state === "insufficient" || state === "insufficient-no-experience" || state === "insufficient-project-fields"
      ? insufficientReadinessPreview(readinessRaw, {
          noExperience: state === "insufficient-no-experience",
          projectFields: state === "insufficient-project-fields",
        })
      : readinessRaw
  const sessions = state === "empty" ? [] : sessionsRaw
  const failedPreview = state === "failed-session" || state === "failed-session-partial"
  const inProgress =
    state === "empty"
      ? null
      : failedPreview
        ? {
            id: ap.in_progress_session?.id ?? sessionId(sessionsRaw),
            interview_type: ap.in_progress_session?.interview_type ?? ("job" as const),
            answered_count: 0,
            question_count: ap.in_progress_session?.question_count ?? (5 as const),
            last_activity_at: ap.in_progress_session?.last_activity_at ?? ap.last_activity_at,
            effective_generation_status: "failed" as const,
            saved_question_count: state === "failed-session-partial" ? 2 : 0,
          }
        : ap.in_progress_session
  // ST-WAIT-JD only while extraction is running; pending (saved without a key) / failed JDs are
  // extracted first when the user starts (D-30, FL-12 "요건 없으면 요건 추출 먼저")
  const extraction = ap.job_description?.extraction_status ?? "succeeded"
  const waitJd = state === "wait-jd" || extraction === "running"
  const needsExtraction = extraction === "pending" || extraction === "failed" || state === "extract-failed"

  return (
    <div className="mx-auto max-w-3xl space-y-8">
      {crumbs}
      <PageHeader title="면접 준비" description={name} />
      <InterviewPrep
        // remount when ?type= changes so the pre-selection follows the URL
        key={readType(query.type) ?? "none"}
        applicationProjectId={id}
        applicationName={name}
        initialType={readType(query.type)}
        inProgress={inProgress}
        readiness={readiness}
        activeChatId={activeChats[0]?.id ?? null}
        waitJd={waitJd}
        forceFromBoard={state === "from-board"}
        needsExtraction={needsExtraction}
        serverConnection={aiConnection}
        extractionFail={state === "extract-failed" ? "not_a_jd" : null}
      />
      <section className="space-y-3" aria-labelledby="prep-sessions-title">
        <h2 id="prep-sessions-title" className="text-lg leading-7 font-semibold">
          이 기업 JD의 세션 목록
        </h2>
        <SessionList
          rows={sessions}
          showApplication={false}
          caption="이 기업 JD의 면접 세션 목록"
          // [UI-가정] 세션 0개 문구는 명세에 없음
          emptyText="아직 이 기업 JD로 연습한 면접이 없어요"
        />
      </section>
    </div>
  )
}
