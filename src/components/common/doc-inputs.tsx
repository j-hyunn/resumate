"use client"

/**
 * L-02 문서형 입력 (design-system v4 5.9, A-13 예외) — S-10 · S-44 (and C-02 range focus).
 * DocTitleInput · DocTextarea (+ list Enter / Tab, highlightRange) · FieldRows · ChipSelect · CompetencyChips.
 * Borderless on purpose: every one keeps a visible label (or aria-label), a placeholder, a hover background
 * and the `ring-2 ring-ring` focus ring.
 */
import * as React from "react"
import { ChevronDown, Pencil, X } from "lucide-react"
import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { Label } from "@/components/ui/label"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { editorOf, rawValueOf } from "./doc-markdown-editor"

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
        "-mx-2 w-full min-w-0 rounded-md bg-transparent px-2 py-0.5 text-xl leading-8 font-bold outline-none placeholder:text-muted-foreground hover:bg-accent/60 focus-visible:bg-transparent aria-invalid:ring-2 aria-invalid:ring-destructive",
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

export { DocTextarea, type DocTextareaProps } from "./doc-markdown-editor"

/**
 * 근거 구간 강조 (C-02 → S-44 `source_locator {start, end}`) and the "지금 본문에서" chip (3.14 v4, G-51):
 * focus the textarea, select the range, scroll it into view and flash the field once.
 * `quote` instead of offsets: finds the text first. Returns false when the range / quote isn't there
 * (the caller toasts "지금 본문에서 그 문장을 찾지 못했어요" [가정]).
 */
