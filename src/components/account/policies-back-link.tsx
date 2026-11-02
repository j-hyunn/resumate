"use client"

/**
 * S-30 "돌아가기" (UQ-94). S-30 sits outside the L-01 shell, so a signed-in user who opened it
 * from the shell footer / S-24 loses the menu. Go back in history when the previous page is
 * this app; otherwise fall back to S-08.
 * [UI-가정] fallback target S-08 (QA recommendation); the route's layout placement is the leader's call.
 */
import * as React from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { ChevronLeft } from "lucide-react"
import { routes } from "@/lib/routes"

export function PoliciesBackLink() {
  const router = useRouter()
  return (
    <Link
      href={routes.career()}
      onClick={(e) => {
        let sameOrigin = false
        try {
          sameOrigin = !!document.referrer && new URL(document.referrer).origin === window.location.origin
        } catch {
          sameOrigin = false
        }
        if (sameOrigin && window.history.length > 1) {
          e.preventDefault()
          router.back()
        }
      }}
      className="inline-flex min-h-11 items-center gap-1 text-sm text-muted-foreground underline-offset-4 hover:text-foreground hover:underline sm:min-h-0"
    >
      <ChevronLeft className="size-4" aria-hidden />
      돌아가기
    </Link>
  )
}
