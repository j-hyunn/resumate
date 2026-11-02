"use client"

/**
 * S-11 정량 성과 (모달). Linked to a 상세 내용 (achievements.project_detail_id) or an
 * 경력 (achievements.experience_id), fixed by the opening screen. Autosaves (C-06);
 * delete closes this dialog and opens C-05 (no dialog over a dialog, design-system 5.6).
 */
import * as React from "react"
import { ArrowRight, CircleAlert, Trash2 } from "lucide-react"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { SaveStatus } from "@/components/common/save-status"
import { InputGuide } from "@/components/common/input-guide"
import type { Achievement } from "@/types/db"
import { saveAchievementAction } from "./actions"
import { nn, useRowAutosave } from "./form-parts"

export type AchievementLink = { project_detail_id: string } | { experience_id: string }

interface Values {
  metric_name: string
  value_before: string
  value_after: string
  unit: string
  description: string
}

function toValues(a: Achievement | null): Values {
  return {
    metric_name: a?.metric_name ?? "",
    value_before: a?.value_before === null || a?.value_before === undefined ? "" : String(a.value_before),
    value_after: a?.value_after === null || a?.value_after === undefined ? "" : String(a.value_after),
    unit: a?.unit ?? "",
    description: a?.description ?? "",
  }
}

function num(v: string): number | null {
  const t = v.replace(/,/g, "").trim()
  if (t === "") return null
  const n = Number(t)
  return Number.isFinite(n) ? n : null
}

export function achievementLine(a: Pick<Achievement, "metric_name" | "value_before" | "value_after" | "unit" | "description">): string {
  const unit = a.unit ?? ""
  const values =
    a.value_before !== null || a.value_after !== null
      ? `${a.value_before ?? "?"}${unit} → ${a.value_after ?? "?"}${unit}`
      : ""
  return [a.metric_name, values].filter(Boolean).join(" · ") || a.description || "내용 없음"
}

export function AchievementDialog({
  open,
  onOpenChange,
  link,
  achievement,
  targetLabel,
  onSaved,
  onDelete,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  link: AchievementLink
  achievement: Achievement | null
  /** "상세 내용 '{제목}'" / "경력 '{회사명}'" */
  targetLabel: string
  onSaved: (row: Achievement) => void
  onDelete: (row: Achievement) => void
}) {
  // UQ-62: Esc / 바깥 클릭 / 닫기 버튼도 폼의 확인 절차를 거친다 (저장 실패 값은 버리지 않음)
  const requestClose = React.useRef<(() => void) | null>(null)
  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next && requestClose.current) requestClose.current()
        else onOpenChange(next)
      }}
    >
      <DialogContent className="max-h-[85dvh] overflow-y-auto sm:max-w-lg">
        {open ? (
          <AchievementForm
            key={achievement?.id ?? "new"}
            link={link}
            achievement={achievement}
            targetLabel={targetLabel}
            onSaved={onSaved}
            onDelete={onDelete}
            onClose={() => onOpenChange(false)}
            registerClose={(fn) => {
              requestClose.current = fn
            }}
          />
        ) : null}
      </DialogContent>
    </Dialog>
  )
}

