"use client"

/**
 * 정량 성과 목록 + S-11 모달 + C-05 (S-09 경력 단위 성과, S-35 결과 아래 목록).
 * `?achievement={id}` opens that achievement (C-02 "원본으로 이동" → S-11).
 */
import * as React from "react"
import Link from "next/link"
import { MessagesSquare, Pencil, Plus } from "lucide-react"
import { Button } from "@/components/ui/button"
import { DeleteConfirmDialog } from "@/components/common/delete-confirm-dialog"
import type { Achievement } from "@/types/db"
import { routes } from "@/lib/routes"
import { deleteCareerItemAction } from "./actions"
import { AchievementDialog, achievementLine, type AchievementLink } from "./achievement-dialog"
import { DraftBadge } from "@/components/common/save-status"

export function AchievementList({
  items: initial,
  link,
  targetLabel,
  disabledReason,
  ensureLink,
  onChange,
  openId,
  addLabel = "+ 정량 성과",
  controlRef,
}: {
  /** UQ-68: lets the page open S-11 (e.g. G-3 "+ 정량 성과") */
  controlRef?: React.Ref<{ openNew: () => void }>
  items: Achievement[]
  /** null while the parent row isn't created yet */
  link: AchievementLink | null
  targetLabel: string
  disabledReason?: string
  /** create the parent first (e.g. new 상세 내용) and return its link */
  ensureLink?: () => Promise<AchievementLink | null>
  onChange?: (items: Achievement[]) => void
  openId?: string | null
  addLabel?: string
}) {
  const [items, setItems] = React.useState(initial)
  const [dialog, setDialog] = React.useState<{ open: boolean; achievement: Achievement | null; link: AchievementLink | null }>(() => {
    const target = openId ? initial.find((a) => a.id === openId) : undefined
    return { open: Boolean(target && link), achievement: target ?? null, link }
  })
  const [deleting, setDeleting] = React.useState<Achievement | null>(null)

  const update = (next: Achievement[]) => {
    setItems(next)
    onChange?.(next)
  }

  const openNew = async () => {
    const l = link ?? (ensureLink ? await ensureLink() : null)
    if (!l) return
    setDialog({ open: true, achievement: null, link: l })
  }

  React.useImperativeHandle(controlRef, () => ({ openNew: () => void openNew() }))

  return (
    <div className="space-y-2">
      {items.length > 0 ? (
        <ul className="divide-y rounded-md border">
          {items.map((a) => (
            <li key={a.id} className="flex min-h-11 items-center gap-2 px-3 py-2">
              <span className="min-w-0 flex-1 text-sm tabular-nums">{achievementLine(a)}</span>
              {a.status === "draft" ? <DraftBadge /> : null}
              {a.source_writing_chat_id ? (
                <Button asChild variant="link" size="sm" className="h-auto px-0">
                  <Link href={routes.writingChatRedirect(a.source_writing_chat_id)}>
                    <MessagesSquare aria-hidden />
                    출처 대화 보기
                  </Link>
                </Button>
              ) : null}
              <Button
                variant="ghost"
                size="icon-sm" className="size-11 lg:size-8"
                aria-label={`정량 성과 편집: ${achievementLine(a)}`}
                onClick={() => link && setDialog({ open: true, achievement: a, link })}
              >
                <Pencil aria-hidden />
              </Button>
            </li>
          ))}
        </ul>
      ) : null}
      <Button variant="outline" size="sm" onClick={openNew} disabled={!link && !ensureLink}>
        <Plus aria-hidden />
        {addLabel.replace(/^\+\s*/, "")}
      </Button>
      {!link && !ensureLink && disabledReason ? <p className="text-sm text-muted-foreground">{disabledReason}</p> : null}

      {dialog.link ? (
        <AchievementDialog
          open={dialog.open}
          onOpenChange={(open) => setDialog((d) => ({ ...d, open }))}
          link={dialog.link}
          achievement={dialog.achievement}
          targetLabel={targetLabel}
          onSaved={(row) => {
            const exists = items.some((x) => x.id === row.id)
            update(exists ? items.map((x) => (x.id === row.id ? row : x)) : [...items, row])
          }}
          onDelete={(row) => setDeleting(row)}
        />
      ) : null}
      <DeleteConfirmDialog
        target={deleting ? { kind: "career", entity_type: "achievement", entity_id: deleting.id, label: achievementLine(deleting) } : null}
        open={deleting !== null}
        onOpenChange={(open) => !open && setDeleting(null)}
        onConfirm={async (opts) => {
          if (!deleting) return
          await deleteCareerItemAction("achievement", deleting.id, undefined, opts.result_mode)
          update(items.filter((x) => x.id !== deleting.id))
        }}
      />
    </div>
  )
}
