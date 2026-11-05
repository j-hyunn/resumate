import { notFound } from "next/navigation"
import { ScreenSuspense } from "@/components/common/screen-suspense"
import { PageHeader } from "@/components/common/basics"
import { CardGridSkeleton, ErrorState } from "@/components/common/state-views"
import { PageCrumbs } from "@/components/common/shell/breadcrumbs"
import { InsightView, type RequirementInfo } from "@/components/applications/insight-view"
import { parseMatchStage } from "@/components/applications/insight-parse"
import { getApplicationProject, getInsightState, getJobDescription } from "@/lib/data/applications"
import { getProject } from "@/lib/data/career"
import { getEvidence } from "@/lib/data/evidence"
import { getDataReadiness } from "@/lib/data/readiness"
import { listActiveWritingChats } from "@/lib/data/writing-chats"
import { applicationDisplayName } from "@/lib/data/labels"
import { getPreviewState, previewErrorCode, previewRetryRefusal } from "@/lib/preview-state"
import { routes } from "@/lib/routes"
import { jdRunState } from "../../_lib/jd-state"
import { gateChatFailurePreview, gateReadinessPreview } from "../../_lib/gate-preview"

// S-16 인사이트. ?state=: loading · error · unauth · not-found · empty · ai-pending · ai-waiting · ai-failed(-input/-timeout) · ai-failed-{7원인} · key-missing
//   · ai-locked · key-invalid · key-check · insufficient · insufficient-no-experience · insufficient-key-invalid · insufficient-chat-failed · wait-jd
//   · v5.3: consent-required · insufficient-project-fields · input-failed · retry-other-provider · retry-refused-key-missing
//     · retry-refused-consent · retry-refused-key-invalid · retry-connection-changed · retry-not-retryable
//   · Q53-2: raw-edited ("공고를 고쳤어요. 생성하면 요건부터 다시 정리해요")
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
  if (state === "not-found") notFound()
  const ap = await getApplicationProject(id)
  if (!ap) notFound()
  const name = applicationDisplayName(ap.name, ap.name_source, ap.created_at)
  const crumbs = (
    <PageCrumbs
      items={[{ label: "자기소개서 관리", href: routes.applications() }, { label: name, href: routes.application(id) }, { label: "인사이트" }]}
      applicationProjectId={id}
    />
  )
  const header = <PageHeader title="인사이트" description="입력된 커리어 데이터 기준으로 이 공고와의 적합도를 정리해요. 합격 가능성을 뜻하지 않아요" />
  if (state === "loading" || state === "error" || state === "unauth")
    return (
      <div className="mx-auto max-w-6xl space-y-8">
        {crumbs}
        {header}
        {state === "loading" ? <CardGridSkeleton cards={3} /> : <ErrorState kind={state === "unauth" ? "unauth" : "error"} />}
      </div>
    )

  const [jd, insightState, baseReadiness, chats] = await Promise.all([
    getJobDescription(id),
    getInsightState(id),
    getDataReadiness(),
    listActiveWritingChats(),
  ])
  const readiness = gateReadinessPreview(baseReadiness, state)
  // ai-locked keeps the stored result (D-36: 결과 열람 + "다시 생성" 자리만 C-18 인라인); an application
  // without an insight shows the C-18 영역형
  const previewEmpty =
    state === "empty" ||
    state === "ai-pending" ||
    state === "ai-waiting" ||
    !!previewErrorCode(state) ||
    state === "insufficient" ||
    state === "insufficient-no-experience" ||
    state === "insufficient-project-fields" ||
    state === "wait-jd" ||
    state === "raw-edited"
  const latest = previewEmpty ? null : insightState.latest
  const evidence = latest ? await getEvidence("insight", latest.id) : {}
  const generating = previewEmpty ? null : insightState.generating
  const partialMatches = generating ? parseMatchStage(generating.match_stage_result) : null
  const partialEvidence = generating && partialMatches ? await getEvidence("insight", generating.id) : {}
  const projectNames: Record<string, string> = {}
  for (const p of latest?.result?.strategy.project_priorities ?? []) {
    const project = await getProject(p.project_id)
    if (project) projectNames[p.project_id] = project.name ?? "이름 없는 프로젝트"
  }
  const requirements: Record<string, RequirementInfo> = {}
  for (const r of jd?.requirements ?? []) requirements[r.id] = { content: r.content, category: r.category, importance: r.importance }
  const careerChanged = Object.values(evidence).some((list) => list.some((e) => e.status !== "ok"))
  const failed = previewErrorCode(state)

  return (
    <div className="mx-auto max-w-6xl space-y-8">
      {crumbs}
      {header}
      <InsightView
        applicationProjectId={id}
        applicationName={name}
        requirements={requirements}
        latest={latest}
        generatingJobId={generating?.ai_job_id ?? null}
        partialMatches={partialMatches}
        partialEvidence={partialEvidence}
        evidence={evidence}
        projectNames={projectNames}
        readiness={readiness}
        activeChatId={chats[0]?.id ?? null}
        {...jdRunState(jd, state)}
        rawTextEdited={state === "raw-edited" || (!state && Boolean(jd?.raw_text_edited_at) && jd?.extraction_status === "pending")}
        gateChatFailure={gateChatFailurePreview(state)}
        careerChanged={careerChanged}
        lateFailure={previewEmpty || generating ? null : ap.insight_status.failure}
        preview={{
          pending: state === "ai-pending" || state === "ai-waiting",
          waiting: state === "ai-waiting",
          failed,
          fail: null,
          refusal: previewRetryRefusal(state),
          otherProvider: state === "retry-other-provider",
        }}
      />
    </div>
  )
}
