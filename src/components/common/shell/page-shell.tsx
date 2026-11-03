"use client"

/**
 * L-02 전체 페이지 셸 (UX v5.6 1.3a, design-system v4 5.8) — S-10 프로젝트 상세 · S-44 산출물 상세.
 * No left menu: ShellBar (로고 · [Resumate AI] · C-06 · 저장하기 · 계정) above one white card.
 *
 *   const guard = useLeaveGuard({ dirty, onSave: save, onDiscard: preserved.clear })
 *   <PageShell guard={guard} save={<SaveButton state=… onSave=… />} aiReopen={panel.reopen}>
 *     <CrumbRow … /> <banners/> <head/> <Separator/> <DocBody … />
 *   </PageShell>
 *   <StaleWriteDialog … />
 *
 * Everything that leaves the page in-app goes through `guard.navigate(href)` (logo, account menu, ←, 이동 경로)
 * or is caught by the document click capture (any other `<a>`: C-10 "돌아가기", C-02 …). Browser close /
 * reload → `beforeunload`. // [UI-가정] browser back / forward is not intercepted (no reliable SPA hook).
 */
import * as React from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { toast } from "sonner"
import { ArrowLeft, Check, CircleAlert, CircleUserRound, FileText, History, KeyRound, Loader2, LogOut, Settings, Sparkles, UserRound } from "lucide-react"
import { cn } from "@/lib/utils"
import { Alert, AlertDescription } from "@/components/ui/alert"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog"
import { Breadcrumb, BreadcrumbItem, BreadcrumbList, BreadcrumbPage, BreadcrumbSeparator } from "@/components/ui/breadcrumb"
import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { formatTime } from "@/lib/data/labels"
import { shellSignOutAction } from "@/lib/data/actions"
import { routes } from "@/lib/routes"
import { ACCOUNT_MENU_ITEMS, type AccountMenuItem } from "./account-menu-items"
import { LogoMark } from "./logo-mark"
import { useToasterPosition } from "./shell-parts"
import { createPreservationStore } from "./input-preservation"
import { registerOutageSlot } from "./page-shell-outage"

// ---------------------------------------------------------------------------
// LeaveGuard — 페이지 단위 이탈 확인 (1.3a 이탈 확인, UX-7)
// ---------------------------------------------------------------------------

type LeaveTarget = string | (() => void)

export interface LeaveGuardController {
  dirty: boolean
  /** Leave to `href` (or run `fn`), asking first when there are unsaved edits. */
  navigate: (target: LeaveTarget) => void
  /** internal: dialog state */
  pending: LeaveTarget | null
  saving: boolean
  cancel: () => void
  leaveWithoutSaving: () => void
  saveAndLeave: () => Promise<void>
  /**
   * StaleWriteDialog "새로 불러오기" (QA UQ-PA-18): drop unsaved edits + [반영] memory (`onDiscard`, i.e. the
   * input preservation) and read the page again — no browser leave prompt, no restore banner afterwards.
   */
  reloadDiscarding: () => void
}

const LeaveGuardContext = React.createContext<LeaveGuardController | null>(null)

/** The page's guard (inside <PageShell>). Outside a page shell: plain navigation. */
export function usePageLeave(): (target: LeaveTarget) => void {
  const guard = React.useContext(LeaveGuardContext)
  const router = useRouter()
  return React.useCallback(
    (target: LeaveTarget) => {
      if (guard) return guard.navigate(target)
      if (typeof target === "function") target()
      else router.push(target)
    },
    [guard, router],
  )
}

function isGuardableClick(e: MouseEvent): string | null {
  if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return null
  const a = (e.target as Element | null)?.closest?.("a[href]") as HTMLAnchorElement | null
  if (!a || a.target === "_blank" || a.hasAttribute("download") || a.dataset.leaveGuard === "skip") return null
  const url = new URL(a.href, window.location.href)
  if (url.origin !== window.location.origin) return null
  // same page (hash / query only to this path) isn't a leave
  if (url.pathname === window.location.pathname && url.search === window.location.search) return null
  return url.pathname + url.search + url.hash
}

/**
 * @param dirty unsaved edits (direct input + AI [반영] fills)
 * @param onSave the page's "저장하기"; resolve true when saved (false = failure / validation error → stay)
 * @param onDiscard "저장하지 않고 나가기" (clear the input preservation)
 */
