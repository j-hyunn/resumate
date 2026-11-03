"use client"

/**
 * C-08 자리 표시 · 검증 배지 (design-system 3.7).
 * - <PlaceholderText text placeholders /> highlights the 6 fixed tokens with a hint tooltip
 * - <BlockFlagBadges flags userModified onAddToCareer /> leads the chip row of a block
 * - <CopyWithPlaceholderGuard> wraps a copy action with "자리 표시 N개가 남아 있습니다"
 */
import * as React from "react"
import { Hash, PenLine, Plus, SearchCheck } from "lucide-react"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import type { DraftBlockFlag, PlaceholderToken } from "@/types/db"

export const PLACEHOLDER_TOKENS: readonly PlaceholderToken[] = [
  "[수치 입력 필요]",
  "[기간 입력 필요]",
  "[내용 확인 필요]",
  "[지원 동기 입력 필요]",
  "[계획 입력 필요]",
  "[사례 입력 필요]",
]

const TOKEN_RE = new RegExp(`(${PLACEHOLDER_TOKENS.map((t) => t.replace(/[[\]]/g, "\\$&")).join("|")})`, "g")

export function countPlaceholders(text: string): number {
  return text.match(TOKEN_RE)?.length ?? 0
}

export function PlaceholderText({
  text,
  placeholders = [],
  className,
}: {
  text: string
  placeholders?: Array<{ token: PlaceholderToken; hint: string }>
  className?: string
}) {
  const parts = text.split(TOKEN_RE)
  const isToken = (part: string) => PLACEHOLDER_TOKENS.includes(part as PlaceholderToken)
  return (
    <span className={className}>
      {parts.map((part, i) => {
        if (!isToken(part)) return <React.Fragment key={i}>{part}</React.Fragment>
        const tokenIndex = parts.slice(0, i).filter(isToken).length
        const hint = placeholders.find((p) => p.token === part)?.hint ?? placeholders[tokenIndex]?.hint
        const mark = (
          <mark
            tabIndex={0}
            className="rounded-sm bg-warning-subtle px-0.5 text-warning-subtle-foreground underline decoration-warning decoration-dashed underline-offset-4 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            {part}
          </mark>
        )
        return hint ? (
          <Tooltip key={i}>
            <TooltipTrigger asChild>{mark}</TooltipTrigger>
            <TooltipContent>{hint}</TooltipContent>
          </Tooltip>
        ) : (
          <React.Fragment key={i}>{mark}</React.Fragment>
        )
      })}
    </span>
  )
}

export function BlockFlagBadges({
  flags,
  userModified,
  onAddToCareer,
}: {
  flags: DraftBlockFlag[]
  userModified?: boolean
  /** "커리어에 추가하기" — 상세 내용 근거 블록이면 S-35 해당 필드로 */
  onAddToCareer?: () => void
}) {
  return (
    <>
      {flags.includes("evidence_check_needed") ? (
        <Badge variant="warning" className="h-6">
          <SearchCheck aria-hidden />
          근거 확인 필요
        </Badge>
      ) : null}
      {flags.includes("number_check_needed") ? (
        <Badge variant="warning" className="h-6">
          <Hash aria-hidden />
          수치 확인 필요
        </Badge>
      ) : null}
      {userModified ? (
        <Badge variant="muted" className="h-6">
          <PenLine aria-hidden />
          편집됨 — 근거 재확인 권장
        </Badge>
      ) : null}
      {onAddToCareer ? (
        <Button variant="link" size="sm" className="h-6 px-1" onClick={onAddToCareer}>
          <Plus aria-hidden />
          커리어에 추가하기
        </Button>
      ) : null}
    </>
  )
}

/** Copy action guard: warns when placeholders remain. */
export function CopyWithPlaceholderGuard({
  text,
  onCopy,
  children,
}: {
  text: string
  onCopy: () => void
  /** render prop receives the guarded click handler */
  children: (onClick: () => void) => React.ReactNode
}) {
  const [open, setOpen] = React.useState(false)
  const count = countPlaceholders(text)
  return (
    <>
      {children(() => (count > 0 ? setOpen(true) : onCopy()))}
      <AlertDialog open={open} onOpenChange={setOpen}>
        <AlertDialogContent>
          <AlertDialogHeader className="text-left">
            <AlertDialogTitle className="text-lg font-semibold">자리 표시 {count}개가 남아 있습니다</AlertDialogTitle>
          </AlertDialogHeader>
          <AlertDialogFooter className="flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <AlertDialogCancel>취소</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                onCopy()
              }}
            >
              계속 복사
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}
