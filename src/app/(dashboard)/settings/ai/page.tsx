import type { Metadata } from "next"
import { ScreenSuspense } from "@/components/common/screen-suspense"
import { PageHeader } from "@/components/common/basics"
import { ErrorState, FormSkeleton } from "@/components/common/state-views"
import { PageCrumbs } from "@/components/common/shell/breadcrumbs"
import { AiConnectionPanel } from "@/components/account/ai-connection-panel"
import { getPreviewState } from "@/lib/preview-state"
import { routes } from "@/lib/routes"

/**
 * S-40 AI 연결 (F-AI-01~03, 09, FL-19/FL-20). Same content component as the settings dialog
 * section "AI 연결" (account/ai-connection-panel, **A1 builds**). Data: getAiConnectionOverview().
 * ?state= : loading · error · unauth · ai-locked(미연결) · key-invalid · key-check · no-active(키는 있고 활성 없음) ·
 *           paused(Claude 일시 중지) · recheck-failed(다시 확인 → 키 무효) · save-failed(활성 전환·삭제 실패) · ai-return(C-18 복귀 배너)
 */
export const metadata: Metadata = { title: "AI 연결" }

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

async function Screen({ params, searchParams }: Props) {
  void params
  const state = getPreviewState(await searchParams)
  const crumbs = <PageCrumbs items={[{ label: "설정", href: routes.settings() }, { label: "AI 연결" }]} />
  if (state === "loading")
    return (
      <div className="mx-auto max-w-3xl space-y-8">
        {crumbs}
        <FormSkeleton fields={3} />
      </div>
    )
  if (state === "unauth" || state === "error")
    return (
      <>
        {crumbs}
        <ErrorState kind={state === "unauth" ? "unauth" : "error"} />
      </>
    )
  return (
    <div className="mx-auto max-w-3xl space-y-8">
      {crumbs}
      <PageHeader title="AI 연결" />
      <AiConnectionPanel variant="page" preview={state} />
    </div>
  )
}
