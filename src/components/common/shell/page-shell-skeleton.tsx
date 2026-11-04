/**
 * L-02 로딩 (S-10 / S-44 상태 "로딩": 머리·STAR 자리 표시, 패널은 기록 목록 자리 표시). Server-safe.
 * Same box rules as PageShell / DocHead / DocBody (design-system 5.8 "창이 스크롤되지 않게 하는 규칙", 5.9 —
 * UQ-SC-4): shell and card `relative overflow-clip`, head capped at 40% and shrinkable, body ≥ 50% of the card.
 */
import { Skeleton } from "@/components/ui/skeleton"

export function PageShellSkeleton({ rows = 5 }: { rows?: number }) {
  return (
    <div className="relative flex h-dvh flex-col overflow-clip bg-shell" aria-busy="true">
      <span className="sr-only">불러오는 중</span>
      <div className="flex h-14 shrink-0 items-center gap-2 px-4">
        <Skeleton className="size-7 rounded-lg" />
        <Skeleton className="h-4 w-20" />
        <Skeleton className="ml-auto h-10 w-[6.5rem]" />
        <Skeleton className="size-9 rounded-full" />
      </div>
      <div className="relative mx-2 mb-2 flex min-h-0 flex-1 flex-col overflow-clip rounded-2xl bg-card shadow-sm max-md:m-0 max-md:rounded-none">
        <div className="flex h-12 shrink-0 items-center gap-2 px-6">
          <Skeleton className="size-8 rounded-full" />
          <Skeleton className="h-4 w-64" />
        </div>
        <div className="relative max-h-[40%] min-h-0 shrink space-y-3 overflow-hidden px-6 pt-2 pb-4 max-md:px-4">
          <Skeleton className="h-8 w-80" />
          <Skeleton className="h-8 w-96" />
          <Skeleton className="h-8 w-72" />
        </div>
        <div className="flex min-h-[50%] flex-1 border-t">
          <div className="relative min-w-0 flex-1 space-y-8 overflow-hidden px-6 py-6 max-md:px-4">
            {Array.from({ length: rows }, (_, i) => (
              <div key={i} className="max-w-[42rem] space-y-2">
                <Skeleton className="h-5 w-32" />
                <Skeleton className="h-16 w-full" />
              </div>
            ))}
          </div>
          <div className="my-3 mr-3 hidden w-[26.25rem] space-y-2 rounded-xl bg-panel p-3 lg:block">
            <Skeleton className="h-8 w-40" />
            <Skeleton className="h-12 w-full" />
            <Skeleton className="h-12 w-full" />
            <Skeleton className="h-12 w-full" />
          </div>
        </div>
      </div>
    </div>
  )
}
