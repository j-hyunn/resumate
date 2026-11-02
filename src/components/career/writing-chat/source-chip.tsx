"use client"

/**
 * C-15 출처 발화 칩 + 필드 상태 (02 C-15, design-system 3.14). Same shape as C-01
 * (CHIP_CLASS). States: ① 출처 있음 (origin ai, review ok) ② 직접 수정 (user_edit)
 * ③ 검토 필요 [수락][거절(비우기)] → 수락함 ④ 아직 없음. 보조: 본인 역할 확인 중.
 */
import * as React from "react"
import { Check, CircleDashed, MessageCircleQuestion, PenLine, TriangleAlert } from "lucide-react"
import { cn } from "@/lib/utils"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { CHIP_CLASS } from "@/components/common/evidence"
import type { StructuredField } from "@/types/db"

export type FieldUiState = "source" | "user_edit" | "needs_review" | "accepted" | "empty"

export function fieldUiState(field: StructuredField<unknown> | undefined): FieldUiState {
  if (!field || field.value === null || field.value === "") return "empty"
  if (field.origin === "user_edit") return "user_edit"
  if (field.review === "needs_review") return "needs_review"
  if (field.review === "accepted") return "accepted"
  return "source"
}

/** "내 답변 #n" — click scrolls to the utterance and highlights the quote */
export function SourceChip({
  number,
  quote,
  onClick,
}: {
  number: number
  quote?: string
  onClick: () => void
}) {
  return (
    <button type="button" className={CHIP_CLASS} onClick={onClick} aria-label={`출처: 내 답변 #${number}${quote ? `, "${quote}"` : ""}`}>
      내 답변 #{number}
    </button>
  )
}

export function SourceChips({
  field,
  numbers,
  onJump,
}: {
  field: Pick<StructuredField<unknown>, "source_message_ids" | "source_quotes">
  numbers: Record<string, number>
  onJump: (messageId: string, quote?: string) => void
}) {
  const ids = field.source_message_ids.filter((id) => numbers[id] !== undefined)
  if (ids.length === 0) return null
  return (
    <span className="flex flex-wrap gap-1">
      {ids.map((id, i) => (
        <SourceChip key={id} number={numbers[id]} quote={field.source_quotes[i]} onClick={() => onJump(id, field.source_quotes[i])} />
      ))}
    </span>
  )
}

/** Right side of a preview field's label row */
export function FieldStateMark({
  state,
  field,
  numbers,
  onJump,
}: {
  state: FieldUiState
  field?: StructuredField<unknown>
  numbers: Record<string, number>
  onJump: (messageId: string, quote?: string) => void
}) {
  if (state === "user_edit")
    return (
      <span className="flex items-center gap-1 text-xs font-medium text-muted-foreground">
        <PenLine className="size-3" aria-hidden />
        직접 수정
      </span>
    )
  if (state === "accepted" && field)
    return (
      <span className="flex flex-wrap items-center gap-1">
        <span className="flex items-center gap-1 text-xs font-medium text-success-subtle-foreground">
          <Check className="size-3" aria-hidden />
          수락함
        </span>
        <SourceChips field={field} numbers={numbers} onJump={onJump} />
      </span>
    )
  if (state === "source" && field) return <SourceChips field={field} numbers={numbers} onJump={onJump} />
  return null
}

/** ③ 검토 필요 wrapper */
export function NeedsReviewBox({
  children,
  field,
  numbers,
  onJump,
  onAccept,
  onReject,
  disabled,
  id,
  fieldLabel,
}: {
  /** UQ-69: "{필드} 수락" accessible names */
  fieldLabel?: string
  children: React.ReactNode
  field: StructuredField<unknown>
  numbers: Record<string, number>
  onJump: (messageId: string, quote?: string) => void
  onAccept: () => void
  onReject: () => void
  disabled?: boolean
  id?: string
}) {
  return (
    <div id={id} tabIndex={-1} className="space-y-2 rounded-md border border-warning bg-warning-subtle p-3">
      <p className="flex items-start gap-1.5 text-sm text-warning-subtle-foreground">
        <TriangleAlert className="mt-0.5 size-4 shrink-0 text-warning" aria-hidden />
        AI가 정리한 표현이 원래 말과 달라요. 확인해 주세요
      </p>
      {children}
      <SourceChips field={field} numbers={numbers} onJump={onJump} />
      <div className="flex gap-2">
        <Button size="sm" onClick={onAccept} disabled={disabled} aria-label={fieldLabel ? `${fieldLabel} 수락` : undefined}>
          수락
        </Button>
        <Button size="sm" variant="outline" onClick={onReject} disabled={disabled} aria-label={fieldLabel ? `${fieldLabel} 거절(비우기)` : undefined}>
          거절(비우기)
        </Button>
      </div>
    </div>
  )
}

export function EmptyValue({ className }: { className?: string }) {
  return (
    <span className={cn("flex items-center gap-1 text-muted-foreground", className)}>
      <CircleDashed className="size-3.5" aria-hidden />
      아직 없음
    </span>
  )
}

export function ActorAmbiguousBadge({ onClick }: { onClick?: () => void }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Badge asChild variant="info" className="cursor-pointer">
          <button type="button" onClick={onClick}>
            <MessageCircleQuestion className="size-3" aria-hidden />
            본인 역할 확인 중
          </button>
        </Badge>
      </TooltipTrigger>
      <TooltipContent>본인 역할 확인 중 — 팀이 한 일과 본인이 한 일을 AI가 묻고 있어요</TooltipContent>
    </Tooltip>
  )
}
