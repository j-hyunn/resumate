"use client"

/**
 * v5.3 A6 그만두기 / 다시 이어 하기 (02 S-36 "대화 그만두기 (메뉴)", S-08 "그만둔 AI 대화",
 * S-10 대화 기록; design-system 5.4 / 6장 A2 (v3)).
 *
 * - AbandonChatDialog: AlertDialog with the spec copy, confirm = default "그만두기" (not destructive:
 *   nothing is deleted). Calls abandonWritingChatAction (`active → abandoned`, no AI).
 * - useResumeChat: `abandoned → active` (no AI call, works without a key) then opens S-36.
 * - markAbandonedFlash / takeAbandonedFlash: S-08 opens the "그만둔 대화" group with the row flashed
 *   once after abandoning (session storage, id only) [UI-가정 G-37].
 */
import * as React from "react"
import { useRouter } from "next/navigation"
import { Loader2 } from "lucide-react"
import { toast } from "sonner"
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog"
import { Button } from "@/components/ui/button"
import { abandonWritingChatAction, resumeWritingChatAction } from "@/lib/data/actions"
import { routes } from "@/lib/routes"

const FLASH_KEY = "resumate.abandoned-chat-flash"

export function markAbandonedFlash(chatId: string): void {
  try {
    window.sessionStorage.setItem(FLASH_KEY, chatId)
  } catch {
    // storage unavailable — no flash
  }
}

export function takeAbandonedFlash(): string | null {
  try {
    const id = window.sessionStorage.getItem(FLASH_KEY)
    if (id) window.sessionStorage.removeItem(FLASH_KEY)
    return id
  } catch {
    return null
  }
}

/** spec copy (02 S-36 "대화 그만두기 (메뉴)") */
export function abandonConfirmText(linkedToProject: boolean): string {
  return `이 대화를 그만둘까요? 기록과 정리 결과는 남고, 나중에 다시 이어 할 수 있어요${linkedToProject ? "" : " (마지막 활동 후 90일 뒤 자동 삭제)"}`
}

export function AbandonChatDialog({
  chat,
  onOpenChange,
  onAbandoned,
}: {
  /** the chat to abandon; null = closed */
  chat: { id: string; project_id: string | null } | null
  onOpenChange: (open: boolean) => void
  onAbandoned: (chatId: string) => void
}) {
  const [busy, setBusy] = React.useState(false)
  const [failed, setFailed] = React.useState(false)
  const confirm = async () => {
    if (!chat) return
    setBusy(true)
    setFailed(false)
    try {
      await abandonWritingChatAction(chat.id)
      markAbandonedFlash(chat.id)
      onOpenChange(false)
      onAbandoned(chat.id)
    } catch {
      setFailed(true)
    } finally {
      setBusy(false)
    }
  }
  return (
    <AlertDialog
      open={chat !== null}
      onOpenChange={(o) => {
        if (busy) return
        setFailed(false)
        onOpenChange(o)
      }}
    >
      <AlertDialogContent>
        <AlertDialogHeader className="text-left">
          <AlertDialogTitle>대화 그만두기</AlertDialogTitle>
          <AlertDialogDescription className="text-base text-foreground">
            {chat ? abandonConfirmText(chat.project_id !== null) : null}
          </AlertDialogDescription>
        </AlertDialogHeader>
        {failed ? (
          <p className="text-sm text-destructive" role="alert">
            그만두지 못했어요. 잠시 후 다시 시도해 주세요
          </p>
        ) : null}
        <AlertDialogFooter>
          <AlertDialogCancel disabled={busy}>취소</AlertDialogCancel>
          {/* [UI-가정] G-37: confirm label "그만두기" (default, not destructive — nothing is deleted) */}
          <Button disabled={busy} onClick={() => void confirm()}>
            {busy ? <Loader2 className="animate-spin" aria-hidden /> : null}
            그만두기
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}

/**
 * 다시 이어 하기 (A6): `abandoned → active` without an AI call (no key needed), then S-36.
 * Returns `{ resume, pendingId }`.
 */
export function useResumeChat() {
  const router = useRouter()
  const [pendingId, setPendingId] = React.useState<string | null>(null)
  const resume = React.useCallback(
    async (chatId: string, opts?: { open?: boolean }): Promise<boolean> => {
      setPendingId(chatId)
      try {
        const chat = await resumeWritingChatAction(chatId)
        if (!chat) {
          // auto-cleaned or no longer abandoned (another tab) → refresh the list
          // [UI-가정] copy (spec has none for this race)
          toast.error("이 대화는 다시 이어 할 수 없어요")
          router.refresh()
          return false
        }
        if (opts?.open !== false) router.push(routes.writingChat(chatId))
        return true
      } catch {
        toast.error("다시 이어 하지 못했어요. 잠시 후 다시 시도해 주세요")
        return false
      } finally {
        setPendingId(null)
      }
    },
    [router],
  )
  return { resume, pendingId }
}
