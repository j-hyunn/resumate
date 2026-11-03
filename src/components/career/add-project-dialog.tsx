"use client"

/**
 * C-23 프로젝트 추가 — 소속 선택 · 독립 이름 입력 (UX v5.6 C-23, design-system v4 3.23 `AddProjectDialog`).
 * (v5.6, PA-3) 경력·교육의 "+ 프로젝트 추가"는 이 다이얼로그 없이 S-10 새 페이지로 간다. 남은 두 경우만:
 *  ① `mode = "standalone"` — C-22 "프로젝트": 이름만 넣고 "만들기" → `projects` 행(draft, 소속 없음) → S-43
 *     (D-UX-28 확정 (a) 이름 다이얼로그 유지)
 *  ② `mode = "choose"` — C-09 `create_project`·S-16 보완점: 소속을 고른다. 경력·교육 → "계속"(행 없음, S-10 새 페이지) /
 *     "소속 없음(독립 프로젝트)" → 이름 + "만들기"
 */
import * as React from "react"
import { useRouter } from "next/navigation"
import { CircleAlert, Info, Loader2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group"
import { Separator } from "@/components/ui/separator"
import { routes } from "@/lib/routes"
import { createCareerItemAction } from "./actions"

const NAME_MAX = 100
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
  /** "만들기" succeeded → the new standalone project (the caller opens S-43) */
  onCreated: (projectId: string) => void
  /** S-16 보완점: carried to the S-10 새 페이지 on "계속" (`requirement_id`, "관련 요건" 맥락) */
  requirementId?: string | null
} & (
  | { mode: "standalone" }
  | {
      mode: "choose"
      affiliations: AffiliationOption[]
      /** [가정] 완료 경력이 있으면 가장 최근 경력을 미리 선택 — the caller knows which */
      defaultAffiliationId?: string | null
    }
)

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
  const choose = props.mode === "choose"
  const [picked, setPicked] = React.useState<string>(() => (props.mode === "choose" ? (props.defaultAffiliationId ?? props.affiliations[0]?.id ?? STANDALONE) : STANDALONE))
  const [name, setName] = React.useState("")
  const [pending, setPending] = React.useState(false)
  const [failed, setFailed] = React.useState(false)
  // a retried create asks about the row the first try may have made
  const clientId = React.useMemo(() => crypto.randomUUID(), [])
  const standalone = picked === STANDALONE
  const affiliation = props.mode === "choose" ? props.affiliations.find((a) => a.id === picked) : undefined

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!standalone && affiliation) {
      // "계속": no row — S-10 새 프로젝트 빈 페이지
      props.onOpenChange(false)
      const requirement = props.requirementId ? { requirement_id: props.requirementId } : {}
      router.push(routes.projectPageNew(affiliation.type === "experience" ? { experience: affiliation.id, ...requirement } : { education: affiliation.id, ...requirement }))
      return
    }
    if (!name.trim()) return
    setPending(true)
    setFailed(false)
    try {
      const r = await createCareerItemAction({ kind: "project", patch: { name: name.trim() }, skills: [] }, { client_id: clientId })
      if (!r.ok) return setFailed(true)
      props.onCreated(r.id)
    } catch {
      setFailed(true)
    } finally {
      setPending(false)
    }
  }

  const groups = props.mode === "choose" ? (["experience", "education"] as const).map((t) => ({ t, rows: props.affiliations.filter((a) => a.type === t) })) : []

  return (
    <form onSubmit={submit} noValidate className="flex flex-col gap-4">
      <DialogHeader className="text-left">
        <DialogTitle className="text-lg font-semibold">{choose ? "어디에 프로젝트를 추가할까요?" : "새 독립 프로젝트"}</DialogTitle>
        <DialogDescription className={choose ? "sr-only" : "text-sm"}>
          {choose ? "프로젝트가 속한 경력·교육을 골라 주세요" : "이름을 넣고 만들면 프로젝트 정보·내용·산출물을 이어서 채울 수 있어요"}
        </DialogDescription>
      </DialogHeader>

      {choose ? (
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
      ) : null}

      {choose && standalone ? (
        <p className="flex items-start gap-1.5 text-sm text-muted-foreground">
          <Info className="mt-0.5 size-4 shrink-0" aria-hidden />
          독립 프로젝트에는 STAR가 없어요. 산출물은 AI와 함께 쓸 수 있어요
        </p>
      ) : null}

      {standalone ? (
        <div className="space-y-2">
          <Label htmlFor="c23-name">
            프로젝트명 <span aria-hidden>*</span>
          </Label>
          <Input id="c23-name" autoFocus required maxLength={NAME_MAX} value={name} onChange={(e) => setName(e.target.value)} placeholder="프로젝트명을 입력해 주세요" />
          <p className="text-right text-xs text-muted-foreground tabular-nums">
            {name.length} / {NAME_MAX}
          </p>
        </div>
      ) : null}

      {failed ? (
        <p className="flex items-center gap-1.5 text-sm text-destructive" role="alert">
          <CircleAlert className="size-4 shrink-0" aria-hidden />
          프로젝트를 만들지 못했어요 · 다시 시도
        </p>
      ) : null}

      <DialogFooter>
        <Button type="button" variant="outline" onClick={() => props.onOpenChange(false)} disabled={pending}>
          취소
        </Button>
        <Button type="submit" disabled={pending || (standalone && !name.trim())}>
          {pending ? <Loader2 className="animate-spin" aria-hidden /> : null}
          {standalone ? "만들기" : "계속"}
        </Button>
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