function AchievementForm({
  link,
  achievement,
  targetLabel,
  onSaved,
  onDelete,
  onClose,
  registerClose,
}: {
  link: AchievementLink
  achievement: Achievement | null
  targetLabel: string
  onSaved: (row: Achievement) => void
  onDelete: (row: Achievement) => void
  onClose: () => void
  registerClose: (fn: (() => void) | null) => void
}) {
  const failedRef = React.useRef(false)
  const [confirmClose, setConfirmClose] = React.useState(false)
  const [values, setValues] = React.useState<Values>(() => toValues(achievement))
  const { autosave, row } = useRowAutosave<Values, Achievement>({
    initialId: achievement?.id ?? null,
    initialRow: achievement,
    save: async (id, v, opts) => {
      try {
        const saved = await saveAchievementAction(
        id,
        {
          ...link,
          metric_name: nn(v.metric_name),
          value_before: num(v.value_before),
          value_after: num(v.value_after),
          unit: nn(v.unit),
          description: nn(v.description),
        },
        opts,
      )
        failedRef.current = false
        return saved
      } catch (e) {
        failedRef.current = true
        throw e
      }
    },
    onSaved,
  })
  const set = (patch: Partial<Values>) => {
    const next = { ...values, ...patch }
    setValues(next)
    autosave.schedule(next)
  }
  const blur = () => void autosave.flush()

  /** flush; on failure keep the dialog open and ask (UQ-62) */
  const tryClose = React.useCallback(async () => {
    await autosave.flush()
    if (failedRef.current) setConfirmClose(true)
    else onClose()
  }, [autosave, onClose])
  React.useEffect(() => {
    registerClose(() => void tryClose())
    return () => registerClose(null)
  }, [registerClose, tryClose])
  const isDetail = "project_detail_id" in link
  const current = row ?? achievement

  return (
    <>
      <DialogHeader className="text-left">
        <DialogTitle className="text-lg leading-7 font-semibold">정량 성과</DialogTitle>
        <DialogDescription>연결 대상: {targetLabel}</DialogDescription>
      </DialogHeader>
      <div className="space-y-4">
        <div className="space-y-1.5">
          <Label htmlFor="ach-metric" className="text-sm font-medium">
            지표 이름
          </Label>
          <Input id="ach-metric" value={values.metric_name} onChange={(e) => set({ metric_name: e.target.value })} onBlur={blur} />
        </div>
        <fieldset className="space-y-1.5">
          <legend className="text-sm leading-5 font-medium">변화</legend>
          <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-2 sm:grid-cols-[1fr_auto_1fr_6rem]">
            <Input
              aria-label="이전 값"
              placeholder="이전"
              inputMode="decimal"
              className="tabular-nums"
              value={values.value_before}
              onChange={(e) => set({ value_before: e.target.value })}
              onBlur={blur}
            />
            <ArrowRight className="size-4 text-muted-foreground" aria-hidden />
            <Input
              aria-label="이후 값"
              placeholder="이후"
              inputMode="decimal"
              className="tabular-nums"
              value={values.value_after}
              onChange={(e) => set({ value_after: e.target.value })}
              onBlur={blur}
            />
            <Input
              aria-label="단위"
              placeholder="단위"
              className="col-span-3 sm:col-span-1"
              value={values.unit}
              onChange={(e) => set({ unit: e.target.value })}
              onBlur={blur}
            />
          </div>
        </fieldset>
        <div className="space-y-1.5">
          <Label htmlFor="ach-desc" className="text-sm font-medium">
            서술{isDetail ? <span className="ml-1 font-normal text-muted-foreground">(선택)</span> : null}
          </Label>
          <Textarea
            id="ach-desc"
            className="min-h-20 text-base leading-[1.75]"
            value={values.description}
            onChange={(e) => set({ description: e.target.value })}
            onBlur={blur}
            aria-describedby="ach-desc-guide"
          />
          <InputGuide id="ach-desc-guide" guide="G-2" />
        </div>
        <p className="text-sm text-muted-foreground">
          유형: {current?.kind ?? "입력한 내용에 따라 자동으로 정해져요"}
          {/* [UI-가정] achievements.kind 생성 값 목록 미정 → 값 그대로 표시 */}
        </p>
      </div>
      {confirmClose ? (
        <Alert variant="destructive" role="alert">
          <CircleAlert aria-hidden />
          <AlertTitle>저장하지 못한 내용이 있어요</AlertTitle>
          <AlertDescription className="space-y-2">
            <p>지금 닫으면 저장하지 못한 입력이 사라져요. 다시 시도하거나 계속 편집해 주세요</p>
            <div className="flex flex-wrap gap-2">
              <Button
                size="sm"
                variant="outline"
                onClick={async () => {
                  await autosave.retry()
                  if (!failedRef.current) {
                    setConfirmClose(false)
                    onClose()
                  }
                }}
              >
                다시 시도
              </Button>
              <Button size="sm" variant="ghost" onClick={() => setConfirmClose(false)}>
                계속 편집
              </Button>
              <Button size="sm" variant="ghost" className="text-destructive" onClick={onClose}>
                그래도 닫기
              </Button>
            </div>
          </AlertDescription>
        </Alert>
      ) : null}
      <DialogFooter className="flex-col-reverse items-stretch gap-2 sm:flex-row sm:items-center sm:justify-between">
        <SaveStatus state={autosave.state} savedAt={autosave.savedAt} onRetry={autosave.retry} />
        <div className="flex flex-col-reverse gap-2 sm:flex-row">
          {current ? (
            <Button
              variant="ghost"
              className="text-destructive"
              onClick={async () => {
                await autosave.flush()
                onClose()
                onDelete(current)
              }}
            >
              <Trash2 aria-hidden />
              삭제
            </Button>
          ) : null}
          <Button onClick={() => void tryClose()}>
            완료
          </Button>
        </div>
      </DialogFooter>
    </>
  )
}
