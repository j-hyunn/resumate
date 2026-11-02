"use client"

/**
 * Shared pieces for the A2 career forms (design-system 5.3 편집기): section cards,
 * labelled inputs, long STAR fields with char count, the danger zone with C-05,
 * and the autosave wiring that creates the row on the first save.
 */
import * as React from "react"
import { useRouter } from "next/navigation"
import { Trash2 } from "lucide-react"
import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import { Card } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { CharCount } from "@/components/common/input-guide"
import { DeleteConfirmDialog, type DeleteTarget } from "@/components/common/delete-confirm-dialog"
import { useAutosave } from "@/components/common/save-status"
import { notifyCareerSaved } from "@/components/common/return-banner"
import { usePreviewState } from "@/components/common/preview-state-client"
import type { DeletionEntityType } from "@/types/db"
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

/**
 * Autosave for a career row (C-06). Creates the row on the first save (id = null), then
 * moves the URL to the edit route without remounting (history.replaceState). Saving never
 * blocks on validation; the data layer recomputes `status` (DM-8).
 * `?state=save-failed` makes every save fail (ST-SAVE-FAILED preview).
 */
export function useRowAutosave<T, R extends { id: string; status?: string }>({
  initialId,
  initialRow,
  save,
  editHref,
  onSaved,
}: {
  initialId: string | null
  initialRow?: R | null
  save: (id: string | null, values: T, opts: { fail?: boolean }) => Promise<R>
  editHref?: (id: string) => string
  onSaved?: (row: R) => void
}) {
  const preview = usePreviewState()
  const fail = preview === "save-failed"
  const idRef = React.useRef<string | null>(initialId)
  const [row, setRow] = React.useState<R | null>(initialRow ?? null)
  const onSavedRef = React.useRef(onSaved)
  React.useEffect(() => {
    onSavedRef.current = onSaved
  })
  const autosave = useAutosave<T>({
    save: async (values) => {
      const saved = await save(idRef.current, values, { fail })
      const created = idRef.current === null
      idRef.current = saved.id
      setRow(saved)
      if (created && editHref) window.history.replaceState(null, "", editHref(saved.id))
      notifyCareerSaved()
      onSavedRef.current?.(saved)
    },
  })
  return { autosave, row, id: row?.id ?? initialId }
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
