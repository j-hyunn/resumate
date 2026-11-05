"use client"

/**
 * Shared pieces for the A2 career forms (S-04 프로필; design-system 5.3 편집기): section cards,
 * labelled inputs, and the autosave wiring that creates the row on the first save.
 */
import * as React from "react"
import { cn } from "@/lib/utils"
import { Card } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { AutosaveBlocked, useAutosave } from "@/components/common/save-status"
import { notifyCareerSaved } from "@/components/common/return-banner"
import { usePreviewState } from "@/components/common/preview-state-client"
import { decideConflict, newRowId, type RowSaveResult } from "@/lib/data/row-save"

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

export type RowSaveOptions = { fail?: boolean; client_id?: string; expected_updated_at?: string }

type RowProblem<R> = { kind: "conflict"; latest: R } | { kind: "gone" } | { kind: "invalid" }

/**
 * Autosave for a career row (C-06). Creates the row on the first save (id = null), then
 * moves the URL to the edit route without remounting (history.replaceState). Saving never
 * blocks on validation; the data layer recomputes `status` (DM-8).
 *
 * - First save: the form generates the id and sends it as `client_id` on every try, so a lost response followed by
 *   "다시 시도" can't make a second row (W2-①).
 * - Later saves: `expected_updated_at` = the row the form last saw. A refused save shows `problem`
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

/** '' → null for nullable text columns */
export function nn(value: string): string | null {
  const t = value.trim()
  return t === "" ? null : value
}
