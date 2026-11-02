"use client"

import * as React from "react"
import { usePathname, useRouter, useSearchParams } from "next/navigation"
import { FlaskConical } from "lucide-react"
import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { isPreviewEnabled, PREVIEW_STATES, readPreviewState, type PreviewState } from "@/lib/preview-state"

/**
 * Client-side `?state=` reader. Components using it must sit under a <Suspense> boundary
 * (the dashboard layout already wraps pages in one via loading.tsx).
 */
export function usePreviewState(): PreviewState | null {
  const params = useSearchParams()
  return readPreviewState(params)
}

/** Dev-only floating switcher so QA can flip ?state= without typing URLs. */
export function PreviewStateSwitcher() {
  const params = useSearchParams()
  const pathname = usePathname()
  const router = useRouter()
  if (!isPreviewEnabled) return null
  const current = params.get("state") ?? ""

  const setState = (value: string) => {
    const next = new URLSearchParams(params.toString())
    if (value) next.set("state", value)
    else next.delete("state")
    const qs = next.toString()
    router.replace(qs ? `${pathname}?${qs}` : pathname)
  }

  return (
    <div className="fixed right-16 bottom-4 z-40">
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="outline" size="sm" className="bg-card shadow-md" aria-label="상태 미리보기 (개발용)">
            <FlaskConical aria-hidden />
            {current || "state"}
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="max-h-[60vh] overflow-y-auto">
          <DropdownMenuLabel>?state= 미리보기 (개발용)</DropdownMenuLabel>
          <DropdownMenuSeparator />
          <DropdownMenuRadioGroup value={current} onValueChange={setState}>
            <DropdownMenuRadioItem value="">정상</DropdownMenuRadioItem>
            {PREVIEW_STATES.map((s) => (
              <DropdownMenuRadioItem key={s} value={s}>
                {s}
              </DropdownMenuRadioItem>
            ))}
          </DropdownMenuRadioGroup>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  )
}

/** Renders children only while ?state= equals one of `states` (client-side switch). */
export function WhenPreview({ states, children }: { states: PreviewState[]; children: React.ReactNode }) {
  const state = usePreviewState()
  return state && states.includes(state) ? <>{children}</> : null
}
