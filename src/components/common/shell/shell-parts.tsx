"use client"

/**
 * L-01 top bar, global toast region, AI completion watcher (C-03 toast), AI 장애 배너 (S-28).
 */
import * as React from "react"
import { usePathname, useRouter } from "next/navigation"
import { X } from "lucide-react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Separator } from "@/components/ui/separator"
import { SidebarTrigger, useSidebar } from "@/components/ui/sidebar"
import { Toaster } from "@/components/ui/sonner"
import { MENU_ITEMS, menuKeyForPath } from "@/lib/routes"
import { listActiveAiJobsAction } from "@/lib/data/actions"
import type { AiProviderName } from "@/types/db"
import { AI_PROVIDER_LABELS, AI_PROVIDERS } from "@/lib/mock/ai-providers"
import { AiOutageAlert } from "../state-views"
import { ExternalProviderLink } from "../ai-error-notice"
import { usePreviewState } from "../preview-state-client"
import { CrumbTrail, useTopBarActions } from "./breadcrumbs"

/**
 * Top bar (shadcn sidebar-08): sidebar toggle · vertical separator · breadcrumb, h-16, inside
 * the inset panel, fixed at its top (the panel is the scroll container). The toggle collapses/expands the icon rail on wide screens and
 * opens the drawer below lg. Below md only the last breadcrumb node shows.
 * Right side: actions declared by the page via <PageTopActions>.
 */
export function TopBar() {
  const pathname = usePathname()
  const { state, isMobile } = useSidebar()
  const actions = useTopBarActions()
  const current = MENU_ITEMS.find((m) => m.key === menuKeyForPath(pathname))
  const currentLabel = current?.label ?? (pathname.startsWith("/settings") ? "설정" : "")
  const toggleLabel = isMobile ? "메뉴 열기" : state === "expanded" ? "메뉴 접기" : "메뉴 펼치기"
  return (
    <header className="sticky top-0 z-20 flex h-16 shrink-0 items-center gap-2 bg-background">
      <div className="flex min-w-0 flex-1 items-center gap-2 px-4">
        <SidebarTrigger className="-ml-1" aria-label={toggleLabel} />
        <Separator orientation="vertical" className="mr-2 data-vertical:h-4 data-vertical:self-auto" />
        <CrumbTrail fallback={currentLabel} />
      </div>
      {actions ? <div className="flex shrink-0 items-center gap-2 pr-4">{actions}</div> : null}
    </header>
  )
}

/** Static top bar for the prerendered shell (TopBar streams in under Suspense). */
export function TopBarFallback() {
  return <header className="sticky top-0 z-20 h-16 shrink-0 bg-background" aria-hidden />
}

/** Global toast region: bottom-right on wide screens, top-center on narrow (design-system 2). */
export function ResponsiveToaster() {
  const [narrow, setNarrow] = React.useState(false)
  React.useEffect(() => {
    const mql = window.matchMedia("(max-width: 1023px)")
    const update = () => setNarrow(mql.matches)
    update()
    mql.addEventListener("change", update)
    return () => mql.removeEventListener("change", update)
  }, [])
  return <Toaster position={narrow ? "top-center" : "bottom-right"} />
}

const WATCH_MS = 4_000

/**
 * Polls running async AI jobs and shows the completion toast with "보기" (C-03 이탈 허용·완료 알림).
 * Fires `resumate:ai-jobs-changed` so menu badges refresh.
 */
export function AiJobWatcher() {
  const router = useRouter()
  const seen = React.useRef<Map<string, string>>(new Map())
  React.useEffect(() => {
    let alive = true
    const tick = async () => {
      const jobs = await listActiveAiJobsAction()
      if (!alive) return
      let changed = false
      for (const job of jobs) {
        const prev = seen.current.get(job.id)
        if (prev && prev !== job.status) changed = true
        if ((prev === "running" || prev === "queued") && job.status === "succeeded") {
          toast.success(job.done_message, {
            action: job.result_href ? { label: "보기", onClick: () => router.push(job.result_href as string) } : undefined,
          })
        }
        seen.current.set(job.id, job.status)
      }
      if (changed) window.dispatchEvent(new Event("resumate:ai-jobs-changed"))
    }
    void tick()
    const t = setInterval(tick, WATCH_MS)
    return () => {
      alive = false
      clearInterval(t)
    }
  }, [router])
  return null
}

/** S-28 AI 장애 배너: shown when the service reports degradation or ?state=ai-outage. Dismissable. */
const OUTAGE_DISMISS_KEY = "resumate.outage-dismissed"
const OUTAGE_EVENT = "resumate:outage-dismissed"

function readDismissed(): string | null {
  try {
    return window.sessionStorage.getItem(OUTAGE_DISMISS_KEY)
  } catch {
    return null
  }
}

const subscribeDismiss = (cb: () => void) => {
  window.addEventListener(OUTAGE_EVENT, cb)
  return () => window.removeEventListener(OUTAGE_EVENT, cb)
}

/**
 * S-28 공급자 장애 배너 (v2: per provider). Shown only when the **active** provider is affected;
 * `?state=ai-outage` previews it for the active provider (Gemini when none). Dismiss hides it for
 * the browser session (per provider). // [UI-가정] session-scoped dismiss
 */
export function AiOutageBanner({ provider }: { provider: AiProviderName | null }) {
  const preview = usePreviewState()
  const shown = provider ?? (preview === "ai-outage" ? "gemini" : null)
  const dismissed = React.useSyncExternalStore(subscribeDismiss, readDismissed, () => null)
  if (!shown || dismissed === shown) return null
  const label = AI_PROVIDER_LABELS[shown]
  return (
    <AiOutageAlert
      providerLabel={label}
      className="px-4 lg:px-6 has-data-[slot=alert-action]:pr-4"
      action={
        <div data-slot="alert-action" className="col-start-2 flex items-center gap-1 pt-1 sm:absolute sm:top-1.5 sm:right-2 sm:pt-0">
          <ExternalProviderLink href={AI_PROVIDERS[shown].status_url}>{`${label} 상태 페이지`}</ExternalProviderLink>
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label="배너 닫기"
            onClick={() => {
              try {
                window.sessionStorage.setItem(OUTAGE_DISMISS_KEY, shown)
              } catch {}
              window.dispatchEvent(new Event(OUTAGE_EVENT))
            }}
          >
            <X aria-hidden />
          </Button>
        </div>
      }
    />
  )
}
