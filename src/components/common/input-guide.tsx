/**
 * C-07 입력 가이드 + 글자 수 표시 + MonthField (design-system 3.6, 2 공통 패턴).
 */
"use client"

import * as React from "react"
import { Lightbulb, ShieldAlert, UserRound, type LucideIcon } from "lucide-react"
import { cn } from "@/lib/utils"
import { Checkbox } from "@/components/ui/checkbox"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"

export type GuideId = "G-1" | "G-2" | "G-3" | "G-4"

/** Spec copy (02 C-07). G-3/G-4 take extra content (action link / per-field example). */
export const GUIDE_COPY: Record<"G-1" | "G-2" | "G-3", string> = {
  "G-1": "'우리 팀은'보다 '저는'으로 써 주세요. 팀이 한 일·배경은 상황에 써 주세요",
  "G-2": "건강·종교·노조 활동 같은 민감정보, 동료·고객의 개인정보, 회사 기밀은 쓰지 마세요",
  "G-3": "수치를 정량 성과로 정리하면 AI가 숫자를 정확히 써요",
}

const GUIDE_ICON: Record<GuideId, LucideIcon> = {
  "G-1": UserRound,
  "G-2": ShieldAlert,
  "G-3": Lightbulb,
  "G-4": Lightbulb,
}

/**
 * Help line under a field (gap-field). Not warning-styled.
 * G-4: pass the per-field example as children. G-3: pass the "+ 정량 성과" button as `action`.
 */
export function InputGuide({
  id,
  guide,
  children,
  action,
  className,
}: {
  /** for aria-describedby */
  id?: string
  guide: GuideId
  children?: React.ReactNode
  action?: React.ReactNode
  className?: string
}) {
  const Icon = GUIDE_ICON[guide]
  const text = guide === "G-4" ? children : (GUIDE_COPY[guide] ?? children)
  return (
    <p id={id} className={cn("flex items-start gap-1.5 text-sm leading-5 text-muted-foreground", className)}>
      <Icon className="mt-0.5 size-4 shrink-0" aria-hidden />
      <span>
        {text}
        {action ? <> {action}</> : null}
      </span>
    </p>
  )
}

/** "1,240 / 2,000" — 90% 넘으면 warning, 넘으면 destructive */
export function CharCount({ count, limit, suffix, className, id }: { count: number; limit: number; suffix?: string; className?: string; id?: string }) {
  const tone = count > limit ? "text-destructive" : count >= limit * 0.9 ? "text-warning-subtle-foreground" : "text-muted-foreground"
  return (
    <span id={id} className={cn("text-xs font-medium tabular-nums", tone, className)} aria-live={count > limit ? "polite" : undefined}>
      {count.toLocaleString("ko-KR")} / {limit.toLocaleString("ko-KR")}
      {suffix}
    </span>
  )
}

/** Count characters by count_basis (자소서 공백 기준) */
export function countChars(text: string, basis: "with_spaces" | "without_spaces" = "with_spaces"): number {
  return basis === "without_spaces" ? text.replace(/\s/g, "").length : text.length
}

// ---------------------------------------------------------------------------
// MonthField — 연 Select + 월 Select (+ 재직 중 / 재학 중 checkbox)
// value: 'YYYY-MM-01' | null
// ---------------------------------------------------------------------------

export function MonthField({
  id,
  label,
  value,
  onChange,
  required,
  disabled,
  minYear = 1970,
  maxYear = new Date().getFullYear() + 1,
  ongoing,
  className,
  describedBy,
  size = "default",
  labelHidden = false,
  invalid,
}: {
  id: string
  label: string
  value: string | null
  onChange: (value: string | null) => void
  required?: boolean
  disabled?: boolean
  minYear?: number
  maxYear?: number
  /** 재직 중 / 재학 중 checkbox (disables this field when checked) */
  ongoing?: { label: string; checked: boolean; onCheckedChange: (checked: boolean) => void }
  className?: string
  describedBy?: string
  /** (v4) design-system 5.9: "sm" = L-02 머리 행 (h-8, 연 6.5rem / 월 5rem). Default keeps the form size. */
  size?: "default" | "sm"
  /** (v4) L-02 FieldRows: the row label (dt) is the visible label, so this one is sr-only. */
  labelHidden?: boolean
  invalid?: boolean
}) {
  // UQ-8: a year without a month stays local; the value is emitted only when both are set
  const [draftYear, setDraftYear] = React.useState<string>("")
  const year = value ? value.slice(0, 4) : draftYear
  const month = value ? String(Number(value.slice(5, 7))) : ""
  const isDisabled = disabled || ongoing?.checked
  const years = React.useMemo(() => {
    const list: string[] = []
    for (let y = maxYear; y >= minYear; y -= 1) list.push(String(y))
    return list
  }, [minYear, maxYear])

  const emit = (y: string, m: string) => {
    setDraftYear(y)
    if (!y || !m) return onChange(null)
    onChange(`${y}-${m.padStart(2, "0")}-01`)
  }

  const sm = size === "sm"
  const triggerSm = "h-8 text-sm data-[size=sm]:h-8 data-[size=default]:h-8"
  return (
    <div className={cn(labelHidden ? "contents" : "space-y-1.5", className)}>
      <span id={`${id}-label`} className={labelHidden ? "sr-only" : "block text-sm leading-5 font-medium"}>
        {label}
        {required ? (
          <>
            <span aria-hidden className="text-destructive"> *</span>
            <span className="sr-only">필수</span>
          </>
        ) : null}
      </span>
      <div className="flex flex-wrap items-center gap-2" role="group" aria-labelledby={`${id}-label`} aria-describedby={describedBy}>
        <Select value={year} onValueChange={(y) => emit(y, month)} disabled={isDisabled}>
          <SelectTrigger
            id={`${id}-year`}
            size={sm ? "sm" : "default"}
            className={sm ? cn("w-[6.5rem]", triggerSm) : "w-28"}
            aria-label={`${label} 연도`}
            aria-invalid={invalid || undefined}
          >
            <SelectValue placeholder="연도" />
          </SelectTrigger>
          <SelectContent className="max-h-72">
            {years.map((y) => (
              <SelectItem key={y} value={y}>
                {y}년
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={month} onValueChange={(m) => emit(year, m)} disabled={isDisabled || !year}>
          <SelectTrigger
            id={`${id}-month`}
            size={sm ? "sm" : "default"}
            className={sm ? cn("w-[5rem]", triggerSm) : "w-24"}
            aria-label={`${label} 월`}
            aria-invalid={invalid || undefined}
          >
            <SelectValue placeholder="월" />
          </SelectTrigger>
          <SelectContent>
            {Array.from({ length: 12 }, (_, i) => String(i + 1)).map((m) => (
              <SelectItem key={m} value={m}>
                {m}월
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        {ongoing ? (
          <Label className="flex items-center gap-2 text-base font-normal">
            <Checkbox checked={ongoing.checked} onCheckedChange={(v) => ongoing.onCheckedChange(v === true)} />
            {ongoing.label}
          </Label>
        ) : null}
      </div>
    </div>
  )
}
