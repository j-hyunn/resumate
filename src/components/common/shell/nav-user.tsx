"use client"

/**
 * Account menu (shadcn sidebar-08 NavUser): identity · 설정(dialog) · 다크 모드 · 로그아웃.
 * `AccountMenuContent` is the one popover body — the L-01 footer NavUser and the L-02 ShellBar avatar both render it,
 * so the two menus look and list the same (the sidebar version is the reference).
 */
import * as React from "react"
import { useRouter } from "next/navigation"
import { ChevronsUpDown, LogOut, Moon, Settings } from "lucide-react"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { Switch } from "@/components/ui/switch"
import { SidebarMenu, SidebarMenuButton, SidebarMenuItem, useSidebar } from "@/components/ui/sidebar"
import { cn } from "@/lib/utils"
import { routes } from "@/lib/routes"
import { clearUserUnsavedInput } from "@/components/common/clear-user-storage"
import { shellSignOutAction } from "@/lib/data/actions"
import { useResolvedTheme, useTheme } from "../theme"
import { UserAvatar } from "./user-avatar"

export interface AccountMenuUser {
  name: string
  email: string
  avatarUrl: string | null
}

function AccountIdentity({ user }: { user: AccountMenuUser | null }) {
  return (
    <>
      <UserAvatar name={user?.name ?? ""} avatarUrl={user?.avatarUrl ?? null} />
      <div className="grid flex-1 text-left text-sm leading-tight">
        <span className="truncate font-medium">{user?.name ?? ""}</span>
        <span className="truncate text-xs">{user?.email ?? ""}</span>
      </div>
    </>
  )
}

/** Sign out, then leave to S-01 even if it failed ([UI-가정] S-24). */
export function useAccountSignOut() {
  const router = useRouter()
  return React.useCallback(async () => {
    try {
      await shellSignOutAction()
    } catch {
      // [UI-가정] S-24와 같이 실패해도 로그인 전 화면으로 나간다
    } finally {
      clearUserUnsavedInput() // U40-1: before the redirect
      router.replace(routes.landing())
    }
  }, [router])
}

/**
 * 다크 모드 on/off (light ↔ dark only) — 화면 테마의 유일한 입구 (UX v5.17 SD-A16, design-system 5.11: 설정에
 * "화면" 섹션은 없다). 저장값이 없으면(처음) 시스템 설정을 따르고, 첫 토글이 라이트/다크로 고정한다.
 * 확정 2026-11-06 (사용자, UI42-6, P-23): 테마는 계정 메뉴에만 둔다 — 설정 탭에 테마 행을 다시 넣지 않는다.
 * The menu stays open so the switch can be seen flipping.
 */
function ThemeToggleItem() {
  const { setTheme } = useTheme()
  const dark = useResolvedTheme() === "dark"
  return (
    <DropdownMenuItem
      role="menuitemcheckbox"
      aria-checked={dark}
      onSelect={(e) => {
        e.preventDefault()
        setTheme(dark ? "light" : "dark")
      }}
    >
      <Moon aria-hidden />
      다크 모드
      <Switch checked={dark} tabIndex={-1} aria-hidden className="pointer-events-none ml-auto" />
    </DropdownMenuItem>
  )
}

/** Shared popover body: identity header · 설정 · 다크 모드 · 로그아웃. */
export function AccountMenuContent({
  user,
  onOpenSettings,
  onSignOut,
  className,
  ...props
}: Omit<React.ComponentProps<typeof DropdownMenuContent>, "children"> & {
  user: AccountMenuUser | null
  onOpenSettings: () => void
  onSignOut: () => void
}) {
  return (
    <DropdownMenuContent className={cn("min-w-56 rounded-lg", className)} sideOffset={4} {...props}>
      <DropdownMenuLabel className="p-0 font-normal">
        <div className="flex items-center gap-2 px-1 py-1.5 text-left text-sm">
          <AccountIdentity user={user} />
        </div>
      </DropdownMenuLabel>
      <DropdownMenuSeparator />
      <DropdownMenuGroup>
        <DropdownMenuItem onSelect={onOpenSettings}>
          <Settings aria-hidden />
          설정
        </DropdownMenuItem>
        <ThemeToggleItem />
      </DropdownMenuGroup>
      <DropdownMenuSeparator />
      <DropdownMenuItem onSelect={onSignOut}>
        <LogOut aria-hidden />
        로그아웃
      </DropdownMenuItem>
    </DropdownMenuContent>
  )
}

export function NavUser({ user, onOpenSettings }: { user: AccountMenuUser | null; onOpenSettings: () => void }) {
  const { isMobile } = useSidebar()
  const signOut = useAccountSignOut()

  return (
    <SidebarMenu>
      <SidebarMenuItem>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <SidebarMenuButton
              size="lg"
              tooltip="계정"
              className="data-[state=open]:bg-sidebar-accent data-[state=open]:text-sidebar-accent-foreground"
            >
              <AccountIdentity user={user} />
              <ChevronsUpDown className="ml-auto size-4" aria-hidden />
              <span className="sr-only">계정 메뉴 열기</span>
            </SidebarMenuButton>
          </DropdownMenuTrigger>
          <AccountMenuContent
            user={user}
            onOpenSettings={onOpenSettings}
            onSignOut={() => void signOut()}
            className="w-(--radix-dropdown-menu-trigger-width)"
            side={isMobile ? "bottom" : "right"}
            align="end"
          />
        </DropdownMenu>
      </SidebarMenuItem>
    </SidebarMenu>
  )
}
