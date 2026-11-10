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
}: {
  idPrefix: string
  value: string
  error?: string
  onChange: (v: string) => void
  inputRef?: React.Ref<HTMLTextAreaElement>
}) {
  return (
    <div className="min-w-0 flex-1 space-y-1">
      <Label htmlFor={`${idPrefix}-text`} className="sr-only">
        문항 문장
      </Label>
      <Textarea
        id={`${idPrefix}-text`}
        ref={inputRef}
        value={value}
        maxLength={COVER_LETTER_LIMITS.question_text}
        className="min-h-16 field-sizing-content font-sans text-base"
        placeholder="예: 지원 동기를 작성해 주세요."
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? `${idPrefix}-text-error` : undefined}
        onChange={(e) => onChange(e.target.value)}
      />
      <div className="flex items-start justify-between gap-2">
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
