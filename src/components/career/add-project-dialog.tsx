"use client"

/**
 * C-23 프로젝트 추가 — 소속 선택 (UX v5.9 C-23, design-system v4 3.23 `AddProjectDialog`).
 * C-09 `create_project`·"직접 입력하기"·S-16 보완점에서 소속을 고른다. 이 다이얼로그는 행을 만들지 않는다:
 *  - 경력·교육 → "계속" → S-10 새 프로젝트 빈 페이지 (PA-3)
 *  - "소속 없음(독립 프로젝트)" → "계속" → `onStandalone` — the caller opens the C-22 추가 모달 (`AddCareerDialog`
 *    kind="project"), which creates the row on "추가하기" (v5.9, D-UX-28 변경 — 이름 다이얼로그 없음)
 */
import * as React from "react"
import { useRouter } from "next/navigation"
import { Info } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Label } from "@/components/ui/label"
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group"
import { Separator } from "@/components/ui/separator"
import { routes } from "@/lib/routes"

const STANDALONE = "standalone"

export interface AffiliationOption {
  type: "experience" | "education"
  id: string
  name: string | null
  /** meta line, e.g. "2022.03 - 현재" */
  period?: string | null
}

export type AddProjectDialogProps = {
  open: boolean
  onOpenChange: (open: boolean) => void
  affiliations: AffiliationOption[]
  /** [가정] 완료 경력이 있으면 가장 최근 경력을 미리 선택 — the caller knows which */
  defaultAffiliationId?: string | null
  /** S-16 보완점: carried to the S-10 새 페이지 on "계속" (`requirement_id`, "관련 요건" 맥락) */
  requirementId?: string | null
  /** "소속 없음" → "계속": the dialog has closed; open the 독립 프로젝트 추가 모달 */
  onStandalone: () => void
}

export function AddProjectDialog(props: AddProjectDialogProps) {
  return (
    <Dialog open={props.open} onOpenChange={props.onOpenChange}>
      {/* [UI-가정] 좁은 화면도 Dialog (C-22와 같은 모달 — 시트 전환은 C-22가 바뀔 때 함께) */}
      <DialogContent className="sm:max-w-md">{props.open ? <AddProjectForm {...props} /> : null}</DialogContent>
    </Dialog>
  )
}

function AddProjectForm(props: AddProjectDialogProps) {
  const router = useRouter()
  const [picked, setPicked] = React.useState<string>(() => props.defaultAffiliationId ?? props.affiliations[0]?.id ?? STANDALONE)
  const affiliation = props.affiliations.find((a) => a.id === picked)

  const submit = (e: React.FormEvent) => {
    e.preventDefault()
    props.onOpenChange(false)
    if (!affiliation) return props.onStandalone()
    // "계속": no row — S-10 새 프로젝트 빈 페이지
    const requirement = props.requirementId ? { requirement_id: props.requirementId } : {}
    router.push(routes.projectPageNew(affiliation.type === "experience" ? { experience: affiliation.id, ...requirement } : { education: affiliation.id, ...requirement }))
  }

  const groups = (["experience", "education"] as const).map((t) => ({ t, rows: props.affiliations.filter((a) => a.type === t) }))

  return (
    <form onSubmit={submit} noValidate className="flex flex-col gap-4">
      <DialogHeader className="text-left">
        <DialogTitle className="text-lg font-semibold">어디에 프로젝트를 추가할까요?</DialogTitle>
        <DialogDescription className="sr-only">프로젝트가 속한 경력·교육을 골라 주세요</DialogDescription>
      </DialogHeader>

      <RadioGroup value={picked} onValueChange={setPicked} aria-label="소속" className="gap-3">
        <div className="max-h-72 space-y-3 overflow-y-auto">
          {groups.map(({ t, rows }) =>
            rows.length ? (
              <div key={t} className="space-y-1.5">
                <p className="text-sm text-muted-foreground">{t === "experience" ? "경력" : "교육"}</p>
                {rows.map((a) => (
                  <OptionCard key={a.id} value={a.id} title={a.name ?? (t === "experience" ? "이름 없는 경력" : "이름 없는 교육")} meta={a.period} />
                ))}
              </div>
            ) : null,
          )}
        </div>
        <Separator />
        <OptionCard value={STANDALONE} title="소속 없음(독립 프로젝트)" />
      </RadioGroup>

      {picked === STANDALONE ? (
        <p className="flex items-start gap-1.5 text-sm text-muted-foreground">
          <Info className="mt-0.5 size-4 shrink-0" aria-hidden />
          독립 프로젝트에는 STAR가 없어요. 산출물은 AI와 함께 쓸 수 있어요
        </p>
      ) : null}

      <DialogFooter>
        <Button type="button" variant="outline" onClick={() => props.onOpenChange(false)}>
          취소
        </Button>
        <Button type="submit">계속</Button>
      </DialogFooter>
    </form>
  )
}

function OptionCard({ value, title, meta }: { value: string; title: string; meta?: string | null }) {
  const id = `c23-${value}`
  return (
    <Label
      htmlFor={id}
      className="flex cursor-pointer items-start gap-3 rounded-lg border p-3 text-base font-normal has-data-[state=checked]:border-primary has-data-[state=checked]:bg-primary-subtle"
    >
      <RadioGroupItem value={value} id={id} className="mt-1" />
      <span className="min-w-0 space-y-0.5">
        <span className="block truncate font-medium">{title}</span>
        {meta ? <span className="block text-sm text-muted-foreground tabular-nums">{meta}</span> : null}
      </span>
    </Label>
  )
}
