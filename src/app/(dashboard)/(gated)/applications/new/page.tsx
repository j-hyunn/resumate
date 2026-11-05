import { notFound } from "next/navigation"
import { ScreenSuspense } from "@/components/common/screen-suspense"
import { PageHeader } from "@/components/common/basics"
import { ErrorState, FormSkeleton } from "@/components/common/state-views"
import { PageCrumbs } from "@/components/common/shell/breadcrumbs"
import { ApplicationNewForm } from "@/components/applications/application-new-form"
import { getPreviewState } from "@/lib/preview-state"
import { routes } from "@/lib/routes"

// S-14 자기소개서 추가. ?from=board → S-39로 복귀. ?state=: loading · error · unauth · not-found · save-failed · ai-locked ·
// consent-required (만들기 → C-21) · key-invalid (만들기 → C-20 key_invalid) ·
// create-refused-consent · create-refused-key-invalid (Q53-1: 화면 판정 뒤 서버 거부, 경로 ⑥). 미리보기는 행을 만들지 않는다
type Props = { params: Promise<Record<string, never>>; searchParams: Promise<Record<string, string | string[] | undefined>> }

export default function Page({ params, searchParams }: Props) {
  return (
    <ScreenSuspense>
      <Screen params={params} searchParams={searchParams} />
    </ScreenSuspense>
  )
}

async function Screen({ searchParams }: Props) {
  const sp = await searchParams
  const state = getPreviewState(sp)
  if (state === "not-found") notFound()
  const fromBoard = sp.from === "board"
  return (
    <div className="mx-auto max-w-3xl space-y-8">
      <PageCrumbs
        items={[
          fromBoard ? { label: "지원 현황", href: routes.board() } : { label: "자기소개서 관리", href: routes.applications() },
          { label: "자기소개서 추가" },
        ]}
      />
      <PageHeader title="자기소개서 추가" description="공고를 붙여넣어 자기소개서를 만들어요. 이 자기소개서에서 인사이트·서류·면접을 준비할 수 있어요" />
      {state === "loading" ? (
        <FormSkeleton fields={3} />
      ) : state === "error" || state === "unauth" ? (
        <ErrorState kind={state === "unauth" ? "unauth" : "error"} />
      ) : (
        <ApplicationNewForm
          fromBoard={fromBoard}
          failSave={state === "save-failed"}
          previewServerRefusal={state === "create-refused-consent" ? "ai_consent_required" : state === "create-refused-key-invalid" ? "key_invalid" : null}
        />
      )}
    </div>
  )
}
