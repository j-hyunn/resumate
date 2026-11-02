import type { Metadata } from "next"
import { ScreenSuspense } from "@/components/common/screen-suspense"
import { PageHeader } from "@/components/common/basics"
import { ErrorState, FormSkeleton } from "@/components/common/state-views"
import { PageCrumbs } from "@/components/common/shell/breadcrumbs"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { SettingsSectionBody } from "@/components/account/settings-sections"
import { SETTINGS_SECTIONS } from "@/components/account/settings-section-list"
import { getConsentStatuses } from "@/lib/data/account"
import { getCurrentUser } from "@/lib/data/shell"
import { getPreviewState } from "@/lib/preview-state"

/**
 * S-24 설정 (F-COM-02, 03, 05). L-01 사이드바에서는 설정 다이얼로그(shell/settings-dialog)로 열리고,
 * 이 페이지는 직접 주소·S-25 취소/이동 경로용으로 같은 섹션(settings-sections)을 카드로 보인다. 02 명세는 "v3와 같음"(v3 없음) →
 * 매트릭스의 기능(동의 관리·AI 학습 미사용 안내·탈퇴 진입)과 S-04 진입점으로 구성 [UI-가정].
 * design-system 6 A1: max-w-form, 섹션 카드.
 * ?state= : loading · error · unauth · save-failed(선택 동의 변경 실패)
 */
export const metadata: Metadata = { title: "설정" }

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
  const crumbs = <PageCrumbs items={[{ label: "설정" }]} />

  if (state === "loading")
    return (
      <div className="mx-auto max-w-3xl space-y-8">
        {crumbs}
        <FormSkeleton fields={6} />
      </div>
    )
  if (state === "unauth" || state === "error")
    return (
      <>
        {crumbs}
        <ErrorState kind={state === "unauth" ? "unauth" : "error"} />
      </>
    )

  const [user, statuses] = await Promise.all([getCurrentUser(), getConsentStatuses()])
  const data = { email: user.email, statuses }

  return (
    <div className="mx-auto max-w-3xl space-y-8">
      {crumbs}
      <PageHeader title="설정" />
      {SETTINGS_SECTIONS.map((section) => (
        <Card key={section.id}>
          <CardHeader>
            <CardTitle>
              <h2>{section.label}</h2>
            </CardTitle>
            {section.description ? <CardDescription>{section.description}</CardDescription> : null}
          </CardHeader>
          <CardContent>
            <SettingsSectionBody section={section.id} data={data} failSave={state === "save-failed"} />
          </CardContent>
        </Card>
      ))}
    </div>
  )
}
