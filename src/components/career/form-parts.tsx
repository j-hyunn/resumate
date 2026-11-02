"use client"

/**
 * Shared pieces for the A2 career forms (design-system 5.3 편집기): section cards,
 * labelled inputs, long STAR fields with char count, the danger zone with C-05,
 * and the autosave wiring that creates the row on the first save.
 */
import * as React from "react"
import { useRouter } from "next/navigation"
import { CircleAlert, CircleCheck, Trash2, TriangleAlert } from "lucide-react"
import { cn } from "@/lib/utils"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"
import { Card } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { CharCount } from "@/components/common/input-guide"
import { DeleteConfirmDialog, type DeleteTarget } from "@/components/common/delete-confirm-dialog"
import { AutosaveBlocked, useAutosave } from "@/components/common/save-status"
import { notifyCareerSaved } from "@/components/common/return-banner"
import { usePreviewState } from "@/components/common/preview-state-client"
import type { DeletionEntityType } from "@/types/db"
import { decideConflict, isPeriodReversed, newRowId, type RowSaveResult } from "@/lib/data/row-save"
import { deleteCareerItemAction } from "./actions"

export function RequiredMark() {
  return (
    <>
      <span aria-hidden className="text-destructive">
        {" "}
        *
      </span>
      <span className="sr-only">필수</span>
    </>
  )
}

export function FormSection({
  title,
  description,
  actions,
  children,
  className,
  id,
}: {
  title: React.ReactNode
  description?: React.ReactNode
  actions?: React.ReactNode
  children: React.ReactNode
  className?: string
  id?: string
}) {
  const headingId = React.useId()
  return (
    <Card className={cn("gap-4 p-5", className)} aria-labelledby={headingId} role="region" id={id}>
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="space-y-1">
          <h2 id={headingId} className="text-base leading-6 font-semibold">
            {title}
          </h2>
          {description ? <p className="text-sm leading-5 text-muted-foreground">{description}</p> : null}
        </div>
        {actions ? <div className="flex flex-wrap gap-2">{actions}</div> : null}
      </div>
      {children}
    </Card>
  )
}

export function TextField({
  id,
  label,
  required,
  value,
  onChange,
  onBlur,
  placeholder,
  type = "text",
  maxLength,
  help,
  invalid,
  className,
  inputMode,
  describedBy,
  inputClassName,
}: {
  id: string
  label: React.ReactNode
  required?: boolean
  value: string
  onChange: (value: string) => void
  onBlur?: () => void
  placeholder?: string
  type?: string
  maxLength?: number
  help?: React.ReactNode
  invalid?: boolean
  className?: string
  inputMode?: React.HTMLAttributes<HTMLInputElement>["inputMode"]
  /** extra ids (e.g. a shared error line, UQ-76) */
  describedBy?: string
  /** classes on the input itself (e.g. S-10 `focus=fields` highlight ring) */
  inputClassName?: string
}) {
  return (
    <div className={cn("space-y-1.5", className)}>
      <Label htmlFor={id} className="text-sm leading-5 font-medium">
        {label}
        {required ? <RequiredMark /> : null}
      </Label>
      <Input
        id={id}
        type={type}
        value={value}
        placeholder={placeholder}
        maxLength={maxLength}
        inputMode={inputMode}
        className={inputClassName}
        aria-invalid={invalid || undefined}
        aria-describedby={[help ? `${id}-help` : null, describedBy ?? null].filter(Boolean).join(" ") || undefined}
        onChange={(e) => onChange(e.target.value)}
        onBlur={onBlur}
      />
      {help ? (
        <div id={`${id}-help`} className="space-y-1">
          {help}
        </div>
      ) : null}
    </div>
  )
}

