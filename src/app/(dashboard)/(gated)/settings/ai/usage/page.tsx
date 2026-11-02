import type { Metadata } from "next"
import { ScreenSuspense } from "@/components/common/screen-suspense"
import { PageHeader } from "@/components/common/basics"
import { ErrorState, FormSkeleton } from "@/components/common/state-views"
import { PageCrumbs } from "@/components/common/shell/breadcrumbs"
import { AiUsagePanel } from "@/components/account/ai-usage-panel"
import { getPreviewState } from "@/lib/preview-state"
import { routes } from "@/lib/routes"

/**
 * S-42 AI 사용량 (F-AI-07). Same content component as the settings dialog
 * section "AI 사용량" (account/ai-usage-panel, **A1 builds**). Data: getAiUsageSummary(), getAiPriceTables().
 * ?state= : loading · error(본문 자리 "다시 불러오기") · unauth · ai-locked (연결 전 C-18 영역형) · empty(이번 달 기록 없음)
 */
export const metadata: Metadata = { title: "AI 사용량" }

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
  const crumbs = <PageCrumbs items={[{ label: "설정", href: routes.settings() }, { label: "AI 연결", href: routes.aiConnection() }, { label: "AI 사용량" }]} />
  if (state === "loading")
    return (
      <div className="mx-auto max-w-3xl space-y-8">
        {crumbs}
        <FormSkeleton fields={3} />
      </div>
    )
  if (state === "unauth")
    return (
      <>
        {crumbs}
        <ErrorState kind="unauth" />
      </>
    )
  return (
    <div className="mx-auto max-w-3xl space-y-8">
      {crumbs}
      <PageHeader title="AI 사용량" />
      <AiUsagePanel variant="page" preview={state} />
    </div>
  )
}