export function useLeaveGuard({ dirty, onSave, onDiscard }: { dirty: boolean; onSave: () => Promise<boolean>; onDiscard?: () => void }): LeaveGuardController {
  const router = useRouter()
  const [pending, setPending] = React.useState<LeaveTarget | null>(null)
  const [saving, setSaving] = React.useState(false)
  const bypass = React.useRef(false)
  const dirtyRef = React.useRef(dirty)
  React.useEffect(() => {
    dirtyRef.current = dirty
  }, [dirty])

  const go = React.useCallback(
    (target: LeaveTarget) => {
      bypass.current = true
      if (typeof target === "function") target()
      else router.push(target)
      // the page may stay (an in-page callback): re-arm after the navigation started
      window.setTimeout(() => {
        bypass.current = false
      }, 1500)
    },
    [router],
  )

  const navigate = React.useCallback(
    (target: LeaveTarget) => {
      if (!dirtyRef.current || bypass.current) return go(target)
      setPending(() => target)
    },
    [go],
  )

  // browser close / reload: the browser's own confirm (no custom copy possible)
  React.useEffect(() => {
    if (!dirty) return
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      if (bypass.current) return
      e.preventDefault()
      e.returnValue = ""
    }
    window.addEventListener("beforeunload", onBeforeUnload)
    return () => window.removeEventListener("beforeunload", onBeforeUnload)
  }, [dirty])

  // any other in-app <a> (C-10 돌아가기, C-02, links in the panel …)
  React.useEffect(() => {
    const onClick = (e: MouseEvent) => {
      if (!dirtyRef.current || bypass.current) return
      const href = isGuardableClick(e)
      if (!href) return
      e.preventDefault()
      e.stopPropagation()
      setPending(() => href)
    }
    document.addEventListener("click", onClick, true)
    return () => document.removeEventListener("click", onClick, true)
  }, [])

  const cancel = React.useCallback(() => setPending(null), [])
  const leaveWithoutSaving = React.useCallback(() => {
    const target = pending
    setPending(null)
    onDiscard?.()
    if (target) go(target)
  }, [pending, onDiscard, go])
  const saveAndLeave = React.useCallback(async () => {
    const target = pending
    setSaving(true)
    const ok = await onSave().catch(() => false)
    setSaving(false)
    setPending(null)
    // failure / validation error: stay; SaveButton shows the failed / invalid state
    if (ok && target) go(target)
  }, [pending, onSave, go])

  const reloadDiscarding = React.useCallback(() => {
    bypass.current = true
    onDiscard?.()
    window.location.reload()
  }, [onDiscard])

  return { dirty, navigate, pending, saving, cancel, leaveWithoutSaving, saveAndLeave, reloadDiscarding }
}

/** 이탈 확인 다이얼로그 — AlertDialog 3 actions (5.8). Rendered by <PageShell>. */
export function LeaveGuardDialog({ guard }: { guard: LeaveGuardController }) {
  return (
    <AlertDialog open={guard.pending !== null} onOpenChange={(o) => !o && !guard.saving && guard.cancel()}>
      <AlertDialogContent className="sm:max-w-md">
        <AlertDialogHeader className="text-left">
          <AlertDialogTitle>저장하지 않은 변경이 있어요</AlertDialogTitle>
          {/* [UI-가정] description line (the spec gives the title and the 3 buttons only) */}
          <AlertDialogDescription>저장하지 않고 나가면 이번에 고친 내용이 사라져요</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter className="max-sm:flex-col-reverse max-sm:[&>*]:w-full">
          <AlertDialogCancel disabled={guard.saving}>계속 편집</AlertDialogCancel>
          <Button variant="destructive-ghost" disabled={guard.saving} onClick={guard.leaveWithoutSaving}>
            저장하지 않고 나가기
          </Button>
          <Button onClick={() => void guard.saveAndLeave()} disabled={guard.saving}>
            {guard.saving ? <Loader2 className="animate-spin" aria-hidden /> : null}
            저장하고 나가기
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}

// ---------------------------------------------------------------------------
// SaveButton — 저장하기 6상태 + C-06 글자 (5.8 표)
// ---------------------------------------------------------------------------

/**
 * idle = 변경 없음, dirty = 변경 있음, saving, saved, failed = ST-SAVE-FAILED, invalid = 검증 오류,
 * stale = 다른 곳에서 바뀜 (`stale_write`, the page opens <StaleWriteDialog>).
 */
export type SaveUiState = "idle" | "dirty" | "saving" | "saved" | "failed" | "invalid" | "stale"

const isMac = () => typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent)

