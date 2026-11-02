"use client"

/**
 * S-08 "작성 중인 AI 대화" + v5.3 A6 "그만둔 AI 대화" (02 S-08, design-system 6장 A2 (v3)).
 * - 작성 중 행: 대상 · 마지막 활동 · n/40 (시작 인사 제외, A5) · 자동 삭제 D-day · "이어서" ·
 *   ⋯ "대화 그만두기"(→ abandoned, 확인) · 구분선 · "대화 삭제"(C-05)
 * - 그만둔 대화: 접힌 묶음 "그만둔 대화 N개" (0개면 없음). 행 = PauseCircle + 같은 meta +
 *   "다시 이어 하기"(abandoned → active, AI 호출 없음 · 키 없이 가능 → S-36) + ⋯ "대화 삭제"
 * After abandoning (here or in S-36) the group opens with that row flashed once [UI-가정 G-37].
 */
import * as React from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { ChevronRight, Loader2, MoreHorizontal, PauseCircle, Sparkles } from "lucide-react"
import { cn } from "@/lib/utils"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card } from "@/components/ui/card"
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible"
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu"
import type { WritingChat } from "@/types/db"
import { formatRelative } from "@/lib/data/labels"
import { daysUntilAutoDelete, WRITING_CHAT_MESSAGE_LIMIT } from "@/lib/data/writing-chat-limits"
import { routes } from "@/lib/routes"
import { AbandonChatDialog, takeAbandonedFlash, useResumeChat } from "./writing-chat/abandon"

export function WritingChatLists({
  active,
  abandoned,
  projectName,
  now,
  onDelete,
}: {
  active: WritingChat[]
  abandoned: WritingChat[]
  projectName: (id: string | null) => string
  now: number
  /** C-05 (entity_type writing_chat) — owned by the tree's delete dialog */
  onDelete: (chatId: string) => void
}) {
  const router = useRouter()
  const [abandoning, setAbandoning] = React.useState<WritingChat | null>(null)
  const [open, setOpen] = React.useState(false)
  const [flashId, setFlashId] = React.useState<string | null>(null)
  const [announce, setAnnounce] = React.useState("")
  const { resume, pendingId } = useResumeChat()

  // 그만둔 뒤 S-08: open the group and flash that row once
  React.useEffect(() => {
    const id = takeAbandonedFlash()
    if (!id) return
    /* eslint-disable react-hooks/set-state-in-effect -- one-shot read of session storage after navigation */
    setOpen(true)
    setFlashId(id)
    // UQ-485: announce once and move focus to the row's "다시 이어 하기" (the menu trigger is gone)
    setAnnounce("대화를 그만뒀어요. 그만둔 대화 묶음에서 다시 이어 할 수 있어요")
    /* eslint-enable react-hooks/set-state-in-effect */
    const f = window.setTimeout(() => document.getElementById(`resume-chat-${id}`)?.focus(), 80)
    const t = window.setTimeout(() => setFlashId(null), 1400)
    return () => {
      window.clearTimeout(f)
      window.clearTimeout(t)
    }
  }, [abandoned.length])

  const target = (c: WritingChat) => (c.mode === "new_project" ? "새 프로젝트" : projectName(c.project_id))
  const meta = (c: WritingChat) => (
    <span className="text-sm text-muted-foreground tabular-nums">
      {formatRelative(c.last_activity_at, now)} · {c.message_count}/{WRITING_CHAT_MESSAGE_LIMIT}
    </span>
  )
  const deadline = (c: WritingChat) => {
    const left = daysUntilAutoDelete(c, now)
    return left !== null ? <Badge variant="warning">{left}일 뒤 자동 삭제</Badge> : null
  }

  if (!active.length && !abandoned.length) return null

  return (
    <section className="space-y-2" aria-label="AI 작성 대화">
      {active.length ? (
        <h2 className="text-lg leading-7 font-semibold">작성 중인 AI 대화</h2>
      ) : null}
      {active.length ? (
        <Card className="gap-0 divide-y p-0">
          {active.map((c) => (
            <div key={c.id} className="flex flex-wrap items-center gap-2 px-4 py-3">
              <Sparkles className="size-4 text-ai" aria-hidden />
              <span className="min-w-0 flex-1 font-medium">{target(c)}</span>
              {meta(c)}
              {deadline(c)}
              <Button asChild variant="outline" size="sm">
                <Link href={routes.writingChat(c.id)}>이어서</Link>
              </Button>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="ghost" size="icon-sm" className="size-11 lg:size-8" aria-label={`'${target(c)}' 대화 메뉴`}>
                    <MoreHorizontal aria-hidden />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  <DropdownMenuItem onSelect={() => setAbandoning(c)}>
                    <PauseCircle aria-hidden />
                    대화 그만두기
                  </DropdownMenuItem>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem className="text-destructive" onSelect={() => onDelete(c.id)}>
                    대화 삭제
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          ))}
        </Card>
      ) : null}

      {abandoned.length ? (
        <Collapsible open={open} onOpenChange={setOpen}>
          <CollapsibleTrigger asChild>
            <Button variant="ghost" size="sm" className="text-sm text-muted-foreground">
              <ChevronRight className={cn("size-4 transition-transform", open && "rotate-90")} aria-hidden />
              {/* [UI-가정] 묶음 이름 (02 S-08 `[가정]`) */}
              <span className="tabular-nums">그만둔 대화 {abandoned.length}개</span>
            </Button>
          </CollapsibleTrigger>
          <CollapsibleContent>
            <Card className="mt-2 gap-0 divide-y p-0" role="group" aria-label="그만둔 대화">
              {abandoned.map((c) => (
                <div
                  key={c.id}
                  className={cn("flex flex-wrap items-center gap-2 px-4 py-3", flashId === c.id && "animate-field-flash")}
                >
                  <PauseCircle className="size-4 text-muted-foreground" aria-hidden />
                  <span className="min-w-0 flex-1 font-medium">{target(c)}</span>
                  {meta(c)}
                  {deadline(c)}
                  {/* A6: no AI call → no C-19 badge, enabled without a key */}
                  <Button id={`resume-chat-${c.id}`} variant="outline" size="sm" disabled={pendingId !== null} onClick={() => void resume(c.id)}>
                    {pendingId === c.id ? <Loader2 className="animate-spin" aria-hidden /> : null}
                    다시 이어 하기
                  </Button>
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button variant="ghost" size="icon-sm" className="size-11 lg:size-8" aria-label={`'${target(c)}' 그만둔 대화 메뉴`}>
                        <MoreHorizontal aria-hidden />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      <DropdownMenuItem className="text-destructive" onSelect={() => onDelete(c.id)}>
                        대화 삭제
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </div>
              ))}
            </Card>
          </CollapsibleContent>
        </Collapsible>
      ) : null}

      <p className="sr-only" role="status">
        {announce}
      </p>
      <AbandonChatDialog chat={abandoning} onOpenChange={(o) => !o && setAbandoning(null)} onAbandoned={() => router.refresh()} />
    </section>
  )
}
