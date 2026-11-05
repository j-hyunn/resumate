import { notFound } from "next/navigation"
import { ScreenSuspense } from "@/components/common/screen-suspense"
import { PageHeader } from "@/components/common/basics"
import { ErrorState, ListSkeleton } from "@/components/common/state-views"
import { PageCrumbs } from "@/components/common/shell/breadcrumbs"
import { DraftList, NewDraftPanel, type DraftRowMeta } from "@/components/applications/drafts-view"
import { getApplicationProject, getDraft, getInsightState, getJobDescription, listDrafts } from "@/lib/data/applications"
import { getDataReadiness } from "@/lib/data/readiness"
import { listActiveWritingChats } from "@/lib/data/writing-chats"
import { applicationDisplayName } from "@/lib/data/labels"
import { getPreviewState } from "@/lib/preview-state"
import { routes } from "@/lib/routes"
import { getCareerSourceTree } from "@/lib/data/drafts"
import { extractFirstPreviewFail, jdRunState } from "../../_lib/jd-state"
import { gateChatFailurePreview, gateReadinessPreview } from "../../_lib/gate-preview"

// S-17 서류 초안 목록·경력기술서 설정. ?state=: loading · error · unauth · not-found · empty · ai-locked · key-invalid · key-check
//   · insufficient · insufficient-no-experience · insufficient-key-invalid · insufficient-chat-failed · wait-jd
//   · ranking-failed(화면 전용: AI-11 실패 → 체크 없는 트리 + "AI에게 다시 맡기기", v5.3 A23)
//   · v5.3: consent-required · insufficient-project-fields · extract-failed · extract-failed-input · extract-failed-wait
//     (화면 전용: 요건 선행 추출 실패 → C-20 inline, 초안 행 없음)
//   · Q53-4: no-requirements (요건 없는 JD: "새 경력기술서" → 추출 → 설정) · no-requirements-consent · no-requirements-key-invalid
//     (자동 실행 없는 설정 화면). 미리보기의 추출은 모의이고 저장소를 바꾸지 않는다
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
      items={[{ label: "자기소개서 관리", href: routes.applications() }, { label: name, href: routes.application(id) }, { label: "서류 초안" }]}
      applicationProjectId={id}
    />
  )
  const header = <PageHeader title="서류 초안" description="커리어 데이터를 근거로 이 공고에 맞춘 경력기술서와 자소서 문항 답변 초안을 만들어요" />
  if (state === "loading" || state === "error" || state === "unauth")
    return (
      <div className="mx-auto max-w-6xl space-y-8">
        {crumbs}
        {header}
        {state === "loading" ? <ListSkeleton rows={3} /> : <ErrorState kind={state === "unauth" ? "unauth" : "error"} />}
      </div>
    )

  const [drafts, tree, insight, jd, baseReadiness, chats] = await Promise.all([
    listDrafts(id),
    getCareerSourceTree(),
    getInsightState(id),
    getJobDescription(id),
    getDataReadiness(),
    listActiveWritingChats(),
  ])
  const readiness = gateReadinessPreview(baseReadiness, state)
  // v5.3: 자소서 실패 문항 수 + 완료 문항 유무 (결과 배지 값은 drafts.provider — UQ-522)
  const meta: Record<string, DraftRowMeta> = {}
  for (const d of drafts.filter((x) => x.draft_type === "cover_letter")) {
    const full = await getDraft(id, d.id)
    const sections = full?.sections ?? []
    meta[d.id] = {
      failed_sections: sections.filter((s) => s.status === "failed").length,
      has_result: sections.some((s) => s.status === "ready"),
    }
  }
  const extractFail = extractFirstPreviewFail(state)
  const run = jdRunState(jd, state)
  const noRequirementsPreview = state === "no-requirements" || state === "no-requirements-consent" || state === "no-requirements-key-invalid"
  // Q53-7: 경력기술서 `composing` (첫 생성 중단) — S-17 설정이 이 값을 복원한다 (프로젝트당 1개)
  const composing = drafts.find((d) => d.draft_type === "career_description" && d.status === "composing") ?? null
  const priorities =
    insight.latest?.result?.strategy.project_priorities
      .slice()
      .sort((a, b) => a.rank - b.rank)
      .map((p) => p.project_id) ?? null

  return (
    <div className="mx-auto max-w-6xl space-y-8">
      {crumbs}
      {header}
      <section className="space-y-3" aria-labelledby="draft-list">
        <h2 id="draft-list" className="text-lg leading-7 font-semibold">
          만든 초안
        </h2>
        <DraftList applicationProjectId={id} drafts={state === "empty" ? [] : drafts} meta={meta} extractFirst={jdRunState(jd, state).extractFirst} />
      </section>
      <NewDraftPanel
        // the restored `composing` settings live and die with that row: deleting it starts the panel over (UQ-605)
        key={noRequirementsPreview ? "new" : (composing?.id ?? "new")}
        applicationProjectId={id}
        applicationName={name}
        tree={tree}
        insightPriorities={state === "ranking-failed" || noRequirementsPreview ? null : priorities}
        readiness={readiness}
        activeChatId={chats[0]?.id ?? null}
        {...run}
        extractFirst={run.extractFirst || !!extractFail || noRequirementsPreview}
        extractFailPreview={extractFail}
        composingDraft={noRequirementsPreview ? null : composing}
        previewGate={state === "no-requirements-consent" ? "consent" : state === "no-requirements-key-invalid" ? "key_invalid" : null}
        gateChatFailure={gateChatFailurePreview(state)}
        failRanking={state === "ranking-failed"}
      />
    </div>
  )
}
