"use client"

/**
 * L-01 left menu (design-system 5.1), built on the shadcn sidebar-08 block: inset variant,
 * brand header, NavMain (커리어 · 기업 JD 관리 · 모의 면접 · 지원 현황, fixed order),
 * NavSecondary pinned to the bottom, NavUser in the footer.
 * Unlike the block it collapses to an icon rail (collapsible="icon") — labels become tooltips
 * and count badges become a dot on the icon. Below lg (1024px) it renders as a left Sheet drawer.
 */
import * as React from "react"
import Link from "next/link"
import { usePathname } from "next/navigation"
import { Briefcase, FileText, KanbanSquare, Layers, MessagesSquare, Settings, type LucideIcon } from "lucide-react"
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuBadge,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarRail,
  useSidebar,
} from "@/components/ui/sidebar"
import { MENU_ITEMS, menuKeyForPath, routes, type MenuKey } from "@/lib/routes"
import type { CurrentUser, ShellBadges } from "@/lib/data/shell"
import { getShellBadgesAction } from "@/lib/data/actions"
import { clearNavOrigin } from "../return-target"
import { NavMain } from "./nav-main"
import { NavSecondary, type NavSecondaryItem } from "./nav-secondary"
import { NavUser } from "./nav-user"
import { LogoMark } from "./logo-mark"
import { useSettingsDialog } from "./settings-dialog"
import { NavAiStatus } from "./nav-ai-status"
import { useAiConnection } from "../ai-connection-context"
import type { AiConnection } from "@/types/db"

const MENU_ICONS: Record<MenuKey, LucideIcon> = {
  career: Layers,
  applications: Briefcase,
  interviews: MessagesSquare,
  board: KanbanSquare,
}

const BADGE_POLL_MS = 10_000

function useShellBadges(): ShellBadges | null {
  const pathname = usePathname()
  const [badges, setBadges] = React.useState<ShellBadges | null>(null)
  React.useEffect(() => {
    let alive = true
    const load = async () => {
      const b = await getShellBadgesAction()
      if (alive) setBadges(b)
    }
    void load()
    const t = setInterval(load, BADGE_POLL_MS)
    const onJobs = () => void load()
    window.addEventListener("resumate:ai-jobs-changed", onJobs)
    return () => {
      alive = false
      clearInterval(t)
      window.removeEventListener("resumate:ai-jobs-changed", onJobs)
    }
  }, [pathname])
  return badges
}

function hasMenuBadge(menu: MenuKey, badges: ShellBadges | null): boolean {
  if (!badges) return false
  if (menu === "career") return badges.career_active_chat
  if (menu === "applications") return badges.applications_running_jobs > 0
  if (menu === "interviews") return badges.interviews_in_progress + badges.interviews_new_results > 0
  return false
}

function MenuBadge({ menu, badges }: { menu: MenuKey; badges: ShellBadges | null }) {
  if (!badges) return null
  if (menu === "career" && badges.career_active_chat)
    return (
      <SidebarMenuBadge>
        <span className="size-2 rounded-full bg-primary" aria-hidden />
        <span className="sr-only">작성 중인 AI 대화 있음</span>
      </SidebarMenuBadge>
    )
  if (menu === "applications" && badges.applications_running_jobs > 0)
    return (
      <SidebarMenuBadge>
        {badges.applications_running_jobs}
        <span className="sr-only">진행 중인 AI 작업 {badges.applications_running_jobs}개</span>
      </SidebarMenuBadge>
    )
  if (menu === "interviews") {
    // [UI-가정] 작성 중 세션 수와 새 채점 결과 수를 배지 하나로 합쳐 보이고 각 수는 스크린 리더 문구로 구분
    const total = badges.interviews_in_progress + badges.interviews_new_results
    if (total === 0) return null
    return (
      <SidebarMenuBadge>
        {total}
        <span className="sr-only">
          작성 중 면접 {badges.interviews_in_progress}개, 새 채점 결과 {badges.interviews_new_results}개
        </span>
      </SidebarMenuBadge>
    )
  }
  return null
}

export function AppSidebar({ user }: { user?: CurrentUser | null }) {
  const pathname = usePathname()
  const badges = useShellBadges()
  const aiConnection = useAiConnection()
  return <AppSidebarView pathname={pathname} badges={badges} user={user ?? null} aiConnection={aiConnection} />
}

/** Static first paint (prerendered shell) before pathname is known — wrap AppSidebar in Suspense with this. */
export function AppSidebarFallback() {
  return <AppSidebarView pathname="" badges={null} user={null} aiConnection={null} />
}

function AppSidebarView({
  pathname,
  badges,
  user,
  aiConnection,
}: {
  pathname: string
  badges: ShellBadges | null
  user: CurrentUser | null
  aiConnection: AiConnection | null
}) {
  const active = menuKeyForPath(pathname)
  const { setOpenMobile, isMobile } = useSidebar()
  const { openSettings } = useSettingsDialog()
  const close = () => {
    if (isMobile) setOpenMobile(false)
  }
  // UQ-7: choosing a menu starts a fresh path → forget S-39 / S-37 origin
  const onMenu = () => {
    clearNavOrigin()
    close()
  }

  const navMain = MENU_ITEMS.map((item) => {
    const Icon = MENU_ICONS[item.key]
    return {
      title: item.label,
      url: item.href,
      icon: <Icon aria-hidden />,
      isActive: active === item.key,
      badge: <MenuBadge menu={item.key} badges={badges} />,
      dot: hasMenuBadge(item.key, badges),
      onClick: onMenu,
    }
  })

  // 설정 opens the S-24 dialog (shadcn sidebar-13) instead of navigating
  const openSettingsFromMenu = () => {
    close()
    openSettings()
  }
  const navSecondary: NavSecondaryItem[] = [
    { title: "설정", icon: <Settings aria-hidden />, isActive: pathname.startsWith(routes.withdraw()), onSelect: openSettingsFromMenu },
    { title: "개인정보 처리방침", url: routes.policies(), icon: <FileText aria-hidden />, onClick: close },
  ]

  return (
    <Sidebar variant="inset" collapsible="icon">
      <SidebarHeader>
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton size="lg" asChild tooltip="Resumate">
              <Link href={routes.career()} onClick={onMenu}>
                {/* [UI-가정] 로고 자리: 브랜드 마크가 정해지기 전까지 lucide 아이콘 (LogoMark, shared with L-02) */}
                <LogoMark />
                <div className="grid flex-1 text-left text-sm leading-tight">
                  <span className="truncate font-medium">Resumate</span>
                  {/* [UI-가정] 부제 문구 */}
                  <span className="truncate text-xs">AI 커리어 관리</span>
                </div>
              </Link>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarHeader>
      <SidebarContent>
        {/* [UI-가정] 그룹 라벨 문구 */}
        <NavMain label="메뉴" items={navMain} />
        <NavSecondary
          items={navSecondary}
          className="mt-auto"
          leading={
            <NavAiStatus
              connection={aiConnection}
              onSelect={() => {
                close()
                openSettings("ai-connection")
              }}
            />
          }
        />
      </SidebarContent>
      <SidebarFooter>
        <NavUser user={user ? { name: user.email.split("@")[0] ?? "", email: user.email } : null} onOpenSettings={openSettingsFromMenu} />
      </SidebarFooter>
      <SidebarRail />
    </Sidebar>
  )
}
