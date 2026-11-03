import { Suspense } from "react"
import { ConsentGate } from "@/server/auth/consent-gate"
import { PageShellSkeleton } from "@/components/common/shell/page-shell-skeleton"

/**
 * F-COM-02 gate for the L-02 pages — identical to `(dashboard)/(gated)` (leader Q-8: same auth / consent gating).
 * A2 puts S-10 (`career/projects/[id]`, `career/projects/new`) and S-44 (`career/deliverables/[id]`,
 * `career/projects/[id]/deliverables/new`) under this group and removes the `(dashboard)` copies.
 */
export default function PageGatedLayout({ children }: { children: React.ReactNode }) {
  return (
    <Suspense fallback={<PageShellSkeleton />}>
      <ConsentGate>{children}</ConsentGate>
    </Suspense>
  )
}
