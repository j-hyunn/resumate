import { Suspense } from "react"
import { AiConnectionProvider } from "@/components/common/ai-connection-context"
import { PreviewStateSwitcher } from "@/components/common/preview-state-client"
import { AiJobWatcher } from "@/components/common/shell/shell-parts"
import { DeletionIncompleteGuard } from "@/components/common/shell/deletion-guard"
import { PageShellOutageSlot } from "@/components/common/shell/server-slots"

/**
 * L-02 전체 페이지 셸 그룹 (UX v5.6 1.3a, leader Q-8): S-10 프로젝트 상세 · S-44 산출물 상세 live here, outside
 * the L-01 sidebar layout. Each page draws <PageShell> itself (its "저장하기" state belongs to the page).
 * Same providers as `(dashboard)` minus the sidebar; the consent gate is `(page)/(gated)` like `(dashboard)/(gated)`.
 */
export default function PageGroupLayout({ children }: { children: React.ReactNode }) {
  return (
    <AiConnectionProvider>
      {children}
      {/* S-28 장애 배너 → portalled under the page's ShellBar (UQ-PA-17) */}
      <Suspense fallback={null}>
        <PageShellOutageSlot />
      </Suspense>
      <AiJobWatcher />
      <Suspense fallback={null}>
        <PreviewStateSwitcher />
      </Suspense>
      {/* v5.3 A7: deletion_incomplete → S-25 탈퇴 마무리 only (same guard as L-01) */}
      <Suspense fallback={null}>
        <DeletionIncompleteGuard />
      </Suspense>
    </AiConnectionProvider>
  )
}
