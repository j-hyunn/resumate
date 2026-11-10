"use client"

/**
 * 문항 칸 묶음 — **문항 설정 상태**와 작성 상태의 **"문항 편집"**이 같은 모양을 쓴다
 * (design-system 5.12 "문항 설정 상태" / "문항 편집", UX v5.20 S-46).
 *
 * 문항 문장(≤ 1,000자) · 글자 수 제한(1~10,000, **기본 800** CF-U2) · 기준(공백 포함/제외) ·
 * 메모(≤ 300자, **접어 둔다** CF-A10). A12 안내는 글자 수 칸 아래 줄이다.
 */
import * as React from "react"
import { Info, Plus } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Textarea } from "@/components/ui/textarea"
import { InputGroup, InputGroupAddon, InputGroupInput, InputGroupText } from "@/components/ui/input-group"
import { cn } from "@/lib/utils"
import { CharCount, InputGuide } from "@/components/common/input-guide"
import type { CountBasis } from "@/types/db"
import { CHAR_LIMIT_A12_NOTE } from "@/lib/data/cover-letter-copy"
import { COVER_LETTER_FUTURE_PLAN_NOTE_HINT, COVER_LETTER_LIMITS } from "@/lib/data/cover-letter-defaults"
import { COUNT_BASIS_LABELS } from "../labels"
import type { QuestionErrors, QuestionForm } from "./question-form"

export function QuestionTextField({
  idPrefix,
  value,
  error,
  onChange,
  inputRef,
  placeholder = "예: 지원 동기를 작성해 주세요.",
  compact = false,
  number,
  trailing,
}: {
  idPrefix: string
  value: string
  error?: string
  onChange: (v: string) => void
  inputRef?: React.Ref<HTMLTextAreaElement>
  placeholder?: string
  /**
   * 문항 설정 상태의 한 줄 모양 (시안 2): 입력 칸처럼 한 줄 높이에서 시작해 긴 문장만 늘어난다.
   * 오류·글자 수 줄은 그대로 아래에 붙는다.
   */
  compact?: boolean
  /** 문항 번호 — 숨은 라벨이 행마다 달라지게 ("문항 1 문장", 59 QA UQ-769) */
  number?: number
  /**
   * 칸 안 오른쪽 끝에 둘 작은 조작(문항 설정 행의 ⋯ 메뉴). 행 밖에 두면 글자 수 칸의 오른쪽 끝이 아래 주 버튼과
   * 어긋나서 칸 안쪽으로 넣었다 (59 QA UQ-767) `[UI-가정]`
   */
  trailing?: React.ReactNode
}) {
  return (
    <div className="min-w-0 flex-1 space-y-1">
      <Label htmlFor={`${idPrefix}-text`} className="sr-only">
        {number ? `문항 ${number} 문장` : "문항 문장"}
      </Label>
      <div className="relative">
      <Textarea
        id={`${idPrefix}-text`}
        ref={inputRef}
        value={value}
        maxLength={COVER_LETTER_LIMITS.question_text}
        rows={compact ? 1 : undefined}
        className={cn(
          compact ? "min-h-10 resize-none field-sizing-content py-2 font-sans text-base" : "min-h-16 field-sizing-content font-sans text-base",
          trailing ? "pr-10" : null,
        )}
        placeholder={placeholder}
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? `${idPrefix}-text-error` : undefined}
        onChange={(e) => onChange(e.target.value)}
      />
      {trailing ? <div className="absolute top-1 right-1">{trailing}</div> : null}
      </div>
      <div className={compact && !error && value.length < COVER_LETTER_LIMITS.question_text * 0.9 ? "hidden" : "flex items-start justify-between gap-2"}>
        {error ? (
          <p id={`${idPrefix}-text-error`} className="text-sm text-destructive" role="alert">
            {error}
          </p>
        ) : (
          <span />
        )}
        {/* C-07: 90%부터 보인다 */}
        {value.length >= COVER_LETTER_LIMITS.question_text * 0.9 ? <CharCount count={value.length} limit={COVER_LETTER_LIMITS.question_text} /> : null}
      </div>
    </div>
  )
}

/**
 * 글자 수 제한 칸 — 숫자 입력 + 접미사 "자" (시안 2의 오른쪽 상자). 공통 `InputGroup`.
 * 기본값 800은 폼이 미리 채운다(CF-U2). A12 안내는 이 칸에 포커스가 있을 때 부르는 쪽이 보인다.
 */
