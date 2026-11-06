"use client"

/**
 * S-24 설정 다이얼로그 — 왼쪽 탭 4개 (UX v5.17a S-24 SD-A1, design-system 5.11): 계정 · AI 연결 · 약관 · 개선 요청.
 * shadcn sidebar-13 "sidebar in a dialog": 전체 폭 머리 "설정" + X · 탭 목록(collapsible="none" sidebar, 글자만) + 스크롤 본문
 * (v5.12 원본 화면 맞춤 — 본문은 컨테이너 쿼리 `@container/settings`로 배치를 바꾼다).
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
import { Loader2, X } from "lucide-react"
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog"
import { Button } from "@/components/ui/button"
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog"
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
import { SETTINGS_VISUAL_STYLE } from "./settings-visual"
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
  const preview = options.preview ?? null

  return (
    // onOpenChange(false) covers 머리 X · Esc · 바깥 누르기 — it asks first when 내 정보 is dirty
    <Dialog open={open} onOpenChange={(o) => !o && onRequestClose()}>
      {/* 크기·높이는 틀에 고정 — 탭을 바꿔도 다이얼로그 크기가 출렁이지 않게 (design-system 5.11 틀, v5.12 G-75) */}
      <DialogContent
        showCloseButton={false}
        style={SETTINGS_VISUAL_STYLE}
        // 첫 포커스 = 선택된 탭 버튼 (머리 X가 첫 tabbable이 되어 열자마자 닫기 쉬운 것을 막는다, QA-43-04).
        // 넓은 화면은 왼쪽 탭 목록, 좁은 화면은 탭 줄 — 보이는 쪽을 고른다.
        onOpenAutoFocus={(e) => {
          const root = e.currentTarget as HTMLElement | null
          const current = Array.from(
            root?.querySelectorAll<HTMLElement>('nav[aria-label="설정 탭"] [aria-current="page"]') ?? [],
          ).find((el) => el.getClientRects().length > 0)
          if (!current) return
          e.preventDefault()
          current.focus({ preventScroll: true })
        }}
        className="flex h-[min(640px,85svh)] flex-col gap-0 overflow-hidden p-0 md:h-[min(760px,calc(100dvh-4rem))] md:max-w-[760px] lg:max-w-[min(1100px,calc(100vw-4rem))]"
      >
        <header className="flex h-14 shrink-0 items-center justify-between gap-2 border-b px-4 md:h-16 md:px-5">
          <DialogTitle className="text-base leading-6 font-semibold">설정</DialogTitle>
          <DialogClose asChild>
            <Button variant="muted-ghost" size="icon-sm" aria-label="닫기">
              <X className="size-5" aria-hidden />
            </Button>
          </DialogClose>
        </header>
        <DialogDescription className="sr-only">
          계정과 내 정보, AI 연결과 사용량, 약관과 선택 동의, 개선 요청을 확인하고 바꿀 수 있어요.
        </DialogDescription>
        <SidebarProvider
          className="min-h-0 flex-1 items-stretch"
          style={{ "--sidebar-width": "13rem" } as React.CSSProperties}
        >
          <Sidebar collapsible="none" className="hidden h-auto md:flex">
            <SidebarContent>
              <SidebarGroup className="p-3">
                <SidebarGroupContent>
                  <nav aria-label="설정 탭">
                    <SidebarMenu className="gap-0">
                      {/* (v5.12) 탭은 글자만 — 아이콘 없음 (원본 화면) */}
                      {SETTINGS_TABS.map((item) => (
                        <SidebarMenuItem key={item.id}>
                          <SidebarMenuButton
                            className="h-10 text-sm"
                            isActive={item.id === tab}
                            aria-current={item.id === tab ? "page" : undefined}
                            onClick={() => onTabChange(item.id)}
                          >
                            <span>{item.label}</span>
                            {item.id === "ai-connection" ? <AiConnectionWarnDot /> : null}
                          </SidebarMenuButton>
                        </SidebarMenuItem>
                      ))}
                    </SidebarMenu>
                  </nav>
                </SidebarGroupContent>
              </SidebarGroup>
            </SidebarContent>
          </Sidebar>
          <main className="flex min-w-0 flex-1 flex-col overflow-hidden bg-popover">
            {/* [UI-가정] G-63 좁은 화면: 왼쪽 탭 대신 4칸 고정 탭 줄 (320px 미만에서만 가로 스크롤) */}
            <nav aria-label="설정 탭" className="shrink-0 overflow-x-auto px-4 pt-3 pb-3 md:hidden">
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
            <div
              id="settings-body"
              className="@container/settings flex-1 overflow-y-auto px-4 pt-0 pb-4 md:px-5 md:pt-5 md:pb-6"
            >
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
