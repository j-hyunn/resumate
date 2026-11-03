/**
 * Server parts of the L-01 shell. Each reads request-time data, so the layout wraps them
 * in <Suspense> (Cache Components).
 */
import { getCurrentUser, getServiceStatus } from "@/lib/data/shell"
import { AppSidebar } from "./app-sidebar"
import { AiOutageBanner } from "./shell-parts"
import { PageShellOutagePortal } from "./page-shell-outage"

/** 왼쪽 메뉴 + 하단 사용자 메뉴(계정 이메일) */
export async function ShellSidebar() {
  const user = await getCurrentUser()
  return <AppSidebar user={user} />
}

export async function AiOutageSlot() {
  const status = await getServiceStatus()
  // v2: only when the active provider is affected (S-28)
  const affected = status.active_provider && status.affected_providers.includes(status.active_provider) ? status.active_provider : null
  return <AiOutageBanner provider={affected} />
}

/** L-02 (`(page)` layout): the same banner, portalled under the page's ShellBar (UQ-PA-17). */
export async function PageShellOutageSlot() {
  const status = await getServiceStatus()
  const affected = status.active_provider && status.affected_providers.includes(status.active_provider) ? status.active_provider : null
  return <PageShellOutagePortal provider={affected} />
}
