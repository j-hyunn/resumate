"use client"

/**
 * L-02 문서형 입력 (design-system v4 5.9, A-13 예외) — S-10 · S-44 (and C-02 range focus).
 * DocTitleInput · DocTextarea (+ list Enter / Tab, highlightRange) · FieldRows · ChipSelect · CompetencyChips.
 * Borderless on purpose: every one keeps a visible label (or aria-label), a placeholder, a hover background
 * and the `ring-2 ring-ring` focus ring.
 */
import * as React from "react"
import { ChevronDown, Plus, X } from "lucide-react"
import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { continueList, indentList } from "./doc-list-keys"

// ---------------------------------------------------------------------------
// DocTitleInput — 머리 제목 = 입력 칸 (S-10 프로젝트명 / S-44 산출물 제목)
// ---------------------------------------------------------------------------

export interface DocTitleInputProps extends Omit<React.ComponentProps<"input">, "size"> {
  /** "프로젝트명" / "산출물 제목" */
  label: string
  /** 대화 시작 전 이름 필요 — the reminder ring (not an error) until a name is typed [가정] */
  attention?: boolean
  invalid?: boolean
}

export const DocTitleInput = React.forwardRef<HTMLInputElement, DocTitleInputProps>(function DocTitleInput(
  { label, attention, invalid, className, maxLength = 100, ...props },
  ref,
) {
  return (
    <input
      ref={ref}
      type="text"
      aria-label={label}
      aria-required
      aria-invalid={invalid || undefined}
      maxLength={maxLength}
      className={cn(
        "-mx-2 w-full min-w-0 rounded-md bg-transparent px-2 py-0.5 text-xl leading-8 font-bold outline-none placeholder:text-muted-foreground hover:bg-accent/60 focus-visible:bg-transparent focus-visible:ring-2 focus-visible:ring-ring aria-invalid:ring-2 aria-invalid:ring-destructive",
        attention && "ring-2 ring-primary ring-offset-2 ring-offset-card",
        className,
      )}
      {...props}
    />
  )
})

// ---------------------------------------------------------------------------
// DocTextarea — 마크다운 원문 입력 (G-50: list Enter continues, Tab / Shift+Tab indents on list lines)
// ---------------------------------------------------------------------------

export interface DocTextareaProps extends Omit<React.ComponentProps<"textarea">, "onChange" | "value"> {
  value: string
  onValueChange: (value: string) => void
}

/**
 * `field-sizing-content`, 16px/1.75, borderless. Pass a visible label via `aria-labelledby` (STAR 칸 제목).
 * Tab only indents / outdents a list line when there is something to do (else focus moves), and Escape
 * makes the next Tab leave the field — no keyboard trap (doc-list-keys.ts, QA UQ-PA-5).
 */
export const DocTextarea = React.forwardRef<HTMLTextAreaElement, DocTextareaProps>(function DocTextarea(
  { value, onValueChange, className, onKeyDown, onBlur, ...props },
  ref,
) {
  const inner = React.useRef<HTMLTextAreaElement | null>(null)
  React.useImperativeHandle(ref, () => inner.current as HTMLTextAreaElement)
  const pendingCaret = React.useRef<number | null>(null)
  React.useLayoutEffect(() => {
    if (pendingCaret.current !== null && inner.current) {
      inner.current.setSelectionRange(pendingCaret.current, pendingCaret.current)
      pendingCaret.current = null
    }
  })
  const exitArmed = React.useRef(false)
  const handleKey = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    onKeyDown?.(e)
    if (e.defaultPrevented || e.nativeEvent.isComposing) return
    if (e.key === "Escape") {
      exitArmed.current = true
      return
    }
    const armed = exitArmed.current
    if (e.key !== "Shift") exitArmed.current = false
    const el = e.currentTarget
    const plain = !e.metaKey && !e.ctrlKey && !e.altKey
    const result =
      e.key === "Enter" && !e.shiftKey && plain
        ? continueList(el.value, el.selectionStart, el.selectionEnd)
        : e.key === "Tab" && plain && !armed && el.selectionStart === el.selectionEnd
          ? indentList(el.value, el.selectionStart, e.shiftKey)
          : null
    if (!result) return
    e.preventDefault()
    pendingCaret.current = result.caret
    onValueChange(result.value)
  }
  return (
    <textarea
      ref={inner}
      value={value}
      onChange={(e) => onValueChange(e.target.value)}
      onKeyDown={handleKey}
      onBlur={(e) => {
        exitArmed.current = false
        onBlur?.(e)
      }}
      className={cn(
        "-mx-2 field-sizing-content min-h-[5.25rem] w-full resize-none rounded-md bg-transparent px-2 py-1.5 text-base leading-[1.75] outline-none placeholder:text-muted-foreground hover:bg-accent/50 focus-visible:bg-transparent focus-visible:ring-2 focus-visible:ring-ring aria-invalid:ring-2 aria-invalid:ring-destructive",
        className,
      )}
      {...props}
    />
  )
})

