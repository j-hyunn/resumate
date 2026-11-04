"use client"

/**
 * L-02 상단 스크롤 상자 (design-system 5.9 "머리·배너가 넘칠 때", 2026-11-04 30 run — UQ-SC-2).
 * A capped box (DocHead, ShellBanners) that scrolls only when its content is taller than the cap. While it
 * overflows it:
 *  - fades its bottom edge until scrolled to the end, so "there is more" is visible — shadcn's `scroll-fade-b` mask
 *    (shadcn/tailwind.css, same as MessageScroller; alpha mask, no colour). The class is toggled here too because
 *    browsers without scroll-driven animations would otherwise keep the fade at the end;
 *  - becomes a named, focusable region (`role="region"` + `aria-label` + `tabIndex=0`), so keyboard users can
 *    scroll to text after the last field (arrow keys / Page Down once the box has focus).
 * When it fits, it is a plain div: no extra tab stop, no landmark noise.
 * The content sits in one inner div (observed for size changes); `innerClassName` styles it (e.g. `space-y-3`).
 */
import * as React from "react"
import { cn } from "@/lib/utils"

export function useScrollOverflow<T extends HTMLElement>(): {
  ref: React.RefObject<T | null>
  overflowing: boolean
  atEnd: boolean
} {
  const ref = React.useRef<T | null>(null)
  const [state, setState] = React.useState({ overflowing: false, atEnd: true })

  React.useEffect(() => {
    const el = ref.current
    if (!el) return
    const update = () => {
      const overflowing = el.scrollHeight - el.clientHeight > 1
      const atEnd = el.scrollTop + el.clientHeight >= el.scrollHeight - 1
      setState((s) => (s.overflowing === overflowing && s.atEnd === atEnd ? s : { overflowing, atEnd }))
    }
    update()
    const ro = new ResizeObserver(update)
    ro.observe(el)
    // the inner content wrapper: its height changes when fields / errors / banners appear, the capped box's doesn't
    for (const child of Array.from(el.children)) ro.observe(child)
    el.addEventListener("scroll", update, { passive: true })
    return () => {
      ro.disconnect()
      el.removeEventListener("scroll", update)
    }
  }, [])

  return { ref, ...state }
}

export function OverflowScroller({
  label,
  className,
  innerClassName,
  children,
}: {
  /** accessible name used only while the box overflows (e.g. "프로젝트 정보") */
  label: string
  /** the capped box: max-height / padding / shrink */
  className?: string
  /** the content wrapper: spacing between children */
  innerClassName?: string
  children: React.ReactNode
}) {
  const { ref, overflowing, atEnd } = useScrollOverflow<HTMLDivElement>()
  return (
    <div
      ref={ref}
      role={overflowing ? "region" : undefined}
      aria-label={overflowing ? label : undefined}
      tabIndex={overflowing ? 0 : undefined}
      data-overflowing={overflowing || undefined}
      className={cn(
        "relative min-h-0 scroll-pb-10 overflow-y-auto outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset",
        overflowing && !atEnd && "scroll-fade-b",
        className,
      )}
    >
      <div className={innerClassName}>{children}</div>
    </div>
  )
}