/** Long text (STAR, 설명): label + meta guidance + Textarea(prose) + guides + char count */
export function LongTextField({
  id,
  label,
  abbr,
  required,
  guidance,
  value,
  onChange,
  onBlur,
  limit,
  guides,
  textareaRef,
  flash,
  minRows = "min-h-32",
}: {
  id: string
  label: string
  /** "(S)" etc., muted */
  abbr?: string
  required?: boolean
  guidance?: React.ReactNode
  value: string
  onChange: (value: string) => void
  onBlur?: () => void
  limit: number
  guides?: React.ReactNode
  textareaRef?: React.Ref<HTMLTextAreaElement>
  /** C-02 "원본으로 이동" focus target → ring + field-flash once */
  flash?: boolean
  minRows?: string
}) {
  const over = value.length > limit
  return (
    <div className="space-y-1.5">
      <Label htmlFor={id} className="text-sm leading-5 font-medium">
        {label}
        {abbr ? <span className="ml-1 text-muted-foreground">{abbr}</span> : null}
        {required ? <RequiredMark /> : null}
      </Label>
      {guidance ? (
        <p id={`${id}-guidance`} className="text-sm leading-5 text-muted-foreground">
          {guidance}
        </p>
      ) : null}
      <Textarea
        id={id}
        ref={textareaRef}
        value={value}
        maxLength={limit}
        aria-invalid={over || undefined}
        aria-describedby={[guidance ? `${id}-guidance` : null, `${id}-count`, guides ? `${id}-guides` : null].filter(Boolean).join(" ")}
        className={cn("text-base leading-[1.75]", minRows, flash && "animate-field-flash ring-2 ring-ring")}
        onChange={(e) => onChange(e.target.value)}
        onBlur={onBlur}
      />
      <div className="flex items-start justify-between gap-3">
        <div id={`${id}-guides`} className="min-w-0 space-y-1">
          {guides}
        </div>
        <CharCount id={`${id}-count`} count={value.length} limit={limit} className="shrink-0" />
      </div>
    </div>
  )
}

export type RowSaveOptions = { fail?: boolean; client_id?: string; expected_updated_at?: string }

type RowProblem<R> = { kind: "conflict"; latest: R } | { kind: "gone" } | { kind: "invalid" }

/**
 * Autosave for a career row (C-06). Creates the row on the first save (id = null), then
 * moves the URL to the edit route without remounting (history.replaceState). Saving never
 * blocks on validation; the data layer recomputes `status` (DM-8).
 *
 * - First save: the form generates the id and sends it as `client_id` on every try, so a lost response followed by
 *   "다시 시도" can't make a second row (W2-①).
 * - Later saves: `expected_updated_at` = the row the form last saw. A refused save shows `problem` (<SaveProblemNotice>)
 *   unless `comparable` shows it isn't a real conflict: see `decideConflict` (W2-②).
 *
 * `?state=save-failed` makes every save fail (ST-SAVE-FAILED preview); `?state=save-conflict` answers the first save
 * with a conflict, the stored row standing in for "the latest".
 */
