"use client"

/**
 * S-10 leaves to S-08 with a toast (UX v5.6 S-10 URL: "S-08 + 토스트 '찾을 수 없는 항목이에요'" [가정], and the
 * `project_not_affiliated` / standalone paths). The root layout owns the Toaster, so the toast survives the move.
 */
import * as React from "react"
import { useRouter } from "next/navigation"
import { toast } from "sonner"
import { PageShellSkeleton } from "@/components/common/shell/page-shell-skeleton"

export function RedirectNotice({ href, message }: { href: string; message?: string }) {
  const router = useRouter()
  const done = React.useRef(false)
  React.useEffect(() => {
    if (done.current) return
    done.current = true
    if (message) toast(message)
    router.replace(href)
  }, [href, message, router])
  return <PageShellSkeleton />
}
