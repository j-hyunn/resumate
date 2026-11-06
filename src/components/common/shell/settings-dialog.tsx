"use client"

/**
 * S-24 설정 다이얼로그 — 왼쪽 탭 4개 (UX v5.17a S-24 SD-A1, design-system 5.11): 계정 · AI 연결 · 약관 · 개선 요청.
 * shadcn sidebar-13 "sidebar in a dialog": 탭 목록(collapsible="none" sidebar) + 머리 "설정 › {탭}" + 스크롤 본문.
 * There are no settings pages: S-24 · S-40 · S-42 live only here (S-25 탈퇴, S-41 키 연결은 밖의 화면).
 *
 * Opened from the L-01 사이드바 / L-02 계정 메뉴 / in-app links via useSettingsDialog() / <SettingsLink>, or by URL
 * `?settings={tab}[&provider=]` (routes.settings — the fallback for screens without this provider). v5.10 섹션 ID
 * (`withdraw` · `ai-usage` · `consents` · `ai-data`)는 URL에서만 받아 탭 + 스크롤 위치로 바꾼다.
 * 열 때 고를 탭 = 진입점이 지정한 탭, 없으면 계정. 탭마다 열 때 다시 읽는다.
 *
 * 미저장 확인 (`UnsavedChangesConfirm`): 계정 탭 "내 정보"에 저장하지 않은 변경이 있으면 닫기(Esc · 바깥 누르기 ·
 * 메뉴 다시 열기 포함) · 탭 전환 · [회원 탈퇴] 전에 묻는다. 로그아웃은 묻지 않는다.
 */
import * as React from "react"
import Link from "next/link"
import { usePathname, useRouter, useSearchParams } from "next/navigation"
import { Loader2 } from "lucide-react"
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog"
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
import { routes } from "@/lib/routes"
import { readPreviewState } from "@/lib/preview-state"
import type { AiProviderName } from "@/types/db"
import { AccountTab } from "@/components/account/account-tab"
import { AiConnectionPanel } from "@/components/account/ai-connection-panel"
import { FeedbackTab } from "@/components/account/feedback-tab"
import { PoliciesTab } from "@/components/account/policies-tab"
import { SETTINGS_TABS, resolveSettingsSection, type SettingsTabId } from "@/components/account/settings-section-list"
import { useAiConnectionBase } from "../ai-connection-context"
import { SettingsGuardContext, type SettingsGuard, type SettingsGuardContextValue } from "./settings-guard"

export interface OpenSettingsOptions {
  /** AI 연결 탭: scroll to this provider's row (`#provider-row-{p}`, C-19 경고 → 해당 행) */
  provider?: AiProviderName | null
  /** scroll anchor inside the tab (old section ids: `#settings-danger-zone`, `#settings-ai-usage`) */
  anchor?: string | null
  /** dev `?state=` preview for the tab bodies (only when opened by URL) */
  preview?: string | null
}

interface SettingsDialogContextValue {
  openSettings: (tab?: SettingsTabId, options?: OpenSettingsOptions) => void
}

const SettingsDialogContext = React.createContext<SettingsDialogContextValue | null>(null)

export function useSettingsDialog(): SettingsDialogContextValue {
  const ctx = React.useContext(SettingsDialogContext)
  if (!ctx) throw new Error("useSettingsDialog must be used within SettingsDialogProvider")
  return ctx
}

const PROVIDERS = new Set<string>(["gemini", "anthropic", "openai"])

/**
 * Link that opens the settings dialog on `section` (a tab). Inside a provider it opens in place (no
 * navigation, so the L-02 leave guard skips it); elsewhere it navigates to routes.settings().
 */
