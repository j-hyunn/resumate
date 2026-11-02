import type { Metadata } from "next"
import { ScreenSuspense } from "@/components/common/screen-suspense"
import { ErrorState, TextSkeleton } from "@/components/common/state-views"
import { Alert, AlertDescription } from "@/components/ui/alert"
import { PoliciesView } from "@/components/account/policies-view"
import { PoliciesBackLink } from "@/components/account/policies-back-link"
import { isPolicyType } from "@/components/account/policy-content"
import { getPreviewState } from "@/lib/preview-state"
import { getPolicyVersions } from "@/lib/data/account"
import { Info } from "lucide-react"

/**
 * S-30 처리방침·약관 열람 (NFR-PRV-10). 공통 화면: 비로그인(S-01·S-02·S-03)과 L-01 메뉴 하단에서 연다.
 * `?doc=terms|privacy|cross_border_transfer` 로 탭을 고른다(기본 privacy).
 * ?state= : loading · error · not-found(문서를 못 찾음)
 */
export const metadata: Metadata = { title: "처리방침·약관" }

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
    <div className="mx-auto max-w-[42rem] space-y-4 px-4 py-10">
      <TextSkeleton lines={8} />
    </div>
  )
}

async function Screen({ searchParams }: Props) {
  const sp = await searchParams
  const state = getPreviewState(sp)
  if (state === "loading") return <Fallback />
  if (state === "error") return <ErrorState kind="error" />
  if (state === "not-found") return <ErrorState kind="not-found" />
  const rawDoc = Array.isArray(sp.doc) ? sp.doc[0] : sp.doc
  // [UI-가정] default tab = 개인정보 처리방침 (the shell footer link is labelled "처리방침")
  const initial = isPolicyType(rawDoc) ? rawDoc : "privacy"

  return (
    <div className="mx-auto max-w-[42rem] space-y-6 px-4 py-10">
      <PoliciesBackLink />
      <h1 className="text-2xl leading-8 font-bold">처리방침·약관</h1>
      {/* [UI-가정] legal body text is pending (S-30 "v3와 같음", v3 not in repo) */}
      <Alert variant="info">
        <Info aria-hidden />
        <AlertDescription>출시 전 법무 검토를 거쳐 최종 문구로 바뀌어요. 보관 기간과 전송 항목은 현재 기준이에요.</AlertDescription>
      </Alert>
      <PoliciesView initial={initial} versions={await getPolicyVersions()} />
    </div>
  )
}
