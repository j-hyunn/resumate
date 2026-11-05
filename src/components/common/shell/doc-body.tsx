"use client"

/**
 * L-02 본문 2단 (design-system v4 5.9 "본문 2단" + 5.8 "좁은 화면"): left input column | ResizeHandle | panel.
 * Wide (card ≥ ~820px and window ≥ 1024): the panel is an aside in the card, width remembered (5.9 폭 규칙).
 * Narrow: one column, a floating "Resumate AI" button, the panel in a right Sheet (<768 full screen).
 * The panel content is whatever `aside` renders (the AI panel core renders its own header / views).
 */
import * as React from "react"
import { Sparkles } from "lucide-react"
import { cn } from "@/lib/utils"
import { useScrollActivity } from "@/hooks/use-scroll-activity"
import { Button } from "@/components/ui/button"
import { Sheet, SheetContent, SheetDescription, SheetTitle } from "@/components/ui/sheet"
import { PANEL_WIDTH, ResizeHandle } from "../doc-inputs"
import { OverflowScroller } from "./overflow-scroller"

/** Where the panel is and how big — owned by the panel controller (`useAiPanel().placement`). */
export interface DocPanelPlacement {
  mode: "wide" | "narrow"
  setMode: (mode: "wide" | "narrow") => void
  wideOpen: boolean
  setWideOpen: (open: boolean) => void
  sheetOpen: boolean
  setSheetOpen: (open: boolean) => void
  width: number
  setWidth: (w: number) => void
}

const DocBodyContext = React.createContext<{ mode: "wide" | "narrow"; closeSheet: () => void } | null>(null)

/** Inside the panel: "sheet" mode shows "STAR 보기" / "본문 보기" before × (5.8 좁은 화면). */
export function useDocBodyMode(): { mode: "wide" | "narrow"; closeSheet: () => void } {
  return React.useContext(DocBodyContext) ?? { mode: "wide", closeSheet: () => {} }
}

const NARROW_CARD = 820

/**
 * L-02 머리 (5.9 세로 구성 2): title / fields above the Separator. It never scrolls with the body. It is capped at
 * 40% of the card and may shrink further so DocBody keeps its 50% minimum (UQ-SC-1); when its content is taller it
 * scrolls by itself, fades its bottom edge and becomes a focusable named region (OverflowScroller, UQ-SC-2).
 * `className` styles the content wrapper (spacing between rows); `label` names the region ("프로젝트 정보").
 */
export function DocHead({ children, className, label = "페이지 정보" }: { children: React.ReactNode; className?: string; label?: string }) {
  return (
    <OverflowScroller label={label} className="max-h-[40%] shrink px-6 pt-2 pb-4 max-md:px-4" innerClassName={className}>
      {children}
    </OverflowScroller>
  )
}

