import { redirect } from "next/navigation"
import { isPolicyType } from "@/components/account/policy-content"
import { routes } from "@/lib/routes"

/**
 * Old S-30 address (`/policies?doc=…`, one page with tabs). Each document now has its own page
 * (/policies/{policy_type}); keep old links working. Default = 개인정보 처리방침.
 */
type Props = { searchParams: Promise<Record<string, string | string[] | undefined>> }

export default async function Page({ searchParams }: Props) {
  const sp = await searchParams
  const raw = Array.isArray(sp.doc) ? sp.doc[0] : sp.doc
  redirect(routes.policies(isPolicyType(raw) ? raw : "privacy"))
}
