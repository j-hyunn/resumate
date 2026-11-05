import { notFound } from "next/navigation"
import { ScreenSuspense } from "@/components/common/screen-suspense"
import { PageHeader } from "@/components/common/basics"
import { ErrorState, FormSkeleton } from "@/components/common/state-views"
import { PageCrumbs } from "@/components/common/shell/breadcrumbs"
import { CoverLetterQuestions } from "@/components/applications/cover-letter-questions"
import { getApplicationProject, getDraft, getJobDescription } from "@/lib/data/applications"
import { getDataReadiness } from "@/lib/data/readiness"
import { listActiveWritingChats } from "@/lib/data/writing-chats"
import { applicationDisplayName } from "@/lib/data/labels"
import { getPreviewState } from "@/lib/preview-state"
import { routes } from "@/lib/routes"
import { extractFirstPreviewFail, jdRunState } from "../../../../_lib/jd-state"
import { gateChatFailurePreview, gateReadinessPreview } from "../../../../_lib/gate-preview"

// S-18 자소서 문항 설정 (D-UX-23). ?state=: loading · error · unauth · not-found · save-failed · ai-locked · key-invalid · key-check
//   · v5.3: consent-required · insufficient-project-fields · extract-failed · extract-failed-input · extract-failed-wait (요건 선행 추출 실패)
//   · insufficient · insufficient-no-experience · insufficient-key-invalid · insufficient-chat-failed · wait-jd
type Props = { params: Promise<{ id: string; draftId: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> }

export default function Page({ params, searchParams }: Props) {
  return (
    <ScreenSuspense>
      <Screen params={params} searchParams={searchParams} />
    </ScreenSuspense>
  )
}

async function Screen({ params, searchParams }: Props) {
  const { id, draftId } = await params
  const state = getPreviewState(await searchParams)
  if (state === "not-found") notFound()
  const [ap, draft] = await Promise.all([getApplicationProject(id), getDraft(id, draftId)])
  if (!ap || !draft || draft.draft_type !== "cover_letter") notFound()
  const name = applicationDisplayName(ap.name, ap.name_source, ap.created_at)
  const crumbs = (
    <PageCrumbs
      items={[
        { label: "자기소개서 관리", href: routes.applications() },
        { label: name, href: routes.application(id) },
        { label: "서류 초안", href: routes.applicationDrafts(id) },
        { label: "자소서 문항 설정" },
      ]}
      applicationProjectId={id}
    />
  )
  const header = (
    <PageHeader
      title="자소서 문항 설정"
      description="기본 3문항으로 시작해요. 문항 문구·글자 수·메모를 고치고, 문항을 추가하거나 지울 수 있어요(최소 1개)"
    />
  )
  if (state === "loading" || state === "error" || state === "unauth")
    return (
      <div className="mx-auto max-w-3xl space-y-8">
        {crumbs}
        {header}
        {state === "loading" ? <FormSkeleton fields={4} /> : <ErrorState kind={state === "unauth" ? "unauth" : "error"} />}
      </div>
    )

  const [jd, baseReadiness, chats] = await Promise.all([getJobDescription(id), getDataReadiness(), listActiveWritingChats()])
  const readiness = gateReadinessPreview(baseReadiness, state)

  return (
    <div className="mx-auto max-w-3xl space-y-8">
      {crumbs}
      {header}
      <CoverLetterQuestions
        applicationProjectId={id}
        applicationName={name}
        draftId={draftId}
        sections={draft.sections}
        readiness={readiness}
        activeChatId={chats[0]?.id ?? null}
        {...jdRunState(jd, state)}
        extractFirst={jdRunState(jd, state).extractFirst || !!extractFirstPreviewFail(state)}
        extractFailPreview={extractFirstPreviewFail(state)}
        gateChatFailure={gateChatFailurePreview(state)}
        failSave={state === "save-failed"}
      />
    </div>
  )
}
