import type { Metadata } from "next"
import { ScreenSuspense } from "@/components/common/screen-suspense"
import { ErrorState, FormSkeleton } from "@/components/common/state-views"
import { Card } from "@/components/ui/card"
import { ConsentForm } from "@/components/account/consent-form"
import { safeNextPath } from "@/lib/routes"
import { getPolicyVersions } from "@/lib/data/account"
import { getPreviewState } from "@/lib/preview-state"

/**
 * S-03 약관·개인정보 동의 (가입 직후, F-COM-02/03). 동의 완료 → S-08 또는 원래 URL(`?next=`).
 * ?state= : loading · save-failed(저장 실패) · unauth(로그인 세션 없음) · error
 */
export const metadata: Metadata = { title: "약관·개인정보 동의" }

type SearchParams = Record<string, string | string[] | undefined>
type Props = { searchParams: Promise<SearchParams> }

export default function Page({ searchParams }: Props) {
  return (
    <ScreenSuspense fallback={<Fallback />}>
      <Screen searchParams={searchParams} />
    </ScreenSuspense>
  )
}

function Fallback() {
  return (
    <div className="px-4">
      <FormSkeleton fields={5} className="mx-auto mt-16 max-w-md" />
    </div>
  )
}

async function Screen({ searchParams }: Props) {
  const sp = await searchParams
  const state = getPreviewState(sp)
  if (state === "loading") return <Fallback />
  if (state === "unauth") return <ErrorState kind="unauth" />
  if (state === "error") return <ErrorState kind="error" />
  const next = safeNextPath(sp.next)

  return (
    <div className="px-4 pb-16">
      <Card className="mx-auto mt-16 max-w-md gap-6 p-8">
        <header className="space-y-1">
          <h1 className="text-2xl leading-8 font-bold">약관·개인정보 동의</h1>
          {/* [UI-가정] sub copy */}
          <p className="text-sm leading-5 text-muted-foreground">
            Resumate를 쓰려면 필수 항목에 동의해 주세요. 선택 항목은 나중에 설정에서 바꿀 수 있어요.
          </p>
        </header>
        <ConsentForm next={next} failSave={state === "save-failed"} versions={await getPolicyVersions()} />
      </Card>
    </div>
  )
}