export function SettingsLink({
  section,
  provider,
  onClick,
  ...props
}: Omit<React.ComponentProps<typeof Link>, "href"> & { section: SettingsTabId; provider?: AiProviderName | null }) {
  const ctx = React.useContext(SettingsDialogContext)
  return (
    <Link
      {...props}
      href={routes.settings(section, provider ?? undefined)}
      data-leave-guard={ctx ? "skip" : undefined}
      onClick={(e) => {
        onClick?.(e)
        if (!ctx || e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return
        e.preventDefault()
        ctx.openSettings(section, { provider })
      }}
    />
  )
}

/** `?settings={tab | 옛 섹션 ID}[&provider=]` → open the dialog, then drop those params (keeps the rest) */
function SettingsUrlOpener({ open }: { open: SettingsDialogContextValue["openSettings"] }) {
  const params = useSearchParams()
  const pathname = usePathname()
  const router = useRouter()
  const section = params.get("settings")
  React.useEffect(() => {
    if (!section) return
    const provider = params.get("provider")
    const { tab, anchor } = resolveSettingsSection(section)
    open(tab, {
      provider: provider && PROVIDERS.has(provider) ? (provider as AiProviderName) : null,
      anchor: anchor ?? null,
      preview: readPreviewState(params),
    })
    const next = new URLSearchParams(params.toString())
    next.delete("settings")
    next.delete("provider")
    const qs = next.toString()
    router.replace(`${pathname}${qs ? `?${qs}` : ""}${window.location.hash}`, { scroll: false })
  }, [section, params, pathname, router, open])
  return null
}

export function SettingsDialogProvider({ children }: { children: React.ReactNode }) {
  const [open, setOpen] = React.useState(false)
  const [tab, setTab] = React.useState<SettingsTabId>("account")
  const [options, setOptions] = React.useState<OpenSettingsOptions>({})
  /** bumps on every fresh open so tab bodies remount and read again */
  const [session, setSession] = React.useState(0)
  const openRef = React.useRef(false)
  const tabRef = React.useRef<SettingsTabId>("account")
  React.useEffect(() => {
    openRef.current = open
    tabRef.current = tab
  }, [open, tab])

  // 미저장 확인 — the 계정 탭 "내 정보" registers a guard while mounted
  const guardRef = React.useRef<SettingsGuard | null>(null)
  const [pending, setPending] = React.useState<(() => void) | null>(null)
  const [savingFromConfirm, setSavingFromConfirm] = React.useState(false)

  const runGuarded = React.useCallback((action: () => void) => {
    if (guardRef.current?.isDirty()) setPending(() => action)
    else action()
  }, [])
  const guardValue = React.useMemo<SettingsGuardContextValue>(
    () => ({
      register: (g) => {
        guardRef.current = g
      },
      runGuarded,
    }),
    [runGuarded],
  )

  const value = React.useMemo<SettingsDialogContextValue>(
    () => ({
      openSettings: (t, o) => {
        const nextTab = t ?? "account"
        if (openRef.current) {
          // already open (e.g. 계정 메뉴 다시 열기, 탭 안 링크): switching tabs goes through the guard
          const apply = () => {
            setTab(nextTab)
            setOptions((prev) => ({ provider: o?.provider ?? null, anchor: o?.anchor ?? null, preview: o?.preview ?? prev.preview }))
          }
          if (nextTab === tabRef.current) apply()
          else runGuarded(apply)
          return
        }
        setTab(nextTab)
        setOptions({ provider: o?.provider ?? null, anchor: o?.anchor ?? null, preview: o?.preview ?? null })
        setSession((s) => s + 1)
        setOpen(true)
      },
    }),
    [runGuarded],
  )

  /** close without asking (after the guard already ran, or when leaving for S-25 / S-41) */
  const forceClose = React.useCallback(() => {
    guardRef.current = null
    setOpen(false)
  }, [])

  return (
    <SettingsDialogContext.Provider value={value}>
      {children}
      <React.Suspense fallback={null}>
        <SettingsUrlOpener open={value.openSettings} />
      </React.Suspense>
      <SettingsGuardContext.Provider value={guardValue}>
        <SettingsDialog
          open={open}
          onRequestClose={() => runGuarded(forceClose)}
          onNavigate={forceClose}
          tab={tab}
          onTabChange={(t) => {
            if (t === tab) return
            runGuarded(() => {
              setTab(t)
              setOptions((prev) => ({ ...prev, provider: null, anchor: null }))
            })
          }}
          options={options}
          session={session}
        />
        <UnsavedChangesConfirm
          open={pending !== null}
          saving={savingFromConfirm}
          onStay={() => !savingFromConfirm && setPending(null)}
          onDiscard={() => {
            const action = pending
            guardRef.current?.discard()
            setPending(null)
            action?.()
          }}
          onSave={async () => {
            const action = pending
            setSavingFromConfirm(true)
            const ok = (await guardRef.current?.save()) ?? true
            setSavingFromConfirm(false)
            setPending(null)
            // 검증 오류·저장 실패면 확인 창만 닫고 계정 탭에 남는다 (폼이 첫 오류 칸·실패 줄로 포커스)
            if (ok) action?.()
          }}
        />
      </SettingsGuardContext.Provider>
    </SettingsDialogContext.Provider>
  )
}

/** "AI 연결" tab: warning dot + sr-only state when the active key is invalid / needs_check (5.11, G-64) */
function AiConnectionWarnDot({ className }: { className?: string }) {
  const c = useAiConnectionBase()
  if (c?.key_status !== "invalid" && c?.key_status !== "needs_check") return null
  return (
    <>
      <span className={className ?? "ml-auto size-2 shrink-0 rounded-full bg-warning"} aria-hidden />
      <span className="sr-only">{c.key_status === "invalid" ? "키를 확인해 주세요" : "확인 필요"}</span>
    </>
  )
}

function SettingsDialog({
  open,
  onRequestClose,
  onNavigate,
  tab,
  onTabChange,
  options,
  session,
}: {
  open: boolean
  onRequestClose: () => void
  onNavigate: () => void
  tab: SettingsTabId
  onTabChange: (t: SettingsTabId) => void
  options: OpenSettingsOptions
  session: number
}) {
  const current = SETTINGS_TABS.find((t) => t.id === tab) ?? SETTINGS_TABS[0]
  const preview = options.preview ?? null

  return (
    // onOpenChange(false) covers Esc · 바깥 누르기 — it asks first when 내 정보 is dirty
    <Dialog open={open} onOpenChange={(o) => !o && onRequestClose()}>
      <DialogContent className="overflow-hidden p-0 md:max-w-[760px] lg:max-w-[880px]">
        <DialogTitle className="sr-only">설정</DialogTitle>
        <DialogDescription className="sr-only">
          계정과 내 정보, AI 연결과 사용량, 약관과 선택 동의, 개선 요청을 확인하고 바꿀 수 있어요.
        </DialogDescription>
        <SidebarProvider className="min-h-0 items-start" style={{ "--sidebar-width": "12rem" } as React.CSSProperties}>
          <Sidebar collapsible="none" className="hidden md:flex">
            <SidebarContent>
              <SidebarGroup>
                <SidebarGroupContent>
                  <nav aria-label="설정 탭">
                    <SidebarMenu>
                      {SETTINGS_TABS.map((item) => {
                        const Icon = item.icon
                        return (
                          <SidebarMenuItem key={item.id}>
                            <SidebarMenuButton
                              className="h-10 text-base [&>svg]:size-5"
                              isActive={item.id === tab}
                              aria-current={item.id === tab ? "page" : undefined}
                              onClick={() => onTabChange(item.id)}
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
          {/* 높이는 틀에 고정 — 탭을 바꿔도 다이얼로그 크기가 출렁이지 않게 (G-62) */}
          <main className="flex h-[min(640px,85svh)] min-w-0 flex-1 flex-col overflow-hidden md:h-[min(640px,calc(100dvh-4rem))]">
            <header className="flex h-14 shrink-0 items-center px-4 md:h-16 md:px-6">
              <Breadcrumb>
                <BreadcrumbList>
                  <BreadcrumbItem className="hidden md:block">설정</BreadcrumbItem>
                  <BreadcrumbSeparator className="hidden md:block" />
                  <BreadcrumbItem>
                    <BreadcrumbPage>{current.label}</BreadcrumbPage>
                  </BreadcrumbItem>
                </BreadcrumbList>
              </Breadcrumb>
            </header>
            {/* [UI-가정] G-63 좁은 화면: 왼쪽 탭 대신 4칸 고정 탭 줄 (320px 미만에서만 가로 스크롤) */}
            <nav aria-label="설정 탭" className="shrink-0 overflow-x-auto px-4 pb-3 md:hidden">
              <div className="grid min-w-72 grid-cols-4 gap-1">
                {SETTINGS_TABS.map((item) => (
                  <Button
                    key={item.id}
                    size="sm"
                    variant={item.id === tab ? "secondary" : "ghost"}
                    aria-current={item.id === tab ? "page" : undefined}
                    onClick={() => onTabChange(item.id)}
                    className="px-1"
                  >
                    {item.label}
                    {item.id === "ai-connection" ? <AiConnectionWarnDot className="ml-1 size-2 shrink-0 rounded-full bg-warning" /> : null}
                  </Button>
                ))}
              </div>
            </nav>
            <div id="settings-body" className="flex-1 overflow-y-auto px-4 pb-4 md:px-6 md:pb-6">
              <TabBody key={`${session}:${tab}`} tab={tab} options={options} preview={preview} onNavigate={onNavigate} />
            </div>
          </main>
        </SidebarProvider>
      </DialogContent>
    </Dialog>
  )
}

function TabBody({
  tab,
  options,
  preview,
  onNavigate,
}: {
  tab: SettingsTabId
  options: OpenSettingsOptions
  preview: string | null
  onNavigate: () => void
}) {
  switch (tab) {
    case "account":
      return <AccountTab onNavigate={onNavigate} scrollTo={options.anchor ?? null} preview={preview} />
    case "ai-connection":
      return (
        <AiConnectionPanel
          onNavigate={onNavigate}
          focusProvider={options.provider ?? null}
          scrollTo={options.anchor ?? null}
          preview={preview}
        />
      )
    case "policies":
      return <PoliciesTab preview={preview} />
    case "feedback":
      return <FeedbackTab preview={preview} />
  }
}

/**
 * 미저장 확인 (design-system 5.11 `UnsavedChangesConfirm`): L-02 LeaveGuard와 같은 AlertDialog 모양.
 * X = 계속 편집. 탭 전환·회원 탈퇴일 때도 버튼 글자는 "…닫기"다 — 확정 2026-11-06 (사용자, UI42-1, P-22).
 */
function UnsavedChangesConfirm({
  open,
  saving,
  onStay,
  onDiscard,
  onSave,
}: {
  open: boolean
  saving: boolean
  onStay: () => void
  onDiscard: () => void
  onSave: () => void
}) {
  return (
    <AlertDialog open={open} onOpenChange={(o) => !o && onStay()}>
      <AlertDialogContent className="sm:max-w-md">
        <AlertDialogHeader>
          <AlertDialogTitle>저장하지 않은 변경이 있어요</AlertDialogTitle>
          {/* [UI-가정] 설명 줄 (플로우는 제목과 버튼만 정함 — L-02 LeaveGuard와 같은 방식) */}
          <AlertDialogDescription>저장하지 않고 닫으면 내 정보에서 고친 내용이 사라져요</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <Button variant="muted-ghost" disabled={saving} onClick={onDiscard}>
            저장하지 않고 닫기
          </Button>
          <Button onClick={onSave} disabled={saving}>
            {saving ? <Loader2 className="animate-spin" aria-hidden /> : null}
            저장하고 닫기
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}
