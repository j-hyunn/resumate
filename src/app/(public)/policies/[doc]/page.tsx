import type { Metadata } from "next"
import { notFound } from "next/navigation"
import { ScreenSuspense } from "@/components/common/screen-suspense"
import { ErrorState, TextSkeleton } from "@/components/common/state-views"
import { PolicyDocument } from "@/components/account/policy-document"
import { PoliciesBackLink } from "@/components/account/policies-back-link"
import { POLICY_TYPES, POLICY_TYPE_LABELS, isPolicyType } from "@/components/account/policy-content"
import { getPreviewState } from "@/lib/preview-state"
import { getPolicyVersions } from "@/lib/data/account"
import { getCurrentAiDisclosures } from "@/lib/data/policies"

/**
 * S-30 처리방침·약관 열람 (NFR-PRV-10). One page per document: /policies/terms · /policies/privacy ·
 * /policies/cross_border_transfer · /policies/ai_data_use (UX v5.17 SD-A13; same names as policy_versions.policy_type).
 * Opened signed out (S-01·S-02·S-03) and from the S-24 ③ 약관 탭 [전문 확인] (새 탭).
 * ?state= : loading · error · not-found
 */
type SearchParams = Record<string, string | string[] | undefined>
type Props = { params: Promise<{ doc: string }>; searchParams: Promise<SearchParams> }

export function generateStaticParams() {
  return POLICY_TYPES.map((doc) => ({ doc }))
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { doc } = await params
  return { title: isPolicyType(doc) ? POLICY_TYPE_LABELS[doc] : "처리방침·약관" }
}

export default function Page(props: Props) {
  return (
    <ScreenSuspense fallback={<Fallback />}>
      <Screen {...props} />
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

async function Screen({ params, searchParams }: Props) {
  const [{ doc }, sp] = await Promise.all([params, searchParams])
  if (!isPolicyType(doc)) notFound()
  const state = getPreviewState(sp)
  if (state === "loading") return <Fallback />
  if (state === "error") return <ErrorState kind="error" />
  if (state === "not-found") return <ErrorState kind="not-found" />
  const [versions, disclosures] = await Promise.all([
    getPolicyVersions(),
    doc === "ai_data_use" ? getCurrentAiDisclosures().catch(() => []) : Promise.resolve([]),
  ])

  return (
    <div className="mx-auto max-w-[42rem] space-y-6 px-4 py-10">
      <PoliciesBackLink />
      <PolicyDocument type={doc} version={versions[doc]} disclosures={disclosures} />
    </div>
  )
}
