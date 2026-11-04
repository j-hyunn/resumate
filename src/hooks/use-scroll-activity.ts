"use client"

import * as React from "react"

/**
 * Marks a scroll container with `data-scrolling` while it scrolls and for `idleMs` after the last scroll event,
 * so its scrollbar can show only then (`scrollbar-thumb-transparent data-scrolling:scrollbar-thumb-…`).
 * Returns a callback ref. The attribute is set on the node directly — no re-render per scroll event.
 */
export function useScrollActivity<T extends HTMLElement>(idleMs = 1000): (node: T | null) => void {
  const [node, setNode] = React.useState<T | null>(null)
  React.useEffect(() => {
    if (!node) return
    let timer: number | undefined
    const onScroll = () => {
      node.dataset.scrolling = ""
      window.clearTimeout(timer)
      timer = window.setTimeout(() => delete node.dataset.scrolling, idleMs)
    }
    node.addEventListener("scroll", onScroll, { passive: true })
    return () => {
      node.removeEventListener("scroll", onScroll)
      window.clearTimeout(timer)
      delete node.dataset.scrolling
    }
  }, [node, idleMs])
  return setNode
}
