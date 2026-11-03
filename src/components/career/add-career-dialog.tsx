"use client"

/**
 * S-08 커리어 추가·수정 모달 (피그마 1009:2 — 경력 / 교육 이수 / 개인 프로젝트 추가). Fills the item in one
 * go and creates it on "추가하기": no autosave draft and no 작성 중 표시. The detail panel's 수정 buttons
 * open the same modal filled in with the row ("저장하기"). 소속 프로젝트·경력 단위 성과는
 * 받지 않는다 — 프로젝트는 만들어진 경력·교육의 상세 패널에서 추가한다.
 *
 * // [UI-가정] 피그마의 "교육 직무"는 저장할 컬럼이 없어 뺐다. "교육 이수"는 구분 = 교육 과정(course)으로,
 * 진행 중이 아니고 종료월이 있으면 상태 = 수료로 저장한다. 프로젝트의 본문 제목은 피그마 "근무 내용" 대신
 * 상세 패널과 같은 "프로젝트 내용"으로 쓴다.
 */
import * as React from "react"
import { CircleAlert, Loader2, X } from "lucide-react"
import { toast } from "sonner"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Textarea } from "@/components/ui/textarea"
import type { Education, EmploymentType, Experience, Project } from "@/types/db"
import { EMPLOYMENT_TYPE_LABELS } from "@/lib/data/labels"
import { isPeriodReversed } from "@/lib/data/row-save"
import { createCareerItemAction, updateCareerItemAction, type NewCareerItem } from "./actions"
import { nn } from "./form-parts"

export type AddCareerKind = "experience" | "education" | "project"

const TITLES: Record<AddCareerKind, string> = {
  experience: "경력 추가",
  education: "교육 이수 추가",
  project: "개인 프로젝트 추가",
}

const EDIT_TITLES: Record<AddCareerKind, string> = {
  experience: "경력 수정",
  education: "교육 이수 수정",
  project: "개인 프로젝트 수정",
}

const ADDED: Record<AddCareerKind, string> = {
  experience: "경력을 추가했어요",
  education: "교육을 추가했어요",
  project: "프로젝트를 추가했어요",
}

/** The row the 수정 button opens the modal with (filled in) */
export type CareerEditTarget =
  | { kind: "experience"; row: Experience }
  | { kind: "education"; row: Education }
  | { kind: "project"; row: Project; skills: string[] }

interface Period {
  start: string | null
  end: string | null
  ongoing: boolean
}

interface Values {
  name: string
  org: string
  role: string
  rank: string
  position: string
  department: string
  employment_type: EmploymentType | ""
  link: string
  body: string
  period: Period
  skills: string[]
}

const EMPTY: Values = {
  name: "",
  org: "",
  role: "",
  rank: "",
  position: "",
  department: "",
  employment_type: "",
  link: "",
  body: "",
  period: { start: null, end: null, ongoing: false },
  skills: [],
}

type Errors = Partial<Record<"name" | "org" | "rank" | "start" | "end" | "link", string>>

