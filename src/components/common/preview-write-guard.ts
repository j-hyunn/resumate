"use client"

/**
 * `?state=` is a look at a screen, not a run against the store. On a preview URL the connection,
 * readiness and failure shown are simulated, so a write would act on state the page isn't showing
 * (and survive in the store after the preview). Screens call this before an action that writes.
 *
 *   const previewWrite = usePreviewWriteGuard()
 *   const start = async () => { if (previewWrite.stop()) return; await startAction() }
 *
 * Production: `?state=` isn't read (readPreviewState), so `stop()` is always false.
 */
import * as React from "react"
import { toast } from "sonner"
import { usePreviewState } from "./preview-state-client"

export function usePreviewWriteGuard(): { active: boolean; stop: () => boolean } {
  const active = usePreviewState() !== null
  return React.useMemo(
    () => ({
      active,
      stop: () => {
        if (active) toast("미리보기라 실제로 저장하거나 실행하지 않았어요") // dev only
        return active
      },
    }),
    [active],
  )
}
