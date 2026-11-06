"use client"

import * as React from "react"
import { useRouter } from "next/navigation"
import { Loader2, LogOut } from "lucide-react"
import { Button } from "@/components/ui/button"
import { routes } from "@/lib/routes"
import { clearUserUnsavedInput } from "@/components/common/clear-user-storage"
import { signOutAction } from "./actions"

/**
 * S-24 ① 위험 구역 [로그아웃] → S-01, 확인 없이 즉시 (UX v5.17 SD-A5·A7, design-system 5.11.1 `destructive-outline`).
 * `replace` so 뒤로 가기 doesn't reopen 설정; the session is treated as ended even if the call fails
 * (client goes to S-01 either way).
 */
export function SignOutButton() {
  const router = useRouter()
  const [busy, setBusy] = React.useState(false)
  return (
    <Button
      variant="destructive-outline"
      disabled={busy}
      onClick={async () => {
        setBusy(true)
        try {
          await signOutAction()
        } catch {
          // [UI-가정] sign-out failure is not surfaced; leave the signed-in screens regardless
        } finally {
          clearUserUnsavedInput() // U40-1: before the redirect
          router.replace(routes.landing())
        }
      }}
    >
      {busy ? <Loader2 className="animate-spin" aria-hidden /> : <LogOut aria-hidden />}
      로그아웃
    </Button>
  )
}