/** The fields each kind needs before it's created (the DB's completion rule, except a project's 프로젝트 내용) */
function validate(kind: AddCareerKind, v: Values): Errors {
  const errors: Errors = {}
  const { start, end, ongoing } = v.period
  if (!start) errors.start = "시작 연월을 선택해 주세요"
  else if (!ongoing && isPeriodReversed(start, end)) errors.end = "종료가 시작보다 빨라요"
  if (kind === "experience") {
    if (!v.org.trim()) errors.org = "회사명을 입력해 주세요"
    if (!ongoing && !end && !errors.end) errors.end = "종료 연월을 선택하거나 재직 중을 체크해 주세요"
    if (!v.rank.trim() && !v.position.trim()) errors.rank = "직급이나 직책 중 하나를 입력해 주세요"
  }
  if (kind === "education" && !v.org.trim()) errors.org = "운영 기관을 입력해 주세요"
  if (kind === "project") {
    if (!v.name.trim()) errors.name = "서비스 명을 입력해 주세요"
    if (v.link.trim() && !/^https?:\/\//i.test(v.link.trim())) errors.link = "http:// 또는 https://로 시작하는 주소를 입력해 주세요"
  }
  return errors
}

function fromRow(target: CareerEditTarget): Values {
  if (target.kind === "experience") {
    const e = target.row
    return {
      ...EMPTY,
      org: e.company_name ?? "",
      rank: e.job_rank ?? "",
      position: e.job_position ?? "",
      department: e.department ?? "",
      employment_type: e.employment_type ?? "",
      body: e.summary ?? "",
      period: { start: e.start_month, end: e.end_month, ongoing: e.is_current },
    }
  }
  if (target.kind === "education") {
    const e = target.row
    return {
      ...EMPTY,
      name: e.program_name ?? "",
      org: e.institution_name ?? "",
      body: e.description ?? "",
      period: { start: e.start_month, end: e.end_month, ongoing: e.enrollment_status === "enrolled" },
    }
  }
  const p = target.row
  return {
    ...EMPTY,
    name: p.name ?? "",
    role: p.role ?? "",
    link: p.link_url ?? "",
    body: p.description ?? p.summary ?? "",
    period: { start: p.start_month, end: p.end_month, ongoing: p.is_current ?? false },
    skills: target.skills,
  }
}

/** `editing`: fields the modal doesn't show (교육 구분, a 졸업·휴학 상태) stay as they are */
function toItem(kind: AddCareerKind, v: Values, editing?: CareerEditTarget): NewCareerItem {
  const { start, ongoing } = v.period
  const end = ongoing ? null : v.period.end
  if (kind === "experience") {
    return {
      kind,
      patch: {
        company_name: nn(v.org),
        start_month: start,
        end_month: end,
        is_current: ongoing,
        job_rank: nn(v.rank),
        job_position: nn(v.position),
        department: nn(v.department),
        employment_type: v.employment_type || null,
        summary: nn(v.body),
      },
    }
  }
  if (kind === "education") {
    const prev = editing?.kind === "education" ? editing.row : null
    const keptStatus = prev?.enrollment_status && prev.enrollment_status !== "enrolled" ? prev.enrollment_status : null
    return {
      kind,
      patch: {
        program_name: nn(v.name),
        institution_name: nn(v.org),
        education_type: prev?.education_type ?? "course",
        start_month: start,
        end_month: end,
        enrollment_status: ongoing ? "enrolled" : (keptStatus ?? (end ? "completed" : null)),
        description: nn(v.body),
      },
    }
  }
  return {
    kind,
    patch: { name: v.name.trim(), role: nn(v.role), start_month: start, end_month: end, is_current: ongoing, link_url: nn(v.link), description: nn(v.body) },
    skills: v.skills,
  }
}

export function AddCareerDialog({
  kind,
  editing = null,
  onOpenChange,
  onCreated,
  onSaved,
}: {
  /** add mode; null = closed */
  kind?: AddCareerKind | null
  /** edit mode (수정): the modal opens filled in with this row */
  editing?: CareerEditTarget | null
  onOpenChange: (open: boolean) => void
  onCreated?: (item: { kind: AddCareerKind; id: string }) => void
  onSaved?: () => void
}) {
  const formKind = editing?.kind ?? kind ?? null
  return (
    <Dialog open={formKind !== null} onOpenChange={onOpenChange}>
      <DialogContent
        showCloseButton={false}
        className="flex max-h-[calc(100dvh-2rem)] w-[602px] flex-col gap-4 rounded-[20px] p-5 sm:max-w-[602px] lg:h-[calc(100dvh-200px)] lg:max-h-[840px]"
      >
        {/* key: every open starts from an empty (or the row's) form */}
        {formKind ? (
          <AddCareerForm key={editing ? editing.row.id : formKind} kind={formKind} editing={editing} onCreated={onCreated} onSaved={onSaved} />
        ) : null}
      </DialogContent>
    </Dialog>
  )
}

function AddCareerForm({
  kind,
  editing,
  onCreated,
  onSaved,
}: {
  kind: AddCareerKind
  editing: CareerEditTarget | null
  onCreated?: (item: { kind: AddCareerKind; id: string }) => void
  onSaved?: () => void
}) {
  const [values, setValues] = React.useState<Values>(() => (editing ? fromRow(editing) : EMPTY))
  const [submitted, setSubmitted] = React.useState(false)
  const [pending, setPending] = React.useState(false)
  // a retried create asks about the row the first try may have made
  const clientId = React.useMemo(() => crypto.randomUUID(), [])
  const errors = submitted ? validate(kind, values) : {}
  const set = (patch: Partial<Values>) => setValues((v) => ({ ...v, ...patch }))
  const ongoingLabel = kind === "experience" ? "재직 중" : "진행 중"

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    setSubmitted(true)
    if (Object.keys(validate(kind, values)).length > 0) return
    setPending(true)
    try {
      if (editing) {
        const saved = await updateCareerItemAction(editing.row.id, toItem(kind, values, editing), { expected_updated_at: editing.row.updated_at })
        if (!saved.ok) {
          return void toast.error(
            saved.reason === "conflict"
              ? "다른 곳에서 먼저 수정됐어요. 새로고침 후 다시 시도해 주세요"
              : saved.reason === "gone"
                ? "이미 삭제된 항목이에요"
                : "저장하지 못했어요. 입력한 내용을 확인해 주세요",
          )
        }
        toast.success("저장했어요")
        return void onSaved?.()
      }
      const result = await createCareerItemAction(toItem(kind, values), { client_id: clientId })
      if (!result.ok) return void toast.error("추가하지 못했어요. 입력한 내용을 확인해 주세요")
      toast.success(ADDED[kind])
      onCreated?.({ kind, id: result.id })
    } catch {
      toast.error("추가하지 못했어요. 잠시 후 다시 시도해 주세요")
    } finally {
      setPending(false)
    }
  }

  return (
    <form onSubmit={submit} noValidate className="flex min-h-0 flex-1 flex-col gap-4">
      <div className="flex items-center gap-2">
        <DialogTitle className="flex-1 text-xl leading-normal font-semibold">{editing ? EDIT_TITLES[kind] : TITLES[kind]}</DialogTitle>
        <DialogDescription className="sr-only">{editing ? "내용을 고치고 저장하기를 누르면 반영돼요" : "내용을 채우고 추가하기를 누르면 커리어 목록에 추가돼요"}</DialogDescription>
        <DialogClose asChild>
          <Button type="button" variant="ghost" size="icon-sm" aria-label="닫기">
            <X className="size-6" aria-hidden />
          </Button>
        </DialogClose>
      </div>

      <div className="-mx-1 flex min-h-0 flex-1 flex-col gap-6 overflow-y-auto px-1">
        {kind === "experience" ? (
          <Section title="재직 정보">
            <Field id="add-org" label="회사명" error={errors.org}>
              <Input id="add-org" placeholder="회사 명 입력" value={values.org} onChange={(e) => set({ org: e.target.value })} {...invalid("add-org", errors.org)} />
            </Field>
            <PeriodField label="재직 기간" ongoingLabel={ongoingLabel} value={values.period} onChange={(period) => set({ period })} startError={errors.start} endError={errors.end} />
            <div className="grid gap-x-2 sm:grid-cols-2">
              <Field id="add-rank" label="직급" error={errors.rank}>
                <Input id="add-rank" placeholder="직급 입력" value={values.rank} onChange={(e) => set({ rank: e.target.value })} {...invalid("add-rank", errors.rank)} />
              </Field>
              <Field id="add-position" label="직책">
                <Input
                  id="add-position"
                  placeholder="직책 입력"
                  value={values.position}
                  onChange={(e) => set({ position: e.target.value })}
                  aria-invalid={errors.rank ? true : undefined}
                  aria-describedby={errors.rank ? "add-rank-error" : undefined}
                />
              </Field>
              <Field id="add-dept" label="부서">
                <Input id="add-dept" placeholder="부서 입력" value={values.department} onChange={(e) => set({ department: e.target.value })} />
              </Field>
              <Field id="add-type" label="고용 형태">
                <Select value={values.employment_type} onValueChange={(v) => set({ employment_type: v as EmploymentType })}>
                  <SelectTrigger id="add-type" className="w-full">
                    <SelectValue placeholder="고용 형태 선택" />
                  </SelectTrigger>
                  <SelectContent>
                    {(Object.keys(EMPLOYMENT_TYPE_LABELS) as EmploymentType[]).map((t) => (
                      <SelectItem key={t} value={t}>
                        {EMPLOYMENT_TYPE_LABELS[t]}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Field>
            </div>
          </Section>
        ) : kind === "education" ? (
          <Section title="교육 정보">
            <Field id="add-name" label="교육 명">
              <Input id="add-name" placeholder="교육 명 입력" value={values.name} onChange={(e) => set({ name: e.target.value })} />
            </Field>
            <Field id="add-org" label="운영 기관" error={errors.org}>
              <Input id="add-org" placeholder="운영 기관 입력" value={values.org} onChange={(e) => set({ org: e.target.value })} {...invalid("add-org", errors.org)} />
            </Field>
            <PeriodField label="교육 기간" ongoingLabel={ongoingLabel} value={values.period} onChange={(period) => set({ period })} startError={errors.start} endError={errors.end} />
          </Section>
        ) : (
          <Section title="프로젝트 정보">
            <div className="grid gap-x-2 sm:grid-cols-2">
              <Field id="add-name" label="서비스 명" error={errors.name}>
                <Input id="add-name" placeholder="서비스 명 입력" value={values.name} onChange={(e) => set({ name: e.target.value })} {...invalid("add-name", errors.name)} />
              </Field>
              <Field id="add-role" label="역할">
                <Input id="add-role" placeholder="역할 입력" value={values.role} onChange={(e) => set({ role: e.target.value })} />
              </Field>
            </div>
            <PeriodField label="진행 기간" ongoingLabel={ongoingLabel} value={values.period} onChange={(period) => set({ period })} startError={errors.start} endError={errors.end} />
            <SkillsField value={values.skills} onChange={(skills) => set({ skills })} />
            <Field id="add-link" label="프로젝트 링크" error={errors.link}>
              <Input
                id="add-link"
                type="url"
                inputMode="url"
                placeholder="https://www.project.com"
                value={values.link}
                onChange={(e) => set({ link: e.target.value })}
                {...invalid("add-link", errors.link)}
              />
            </Field>
          </Section>
        )}

        <section className="flex min-h-48 flex-1 flex-col gap-2">
          <Label htmlFor="add-body" className="text-base font-medium">
            {kind === "experience" ? "근무 내용" : kind === "education" ? "교육 내용" : "프로젝트 내용"}
          </Label>
          <Textarea
            id="add-body"
            className="min-h-48 flex-1 resize-none text-base leading-[1.75]"
            placeholder={kind === "experience" ? "근무 내용 입력" : kind === "education" ? "교육 내용 입력" : "프로젝트 내용 입력"}
            value={values.body}
            onChange={(e) => set({ body: e.target.value })}
          />
        </section>
      </div>

      <div className="flex justify-end">
        <Button type="submit" variant="secondary" disabled={pending}>
          {pending ? <Loader2 className="animate-spin" aria-hidden /> : null}
          {editing ? "저장하기" : "추가하기"}
        </Button>
      </div>
    </form>
  )
}

function invalid(id: string, error: string | undefined) {
  return error ? { "aria-invalid": true as const, "aria-describedby": `${id}-error` } : {}
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="flex flex-col gap-2">
      <h3 className="text-base font-medium">{title}</h3>
      <div className="flex flex-col">{children}</div>
    </section>
  )
}

function Field({ id, label, error, children }: { id: string; label: string; error?: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-2 py-2">
      <Label htmlFor={id} className="text-sm font-normal">
        {label}
      </Label>
      {children}
      <FieldError id={`${id}-error`} message={error} />
    </div>
  )
}

function FieldError({ id, message }: { id: string; message?: string }) {
  if (!message) return null
  return (
    <p id={id} className="flex items-center gap-1.5 text-sm text-destructive" role="alert">
      <CircleAlert className="size-4 shrink-0" aria-hidden />
      {message}
    </p>
  )
}

/** 연도·월 ~ 연도·월 + 재직 중 / 진행 중, on one row (wraps on narrow screens) */
function PeriodField({
  label,
  ongoingLabel,
  value,
  onChange,
  startError,
  endError,
}: {
  label: string
  ongoingLabel: string
  value: Period
  onChange: (value: Period) => void
  startError?: string
  endError?: string
}) {
  const error = startError ?? endError
  return (
    <div className="flex flex-col gap-2 py-2">
      <span id="add-period-label" className="text-sm">
        {label}
      </span>
      <div
        className="flex flex-wrap items-center gap-2 sm:flex-nowrap"
        role="group"
        aria-labelledby="add-period-label"
        aria-describedby={error ? "add-period-error" : undefined}
      >
        <YearMonth label={`${label} 시작`} value={value.start} onChange={(start) => onChange({ ...value, start })} invalid={Boolean(startError)} />
        <span aria-hidden>~</span>
        <YearMonth
          label={`${label} 종료`}
          value={value.ongoing ? null : value.end}
          onChange={(end) => onChange({ ...value, end })}
          disabled={value.ongoing}
          invalid={Boolean(endError)}
        />
        <Label className="flex shrink-0 items-center gap-2 text-base font-normal text-muted-foreground">
          <Checkbox checked={value.ongoing} onCheckedChange={(v) => onChange({ ...value, ongoing: v === true })} />
          {ongoingLabel}
        </Label>
      </div>
      <FieldError id="add-period-error" message={error} />
    </div>
  )
}

const MIN_YEAR = 1970

function YearMonth({
  label,
  value,
  onChange,
  disabled,
  invalid,
}: {
  label: string
  value: string | null
  onChange: (value: string | null) => void
  disabled?: boolean
  invalid?: boolean
}) {
  // UQ-8: a year without a month stays local; the value is emitted only when both are set
  const [draftYear, setDraftYear] = React.useState("")
  const year = value ? value.slice(0, 4) : draftYear
  const month = value ? String(Number(value.slice(5, 7))) : ""
  const years = React.useMemo(() => {
    const list: string[] = []
    for (let y = new Date().getFullYear() + 1; y >= MIN_YEAR; y -= 1) list.push(String(y))
    return list
  }, [])
  const emit = (y: string, m: string) => {
    setDraftYear(y)
    onChange(y && m ? `${y}-${m.padStart(2, "0")}-01` : null)
  }
  return (
    <div className="flex min-w-0 flex-1 basis-[calc(50%-1rem)] gap-2 sm:basis-0">
      <Select value={year} onValueChange={(y) => emit(y, month)} disabled={disabled}>
        <SelectTrigger className="min-w-0 flex-1" aria-label={`${label} 연도`} aria-invalid={invalid || undefined}>
          <SelectValue placeholder="연도" />
        </SelectTrigger>
        <SelectContent className="max-h-72">
          {years.map((y) => (
            <SelectItem key={y} value={y}>
              {y}년
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <Select value={month} onValueChange={(m) => emit(year, m)} disabled={disabled || !year}>
        <SelectTrigger className="min-w-0 flex-1" aria-label={`${label} 월`} aria-invalid={invalid || undefined}>
          <SelectValue placeholder="월" />
        </SelectTrigger>
        <SelectContent>
          {Array.from({ length: 12 }, (_, i) => String(i + 1)).map((m) => (
            <SelectItem key={m} value={m}>
              {m}월
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  )
}

function SkillsField({ value, onChange }: { value: string[]; onChange: (value: string[]) => void }) {
  const [input, setInput] = React.useState("")
  const add = () => {
    const name = input.trim()
    setInput("")
    if (name && !value.some((s) => s.toLowerCase() === name.toLowerCase())) onChange([...value, name])
  }
  return (
    <div className="flex flex-col gap-2 py-2">
      <Label htmlFor="add-skill" className="text-sm font-normal">
        사용 기술
      </Label>
      <Input
        id="add-skill"
        placeholder="기술 입력 후 Enter"
        value={input}
        onChange={(e) => setInput(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && !e.nativeEvent.isComposing) {
            e.preventDefault()
            add()
          }
        }}
      />
      {value.length > 0 ? (
        <ul className="flex flex-wrap gap-2" aria-label="사용 기술">
          {value.map((s) => (
            <li key={s}>
              <Badge variant="secondary" className="h-8 gap-1 pr-1 pl-3 text-sm">
                {s}
                <Button type="button" variant="ghost" size="icon-xs" className="size-11 lg:size-7" aria-label={`${s} 빼기`} onClick={() => onChange(value.filter((x) => x !== s))}>
                  <X aria-hidden />
                </Button>
              </Badge>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  )
}