export function highlightRange(field: HTMLElement | null, range: { start: number; end: number } | { quote: string }): boolean {
  if (!field) return false
  const editor = editorOf(field)
  if (editor) {
    // offsets are into the saved markdown: take that slice, drop the markdown marks, find it in the editor text
    // server offsets point into the saved string, not into a re-serialized one
    const quote = "quote" in range ? range.quote : (rawValueOf(field) ?? editor.getMarkdown()).slice(range.start, range.end)
    const at = findTextRange(editor, plainQuote(quote))
    field.scrollIntoView({ block: "center", behavior: "smooth" })
    if (at) editor.chain().focus(undefined, { scrollIntoView: false }).setTextSelection(at).run()
    else editor.commands.focus(undefined, { scrollIntoView: false })
    flashElement(field)
    return Boolean(at)
  }
  if (!(field instanceof HTMLTextAreaElement)) return false
  const textarea = field
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

/** markdown → the text a reader sees (marks, list / heading / quote markers removed), first line only */
function plainQuote(md: string): string {
  // the editor escapes literal markup characters (\* \_ \[ …) and writes `&lt;` for a tag-like `<`, so an unescaped
  // `*` / `~` / `` ` `` is always markup; `_` is markup only at a word edge (snake_case stays). Protect escapes first,
  // strip markup, then restore the escaped characters as plain text (backend QA R9 QA-04).
  const kept: string[] = []
  const protectedText = md.replace(/\\([\\`*_[\]~|#>().!+-])/g, (_, ch: string) => {
    kept.push(ch)
    return `\u0000${kept.length - 1}\u0000`
  })
  return protectedText
    .split("\n")
    .map((l) => l.replace(/^\s*(?:[-*+]|\d+\.|#{1,6}|>)\s+/, ""))
    .join(" ")
    .replace(/(\*\*|~~|\*|`)/g, "")
    .replace(/(?<![\p{L}\p{N}])__?|__?(?![\p{L}\p{N}])/gu, "")
    .replace(/\u0000(\d+)\u0000/g, (_, i: string) => kept[Number(i)] ?? "")
    .replace(/&lt;/g, "<")
    .trim()
}

/** the quote inside one text block of the editor → its document positions */
function findTextRange(editor: NonNullable<ReturnType<typeof editorOf>>, quote: string): { from: number; to: number } | null {
  if (!quote) return null
  let hit: { from: number; to: number } | null = null
  editor.state.doc.descendants((node, pos) => {
    if (hit) return false
    if (!node.isTextblock) return true
    const i = node.textContent.indexOf(quote)
    if (i >= 0) hit = { from: pos + 1 + i, to: pos + 1 + i + quote.length }
    return false
  })
  return hit
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

/** 짧은 머리 항목 여러 개를 한 줄에 가로로 (라벨 + 값). 좁으면 다음 줄로 넘어간다. */
export function InlineFields({ children, className }: { children: React.ReactNode; className?: string }) {
  return <dl className={cn("flex flex-wrap items-start gap-x-8 gap-y-2", className)}>{children}</dl>
}

/**
 * One term–value group of `InlineFields`: exactly one `div` wrapping `dt` + `dd` (HTML dl rule), the error inside
 * `dd` (UQ-SC-6). The look is the same as before — label and value side by side, the error on its own line under
 * both, starting at the label: a 2-column grid on the group with `dd` spanning both columns as a subgrid, so the
 * value sits in column 2 next to the label and the error spans the full width on the next row.
 */
export function InlineField({ label, labelId, children, error }: { label: string; labelId?: string; children: React.ReactNode; error?: React.ReactNode }) {
  return (
    <div className="grid min-w-0 grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-1">
      <dt id={labelId} className="col-start-1 row-start-1 flex min-h-9 items-center self-start text-sm text-muted-foreground">
        {label}
      </dt>
      <dd className="col-span-2 col-start-1 row-start-1 grid grid-cols-subgrid gap-y-1">
        <div className="col-start-2 flex min-h-9 flex-wrap items-center gap-2">{children}</div>
        {error ? <div className="col-span-2 col-start-1">{error}</div> : null}
      </dd>
    </div>
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
  /** id(s) of the error / help line → the trigger's aria-describedby */
  describedBy?: string
  invalid?: boolean
}) {
  // pick in a popover (up to `max`), then [적용] commits them at once; closing (outside click / Esc) drops the draft
  const [open, setOpen] = React.useState(false)
  const [draft, setDraft] = React.useState<K[]>(value)
  const keys = Object.keys(options) as K[]
  const draftFull = draft.length >= max
  const changed = draft.length !== value.length || draft.some((k) => !value.includes(k))
  const onOpenChange = (o: boolean) => {
    if (o) setDraft(value)
    setOpen(o)
  }
  const toggle = (k: K, on: boolean) =>
    setDraft((d) => (on ? (d.includes(k) || d.length >= max ? d : [...d, k]) : d.filter((x) => x !== k)))
  return (
    <div className={cn("flex flex-wrap items-center gap-2 rounded-md", invalid && "ring-2 ring-destructive")} role="group" aria-labelledby={labelledBy}>
      {value.map((k) => (
        <span key={k} className="inline-flex h-8 items-center gap-1 rounded-full bg-primary-subtle pr-1 pl-3 text-sm text-primary-subtle-foreground">
          {options[k]}
          <button
            type="button"
            aria-label={`${options[k]} 빼기`}
            onClick={() => onChange(value.filter((v) => v !== k))}
            className="grid size-6 place-items-center rounded-full hover:bg-primary/10 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
          >
            <X className="size-3.5" aria-hidden />
          </button>
        </span>
      ))}
      <Popover open={open} onOpenChange={onOpenChange}>
        <PopoverTrigger asChild>
          <Button variant="chip" size="sm" className="max-md:px-3" aria-labelledby={labelledBy} aria-describedby={describedBy} aria-invalid={invalid || undefined}>
            {value.length ? (
              <>
                <Pencil className="size-3.5" aria-hidden />
                역량 선택
              </>
            ) : (
              <>
                <span className="text-muted-foreground">미선택</span>
                <ChevronDown className="size-3.5 text-muted-foreground" aria-hidden />
              </>
            )}
          </Button>
        </PopoverTrigger>
        <PopoverContent align="start" className="w-64 p-0">
          <div className="flex items-baseline justify-between gap-2 px-3 pt-3 pb-2">
            <p className="text-sm font-medium">역량 선택</p>
            <p className={cn("text-xs tabular-nums", draftFull ? "text-primary-text" : "text-muted-foreground")}>
              {draft.length} / {max}
            </p>
          </div>
          <ul
            className="max-h-72 space-y-0.5 scrollbar-thin scrollbar-thumb-muted-foreground/30 scrollbar-track-transparent overflow-y-auto px-1.5 pb-2"
            aria-label="역량 목록"
          >
            {keys.map((k) => {
              const checked = draft.includes(k)
              const disabled = !checked && draftFull
              return (
                <li key={k}>
                  <Label
                    className={cn(
                      "flex min-h-9 cursor-pointer items-center gap-2.5 rounded-md px-1.5 text-sm font-normal hover:bg-accent",
                      disabled && "cursor-not-allowed opacity-50 hover:bg-transparent",
                    )}
                  >
                    <Checkbox checked={checked} disabled={disabled} onCheckedChange={(on) => toggle(k, on === true)} />
                    {options[k]}
                  </Label>
                </li>
              )
            })}
          </ul>
          <div className="flex justify-end border-t px-3 py-2">
            <Button
                size="sm"
                disabled={!changed}
                onClick={() => {
                  // keep the option order, not the click order
                  onChange(keys.filter((k) => draft.includes(k)))
                  setOpen(false)
                }}
              >
                적용
              </Button>
          </div>
        </PopoverContent>
      </Popover>
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

