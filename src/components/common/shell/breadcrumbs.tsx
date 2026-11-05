"use client"

/**
 * L-01 이동 경로. Pages declare their trail with <PageCrumbs items=… />; the shell's top bar
 * renders it. Application sub-screens pass `applicationProjectId` so the first node becomes
 * "지원 현황" / "모의 면접" when the user came from S-39 / S-37 (setNavOrigin).
 */
import * as React from "react"
import Link from "next/link"
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from "@/components/ui/breadcrumb"
import { routes } from "@/lib/routes"
import { clearNavOrigin, readNavOrigin } from "../return-target"

export interface Crumb {
  label: string
  href?: string
}

interface CrumbContextValue {
  crumbs: Crumb[]
  setCrumbs: (c: Crumb[]) => void
  actions: React.ReactNode
  setActions: (a: React.ReactNode) => void
}
const CrumbContext = React.createContext<CrumbContextValue | null>(null)

export function CrumbProvider({ children }: { children: React.ReactNode }) {
  const [crumbs, setCrumbs] = React.useState<Crumb[]>([])
  const [actions, setActions] = React.useState<React.ReactNode>(null)
  const value = React.useMemo(() => ({ crumbs, setCrumbs, actions, setActions }), [crumbs, actions])
  return <CrumbContext.Provider value={value}>{children}</CrumbContext.Provider>
}

export function useCrumbs(): Crumb[] {
  return React.useContext(CrumbContext)?.crumbs ?? []
}

export function useTopBarActions(): React.ReactNode {
  return React.useContext(CrumbContext)?.actions ?? null
}

/**
 * Screen actions in the top bar's right side (UQ-9). Narrow screens show at most one
 * action there; put the rest in a ⋯ menu inside `children`.
 */
export function PageTopActions({ children }: { children: React.ReactNode }) {
  const ctx = React.useContext(CrumbContext)
  const setActions = ctx?.setActions
  React.useEffect(() => {
    setActions?.(children)
    return () => setActions?.(null)
  }, [setActions, children])
  return null
}

const ORIGIN_CRUMB = {
  board: { label: "지원 현황", href: routes.board() },
  interviews: { label: "모의 면접", href: routes.interviews() },
} as const

/** Declare the page trail. Last item = current page (no href needed). */
export function PageCrumbs({ items, applicationProjectId }: { items: Crumb[]; applicationProjectId?: string }) {
  const ctx = React.useContext(CrumbContext)
  const key = JSON.stringify(items) + (applicationProjectId ?? "")
  React.useEffect(() => {
    if (!ctx) return
    let trail = items
    // UQ-7 / UQ-122: any screen outside a 자기소개서 (menus, 커리어 incl. S-36, 설정) resets the
    // origin, so later visits to S-20/S-22/S-31 show "자기소개서 관리" unless they come from S-39/S-37 again
    if (!applicationProjectId) clearNavOrigin()
    const origin = readNavOrigin(applicationProjectId)
    if (origin && items[0]?.href === routes.applications()) trail = [ORIGIN_CRUMB[origin], ...items.slice(1)]
    ctx.setCrumbs(trail)
    return () => ctx.setCrumbs([])
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key])
  return null
}

/**
 * Top-bar trail. Below md only the current (last) node shows, as in the shadcn sidebar block;
 * `fallback` (current menu name) shows when the page declared no trail.
 */
export function CrumbTrail({ fallback }: { fallback?: string }) {
  const crumbs = useCrumbs()
  const shown = crumbs.length > 0 ? crumbs : fallback ? [{ label: fallback }] : []
  if (shown.length === 0) return null
  return (
    <Breadcrumb className="min-w-0">
      <BreadcrumbList className="flex-nowrap text-sm">
        {shown.map((c, i) => {
          const last = i === shown.length - 1
          return (
            <React.Fragment key={`${c.label}-${i}`}>
              <BreadcrumbItem className={last ? "min-w-0" : "hidden min-w-0 md:inline-flex"}>
                {last || !c.href ? (
                  <BreadcrumbPage className="max-w-[16rem] truncate font-medium text-foreground">{c.label}</BreadcrumbPage>
                ) : (
                  <BreadcrumbLink asChild>
                    <Link href={c.href} className="max-w-[16rem] truncate text-muted-foreground hover:text-foreground">
                      {c.label}
                    </Link>
                  </BreadcrumbLink>
                )}
              </BreadcrumbItem>
              {!last ? <BreadcrumbSeparator className="hidden md:block" /> : null}
            </React.Fragment>
          )
        })}
      </BreadcrumbList>
    </Breadcrumb>
  )
}
