"use client"

/**
 * S-24 설정 as a dialog (shadcn sidebar-13 "sidebar in a dialog"): section list on the left
 * (collapsible="none" sidebar), breadcrumb "설정 › {section}" + scrolling body on the right.
 * Opened from the L-01 사이드바 (NavSecondary 설정, NavUser 설정) via useSettingsDialog().
 * Below md the block hides the section list, so a horizontal section strip replaces it [UI-가정].
 * Data (email + consent statuses) is read when the dialog opens.
 */
import * as React from "react"
import { RotateCcw } from "lucide-react"
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from "@/components/ui/breadcrumb"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog"
import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarGroupContent,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarProvider,
} from "@/components/ui/sidebar"
import { Skeleton } from "@/components/ui/skeleton"
import { cn } from "@/lib/utils"
import { getSettingsDataAction } from "@/components/account/actions"
import { SettingsSectionBody, type SettingsData } from "@/components/account/settings-sections"
import { SETTINGS_SECTIONS, type SettingsSectionId } from "@/components/account/settings-section-list"
import { useAiConnectionBase } from "../ai-connection-context"

interface SettingsDialogContextValue {
  openSettings: (section?: SettingsSectionId) => void
}

const SettingsDialogContext = React.createContext<SettingsDialogContextValue | null>(null)

export function useSettingsDialog(): SettingsDialogContextValue {
  const ctx = React.useContext(SettingsDialogContext)
  if (!ctx) throw new Error("useSettingsDialog must be used within SettingsDialogProvider")
  return ctx
}

type LoadState = { status: "loading" } | { status: "error" } | { status: "ready"; data: SettingsData }

export function SettingsDialogProvider({ children }: { children: React.ReactNode }) {
  const [open, setOpen] = React.useState(false)
  const [section, setSection] = React.useState<SettingsSectionId>("account")
  const [load, setLoad] = React.useState<LoadState>({ status: "loading" })

  // read fresh data every time the dialog opens (consents may have changed elsewhere)
  const fetchData = React.useCallback(async () => {
    setLoad({ status: "loading" })
    const res = await getSettingsDataAction()
    setLoad(res.ok ? { status: "ready", data: { email: res.email, statuses: res.statuses } } : { status: "error" })
  }, [])

  const value = React.useMemo<SettingsDialogContextValue>(
    () => ({
      openSettings: (s) => {
        setSection(s ?? "account")
        setOpen(true)
        void fetchData()
      },
    }),
    [fetchData],
  )
  return (
    <SettingsDialogContext.Provider value={value}>
      {children}
      <SettingsDialog
        open={open}
        onOpenChange={setOpen}
        section={section}
        onSectionChange={setSection}
        load={load}
        onRetry={() => void fetchData()}
      />
    </SettingsDialogContext.Provider>
  )
}

/** "AI 연결" item: warning dot + sr-only state when the key is invalid / needs_check (5.1) */
function AiConnectionWarnDot() {
  const c = useAiConnectionBase()
  if (c?.key_status !== "invalid" && c?.key_status !== "needs_check") return null
  return (
    <>
      <span className="ml-auto size-2 shrink-0 rounded-full bg-warning" aria-hidden />
      <span className="sr-only">{c.key_status === "invalid" ? "키를 확인해 주세요" : "확인 필요"}</span>
    </>
  )
}

function SettingsDialog({
  open,
  onOpenChange,
  section,
  onSectionChange,
  load,
  onRetry,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  section: SettingsSectionId
  onSectionChange: (s: SettingsSectionId) => void
  load: LoadState
  onRetry: () => void
}) {
  const current = SETTINGS_SECTIONS.find((s) => s.id === section) ?? SETTINGS_SECTIONS[0]
  const close = () => onOpenChange(false)

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="overflow-hidden p-0 md:max-h-[500px] md:max-w-[700px] lg:max-w-[800px]">
        <DialogTitle className="sr-only">설정</DialogTitle>
        <DialogDescription className="sr-only">계정, AI 연결과 사용량, 동의, AI 데이터 처리, 약관, 회원 탈퇴를 확인하고 바꿀 수 있어요.</DialogDescription>
        <SidebarProvider className="min-h-0 items-start">
          <Sidebar collapsible="none" className="hidden md:flex">
            <SidebarContent>
              <SidebarGroup>
                <SidebarGroupContent>
                  <nav aria-label="설정 섹션">
                    <SidebarMenu>
                      {SETTINGS_SECTIONS.map((item) => {
                        const Icon = item.icon
                        return (
                          <SidebarMenuItem key={item.id}>
                            <SidebarMenuButton
                              isActive={item.id === section}
                              aria-current={item.id === section ? "page" : undefined}
                              onClick={() => onSectionChange(item.id)}
                            >
                              <Icon aria-hidden />
                              <span>{item.label}</span>
                              {item.id === "ai-connection" ? <AiConnectionWarnDot /> : null}
                            </SidebarMenuButton>
                          </SidebarMenuItem>
                        )
                      })}
                    </SidebarMenu>
                  </nav>
                </SidebarGroupContent>
              </SidebarGroup>
            </SidebarContent>
          </Sidebar>
          <main className="flex h-[480px] flex-1 flex-col overflow-hidden max-md:h-[min(560px,80svh)]">
            <header className="flex h-16 shrink-0 items-center gap-2">
              <div className="flex items-center gap-2 px-4">
                <Breadcrumb>
                  <BreadcrumbList>
                    <BreadcrumbItem className="hidden md:block">설정</BreadcrumbItem>
                    <BreadcrumbSeparator className="hidden md:block" />
                    <BreadcrumbItem>
                      <BreadcrumbPage>{current.label}</BreadcrumbPage>
                    </BreadcrumbItem>
                  </BreadcrumbList>
                </Breadcrumb>
              </div>
            </header>
            {/* [UI-가정] 좁은 화면: 블록이 숨기는 왼쪽 목록 대신 가로 섹션 탭 */}
            <nav aria-label="설정 섹션" className="flex shrink-0 gap-1 overflow-x-auto px-4 pb-3 md:hidden">
              {SETTINGS_SECTIONS.map((item) => (
                <Button
                  key={item.id}
                  size="sm"
                  variant={item.id === section ? "secondary" : "ghost"}
                  aria-current={item.id === section ? "page" : undefined}
                  onClick={() => onSectionChange(item.id)}
                  className="shrink-0"
                >
                  {item.label}
                  {item.id === "ai-connection" ? <AiConnectionWarnDot /> : null}
                </Button>
              ))}
            </nav>
            <div className="flex flex-1 flex-col gap-4 overflow-y-auto p-4 pt-0">
              {current.description ? <p className="text-sm text-muted-foreground">{current.description}</p> : null}
              <div className={cn("max-w-3xl", load.status !== "ready" && "space-y-3")}>
                {load.status === "loading" ? (
                  <>
                    <Skeleton className="h-5 w-2/3" />
                    <Skeleton className="h-5 w-1/2" />
                    <Skeleton className="h-10 w-48" />
                  </>
                ) : load.status === "error" ? (
                  <div className="space-y-3">
                    {/* [UI-가정] 설정 불러오기 실패 문구 */}
                    <p className="text-sm text-destructive">설정을 불러오지 못했어요.</p>
                    <Button variant="outline" size="sm" onClick={onRetry}>
                      <RotateCcw aria-hidden />
                      다시 시도
                    </Button>
                  </div>
                ) : (
                  <SettingsSectionBody section={section} data={load.data} onNavigate={close} />
                )}
              </div>
            </div>
          </main>
        </SidebarProvider>
      </DialogContent>
    </Dialog>
  )
}
