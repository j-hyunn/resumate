"use client"

/**
 * A7 (02 L-01 첫 화면, FL-07, S-25 v5.3): an account whose deletion did not finish (data deleted,
 * auth delete pending — get_account_deletion_state() = deletion_incomplete) goes straight to S-25
 * 탈퇴 마무리, before S-08 / the original URL / S-03, and cannot move to other menus [가정].
 * Mock: the state comes from mock_controls (deleteAccountConfirmed incomplete, /dev/states), or
 * `?state=deletion-incomplete` on any guarded URL.
 *
 * UQ-407: until the first check answers, an opaque cover hides the page (no flash of the original
 * screen, no clicks); while redirecting the cover stays. Later navigations re-check without the
 * cover (the state was already known to be active).
 */
import * as React from "react"
import { usePathname, useRouter } from "next/navigation"
import { getAccountDeletionStateAction } from "@/lib/data/actions"
import { routes } from "@/lib/routes"
import { usePreviewState } from "../preview-state-client"

/** first answer of this page session: once "active", later checks run without the cover */
let knownActive = false

export function DeletionIncompleteGuard({ paths }: { paths?: string[] }) {
  const pathname = usePathname()
  const router = useRouter()
  const preview = usePreviewState()
  // UQ-586: only the finalize card is exempt — S-25 itself is covered too, so opening
  // /settings/withdraw directly while deletion is incomplete doesn't flash the shell
  const exempt =
    pathname.startsWith(routes.withdrawFinalize()) || pathname.startsWith("/dev/") || (paths ? !paths.some((p) => pathname.startsWith(p)) : false)
  const [cover, setCover] = React.useState(!knownActive && !exempt)

  React.useEffect(() => {
    if (exempt) return
    let alive = true
    void getAccountDeletionStateAction().then((state) => {
      if (!alive) return
      if (state === "deletion_incomplete" || preview === "deletion-incomplete") {
        setCover(true)
        // UQ-451: straight to the shell-less finalize card (no dashboard shell in between)
        router.replace(routes.withdrawFinalize(preview === "deletion-incomplete" ? "deletion-incomplete" : null))
        return
      }
      knownActive = true
      setCover(false)
    })
    return () => {
      alive = false
    }
  }, [exempt, pathname, preview, router])

  if (!cover || exempt) return null
  return <div className="fixed inset-0 z-[100] bg-background" aria-busy="true" aria-label="계정 상태 확인 중" role="status" />
}
