import { Suspense } from "react"
import { SidebarInset, SidebarProvider } from "@/components/ui/sidebar"
import { AppSidebarFallback } from "@/components/common/shell/app-sidebar"
import { CrumbProvider } from "@/components/common/shell/breadcrumbs"
import { AiJobWatcher, TopBar, TopBarFallback } from "@/components/common/shell/shell-parts"
import { CareerReturnSlot } from "@/components/common/shell/career-return-slot"
import { AiOutageSlot, ShellSidebar } from "@/components/common/shell/server-slots"
import { SettingsDialogProvider } from "@/components/common/shell/settings-dialog"
import { PreviewStateSwitcher } from "@/components/common/preview-state-client"
import { AiConnectionProvider } from "@/components/common/ai-connection-context"
import { DeletionIncompleteGuard } from "@/components/common/shell/deletion-guard"

/**
 * L-01 대시보드 셸. Pages render inside <main> with the page gutter; each page sets its
 * own width token (max-w-page / max-w-form / full width) and its breadcrumb via <PageCrumbs>.
 * S-24 설정 opens as a dialog from the sidebar (SettingsDialogProvider).
 * The inset panel is the scroll container (viewport height), so the top bar stays fixed inside it.
 */
export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  return (
    <SidebarProvider>
      <AiConnectionProvider>
      <SettingsDialogProvider>
        <CrumbProvider>
          <Suspense fallback={<AppSidebarFallback />}>
            <ShellSidebar />
          </Suspense>
          <SidebarInset className="h-dvh min-w-0 overflow-y-auto lg:h-[calc(100dvh-1rem)]">
            <Suspense fallback={<TopBarFallback />}>
              <TopBar />
            </Suspense>
            <Suspense fallback={null}>
              <AiOutageSlot />
            </Suspense>
            <Suspense fallback={null}>
              <CareerReturnSlot />
            </Suspense>
            <div id="main" className="flex flex-1 flex-col gap-4 p-4 pt-0">
              {children}
            </div>
          </SidebarInset>
          <AiJobWatcher />
          <Suspense fallback={null}>
            <PreviewStateSwitcher />
          </Suspense>
          {/* v5.3 A7: deletion_incomplete → S-25 탈퇴 마무리 only */}
          <Suspense fallback={null}>
            <DeletionIncompleteGuard />
          </Suspense>
        </CrumbProvider>
      </SettingsDialogProvider>
      </AiConnectionProvider>
    </SidebarProvider>
  )
}
