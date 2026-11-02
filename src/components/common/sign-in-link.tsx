"use client"

/**
 * ST-UNAUTH "로그인" button: passes the current path as `?next=` so S-02 can return to the
 * original URL after signing in (02 1.3, A1 UQ-100). Rendered inside <Suspense> by ErrorState.
 */
import Link from "next/link"
import { usePathname, useSearchParams } from "next/navigation"
import { Button } from "@/components/ui/button"
import { routes, safeNextPath } from "@/lib/routes"

export function SignInLink() {
  const pathname = usePathname()
  const params = useSearchParams()
  const qs = new URLSearchParams(params.toString())
  qs.delete("state") // never carry the dev preview switch into the return URL
  const current = qs.toString() ? `${pathname}?${qs}` : pathname
  return (
    <Button asChild>
      <Link href={routes.signIn(safeNextPath(current))}>로그인</Link>
    </Button>
  )
}
