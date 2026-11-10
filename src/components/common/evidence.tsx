"use client"

/**
 * C-01 근거 칩 + C-02 근거 패널 (design-system 3.1 / 3.2).
 *
 * Usage:
 *   <EvidenceProvider>            // once per screen (or the shell already provides one)
 *     <EvidenceChips items={evidence["strengths.0"]} />
 *   </EvidenceProvider>
 * Data comes from src/lib/data/evidence.ts (EvidenceView) — status is computed there.
 */
import * as React from "react"
import Link from "next/link"
import { ArrowUpRight, Info, RefreshCw, Unlink } from "lucide-react"
import { cn } from "@/lib/utils"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card } from "@/components/ui/card"
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import type { EvidenceView } from "@/lib/data/evidence"
import { markCareerReturn, type ReturnTargetInput } from "./return-target"

/** The one chip shape shared by C-01 and C-15 (design-system 3.1) */
export const CHIP_CLASS =
  "inline-flex h-6 max-w-[16rem] items-center gap-1 rounded-sm border border-chip-border bg-chip px-1.5 align-middle text-xs font-medium text-chip-foreground transition-colors duration-150 hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1"

const STATUS_CLASS: Record<EvidenceView["status"], string> = {
  ok: "",
  changed: "border-warning bg-warning-subtle text-warning-subtle-foreground",
  deleted: "border-dashed bg-transparent text-muted-foreground",
}

const STATUS_SUFFIX: Record<EvidenceView["status"], string> = {
  ok: "",
  changed: " · 변경됨",
  deleted: " · 원본 삭제됨",
}

// ---------------------------------------------------------------------------
// context: one panel per screen
// ---------------------------------------------------------------------------

interface EvidenceContextValue {
  open: (items: EvidenceView[], focusId?: string) => void
}
const EvidenceContext = React.createContext<EvidenceContextValue | null>(null)

export function EvidenceProvider({
  children,
  returnTarget,
}: {
  children: React.ReactNode
  /** when "원본으로 이동" goes into 커리어, store this as the C-10 return target */
  returnTarget?: ReturnTargetInput
}) {
  const [state, setState] = React.useState<{ items: EvidenceView[]; focusId?: string } | null>(null)
  const value = React.useMemo<EvidenceContextValue>(() => ({ open: (items, focusId) => setState({ items, focusId }) }), [])
  return (
    <EvidenceContext.Provider value={value}>
      {children}
      <EvidencePanel
        open={state !== null}
        onOpenChange={(o) => !o && setState(null)}
        items={state?.items ?? []}
        focusId={state?.focusId}
        returnTarget={returnTarget}
      />
    </EvidenceContext.Provider>
  )
}

function useEvidencePanel() {
  return React.useContext(EvidenceContext)
}

/**
 * C-02를 여는 함수만 필요한 자리(칩이 아닌 행 전체가 패널을 여는 C-11 목록 — design-system 3.10).
 * `<EvidenceProvider>` 밖에서는 `null`을 돌려주므로 호출하는 쪽이 자기 패널을 띄우면 된다.
 */
export function useEvidencePanelOpen(): ((items: EvidenceView[], focusId?: string) => void) | null {
  return React.useContext(EvidenceContext)?.open ?? null
}

// ---------------------------------------------------------------------------
// C-01 chip
// ---------------------------------------------------------------------------

export function EvidenceChip({
  item,
  group,
  className,
}: {
  item: EvidenceView
  /** the chip's sibling set (panel shows all, focused on this one) */
  group?: EvidenceView[]
  className?: string
}) {
  const panel = useEvidencePanel()
  const full = `${item.label}${STATUS_SUFFIX[item.status]}`
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          className={cn(CHIP_CLASS, STATUS_CLASS[item.status], className)}
          aria-label={`근거: ${item.label}${item.status === "changed" ? ", 변경됨" : item.status === "deleted" ? ", 원본 삭제됨" : ""}`}
          onClick={() => panel?.open(group ?? [item], item.id)}
        >
          {item.status === "changed" ? <RefreshCw className="size-3 shrink-0" aria-hidden /> : null}
          {item.status === "deleted" ? <Unlink className="size-3 shrink-0" aria-hidden /> : null}
          <span className={cn("shrink-0", item.status === "ok" && "text-muted-foreground")}>{item.kind_label}</span>
          {item.source_label ? (
            <>
              <span aria-hidden className="shrink-0">·</span>
              <span className="truncate">{item.source_label}</span>
            </>
          ) : null}
          {item.status !== "ok" ? <span className="shrink-0">{STATUS_SUFFIX[item.status].replace(" · ", "· ")}</span> : null}
        </button>
      </TooltipTrigger>
      <TooltipContent>{full}</TooltipContent>
    </Tooltip>
  )
}