export function useRowAutosave<T, R extends { id: string; status?: string; updated_at?: string }>({
  initialId,
  initialRow,
  save,
  editHref,
  onSaved,
  comparable,
  stored,
}: {
  initialId: string | null
  initialRow?: R | null
  save: (id: string | null, values: T, opts: RowSaveOptions) => Promise<RowSaveResult<R>>
  editHref?: (id: string) => string
  onSaved?: (row: R) => void
  /** the row in the shape of the form's values (`toValues`) */
  comparable?: (row: R) => unknown
  /** the values as a save of them would leave `latest`, in the same shape (see `decideConflict`) */
  stored?: (values: T, latest: R) => unknown
}) {
  const preview = usePreviewState()
  const fail = preview === "save-failed"
  const idRef = React.useRef<string | null>(initialId)
  const clientId = React.useRef<string | null>(null)
  /** values sent with `client_id` so far: a lost response leaves one of them in the row (QA-W5-06) */
  const createTries = React.useRef<T[]>([])
  const base = React.useRef<R | null>(initialRow ?? null)
  const simulateConflict = React.useRef(preview === "save-conflict")
  const [row, setRow] = React.useState<R | null>(initialRow ?? null)
  const [problem, setProblem] = React.useState<RowProblem<R> | null>(null)
  const onSavedRef = React.useRef(onSaved)
  React.useEffect(() => {
    onSavedRef.current = onSaved
  })
  /** The form now works from this version of the row. */
  const adopt = (latest: R) => {
    idRef.current = latest.id
    base.current = latest
  }
  const applySaved = (saved: R, created = idRef.current === null) => {
    adopt(saved)
    setRow(saved)
    setProblem(null)
    if (created && editHref) window.history.replaceState(null, "", editHref(saved.id))
    notifyCareerSaved()
    onSavedRef.current?.(saved)
  }
  const send = (values: T): Promise<RowSaveResult<R>> => {
    if (simulateConflict.current && base.current) {
      simulateConflict.current = false
      return Promise.resolve({ ok: false, reason: "conflict", latest: base.current })
    }
    const id = idRef.current
    if (id) return save(id, values, { fail, expected_updated_at: base.current?.updated_at })
    clientId.current ??= newRowId()
    createTries.current.push(values)
    return save(null, values, { fail, client_id: clientId.current })
  }
  const autosave = useAutosave<T>({
    save: async (values) => {
      const creating = idRef.current === null
      // this try is not an "earlier" one for its own decision
      const earlierTries = creating ? [...createTries.current] : []
      let result = await send(values)
      if (!result.ok && result.reason === "conflict") {
        const decision =
          preview === "save-conflict"
            ? "conflict"
            : decideConflict({ base: base.current, latest: result.latest, sent: values, comparable, stored, earlierTries })
        if (decision === "already_saved") result = { ok: true, row: result.latest }
        else if (decision === "rebase") {
          adopt(result.latest)
          result = await send(values)
        }
      }
      if (result.ok) return applySaved(result.row, creating)
      setProblem(result.reason === "conflict" ? { kind: "conflict", latest: result.latest } : { kind: result.reason })
      throw new AutosaveBlocked(result.reason)
    },
  })
  /** Conflict: save my input on top of the latest row. */
  const keepMine = () => {
    if (problem?.kind !== "conflict") return
    const created = idRef.current === null
    adopt(problem.latest)
    if (created && editHref) window.history.replaceState(null, "", editHref(problem.latest.id))
    setProblem(null)
    void autosave.retry()
  }
  /** Conflict: drop my input. Returns the row for the form to put back into its fields. */
  const takeLatest = (): R | null => {
    if (problem?.kind !== "conflict") return null
    const { latest } = problem
    autosave.discard()
    applySaved(latest)
    return latest
  }
  return { autosave, row, id: row?.id ?? initialId, problem, keepMine, takeLatest }
}

export type ConflictField = { label: string; value: string }

/**
 * What a refused save means (W2-②③). Conflict: the fields that differ (latest vs. my input) and the choice between
 * them; the input stays in the form until the user chooses. // [UI-가정] 문구 전부 (명세에 충돌 상태 없음)
 */
