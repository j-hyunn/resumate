"use client"

/**
 * S-10 머리 ⋯ "소속 변경" (UX v5.6 S-10 머리 메뉴 [가정]): this user's experiences / educations, the current one
 * checked. Picking changes the form value + 이동 경로; "저장하기" confirms. "소속 없음" is not offered
 * (`project_scope_change_not_allowed`).
 */
import * as React from "react"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Label } from "@/components/ui/label"
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group"
import type { ProjectPageData } from "@/lib/data/career-v45-shared"

type Affiliation = ProjectPageData["affiliations"][number]

export function AffiliationDialog({
  open,
  onOpenChange,
  affiliations,
  current,
  onPick,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  affiliations: Affiliation[]
  current: { type: "experience" | "education"; id: string }
  onPick: (a: Affiliation) => void
}) {
  const currentKey = `${current.type}:${current.id}`
  const [picked, setPicked] = React.useState(currentKey)
  const [lastOpen, setLastOpen] = React.useState(open)
  if (open !== lastOpen) {
    setLastOpen(open)
    if (open) setPicked(currentKey)
  }
  const groups: Array<{ type: Affiliation["type"]; label: string }> = [
    { type: "experience", label: "경력" },
    { type: "education", label: "교육" },
  ]
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>소속 변경</DialogTitle>
          {/* [UI-가정] 설명 문구 */}
          <DialogDescription>이 프로젝트를 둘 경력·교육을 골라 주세요. 저장하기를 눌러야 바뀌어요</DialogDescription>
        </DialogHeader>
        <RadioGroup value={picked} onValueChange={setPicked} className="max-h-80 gap-4 overflow-y-auto">
          {groups.map((g) => {
            const items = affiliations.filter((a) => a.type === g.type)
            if (!items.length) return null
            return (
              <div key={g.type} role="group" aria-label={g.label} className="space-y-2">
                <p className="text-sm text-muted-foreground">{g.label}</p>
                {items.map((a) => {
                  const key = `${a.type}:${a.id}`
                  return (
                    <Label key={key} htmlFor={`aff-${key}`} className="flex min-h-11 cursor-pointer items-center gap-3 rounded-lg border px-3 text-base font-normal has-data-[state=checked]:border-primary has-data-[state=checked]:bg-primary-subtle">
                      <RadioGroupItem id={`aff-${key}`} value={key} />
                      <span className="truncate">{a.name ?? (a.type === "experience" ? "이름 없는 경력" : "이름 없는 교육")}</span>
                    </Label>
                  )
                })}
              </div>
            )
          })}
        </RadioGroup>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            취소
          </Button>
          <Button
            disabled={picked === currentKey}
            onClick={() => {
              const a = affiliations.find((x) => `${x.type}:${x.id}` === picked)
              if (a) onPick(a)
              onOpenChange(false)
            }}
          >
            바꾸기
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