export function CharLimitInput({
  id,
  value,
  invalid,
  describedBy,
  onChange,
  inputRef,
  onFocus,
  onBlur,
  className,
  number,
}: {
  id: string
  value: string
  invalid?: boolean
  describedBy?: string
  onChange: (v: string) => void
  inputRef?: React.Ref<HTMLInputElement>
  onFocus?: () => void
  onBlur?: () => void
  className?: string
  /** 문항 번호 — 숨은 라벨 "문항 1 글자 수 제한" (59 QA UQ-769) */
  number?: number
}) {
  return (
    <InputGroup className={cn("h-10 w-[6.25rem] shrink-0", className)}>
      <InputGroupInput
        id={id}
        ref={inputRef}
        type="number"
        inputMode="numeric"
        min={1}
        max={10_000}
        step={100}
        aria-label={number ? `문항 ${number} 글자 수 제한` : "글자 수 제한"}
        className="h-10 text-base tabular-nums"
        value={value}
        aria-invalid={invalid ? true : undefined}
        aria-describedby={describedBy}
        onChange={(e) => onChange(e.target.value)}
        onFocus={onFocus}
        onBlur={onBlur}
      />
      <InputGroupAddon align="inline-end">
        <InputGroupText className="text-base text-foreground">자</InputGroupText>
      </InputGroupAddon>
    </InputGroup>
  )
}

/** 글자 수 제한 · 기준 · "메모 추가" 한 줄 + A12 안내 */
export function QuestionSettingsRow({
  idPrefix,
  form,
  errors,
  noteOpen,
  onOpenNote,
  onChange,
  limitRef,
}: {
  idPrefix: string
  form: QuestionForm
  errors?: QuestionErrors
  noteOpen: boolean
  onOpenNote: () => void
  onChange: (patch: Partial<QuestionForm>) => void
  limitRef?: React.Ref<HTMLInputElement>
}) {
  return (
    <div className="space-y-1.5">
      <div className="flex flex-wrap items-end gap-4">
        <div className="space-y-1.5">
          <Label htmlFor={`${idPrefix}-limit`}>글자 수 제한</Label>
          <div className="flex items-center gap-1.5">
            <Input
              id={`${idPrefix}-limit`}
              ref={limitRef}
              type="number"
              inputMode="numeric"
              min={1}
              max={10_000}
              step={100}
              className="w-28 tabular-nums"
              value={form.char_limit}
              aria-invalid={errors?.char_limit ? true : undefined}
              aria-describedby={`${idPrefix}-limit-note${errors?.char_limit ? ` ${idPrefix}-limit-error` : ""}`}
              onChange={(e) => onChange({ char_limit: e.target.value })}
            />
            <span className="text-sm text-muted-foreground">자</span>
          </div>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor={`${idPrefix}-basis`}>기준</Label>
          <Select value={form.count_basis} onValueChange={(v) => onChange({ count_basis: v as CountBasis })}>
            <SelectTrigger id={`${idPrefix}-basis`} size="sm" className="w-36">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="with_spaces">{COUNT_BASIS_LABELS.with_spaces}</SelectItem>
              <SelectItem value="without_spaces">{COUNT_BASIS_LABELS.without_spaces}</SelectItem>
            </SelectContent>
          </Select>
        </div>
        {/* 메모는 접어 둔다 (CF-A10) */}
        {!noteOpen && !form.user_note ? (
          <Button type="button" variant="ghost" size="sm" onClick={onOpenNote}>
            <Plus aria-hidden />
            메모 추가
          </Button>
        ) : null}
      </div>
      {errors?.char_limit ? (
        <p id={`${idPrefix}-limit-error`} className="text-sm text-destructive" role="alert">
          {errors.char_limit}
        </p>
      ) : null}
      <p id={`${idPrefix}-limit-note`} className="flex items-start gap-1.5 text-sm text-muted-foreground">
        <Info className="mt-0.5 size-3.5 shrink-0" aria-hidden />
        {CHAR_LIMIT_A12_NOTE}
      </p>
    </div>
  )
}

export function QuestionNoteField({
  idPrefix,
  form,
  errors,
  onChange,
}: {
  idPrefix: string
  form: QuestionForm
  errors?: QuestionErrors
  onChange: (patch: Partial<QuestionForm>) => void
}) {
  return (
    <div className="space-y-1.5">
      <Label htmlFor={`${idPrefix}-note`}>문항 메모</Label>
      <Textarea
        id={`${idPrefix}-note`}
        value={form.user_note}
        maxLength={COVER_LETTER_LIMITS.user_note}
        className="min-h-24 text-base leading-[1.75]"
        aria-invalid={errors?.user_note ? true : undefined}
        aria-describedby={`${idPrefix}-note-help`}
        onChange={(e) => onChange({ user_note: e.target.value })}
      />
      <div id={`${idPrefix}-note-help`} className="space-y-1">
        <div className="flex items-start justify-between gap-2">
          <p className="text-sm text-muted-foreground">
            {/* [UI-가정] 메모 안내 문구 + 입사 후 포부 문항 힌트 (UX S-46) */}
            강조하고 싶은 점이나 지원 이유를 남기면 AI가 초안에 반영해요
            {form.template_key === "future_plan" ? `. ${COVER_LETTER_FUTURE_PLAN_NOTE_HINT}` : ""}
          </p>
          <CharCount count={form.user_note.length} limit={COVER_LETTER_LIMITS.user_note} />
        </div>
        <InputGuide guide="G-2" />
      </div>
    </div>
  )
}
