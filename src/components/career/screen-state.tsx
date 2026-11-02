/**
 * Shared `?state=` handling for A2 pages (server). Returns the ST-xx view to render
 * instead of the screen, or null. `not-found` → notFound().
 * Client-side values (save-failed, ai-failed*, ai-locked, key-invalid, …) are read by the screens.
 */
import { notFound } from "next/navigation"
import { ErrorState, FormSkeleton, ListSkeleton } from "@/components/common/state-views"
import { Skeleton } from "@/components/ui/skeleton"
import type { PreviewState } from "@/lib/preview-state"

export function careerPreviewView(state: PreviewState | null, kind: "form" | "list" | "split" | "chat" = "form"): React.ReactNode | null {
  if (state === "not-found") notFound()
  if (state === "unauth") return <ErrorState kind="unauth" />
  if (state === "error") return <ErrorState kind="error" />
  if (state === "loading") {
    // S-08 v5.5: 목록 자리 표시(행 모양) + 상세 패널 자리 표시
    if (kind === "split")
      return (
        <div className="flex flex-1 flex-col gap-4 lg:flex-row lg:gap-6" aria-busy="true">
          <div className="w-full shrink-0 lg:w-60">
            <ListSkeleton rows={6} />
          </div>
          <div className="min-w-0 flex-1 space-y-6">
            <Skeleton className="h-7 w-48" />
            <FormSkeleton fields={3} />
          </div>
        </div>
      )
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
