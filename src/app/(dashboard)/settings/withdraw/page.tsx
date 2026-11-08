import type { Metadata } from "next"
import { redirect } from "next/navigation"
import { ScreenSuspense } from "@/components/common/screen-suspense"
import { PageHeader } from "@/components/common/basics"
import { ErrorState, FormSkeleton } from "@/components/common/state-views"
import { PageCrumbs } from "@/components/common/shell/breadcrumbs"
import { Card, CardContent } from "@/components/ui/card"
import { DeletionSummary } from "@/components/account/deletion-summary"
import { WithdrawForm } from "@/components/account/withdraw-form"
import { getAccountDeletionState, getAccountDeletionSummary, getRunningAiJobCount } from "@/lib/data/account"
import { getPreviewState } from "@/lib/preview-state"
import { routes } from "@/lib/routes"

/**
 * S-25 회원 탈퇴 (F-COM-05, FL-07 v5.3, D-11, DM-1, A7). 삭제 범위 = get_account_deletion_summary().
 * 순서 (design-system 6 A1 (v3)): 삭제 범위 요약 → AI 연결 묶음·Alert info → 확인 체크 → "탈퇴하기".
 * 확인 체크 → `confirm: true` → 즉시 삭제 → 로그아웃 → S-01(`/`).
 * 약관 동의 게이트 밖 경로 (A7): 동의 기록이 없어도 열린다 — mock 셸에는 동의 게이트가 없다.
 * `get_account_deletion_state() = deletion_incomplete`면 셸 밖 탈퇴 마무리 상태(/settings/withdraw/finalize)로 보낸다.
 * ?state= : loading · error · unauth · empty(데이터 0개) · save-failed(그 밖 오류) ·
 *           deletion-busy(첫 요청이 account_deletion_busy) · deletion-incomplete(탈퇴 마무리 상태로 이동)
 */
export const metadata: Metadata = { title: "회원 탈퇴" }

type Props = {
  params: Promise<Record<string, never>>
  searchParams: Promise<Record<string, string | string[] | undefined>>
}

const EMPTY_SUMMARY = {
  career: { experiences: 0, educations: 0, projects: 0, project_deliverables: 0, skills: 0, writing_chats: 0 },
  applications: { application_projects: 0, insights: 0, drafts: 0, interview_sessions: 0, application_stage_events: 0 },
  ai: { provider_keys: 0, data_use_consents: 0, usage_records: 0 },
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
  // A7: 탈퇴 미완료 → 탈퇴 마무리 상태 (셸 밖)
  if (state === "deletion-incomplete") redirect(routes.withdrawFinalize("deletion-incomplete"))
  if (!state && (await getAccountDeletionState()) === "deletion_incomplete") redirect(routes.withdrawFinalize())
  const crumbs = <PageCrumbs items={[{ label: "설정", href: routes.settings("account") }, { label: "회원 탈퇴" }]} />

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

  const [summary, runningAiJobs] =
    state === "empty" ? [EMPTY_SUMMARY, 0] : await Promise.all([getAccountDeletionSummary(), getRunningAiJobCount()])

  return (
    <div className="mx-auto max-w-3xl space-y-8">
      {crumbs}
      <PageHeader
        title="회원 탈퇴"
        description="탈퇴하면 아래 데이터가 바로 삭제되고 되돌릴 수 없어요. 삭제 후에는 자동으로 로그아웃돼요."
      />
      <Card>
        <CardContent className="space-y-6">
          <section aria-labelledby="withdraw-scope" className="space-y-2">
            <h2 id="withdraw-scope" className="text-lg leading-7 font-semibold">
              함께 삭제되는 데이터
            </h2>
            <DeletionSummary summary={summary} runningAiJobs={runningAiJobs} />
          </section>
          <WithdrawForm
            failDelete={state === "save-failed"}
            simulate={state === "deletion-busy" ? "account_deletion_busy" : null}
          />
        </CardContent>
      </Card>
    </div>
  )
}
