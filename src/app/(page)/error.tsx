"use client"

import { ErrorState } from "@/components/common/state-views"

/** S-28 general error for the L-02 pages (S-10 · S-44), QA UQ-PA-7. Outside a shell: page-centered. */
export default function PageGroupError({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <div className="min-h-dvh bg-shell">
      <ErrorState kind="error" inShell={false} onRetry={reset} />
    </div>
  )
}
