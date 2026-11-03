"use client"

/**
 * S-28 활성 공급자 장애 배너 on L-02 (leader ruling UQ-PA-17: same as L-01's AiOutageSlot). The server slot
 * lives in `(page)/layout.tsx`; PageShell registers the spot right under its ShellBar and the banner is
 * portalled there (the shell is drawn by each page, so the layout can't place it directly).
 */
import * as React from "react"
import { createPortal } from "react-dom"
import type { AiProviderName } from "@/types/db"
import { AiOutageBanner } from "./shell-parts"

let slot: HTMLElement | null = null
const listeners = new Set<() => void>()

/** PageShell's callback ref for the banner spot. */
export function registerOutageSlot(el: HTMLElement | null): void {
  slot = el
  listeners.forEach((fn) => fn())
}

function subscribe(fn: () => void) {
  listeners.add(fn)
  return () => void listeners.delete(fn)
}

export function PageShellOutagePortal({ provider }: { provider: AiProviderName | null }) {
  const target = React.useSyncExternalStore(subscribe, () => slot, () => null)
  if (!target) return null
  return createPortal(<AiOutageBanner provider={provider} />, target)
}