/**
 * 근거 구간 강조 (C-02 → S-44 `source_locator {start, end}`) and the "지금 본문에서" chip (3.14 v4, G-51):
 * focus the textarea, select the range, scroll it into view and flash the field once.
 * `quote` instead of offsets: finds the text first. Returns false when the range / quote isn't there
 * (the caller toasts "지금 본문에서 그 문장을 찾지 못했어요" [가정]).
 */
export function highlightRange(textarea: HTMLTextAreaElement | null, range: { start: number; end: number } | { quote: string }): boolean {
  if (!textarea) return false
  let start: number
  let end: number
  if ("quote" in range) {
    const at = range.quote ? textarea.value.indexOf(range.quote) : -1
    start = at
    end = at + range.quote.length
  } else {
    start = range.start
    end = range.end
  }
  const found = start >= 0 && end > start && end <= textarea.value.length
  textarea.focus({ preventScroll: true })
  textarea.scrollIntoView({ block: "center", behavior: "smooth" })
  if (found) textarea.setSelectionRange(start, end)
  flashElement(textarea)
  return found
}

/** One `animate-field-flash` (+ ring) on a field — [반영] fills, highlightRange. */
export function flashElement(el: HTMLElement | null): void {
  if (!el) return
  el.classList.remove("animate-field-flash")
  void el.offsetWidth
  el.classList.add("animate-field-flash", "ring-2", "ring-ring")
  window.setTimeout(() => el.classList.remove("animate-field-flash", "ring-2", "ring-ring"), 1300)
}

// ---------------------------------------------------------------------------
// FieldRows — S-10 머리 필드 (dl 2열; <768 one column)
// ---------------------------------------------------------------------------

export function FieldRows({ children, className }: { children: React.ReactNode; className?: string }) {
  return <dl className={cn("grid grid-cols-[6.25rem_minmax(0,1fr)] items-center gap-x-4 gap-y-2 max-md:grid-cols-1 max-md:gap-y-1", className)}>{children}</dl>
}

export function FieldRow({ label, labelId, children, error }: { label: string; labelId?: string; children: React.ReactNode; error?: React.ReactNode }) {
  return (
    <>
      <dt id={labelId} className="text-sm text-muted-foreground">
        {label}
      </dt>
      <dd className="flex min-h-9 flex-wrap items-center gap-2 max-md:pb-2">
        {children}
        {error ? <div className="basis-full">{error}</div> : null}
      </dd>
    </>
  )
}

// ---------------------------------------------------------------------------
// ChipSelect — 회색 알약 단일 선택 (프로젝트 종류 · 경험 유형)
// ---------------------------------------------------------------------------

const NONE = "__none__"