function useNarrow(query = "(max-width: 767px)"): boolean {
  const [narrow, setNarrow] = React.useState(false)
  React.useEffect(() => {
    const mql = window.matchMedia(query)
    const update = () => setNarrow(mql.matches)
    update()
    mql.addEventListener("change", update)
    return () => mql.removeEventListener("change", update)
  }, [query])
  return narrow
}

/**
 * The page's only primary button (R-C8). Ctrl/⌘ + S saves (and never opens the browser's save dialog).
 * `savedAt` = the last successful save this visit ("저장됨 HH:MM" in idle / saved).
 */
export function SaveButton({ state, onSave, savedAt, className }: { state: SaveUiState; onSave: () => void; savedAt: string | null; className?: string }) {
  const narrow = useNarrow()
  const enabled = state === "dirty" || state === "failed" || state === "invalid" || state === "stale"
  const showDot = state === "dirty" || state === "failed" || state === "invalid" || state === "stale"
  const enabledRef = React.useRef(enabled)
  const saveRef = React.useRef(onSave)
  React.useEffect(() => {
    enabledRef.current = enabled
    saveRef.current = onSave
  }, [enabled, onSave])

  React.useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(e.metaKey || e.ctrlKey) || e.key.toLowerCase() !== "s" || e.altKey || e.shiftKey) return
      e.preventDefault()
      if (enabledRef.current) saveRef.current()
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [])

  // narrow screens: failures go to a toast (no room for the C-06 line) [가정 G-47]
  const prev = React.useRef(state)
  React.useEffect(() => {
    if (narrow && state === "failed" && prev.current !== "failed") {
      toast("저장하지 못했어요", { icon: <CircleAlert className="size-4 text-destructive" aria-hidden />, action: { label: "다시 시도", onClick: () => saveRef.current() } })
    }
    prev.current = state
  }, [state, narrow])

  const shortcut = isMac() ? "⌘S" : "Ctrl+S"
  return (
    <div className={cn("flex items-center gap-2", className)}>
      <SaveStatusText state={state} savedAt={savedAt} onRetry={onSave} />
      <Tooltip>
        <TooltipTrigger asChild>
          <span className="relative inline-flex">
            <Button
              size="default"
              className="min-w-[6.5rem]"
              disabled={!enabled}
              onClick={onSave}
              aria-keyshortcuts={isMac() ? "Meta+S" : "Control+S"}
            >
              {state === "saving" ? (
                <>
                  <Loader2 className="animate-spin" aria-hidden />
                  저장 중…
                </>
              ) : (
                "저장하기"
              )}
              {showDot ? <span className="sr-only">저장하지 않은 변경 있음</span> : null}
            </Button>
            {showDot ? <span aria-hidden className="pointer-events-none absolute -top-0.5 -right-0.5 size-2.5 rounded-full bg-warning ring-2 ring-shell" /> : null}
          </span>
        </TooltipTrigger>
        {/* [UI-가정] 툴팁 글자 */}
        <TooltipContent>저장하기 ({shortcut})</TooltipContent>
      </Tooltip>
    </div>
  )
}

/** C-06 글자 next to SaveButton (aria-live, 5.8 표). Narrow (<md): an icon only for success. */
export function SaveStatusText({ state, savedAt, onRetry }: { state: SaveUiState; savedAt: string | null; onRetry: () => void }) {
  const time = savedAt ? formatTime(savedAt) : null
  let content: React.ReactNode = null
  if (state === "failed") {
    content = (
      <span className="hidden items-center gap-1 text-destructive md:inline-flex">
        <CircleAlert className="size-3.5" aria-hidden />
        저장하지 못했어요
        <Button variant="link" size="sm" className="h-auto px-0 text-sm" onClick={onRetry}>
          다시 시도
        </Button>
      </span>
    )
  } else if ((state === "saved" || state === "idle") && time) {
    content = (
      <>
        <span className="hidden items-center gap-1 md:inline-flex">
          {state === "saved" ? <Check className="size-3.5 text-success" aria-hidden /> : null}
          저장됨 {time}
        </span>
        <span className="md:hidden">
          <Check className="size-4 text-success" aria-hidden />
          <span className="sr-only">저장됨 {time}</span>
        </span>
      </>
    )
  }
  return (
    <span role="status" aria-live="polite" className="text-sm leading-5 text-muted-foreground tabular-nums">
      {content}
    </span>
  )
}