/** Chip row under a block (`mt-2 flex flex-wrap gap-1`). `max` → table cells "+N". */
export function EvidenceChips({
  items,
  max,
  leading,
  className,
}: {
  items: EvidenceView[] | undefined
  max?: number
  /** e.g. C-08 block badges, rendered first in the row */
  leading?: React.ReactNode
  className?: string
}) {
  const panel = useEvidencePanel()
  const list = items ?? []
  if (list.length === 0 && !leading) return null
  const shown = max ? list.slice(0, max) : list
  const rest = list.length - shown.length
  return (
    <div className={cn("mt-2 flex flex-wrap items-center gap-1", className)}>
      {leading}
      {shown.map((item) => (
        <EvidenceChip key={item.id} item={item} group={list} />
      ))}
      {rest > 0 ? (
        <button
          type="button"
          onClick={() => panel?.open(list)}
          className="inline-flex h-6 items-center rounded-sm border px-1.5 text-xs font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          aria-label={`근거 ${rest}개 더 보기`}
        >
          +{rest}
        </button>
      ) : null}
    </div>
  )
}

// ---------------------------------------------------------------------------
// C-02 panel
// ---------------------------------------------------------------------------

export function EvidencePanel({
  open,
  onOpenChange,
  items,
  focusId,
  returnTarget,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  items: EvidenceView[]
  focusId?: string
  returnTarget?: ReturnTargetInput
}) {
  const focusRef = React.useRef<HTMLDivElement>(null)

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="right"
        className="w-full gap-0 overflow-y-auto sm:max-w-md"
        onOpenAutoFocus={(e) => {
          // UQ-13: move focus to the clicked chip's card
          if (focusRef.current) {
            e.preventDefault()
            focusRef.current.focus()
            focusRef.current.scrollIntoView({ block: "nearest" })
          }
        }}
      >
        <SheetHeader className="border-b p-4">
          <SheetTitle className="text-lg leading-7 font-semibold">근거</SheetTitle>
          <SheetDescription className="flex items-center gap-1.5 text-sm text-muted-foreground">
            <Info className="size-4 shrink-0" aria-hidden />
            입력된 데이터 기준 판단입니다
          </SheetDescription>
        </SheetHeader>
        <div className="space-y-3 p-4">
          {items.map((item) => (
            <Card
              key={item.id}
              ref={item.id === focusId ? focusRef : undefined}
              tabIndex={item.id === focusId ? -1 : undefined}
              aria-label={item.id === focusId ? `근거: ${item.label}` : undefined}
              size="sm"
              className={cn("gap-2 px-4", item.id === focusId && "border-ring")}
            >
              {item.status === "changed" ? (
                <div className="space-y-1">
                  <Badge variant="warning">
                    <RefreshCw aria-hidden />
                    변경됨
                  </Badge>
                  {/* [UI-가정] 변경됨 설명 문구는 "v3와 같음" — 보수적 문구 */}
                  <p className="text-sm text-muted-foreground">이 결과를 만든 뒤 원본이 수정됐어요.</p>
                </div>
              ) : null}
              <span className={cn(CHIP_CLASS, STATUS_CLASS[item.status], "pointer-events-none")}>
                <span className="shrink-0 text-muted-foreground">{item.kind_label}</span>
                {item.source_label ? (
                  <>
                    <span aria-hidden>·</span>
                    <span className="truncate">{item.source_label}</span>
                  </>
                ) : null}
              </span>
              {item.status === "deleted" ? (
                <p className="flex items-start gap-1.5 text-sm text-muted-foreground">
                  <Unlink className="mt-0.5 size-4 shrink-0" aria-hidden />
                  원본 삭제됨 — 이 근거의 원본과 인용문은 삭제되었습니다
                </p>
              ) : (
                <>
                  {item.path.length > 0 ? (
                    <p className="text-sm text-muted-foreground">{item.path.join(" › ")}</p>
                  ) : null}
                  {item.quote ? (
                    <blockquote className="border-l-2 border-chip-border pl-3 text-base leading-[1.75]">{item.quote}</blockquote>
                  ) : item.current_value ? (
                    <div className="space-y-0.5">
                      <p className="text-xs font-medium text-muted-foreground">원본 현재 값</p>
                      <p className="text-base leading-[1.75]">{item.current_value}</p>
                    </div>
                  ) : null}
                  {item.href ? (
                    <Button variant="link" size="sm" className="h-auto justify-start px-0" asChild>
                      <Link
                        href={item.href}
                        onClick={() => {
                          if (item.to_career && returnTarget) markCareerReturn(returnTarget)
                          onOpenChange(false) // UQ-14: close before navigating (Activity keeps state)
                        }}
                      >
                        원본으로 이동
                        <ArrowUpRight aria-hidden />
                      </Link>
                    </Button>
                  ) : item.source_type === "profile" ? (
                    // C-02 (UX v5.17 SD-A19, design-system 3.2 v5.11): S-04가 없어져 원본 화면이 없다 — 이동 버튼 자리에 한 줄
                    <p className="flex items-center gap-1.5 text-sm text-muted-foreground">
                      <Info className="size-4 shrink-0" aria-hidden />
                      이 근거의 원본 화면은 더 이상 없어요
                    </p>
                  ) : null}
                </>
              )}
            </Card>
          ))}
        </div>
      </SheetContent>
    </Sheet>
  )
}
