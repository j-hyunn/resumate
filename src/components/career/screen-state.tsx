/**
 * Shared `?state=` handling for A2 pages (server). Returns the ST-xx view to render
 * instead of the screen, or null. `not-found` → notFound().
 * Client-side values (save-failed, ai-failed*, ai-locked, key-invalid, …) are read by the screens.
 */
import { notFound } from "next/navigation"
import { ErrorState, FormSkeleton, ListSkeleton } from "@/components/common/state-views"
import { Skeleton } from "@/components/ui/skeleton"
import type { PreviewState } from "@/lib/preview-state"

export function careerPreviewView(state: PreviewState | null, kind: "form" | "list" | "chat" = "form"): React.ReactNode | null {
  if (state === "not-found") notFound()
  if (state === "unauth") return <ErrorState kind="unauth" />
  if (state === "error") return <ErrorState kind="error" />
  if (state === "loading") {
    if (kind === "list")
      return (
        <div className="mx-auto max-w-6xl space-y-8" aria-busy="true">
          <Skeleton className="h-8 w-40" />
          <Skeleton className="h-28 w-full rounded-lg" />
          <ListSkeleton rows={5} />
        </div>
      )
    if (kind === "chat")
      return (
        <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_28rem]" aria-busy="true">
          <ListSkeleton rows={4} />
          <FormSkeleton fields={5} />
        </div>
      )
    return (
      <div className="mx-auto max-w-3xl space-y-8" aria-busy="true">
        <Skeleton className="h-8 w-48" />
        <FormSkeleton fields={6} />
      </div>
    )
  }
  return null
}