/** 변경 충돌 확인 (`stale_write`, 5.8). Esc / outside only closes (edits stay) [가정 G-48]. */
export function StaleWriteDialog({
  open,
  entity,
  busy,
  onOverwrite,
  onReload,
  onOpenChange,
}: {
  open: boolean
  entity: "project" | "deliverable"
  busy?: boolean
  /** "내 내용으로 저장" = the same request with p_expected_updated_at = null */
  onOverwrite: () => void
  /** "새로 불러오기" = drop unsaved edits and the [반영] memory, read again */
  onReload: () => void
  onOpenChange: (open: boolean) => void
}) {
  const what = entity === "project" ? "이 프로젝트가" : "이 산출물이"
  const keepRef = React.useRef<HTMLButtonElement | null>(null)
  return (
    <AlertDialog open={open} onOpenChange={(o) => !busy && onOpenChange(o)}>
      <AlertDialogContent
        className="sm:max-w-md"
        onOpenAutoFocus={(e) => {
          // first focus = the choice that keeps the edits ("내 내용으로 저장")
          e.preventDefault()
          keepRef.current?.focus()
        }}
      >
        <AlertDialogHeader className="text-left">
          <AlertDialogTitle>다른 곳에서 {what} 바뀌었어요</AlertDialogTitle>
          {/* [UI-가정] 명세 "버린다고 함께 알림"의 글자 */}
          <AlertDialogDescription>새로 불러오면 저장하지 않은 변경과 AI 반영 표시가 사라져요</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          {/* not AlertDialogCancel: Radix focuses Cancel first, and this one throws edits away (QA UQ-PA-4) */}
          <Button variant="outline" disabled={busy} onClick={onReload}>
            새로 불러오기
          </Button>
          <AlertDialogAction ref={keepRef} disabled={busy} onClick={(e) => (e.preventDefault(), onOverwrite())}>
            {busy ? <Loader2 className="animate-spin" aria-hidden /> : null}
            내 내용으로 저장
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}

// ---------------------------------------------------------------------------
// ShellBar + PageShell
// ---------------------------------------------------------------------------

const ACCOUNT_ICONS: Record<AccountMenuItem["key"], React.ComponentType<{ className?: string }>> = {
  profile: UserRound,
  settings: Settings,
  ai: KeyRound,
  policies: FileText,
  sign_out: LogOut,
}

/** [Resumate AI] 다시 열기 (shown only while the wide panel is closed, D-UX-27). */
export interface AiReopenProps {
  visible: boolean
  onClick: () => void
  /** callback ref of the button (focus target when the panel closes, A-14) */
  bindButton?: React.RefCallback<HTMLButtonElement>
}

function ShellBar({ save, aiReopen }: { save: React.ReactNode; aiReopen?: AiReopenProps | null }) {
  const reopenVisible = aiReopen?.visible ?? false
  const onReopen = aiReopen?.onClick
  const bindReopen = aiReopen?.bindButton
  const leave = usePageLeave()
  const router = useRouter()
  const signOut = async () => {
    try {
      await shellSignOutAction()
    } catch {
      // [UI-가정] like L-01: leave to S-01 even if sign-out failed
    } finally {
      router.replace(routes.landing())
    }
  }
  return (
    <header className="flex h-14 shrink-0 items-center gap-2 bg-shell px-4 max-md:border-b">
      <Link
        href={routes.career()}
        aria-label="Resumate 커리어로 가기"
        className="flex items-center gap-2 rounded-md focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
      >
        <LogoMark className="size-7" />
        <span className="text-base font-semibold">Resumate</span>
      </Link>
      <div className="ml-auto flex items-center gap-2">
        {reopenVisible ? (
          <Button ref={bindReopen} variant="outline" size="sm" className="max-lg:hidden" onClick={onReopen}>
            <Sparkles className="size-4 text-ai" aria-hidden />
            Resumate AI
          </Button>
        ) : null}
        {save}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="icon" aria-label="계정 메뉴">
              <CircleUserRound className="size-5" aria-hidden />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="min-w-48">
            {ACCOUNT_MENU_ITEMS.map((item) => {
              const Icon = ACCOUNT_ICONS[item.key]
              return (
                <React.Fragment key={item.key}>
                  {item.key === "sign_out" ? <DropdownMenuSeparator /> : null}
                  <DropdownMenuItem onSelect={() => ("href" in item ? leave(item.href) : leave(() => void signOut()))}>
                    <Icon aria-hidden />
                    {item.label}
                  </DropdownMenuItem>
                </React.Fragment>
              )
            })}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </header>
  )
}

/** L-02 frame: mint-grey shell, ShellBar, the white card (h-dvh, the window never scrolls). */
export function PageShell({
  guard,
  save,
  aiReopen,
  children,
}: {
  guard: LeaveGuardController
  /** <SaveButton … /> */
  save: React.ReactNode
  aiReopen?: AiReopenProps | null
  children: React.ReactNode
}) {
  useToasterPosition("bottom-left")
  return (
    <LeaveGuardContext.Provider value={guard}>
      <div className="flex h-dvh flex-col overflow-hidden bg-shell text-shell-foreground">
        <ShellBar save={save} aiReopen={aiReopen} />
        {/* S-28 활성 공급자 장애 배너 (leader UQ-PA-17): (page)/layout portals it here */}
        <div ref={registerOutageSlot} className="shrink-0 empty:hidden" />
        <main id="main" className="mx-2 mb-2 flex min-h-0 flex-1 flex-col overflow-hidden rounded-2xl bg-card text-card-foreground shadow-sm max-md:m-0 max-md:rounded-none max-md:shadow-none">
          {children}
        </main>
      </div>
      <LeaveGuardDialog guard={guard} />
    </LeaveGuardContext.Provider>
  )
}

// ---------------------------------------------------------------------------
// CrumbRow — "←" + 이동 경로 (1.3a 이동 줄)
// ---------------------------------------------------------------------------

export interface CrumbItem {
  /** null / empty = the placeholder ("새 프로젝트" / "새 산출물") */
  label: string | null
  placeholder?: string
  /** clickable crumb (S-10 회사명/기관명, S-44 프로젝트명) — goes through the leave guard */
  href?: string
}

/**
 * Wide: "(←) 회사명 › 프로젝트명 › 프로젝트 상세". Narrow (<1024): "← {상위 이름}" only.
 * `back`: S-10 "←" = history back when the previous entry is S-08, else S-08 `?item=` [가정] — pass `onBack`.
 */
export function CrumbRow({ back, items, current }: { back: { href: string; label: string | null; onBack?: () => void }; items: CrumbItem[]; current: string }) {
  const leave = usePageLeave()
  const goBack = () => leave(back.onBack ?? back.href)
  return (
    <div className="flex h-12 shrink-0 items-center gap-2 px-6 max-md:px-4">
      <Button variant="secondary" size="icon-sm" className="rounded-full max-lg:hidden" aria-label="뒤로" onClick={goBack}>
        <ArrowLeft className="size-4" aria-hidden />
      </Button>
      <Button variant="ghost" size="sm" className="max-w-[60vw] justify-start lg:hidden" onClick={goBack}>
        <ArrowLeft aria-hidden />
        <span className="truncate">{back.label || "뒤로"}</span>
      </Button>
      <Breadcrumb className="min-w-0 max-lg:hidden">
        <BreadcrumbList className="flex-nowrap text-sm">
          {items.map((item, i) => {
            const text = item.label?.trim() ? item.label : (item.placeholder ?? "")
            const empty = !item.label?.trim()
            return (
              <React.Fragment key={i}>
                <BreadcrumbItem className="min-w-0">
                  {item.href ? (
                    <button
                      type="button"
                      onClick={() => leave(item.href as string)}
                      title={text}
                      className="max-w-[16rem] truncate rounded-sm text-muted-foreground hover:text-foreground hover:underline focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
                    >
                      {text}
                    </button>
                  ) : (
                    <span title={text} className={cn("max-w-[16rem] truncate text-muted-foreground", empty && "text-muted-foreground")}>
                      {text}
                    </span>
                  )}
                </BreadcrumbItem>
                <BreadcrumbSeparator />
              </React.Fragment>
            )
          })}
          <BreadcrumbItem>
            <BreadcrumbPage className="font-medium text-foreground">{current}</BreadcrumbPage>
          </BreadcrumbItem>
        </BreadcrumbList>
      </Breadcrumb>
    </div>
  )
}

// ---------------------------------------------------------------------------
// 입력 보존 (UX-7, 1.3a 입력 보존) — browser storage only, never the URL
// ---------------------------------------------------------------------------

/** 키: 기존 = 행 ID, 새 페이지 = 소속 ID(산출물은 프로젝트 ID) + "new" (1.3a). */
export function preservationKey(kind: "project" | "deliverable", rowId: string | null, parentId: string): string {
  return `resumate:l02:${kind}:${rowId ?? `${parentId}:new`}`
}

export interface InputPreservation<T> {
  /** what a previous visit left unsaved — the restore banner shows while this is set */
  stored: T | null
  /** debounced write of the current unsaved state; `null` = nothing unsaved now. Ignored until the banner is answered */
  write: (value: T | null) => void
  /** after a successful save / "저장하지 않고 나가기" / "버리기" / "새로 불러오기" */
  clear: () => void
  /** "이어서 편집": the page applied `stored` (its next writes keep it) */
  resolve: () => void
  /** @deprecated alias of `resolve` */
  dismiss: () => void
}

/**
 * localStorage (try/catch) through `createPreservationStore` (input-preservation.ts — the contract and tests).
 * Flushes on unmount and `pagehide`. `enabled: false` stops writing.
 */
export function useInputPreservation<T>(key: string, opts?: { enabled?: boolean; delayMs?: number }): InputPreservation<T> {
  const enabled = opts?.enabled ?? true
  const delay = opts?.delayMs ?? 500
  const [stored, setStored] = React.useState<T | null>(null)
  const store = React.useMemo(
    () =>
      createPreservationStore<T>(() => {
        try {
          return typeof window === "undefined" ? null : window.localStorage
        } catch {
          return null
        }
      }, key, delay),
    [key, delay],
  )

  React.useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- read once after hydration (no SSR access)
    setStored(store.load())
    const onHide = () => store.flush()
    window.addEventListener("pagehide", onHide)
    return () => {
      window.removeEventListener("pagehide", onHide)
      store.dispose()
    }
  }, [store])

  const write = React.useCallback((value: T | null) => {
    if (enabled) store.write(value)
  }, [store, enabled])
  const clear = React.useCallback(() => {
    store.clear()
    setStored(null)
  }, [store])
  const resolve = React.useCallback(() => {
    store.resolve()
    setStored(null)
  }, [store])
  return { stored, write, clear, resolve, dismiss: resolve }
}

/** 입력 보존 배너 (5.8 배너 자리): "저장하지 않은 수정이 있어요 · 이어서 편집 / 버리기" [가정: 배너형]. */
export function InputRestoreBanner({ onContinue, onDiscard }: { onContinue: () => void; onDiscard: () => void }) {
  return (
    <Alert variant="info" className="flex items-center gap-2 py-2">
      <History className="size-4 shrink-0" aria-hidden />
      <AlertDescription className="flex-1 text-sm">저장하지 않은 수정이 있어요</AlertDescription>
      <div className="flex shrink-0 gap-1">
        <Button variant="outline" size="sm" onClick={onContinue}>
          이어서 편집
        </Button>
        <Button variant="ghost" size="sm" onClick={onDiscard}>
          버리기
        </Button>
      </div>
    </Alert>
  )
}

/** 배너 자리: CrumbRow 바로 아래 (C-10 first, then the restore banner). */
export function ShellBanners({ children }: { children: React.ReactNode }) {
  const items = React.Children.toArray(children).filter(Boolean)
  if (!items.length) return null
  return <div className="shrink-0 space-y-2 px-6 pb-2 max-md:px-4">{items}</div>
}