export function DocBody({
  left,
  aside,
  placement,
  sheetLabel,
  className,
}: {
  /** left column content (STAR / 본문) — DocBody gives it the scroll container; it uses the full column width (UP-12) */
  left: React.ReactNode
  /** the panel (e.g. <AiPanel …/>) */
  aside: React.ReactNode
  placement: DocPanelPlacement
  /** sheet title for screen readers ("Resumate AI") */
  sheetLabel?: string
  className?: string
}) {
  const ref = React.useRef<HTMLDivElement | null>(null)
  const openerRef = React.useRef<HTMLButtonElement | null>(null)
  const [cardWidth, setCardWidth] = React.useState(0)
  const { setMode, mode } = placement

  React.useEffect(() => {
    const el = ref.current
    if (!el) return
    const mql = window.matchMedia("(min-width: 1024px)")
    const update = () => {
      const w = el.getBoundingClientRect().width
      setCardWidth(w)
      setMode(mql.matches && w >= NARROW_CARD ? "wide" : "narrow")
    }
    update()
    const ro = new ResizeObserver(update)
    ro.observe(el)
    mql.addEventListener("change", update)
    return () => {
      ro.disconnect()
      mql.removeEventListener("change", update)
    }
  }, [setMode])

  // 5.9 폭 규칙: ≤ 640, ≤ 50% of the card, left keeps 448 (+ handle 12 + panel margin 12)
  const max = Math.max(PANEL_WIDTH.min, Math.min(PANEL_WIDTH.max, Math.floor(cardWidth * 0.5), cardWidth - PANEL_WIDTH.leftMin - 24))
  const width = Math.min(max, Math.max(PANEL_WIDTH.min, placement.width))
  const wideOpen = mode === "wide" && placement.wideOpen
  const bodyScrollRef = useScrollActivity<HTMLDivElement>()
  const ctx = React.useMemo(() => ({ mode, closeSheet: () => placement.setSheetOpen(false) }), [mode, placement])

  return (
    <DocBodyContext.Provider value={ctx}>
      {/* min-h-[50%] of the card: CrumbRow + banners + DocHead never squash the body below half the card on a
          short window — the banners and the head shrink and scroll instead (5.9, UQ-SC-1) */}
      <div ref={ref} className={cn("flex min-h-[50%] flex-1", className)}>
        {/* narrow: bottom room so the floating button never covers the last field / counter (UQ-PA-15) */}
        {/* relative: the scroller is the containing block of its absolutely positioned content (sr-only live
            regions), so that content scrolls / clips here instead of growing the document (28 run) */}
        {/* scrollbar: thin thumb, no track / gutter (as the AI panel), shown only while scrolling + 1s after */}
        <div ref={bodyScrollRef} className={cn("relative min-w-0 flex-1 scrollbar-thin scrollbar-thumb-transparent scrollbar-track-transparent data-scrolling:scrollbar-thumb-muted-foreground/30 overflow-y-auto px-6 py-6 max-md:px-4", wideOpen && "lg:min-w-[28rem]", mode === "narrow" && "pb-24")}>
          {/* full width of the column (no 42rem cap) */}
          <div>{left}</div>
        </div>
        {wideOpen ? (
          // first paint is "wide" before the measurement: below lg the CSS already hides the panel (UQ-PA-15)
          <div className="flex min-h-0 shrink-0 max-lg:hidden">
            <ResizeHandle width={width} min={PANEL_WIDTH.min} max={max} onWidthChange={placement.setWidth} />
            {/* the panel fills the card height (row-flex stretch); only its message list scrolls (5.10) */}
            <div className="my-3 mr-3 flex min-h-0 shrink-0" style={{ width }}>
              {aside}
            </div>
          </div>
        ) : null}
      </div>
      {mode === "narrow" ? (
        <>
          {/* stays mounted while the sheet is open so focus returns to it on close (A-14, UQ-PA-14) */}
          <Button
            ref={openerRef}
            variant="outline"
            className={cn("fixed right-4 bottom-4 z-30 h-11 rounded-full px-4 shadow-md", placement.sheetOpen && "invisible")}
            aria-hidden={placement.sheetOpen || undefined}
            tabIndex={placement.sheetOpen ? -1 : undefined}
            onClick={() => placement.setSheetOpen(true)}
          >
            <Sparkles className="size-4 text-ai" aria-hidden />
            Resumate AI
          </Button>
          <Sheet open={placement.sheetOpen} onOpenChange={placement.setSheetOpen}>
            <SheetContent
              side="right"
              showCloseButton={false}
              className="w-full gap-0 bg-panel p-0 max-md:max-w-none sm:max-w-md"
              onCloseAutoFocus={(e) => {
                e.preventDefault()
                openerRef.current?.focus()
              }}
            >
              <SheetTitle className="sr-only">{sheetLabel ?? "Resumate AI"}</SheetTitle>
              <SheetDescription className="sr-only">Resumate AI 대화 패널</SheetDescription>
              <div className="flex min-h-0 flex-1">{aside}</div>
            </SheetContent>
          </Sheet>
        </>
      ) : null}
    </DocBodyContext.Provider>
  )
}
