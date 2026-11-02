"use client"

import { ErrorState } from "@/components/common/state-views"

/** S-28 general error inside the shell */
export default function DashboardError({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return <ErrorState kind="error" onRetry={reset} />
}