export function ChipSelect<K extends string>({
  value,
  onChange,
  options,
  labelledBy,
  describedBy,
  ariaLabel,
  invalid,
  disabled,
  triggerRef,
}: {
  value: K | null
  onChange: (value: K | null) => void
  options: Record<K, string>
  labelledBy?: string
  /** id(s) of the error / help line → the trigger's aria-describedby */
  describedBy?: string
  ariaLabel?: string
  invalid?: boolean
  disabled?: boolean
  triggerRef?: React.Ref<HTMLButtonElement>
}) {
  return (
    <Select value={value ?? ""} onValueChange={(v) => onChange(v === NONE ? null : (v as K))} disabled={disabled}>
      <SelectTrigger ref={triggerRef} variant="chip" aria-labelledby={labelledBy} aria-describedby={describedBy} aria-label={ariaLabel} aria-invalid={invalid || undefined}>
        <SelectValue placeholder="미선택" />
      </SelectTrigger>
      <SelectContent>
        {/* [UI-가정] "선택 안 함" clears the value */}
        <SelectItem value={NONE} className="text-muted-foreground">
          선택 안 함
        </SelectItem>
        {(Object.keys(options) as K[]).map((k) => (
          <SelectItem key={k} value={k}>
            {options[k]}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}

// ---------------------------------------------------------------------------
// CompetencyChips — 역량 칩 (최대 3, 선택 순서 유지)
// ---------------------------------------------------------------------------

export function CompetencyChips<K extends string>({
  value,
  onChange,
  options,
  max = 3,
  labelledBy,
  describedBy,
  invalid,
}: {
  value: K[]
  onChange: (value: K[]) => void
  options: Record<K, string>
  max?: number
  labelledBy?: string
  /** id(s) of the error / help line → the add trigger's aria-describedby */
  describedBy?: string
  invalid?: boolean
}) {
  const full = value.length >= max
  const toggle = (k: K, on: boolean) => {
    if (on) {
      if (!value.includes(k) && value.length < max) onChange([...value, k])
    } else onChange(value.filter((v) => v !== k))
  }
  return (
    <div className={cn("flex flex-wrap items-center gap-2 rounded-md", invalid && "ring-2 ring-destructive")} role="group" aria-labelledby={labelledBy}>
      {value.map((k) => (
        <span key={k} className="inline-flex h-8 items-center gap-1 rounded-full bg-primary-subtle pr-1 pl-3 text-sm text-primary-subtle-foreground max-md:h-11">
          {options[k]}
          <button
            type="button"
            aria-label={`${options[k]} 빼기`}
            onClick={() => toggle(k, false)}
            className="grid size-6 place-items-center rounded-full hover:bg-primary/10 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
          >
            <X className="size-3.5" aria-hidden />
          </button>
        </span>
      ))}
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="chip" aria-labelledby={labelledBy} aria-describedby={describedBy} aria-invalid={invalid || undefined}>
            {value.length ? (
              <>
                <Plus className="size-3.5" aria-hidden />
                역량 추가
              </>
            ) : (
              <>
                <span className="text-muted-foreground">미선택</span>
                <ChevronDown className="size-3.5 text-muted-foreground" aria-hidden />
              </>
            )}
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="min-w-52">
          {full ? (
            <>
              <DropdownMenuLabel className="text-xs font-normal text-muted-foreground">최대 3개까지 고를 수 있어요</DropdownMenuLabel>
              <DropdownMenuSeparator />
            </>
          ) : null}
          {(Object.keys(options) as K[]).map((k) => {
            const checked = value.includes(k)
            return (
              <DropdownMenuCheckboxItem
                key={k}
                checked={checked}
                disabled={!checked && full}
                onSelect={(e) => e.preventDefault()}
                onCheckedChange={(on) => toggle(k, on === true)}
              >
                {options[k]}
              </DropdownMenuCheckboxItem>
            )
          })}
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  )
}

// ---------------------------------------------------------------------------
// ResizeHandle — 2단 너비 조절 (5.9, A-14: keyboard without drag)
// ---------------------------------------------------------------------------

export const PANEL_WIDTH = { default: 420, min: 360, max: 640, leftMin: 448 } as const

/**
 * `role="separator"` between the left column and the panel. Drag, or keyboard: ←/→ 16px, Shift 64px,
 * Home = min, End = max, Enter = default (420) [가정]. `max` is already clamped by the caller
 * (≤ 640, ≤ 50% of the card, left ≥ 448).
 */
export function ResizeHandle({ width, min, max, onWidthChange }: { width: number; min: number; max: number; onWidthChange: (w: number) => void }) {
  const clamp = (w: number) => Math.round(Math.min(max, Math.max(min, w)))
  const dragging = React.useRef<{ x: number; w: number } | null>(null)
  const [active, setActive] = React.useState(false)

  React.useEffect(() => {
    if (!active) return
    const move = (e: PointerEvent) => {
      if (!dragging.current) return
      // the panel is on the right: moving left widens it
      onWidthChange(clamp(dragging.current.w + (dragging.current.x - e.clientX)))
    }
    const up = () => {
      dragging.current = null
      setActive(false)
    }
    document.body.classList.add("select-none", "cursor-col-resize")
    window.addEventListener("pointermove", move)
    window.addEventListener("pointerup", up, { once: true })
    return () => {
      document.body.classList.remove("select-none", "cursor-col-resize")
      window.removeEventListener("pointermove", move)
      window.removeEventListener("pointerup", up)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- clamp depends on min / max only
  }, [active, min, max, onWidthChange])

  const onKeyDown = (e: React.KeyboardEvent) => {
    const step = e.shiftKey ? 64 : 16
    let next: number | null = null
    if (e.key === "ArrowLeft") next = width + step
    else if (e.key === "ArrowRight") next = width - step
    else if (e.key === "Home") next = min
    else if (e.key === "End") next = max
    else if (e.key === "Enter") next = PANEL_WIDTH.default
    if (next === null) return
    e.preventDefault()
    onWidthChange(clamp(next))
  }

  return (
    <div
      role="separator"
      aria-orientation="vertical"
      aria-label="Resumate AI 패널 너비"
      aria-valuenow={width}
      aria-valuemin={min}
      aria-valuemax={max}
      aria-valuetext={`패널 ${width}픽셀`}
      tabIndex={0}
      onKeyDown={onKeyDown}
      onPointerDown={(e) => {
        e.preventDefault()
        dragging.current = { x: e.clientX, w: width }
        setActive(true)
      }}
      className="group flex w-3 shrink-0 cursor-col-resize items-center justify-center rounded-full outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      <span aria-hidden className={cn("h-10 w-1 rounded-full bg-border group-hover:bg-muted-foreground/50", active && "bg-muted-foreground/50")} />
    </div>
  )
}

