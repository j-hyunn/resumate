import { redirect } from "next/navigation"
import { ScreenSuspense } from "@/components/common/screen-suspense"
import { TextSkeleton } from "@/components/common/state-views"
import { isPolicyType } from "@/components/account/policy-content"
import { routes } from "@/lib/routes"

/**
 * Old S-30 address (`/policies?doc=…`, one page with tabs). Each document now has its own page
 * (/policies/{policy_type}); keep old links working. Default = 개인정보 처리방침.
 * UQ-3 rule (screen-suspense.tsx): searchParams are awaited only inside the Suspense child,
 * or the Cache Components prerender of this route fails the build.
 */
type Props = { searchParams: Promise<Record<string, string | string[] | undefined>> }

export default function Page({ searchParams }: Props) {
  return (
    <ScreenSuspense fallback={<Fallback />}>
      <Redirect searchParams={searchParams} />
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

async function Redirect({ searchParams }: Props): Promise<never> {
  const sp = await searchParams
  const raw = Array.isArray(sp.doc) ? sp.doc[0] : sp.doc
  redirect(routes.policies(isPolicyType(raw) ? raw : "privacy"))
}