export function SaveProblemNotice<R>({
  problem,
  mine,
  latest,
  onKeepMine,
  onTakeLatest,
}: {
  problem: RowProblem<R> | null
  /** the form's fields, in the form's order */
  mine: ConflictField[]
  /** the same fields, from `problem.latest` */
  latest: (row: R) => ConflictField[]
  onKeepMine: () => void
  onTakeLatest: () => void
}) {
  // UQ-706: the notice goes away on a choice, so focus and the screen reader land on this line instead of <body>
  const [resolved, setResolved] = React.useState<string | null>(null)
  const resolvedRef = React.useRef<HTMLParagraphElement>(null)
  const [shownFor, setShownFor] = React.useState(problem)
  if (shownFor !== problem) {
    setShownFor(problem)
    if (problem) setResolved(null)
  }
  React.useEffect(() => {
    if (resolved) resolvedRef.current?.focus()
  }, [resolved])
  if (!problem)
    return resolved ? (
      <p ref={resolvedRef} tabIndex={-1} role="status" className="flex items-center gap-1.5 text-sm text-muted-foreground focus-visible:outline-none">
        <CircleCheck className="size-4 shrink-0" aria-hidden />
        {resolved}
      </p>
    ) : null
  const choose = (handler: () => void, message: string) => () => {
    setResolved(message)
    handler()
  }
  if (problem.kind === "gone")
    return (
      <Alert variant="destructive">
        <CircleAlert aria-hidden />
        <AlertTitle>저장할 곳을 찾지 못했어요</AlertTitle>
        <AlertDescription>이 항목이나 연결한 소속이 다른 곳에서 삭제됐을 수 있어요. 입력한 내용은 저장되지 않았어요.</AlertDescription>
      </Alert>
    )
  if (problem.kind === "invalid")
    return (
      <Alert variant="destructive">
        <CircleAlert aria-hidden />
        <AlertTitle>입력한 값을 저장할 수 없어요</AlertTitle>
        <AlertDescription>기간과 글자 수를 확인해 주세요. 고치면 다시 저장돼요.</AlertDescription>
      </Alert>
    )
  const theirs = latest(problem.latest)
  const changed = mine.flatMap((m, i) => (m.value.trim() === (theirs[i]?.value ?? "").trim() ? [] : [{ label: m.label, mine: m.value, latest: theirs[i]?.value ?? "" }]))
  return (
    <Alert variant="warning" role="alert">
      <TriangleAlert aria-hidden />
      <AlertTitle>다른 탭이나 기기에서 먼저 저장한 내용이 있어요</AlertTitle>
      <AlertDescription className="space-y-3">
        <p>어느 쪽을 남길지 골라 주세요. 고르기 전까지 지금 입력은 저장되지 않아요.</p>
        {changed.length ? (
          <dl className="space-y-2">
            {changed.map((c) => (
              <div key={c.label}>
                <dt className="font-medium text-foreground">{c.label}</dt>
                <dd className="break-words whitespace-pre-wrap">최신: {c.latest || "(비어 있음)"}</dd>
                <dd className="break-words whitespace-pre-wrap">내 입력: {c.mine || "(비어 있음)"}</dd>
              </div>
            ))}
          </dl>
        ) : (
          // UQ-702: a refused save whose visible fields all match (e.g. a value the save normalizes) // [UI-가정] 문구
          <p>보이는 칸은 모두 같아요. 어느 쪽을 골라도 화면 내용은 그대로예요.</p>
        )}
        <div className="flex flex-wrap gap-2">
          {/* UQ-705: 44px touch targets on narrow screens (UX-9) */}
          {/* [UI-가정] 선택 뒤 한 줄 문구 */}
          <Button variant="outline" size="sm" className="max-md:min-h-11" onClick={choose(onTakeLatest, "최신 내용으로 바꿨어요")}>
            최신 내용으로 바꾸기
          </Button>
          <Button size="sm" className="max-md:min-h-11" onClick={choose(onKeepMine, "내 입력으로 저장하고 있어요")}>
            내 입력으로 저장
          </Button>
        </div>
      </AlertDescription>
    </Alert>
  )
}

/** W2-③: inline, under the period fields. The period stays out of the save until it's fixed (`periodPatch`). */
export function PeriodError({ id, start, end }: { id: string; start: string | null; end: string | null }) {
  if (!isPeriodReversed(start, end)) return null
  return (
    <p id={id} className="flex items-center gap-1.5 text-sm text-destructive" role="alert">
      <CircleAlert className="size-4 shrink-0" aria-hidden />
      {/* [UI-가정] */}
      종료 월이 시작 월보다 앞서요. 고치기 전까지 기간은 저장되지 않아요
    </p>
  )
}

/** Month as the conflict notice shows it */
export function monthText(month: string | null): string {
  return month ? month.slice(0, 7) : ""
}

/** 위험 영역: 삭제 → C-05 → delete_career_item → `afterHref` */
export function DangerZone({
  entityType,
  entityId,
  label,
  afterHref,
  buttonLabel,
}: {
  entityType: Exclude<DeletionEntityType, "writing_chat">
  entityId: string | null
  label: string
  afterHref: string
  buttonLabel: string
}) {
  const [open, setOpen] = React.useState(false)
  const router = useRouter()
  if (!entityId) return null
  const target: DeleteTarget = { kind: "career", entity_type: entityType, entity_id: entityId, label }
  return (
    <div className="flex justify-end border-t pt-4">
      <Button variant="ghost" className="text-destructive" onClick={() => setOpen(true)}>
        <Trash2 aria-hidden />
        {buttonLabel}
      </Button>
      <DeleteConfirmDialog
        target={target}
        open={open}
        onOpenChange={setOpen}
        onConfirm={async (opts) => {
          await deleteCareerItemAction(entityType, entityId, opts.affiliation_mode, opts.result_mode)
          router.push(afterHref)
        }}
      />
    </div>
  )
}

/** '' → null for nullable text columns */
export function nn(value: string): string | null {
  const t = value.trim()
  return t === "" ? null : value
}
