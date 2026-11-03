"use client"

import * as React from "react"
import { useRouter } from "next/navigation"
import { toast } from "sonner"
import { PageShellSkeleton } from "@/components/common/shell/page-shell-skeleton"

/**
 * S-44 opened under an affiliated project (산출물은 독립 프로젝트만): → S-10 + toast (UX S-44 URL 행 [가정]).
 * Client side so the toast survives the move; `replace` keeps the bad URL out of history.
 */
export function AffiliatedRedirect({ href }: { href: string }) {
  const router = useRouter()
  React.useEffect(() => {
    toast("산출물은 독립 프로젝트에만 쓸 수 있어요")
    router.replace(href)
  }, [href, router])
  return <PageShellSkeleton />
}
