"use client"

/**
 * C-15 출처 칩 (UX v5.6 C-15, design-system v4 3.14 "Resumate AI 패널의 C-15") — C-01 chip shape, label only
 * (no kind icon). Four kinds:
 *  - utterance  "내 답변 #n"                         → scroll to that user message + flash (S-10 STAR · 분류 추천)
 *  - fact       "이 말에서 정리했어요 · #n" (#3 외 1)   → first source utterance + highlight all (S-44 블록 · 확인이 필요한 내용) [가정 G-58]
 *  - body       "지금 본문에서"                       → select that range in the body field (S-44 블록, highlightRange)
 *  - project    "프로젝트 내용에서" + Tooltip          → no move; a focusable span, not a button (S-44 블록)
 */
import * as React from "react"
import { cn } from "@/lib/utils"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { CHIP_CLASS } from "./evidence"
import type { DeliverableProjectField } from "@/types/db"

/** "프로젝트 내용에서" tooltip names (3.14 v4) */
export const PROJECT_FIELD_LABELS: Record<DeliverableProjectField, string> = {
  "PRJ.description": "프로젝트 내용",
  "PRJ.role": "담당 업무",
  "PRJ.skills": "사용 기술",
  "PRJ.name": "프로젝트명",
  "PRJ.period": "프로젝트 기간",
}

export type SourceChipProps =
  | { kind: "utterance"; userNumber: number; onSelect: () => void; className?: string }
  | { kind: "fact"; userNumbers: number[]; onSelect: () => void; className?: string }
  | { kind: "body"; onSelect: () => void; className?: string }
  | { kind: "project"; fields: DeliverableProjectField[]; className?: string }

export function sourceChipLabel(props: SourceChipProps): string {
  switch (props.kind) {
    case "utterance":
      return `내 답변 #${props.userNumber}`
    case "fact": {
      const [first, ...rest] = props.userNumbers
      if (first === undefined) return "이 말에서 정리했어요"
      return `이 말에서 정리했어요 · #${first}${rest.length ? ` 외 ${rest.length}` : ""}`
    }
    case "body":
      return "지금 본문에서"
    case "project":
      return "프로젝트 내용에서"
  }
}

export function SourceChip(props: SourceChipProps) {
  const label = sourceChipLabel(props)
  if (props.kind === "project") {
    const names = props.fields.map((f) => PROJECT_FIELD_LABELS[f]).join(", ")
    return (
      <Tooltip>
        <TooltipTrigger asChild>
          <span tabIndex={0} className={cn(CHIP_CLASS, "cursor-default", props.className)} aria-label={`${label}: ${names}`}>
            <span className="truncate">{label}</span>
          </span>
        </TooltipTrigger>
        <TooltipContent>{names}</TooltipContent>
      </Tooltip>
    )
  }
  return (
    <button type="button" className={cn(CHIP_CLASS, props.className)} onClick={props.onSelect} title={label}>
      <span className="truncate">{label}</span>
    </button>
  )
}

/** 칩 묶음: 섹션·블록 아래 `mt-1.5 flex flex-wrap gap-1`. */
export function SourceChips({ children, className }: { children: React.ReactNode; className?: string }) {
  return <div className={cn("mt-1.5 flex flex-wrap gap-1", className)}>{children}</div>
}
