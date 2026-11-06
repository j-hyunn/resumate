"use client"

/**
 * S-24 ① 계정 탭 "내 정보" (UX v5.17a S-24 ①, F-P1-01·F-P1-01a; design-system 5.11.1).
 *
 * 섹션 단위 저장: [저장] 하나로 이름 + 셀렉트 3 + 관심 직군·직무 쌍(최대 2) + 최종 학력 6칸을 한 번에
 * `save_profile_basics`로 보낸다(섹션 전체 덮어쓰기). 기대 버전 = 조회의 `profile.updatedAt`, 저장 응답의
 * `updatedAt`으로 갱신한다. 저장하지 않은 변경이 있으면 설정 다이얼로그가 닫기·탭 전환·회원 탈퇴 전에
 * 묻는다(`useSettingsGuard`). 입력은 임시 보존하지 않는다 — 다시 열면 늘 다시 읽는다.
 *
 * Parts: `SectionSaveBar` (저장 줄 + 실패·충돌 줄), `JobInterestRows` (쌍 행), `HighestEducationFields`.
 */
import * as React from "react"
import { Check, CircleAlert, Info, Loader2, Plus, TriangleAlert, X } from "lucide-react"
import { cn } from "@/lib/utils"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectSeparator, SelectTrigger, SelectValue } from "@/components/ui/select"
import { MAX_JOB_INTERESTS, type ProfileOptionDto } from "@/lib/contracts/profile"
import type { ProfileBasicsViewDto } from "@/lib/contracts/profile"
import type { ProfileOptionCategory } from "@/lib/contracts/enums"
import { formatTime } from "@/lib/data/labels"
import { useSettingsGuard } from "@/components/common/shell/settings-guard"
import { getProfileBasicsAction, saveProfileBasicsAction, type SaveProfileBasicsActionResult } from "./actions"
import {
  FIELD_ID,
  FIELD_ORDER,
  LABELS,
  SERVER_FIELD,
  filledPairs,
  fromDto,
  isEmpty,
  newPair,
  pairRowOf,
  payloadOf,
  sameValues,
  sentPairRows,
  validate,
  type Errors,
  type FieldKey,
  type PairRow,
  type ProfileFormValues,
} from "./profile-basics-model"

const pairFamilyId = (n: number) => `pb-job-family-${n}`
const pairRoleId = (n: number) => `pb-job-role-${n}`
const ADD_PAIR_ID = "pb-job-interest-add"
const TOO_MANY_ID = "pb-job-interest-too-many"
const SECTION_HEADING_ID = "settings-profile-heading"

/** focus (and scroll to) `id` after the pending state updates have rendered (errors / added rows / server refusals) */
function focusSoon(id: string) {
  requestAnimationFrame(() =>
    requestAnimationFrame(() => {
      const el = document.getElementById(id)
      if (!el) return
      el.focus({ preventScroll: true })
      el.scrollIntoView({ block: id === SECTION_HEADING_ID ? "start" : "center" })
    }),
  )
}


// ---------------------------------------------------------------------------
// form
// ---------------------------------------------------------------------------

type Banner = { kind: "save_failed" } | { kind: "invalid_option" } | null
type ConflictItem = { label: string; value: string }

/** `?state=` save previews (dev only): the first save returns this result instead of calling the server */
function previewSaveResult(preview: string | null): SaveProfileBasicsActionResult | null {
  switch (preview) {
    case "save-failed":
      return { ok: false, code: null, details: null }
    case "stale-write":
      return { ok: false, code: "stale_write", details: null }
    case "invalid-option":
      return { ok: false, code: "invalid_profile_option", details: { field: "interested_industry", fields: ["interested_industry"] } }
    case "duplicate-interest":
      return { ok: false, code: "duplicate_job_interest", details: { field: "job_interests.2", sortOrder: 2 } }
    default:
      return null
  }
}

export function ProfileBasicsForm({ view, preview = null }: { view: ProfileBasicsViewDto; preview?: string | null }) {
  const [options, setOptions] = React.useState(view.options)
  const [values, setValues] = React.useState(() => fromDto(view.profile))
  const [saved, setSaved] = React.useState(values)
  const [updatedAt, setUpdatedAt] = React.useState(view.profile.updatedAt)
  const [submitted, setSubmitted] = React.useState(false)
  const [errors, setErrors] = React.useState<Errors>({})
  const [pairErrors, setPairErrors] = React.useState<Record<number, string>>({})
  const [tooMany, setTooMany] = React.useState(false)
  const [banner, setBanner] = React.useState<Banner>(null)
  const [conflict, setConflict] = React.useState<ConflictItem[] | null>(null)
  const [saving, setSaving] = React.useState(false)
  const [savedAt, setSavedAt] = React.useState<Date | null>(null)
  const [announce, setAnnounce] = React.useState("")
  const previewUsed = React.useRef(false)
  /** latest values for the guard / save (kept in step by update · applyView · discard) */
  const valuesRef = React.useRef(values)

  const dirty = !sameValues(values, saved)

  const update = (patch: Partial<ProfileFormValues>) => {
    const next = { ...valuesRef.current, ...patch }
    valuesRef.current = next
    setValues(next)
    setSavedAt(null) // 칸을 다시 고치면 "저장됨"을 지운다 (5.11.1)
    if (submitted) setErrors(validate(next))
  }

  const labelOf = (category: ProfileOptionCategory, code: string | null) =>
    code ? (options.find((o) => o.category === category && o.code === code)?.label ?? code) : null

  /** 충돌 줄: 내가 고쳤던 칸만 "{칸 라벨}: {내가 입력한 값}" (G-72) */
  function changedItems(mine: ProfileFormValues, base: ProfileFormValues): ConflictItem[] {
    const show = (t: string | null) => (t && t.trim() ? t.trim() : "—")
    const period = (v: ProfileFormValues) => {
      const s = v.startYear && v.startMonth ? `${v.startYear}.${v.startMonth.padStart(2, "0")}` : ""
      const e = v.endYear && v.endMonth ? `${v.endYear}.${v.endMonth.padStart(2, "0")}` : ""
      return s || e ? `${s || "—"} ~ ${e || "—"}` : null
    }
    const pairs = (v: ProfileFormValues) =>
      filledPairs(v)
        .map((p) => [labelOf("job_family", p.jobFamily), labelOf("job_role", p.jobRole)].filter(Boolean).join(" / "))
        .join(", ") || null
    const rows: Array<[string, string | null, string | null]> = [
      [LABELS.displayName, mine.displayName, base.displayName],
      [LABELS.jobSearchStatus, labelOf("job_search_status", mine.jobSearchStatus), labelOf("job_search_status", base.jobSearchStatus)],
      [LABELS.interestedCompanyType, labelOf("company_type", mine.interestedCompanyType), labelOf("company_type", base.interestedCompanyType)],
      [LABELS.interestedIndustry, labelOf("industry", mine.interestedIndustry), labelOf("industry", base.interestedIndustry)],
      ["관심 직군 · 관심 직무", pairs(mine), pairs(base)],
      [LABELS.schoolName, mine.schoolName, base.schoolName],
      [LABELS.degree, labelOf("degree", mine.degree), labelOf("degree", base.degree)],
      [LABELS.status, labelOf("graduation_status", mine.status), labelOf("graduation_status", base.status)],
      [LABELS.period, period(mine), period(base)],
      [LABELS.major, mine.major, base.major],
      [LABELS.gpa, mine.gpa, base.gpa],
    ]
    return rows.filter(([, a, b]) => (a ?? "").trim() !== (b ?? "").trim()).map(([label, a]) => ({ label, value: show(a) }))
  }

  async function reload(): Promise<ProfileBasicsViewDto | null> {
    const res = await getProfileBasicsAction()
    return res.ok ? res.view : null
  }

  function applyView(next: ProfileBasicsViewDto) {
    const v = fromDto(next.profile)
    setOptions(next.options)
    valuesRef.current = v
    setValues(v)
    setSaved(v)
    setUpdatedAt(next.profile.updatedAt)
  }

  async function save(): Promise<boolean> {
    if (saving) return false
    const current = valuesRef.current
    setSubmitted(true)
    const errs = validate(current)
    setErrors(errs)
    setPairErrors({})
    setTooMany(false)
    const first = FIELD_ORDER.find((k) => errs[k])
    if (first) {
      focusSoon(FIELD_ID[first])
      return false
    }
    setSaving(true)
    setBanner(null)
    setConflict(null)
    // 보낸 위치 → 화면 행 대응표 (빈 행은 보내지 않는다, QA-42-02)
    const sentRows = sentPairRows(current)
    const fake = !previewUsed.current ? previewSaveResult(preview) : null
    if (fake && preview !== "save-failed") previewUsed.current = true
    const res = fake ?? (await saveProfileBasicsAction({ ...payloadOf(current), expectedUpdatedAt: updatedAt }))
    setSaving(false)

    if (res.ok) {
      setSaved(current)
      setUpdatedAt(res.updatedAt)
      setSavedAt(new Date())
      setSubmitted(false)
      setAnnounce("내 정보를 저장했어요")
      return true
    }

    const field = typeof res.details?.field === "string" ? res.details.field : null
    const pairIndex = () => pairRowOf(res.details, sentRows)

    switch (res.code) {
      case "stale_write": {
        const next = await reload()
        if (next) {
          const mine = current
          applyView(next)
          setConflict(changedItems(mine, fromDto(next.profile)))
        } else setBanner({ kind: "save_failed" })
        focusSoon(SECTION_HEADING_ID)
        return false
      }
      case "invalid_profile_option": {
        // 목록을 다시 읽어 셀렉트를 새로 채운다 (입력은 그대로)
        const next = await reload()
        if (next) setOptions(next.options)
        setBanner({ kind: "invalid_option" })
        const msg = "목록에서 내려간 값이거나 고른 직군에 없는 직무예요"
        if (field && SERVER_FIELD[field]) {
          const key = SERVER_FIELD[field]
          setErrors((e) => ({ ...e, [key]: msg }))
          focusSoon(FIELD_ID[key])
        } else {
          // 쌍: 실제는 위치 없이 `job_family` / `job_role`만 준다 → 보낸 첫 쌍의 행, 그 칸으로 포커스
          const i = pairIndex()
          setPairErrors({ [i]: msg })
          focusSoon(field === "job_role" ? pairRoleId(i + 1) : pairFamilyId(i + 1))
        }
        return false
      }
      case "field_too_long": {
        const key = (field && SERVER_FIELD[field]) || "displayName"
        // UX 문구 "{항목}이 너무 길어요" (방어 문구) — 네 칸 모두 받침으로 끝나 "이"
        setErrors((e) => ({ ...e, [key]: `${LABELS[key]}이 너무 길어요` }))
        focusSoon(FIELD_ID[key])
        return false
      }
      case "invalid_period":
        setErrors((e) => ({ ...e, period: "종료 시점이 시작보다 앞설 수 없어요" }))
        focusSoon(FIELD_ID.period)
        return false
      case "duplicate_job_interest": {
        const i = pairIndex()
        setPairErrors({ [i]: "이미 고른 직군·직무예요. 다른 쌍을 고르거나 지워 주세요" })
        focusSoon(pairFamilyId(i + 1))
        return false
      }
      case "too_many_job_interests":
        // 추가 버튼은 2쌍에서 비활성이라 포커스 대상이 못 된다 → 마지막 쌍 행의 첫 셀렉트 (QA-42-07)
        setTooMany(true)
        focusSoon(pairFamilyId(current.pairs.length))
        return false
      default:
        setBanner({ kind: "save_failed" })
        focusSoon(SECTION_HEADING_ID)
        return false
    }
  }

  function discard() {
    valuesRef.current = saved
    setValues(saved)
    setSubmitted(false)
    setErrors({})
    setPairErrors({})
    setTooMany(false)
    setBanner(null)
  }

  useSettingsGuard({ isDirty: () => !sameValues(valuesRef.current, saved), save, discard })

  const err = (k: FieldKey) => (submitted || typeof errors[k] === "string" ? errors[k] : undefined)
  const savedEmpty = isEmpty(saved)

  return (
    <section aria-labelledby={SECTION_HEADING_ID} className="space-y-4">
      <h3 id={SECTION_HEADING_ID} tabIndex={-1} className="text-base leading-6 font-semibold outline-none">
        내 정보
      </h3>

      {banner?.kind === "save_failed" ? (
        <p role="alert" className="flex flex-wrap items-center gap-1.5 text-sm text-destructive">
          <CircleAlert className="size-4 shrink-0" aria-hidden />
          내 정보를 저장하지 못했어요 ·
          <Button type="button" variant="destructive-link" size="sm" className="h-auto p-0" onClick={() => void save()}>
            다시 시도
          </Button>
        </p>
      ) : banner?.kind === "invalid_option" ? (
        <p role="alert" className="flex items-center gap-1.5 text-sm text-destructive">
          <CircleAlert className="size-4 shrink-0" aria-hidden />
          고를 수 없는 값이에요. 다시 골라 주세요
        </p>
      ) : null}

      {conflict ? (
        <Alert variant="warning">
          <TriangleAlert aria-hidden />
          <AlertTitle>다른 곳에서 내 정보가 바뀌었어요. 새로 불러온 값을 확인해 주세요</AlertTitle>
          {conflict.length ? (
            <AlertDescription>
              {/* [UI-가정] G-72: 덮어쓰기 전 내가 고친 값 목록 (P-26) */}
              <ul className="list-disc space-y-0.5 pl-5 text-sm">
                {conflict.map((c) => (
                  <li key={c.label}>
                    {c.label}: {c.value}
                  </li>
                ))}
              </ul>
            </AlertDescription>
          ) : null}
        </Alert>
      ) : null}

      {savedEmpty ? (
        <p className="text-sm text-muted-foreground">아직 비어 있어요. 채우면 Resumate 안 추천이 더 잘 맞아요</p>
      ) : null}

      <p className="flex items-start gap-1.5 text-sm text-muted-foreground">
        <Info className="mt-0.5 size-4 shrink-0" aria-hidden />
        이 정보는 화면 표시와 Resumate 안 추천에만 써요. AI에는 보내지 않아요
      </p>

      {/* 칸 안 Enter로 제출되지 않게 (G-66) */}
      <form noValidate onSubmit={(e) => e.preventDefault()} className="flex flex-col gap-4">
        <FieldBox id={FIELD_ID.displayName} label={LABELS.displayName} error={err("displayName")}>
          <Input
            id={FIELD_ID.displayName}
            value={values.displayName}
            placeholder="이름을 입력해 주세요"
            onChange={(e) => update({ displayName: e.target.value })}
            aria-invalid={Boolean(err("displayName")) || undefined}
            aria-describedby={err("displayName") ? `${FIELD_ID.displayName}-error` : undefined}
          />
        </FieldBox>

        <div className="grid gap-4 sm:grid-cols-2">
          <FieldBox id={FIELD_ID.jobSearchStatus} label={LABELS.jobSearchStatus} error={err("jobSearchStatus")}>
            <OptionSelect
              id={FIELD_ID.jobSearchStatus}
              options={options}
              category="job_search_status"
              value={values.jobSearchStatus}
              onChange={(v) => update({ jobSearchStatus: v })}
              invalid={Boolean(err("jobSearchStatus"))}
            />
          </FieldBox>
          <FieldBox id={FIELD_ID.interestedCompanyType} label={LABELS.interestedCompanyType} error={err("interestedCompanyType")}>
            <OptionSelect
              id={FIELD_ID.interestedCompanyType}
              options={options}
              category="company_type"
              value={values.interestedCompanyType}
              onChange={(v) => update({ interestedCompanyType: v })}
              invalid={Boolean(err("interestedCompanyType"))}
            />
          </FieldBox>
        </div>
        <FieldBox
          id={FIELD_ID.interestedIndustry}
          label={LABELS.interestedIndustry}
          error={err("interestedIndustry")}
          className="sm:w-[calc(50%-0.5rem)]"
        >
          <OptionSelect
            id={FIELD_ID.interestedIndustry}
            options={options}
            category="industry"
            value={values.interestedIndustry}
            onChange={(v) => update({ interestedIndustry: v })}
            invalid={Boolean(err("interestedIndustry"))}
          />
        </FieldBox>

        <JobInterestRows
          options={options}
          rows={values.pairs}
          rowErrors={pairErrors}
          tooMany={tooMany}
          onChange={(pairs) => {
            update({ pairs })
            setPairErrors({})
            setTooMany(false)
          }}
          onFocus={focusSoon}
        />

        <HighestEducationFields options={options} values={values} errors={(k) => err(k)} onChange={update} />

        <SectionSaveBar dirty={dirty} saving={saving} savedAt={savedAt} announce={announce} onSave={() => void save()} />
      </form>
    </section>
  )
}

// ---------------------------------------------------------------------------
// parts
// ---------------------------------------------------------------------------

function FieldBox({
  id,
  label,
  error,
  className,
  children,
}: {
  id: string
  label: string
  error?: string | true
  className?: string
  children: React.ReactNode
}) {
  return (
    <div className={cn("flex flex-col gap-2", className)}>
      <Label htmlFor={id} className="text-sm leading-5 font-medium">
        {label}
      </Label>
      {children}
      <FieldErrorLine id={`${id}-error`} message={typeof error === "string" ? error : undefined} />
    </div>
  )
}

function FieldErrorLine({ id, message, className }: { id: string; message?: string; className?: string }) {
  if (!message) return null
  return (
    <p id={id} role="alert" className={cn("flex items-center gap-1.5 text-sm text-destructive", className)}>
      <CircleAlert className="size-4 shrink-0" aria-hidden />
      {message}
    </p>
  )
}

/** Radix Select can't hold "" as an item value: "선택 안 함" uses a sentinel that saves null (G-65). */
const NONE = "__none"

function OptionSelect({
  id,
  options,
  category,
  value,
  onChange,
  invalid,
  disabled,
  placeholder = "선택해 주세요",
  parentCode,
  ariaLabel,
}: {
  id: string
  options: readonly ProfileOptionDto[]
  category: ProfileOptionCategory
  value: string | null
  onChange: (value: string | null) => void
  invalid?: boolean
  disabled?: boolean
  placeholder?: string
  /** job_role: only the roles of this job_family */
  parentCode?: string | null
  ariaLabel?: string
}) {
  const items = options
    .filter((o) => o.category === category && (parentCode === undefined || o.parentCode === parentCode))
    // 저장된 값이 내려갔어도(is_active = false) 그 값은 계속 보인다 (DM 2.1.1)
    .filter((o) => o.isActive || o.code === value)
    .sort((a, b) => a.sortOrder - b.sortOrder)
  return (
    <Select value={value ?? ""} onValueChange={(v) => onChange(v === NONE ? null : v)} disabled={disabled}>
      <SelectTrigger
        id={id}
        className="w-full"
        aria-label={ariaLabel}
        aria-invalid={invalid || undefined}
        aria-describedby={invalid ? `${id}-error` : undefined}
      >
        <SelectValue placeholder={placeholder} />
      </SelectTrigger>
      <SelectContent className="max-h-72">
        {/* [UI-가정] G-65 "선택 안 함" (새 문구, P-25) */}
        <SelectItem value={NONE} className="text-muted-foreground">
          선택 안 함
        </SelectItem>
        <SelectSeparator />
        {items.map((o) => (
          <SelectItem key={o.code} value={o.code}>
            {o.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}

/** 관심 직군 · 관심 직무 쌍 행 (design-system 5.11.1 `JobInterestRows`, 최대 2) */
function JobInterestRows({
  options,
  rows,
  rowErrors,
  tooMany,
  onChange,
  onFocus,
}: {
  options: readonly ProfileOptionDto[]
  rows: PairRow[]
  rowErrors: Record<number, string>
  tooMany: boolean
  onChange: (rows: PairRow[]) => void
  onFocus: (id: string) => void
}) {
  const full = rows.length >= MAX_JOB_INTERESTS
  return (
    <fieldset className="space-y-2" aria-describedby={tooMany ? TOO_MANY_ID : undefined} aria-invalid={tooMany || undefined}>
      <legend className="mb-2 text-sm leading-5 font-medium">관심 직군 · 관심 직무</legend>
      <div
        aria-hidden
        className="hidden grid-cols-[minmax(0,1fr)_minmax(0,1fr)_2rem] gap-2 text-xs leading-4 text-muted-foreground sm:grid"
      >
        <span>관심 직군</span>
        <span>관심 직무</span>
        <span />
      </div>
      <ol className="space-y-2">
        {rows.map((row, i) => {
          const n = i + 1
          const error = rowErrors[i]
          const errorId = `${pairFamilyId(n)}-error`
          return (
            <li
              key={row.key}
              className="grid grid-cols-[minmax(0,1fr)_2rem] items-start gap-2 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_2rem]"
            >
              <OptionSelect
                id={pairFamilyId(n)}
                ariaLabel={`관심 직군 ${n}`}
                options={options}
                category="job_family"
                value={row.jobFamily}
                invalid={Boolean(error)}
                // 직군을 바꾸면 그 행의 직무를 경고 없이 비운다 (UX `[가정]`)
                onChange={(v) => onChange(rows.map((r) => (r.key === row.key ? { ...r, jobFamily: v, jobRole: v === r.jobFamily ? r.jobRole : null } : r)))}
              />
              <div className="row-start-2 sm:row-start-auto">
                <OptionSelect
                  id={pairRoleId(n)}
                  ariaLabel={`관심 직무 ${n}`}
                  options={options}
                  category="job_role"
                  parentCode={row.jobFamily}
                  value={row.jobRole}
                  disabled={!row.jobFamily}
                  placeholder={row.jobFamily ? "선택해 주세요" : "직군을 먼저 골라 주세요"}
                  onChange={(v) => onChange(rows.map((r) => (r.key === row.key ? { ...r, jobRole: v } : r)))}
                />
              </div>
              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                className="col-start-2 row-start-1 sm:col-start-auto sm:row-start-auto"
                aria-label={`관심 직무 ${n} 삭제`}
                onClick={() => {
                  if (rows.length === 1) {
                    // [UI-가정] G-67: 마지막 행은 지우지 않고 비운다 (빈 행 1개가 늘 남음)
                    onChange([{ ...row, jobFamily: null, jobRole: null }])
                    onFocus(pairFamilyId(1))
                    return
                  }
                  const next = rows.filter((r) => r.key !== row.key)
                  onChange(next)
                  onFocus(pairFamilyId(Math.min(i, next.length - 1) + 1))
                }}
              >
                <X aria-hidden />
              </Button>
              <FieldErrorLine id={errorId} message={error} className="col-span-full" />
            </li>
          )
        })}
      </ol>
      <div className="flex flex-wrap items-center gap-2">
        <Button
          id={ADD_PAIR_ID}
          type="button"
          variant="outline"
          size="sm"
          disabled={full}
          onClick={() => {
            onChange([...rows, newPair()])
            onFocus(pairFamilyId(rows.length + 1))
          }}
        >
          <Plus aria-hidden />
          관심 직무 추가
        </Button>
        {full ? <p className="text-sm text-muted-foreground">최대 2개까지 고를 수 있어요</p> : null}
      </div>
      <FieldErrorLine id={TOO_MANY_ID} message={tooMany ? "관심 직군·직무는 최대 2개까지 고를 수 있어요" : undefined} />
    </fieldset>
  )
}

const MIN_YEAR = 1960
/** [UI-가정] 졸업 예정까지 고를 수 있게 올해 + 6년까지 */
function yearList(): string[] {
  const list: string[] = []
  for (let y = new Date().getFullYear() + 6; y >= MIN_YEAR; y -= 1) list.push(String(y))
  return list
}

/** 최종 학력 묶음 (design-system 5.11.1 `HighestEducationFields`, 평면 6칸 DM v4.12) */
function HighestEducationFields({
  options,
  values,
  errors,
  onChange,
}: {
  options: readonly ProfileOptionDto[]
  values: ProfileFormValues
  errors: (k: FieldKey) => string | true | undefined
  onChange: (patch: Partial<ProfileFormValues>) => void
}) {
  const periodError = errors("period")
  return (
    <fieldset className="space-y-3">
      <legend className="mb-2 text-sm leading-5 font-medium">최종 학력</legend>
      <p className="flex items-start gap-1.5 text-sm text-muted-foreground">
        <Info className="mt-0.5 size-4 shrink-0" aria-hidden />
        커리어의 교육과는 별개 값이에요. 한쪽을 고쳐도 다른 쪽은 바뀌지 않아요
      </p>
      <div className="grid gap-x-3 gap-y-4 sm:grid-cols-2">
        <FieldBox id={FIELD_ID.schoolName} label={LABELS.schoolName} error={errors("schoolName")} className="sm:col-span-2">
          <Input
            id={FIELD_ID.schoolName}
            value={values.schoolName}
            onChange={(e) => onChange({ schoolName: e.target.value })}
            aria-invalid={Boolean(errors("schoolName")) || undefined}
            aria-describedby={errors("schoolName") ? `${FIELD_ID.schoolName}-error` : undefined}
          />
        </FieldBox>
        <FieldBox id={FIELD_ID.degree} label={LABELS.degree} error={errors("degree")}>
          <OptionSelect
            id={FIELD_ID.degree}
            options={options}
            category="degree"
            value={values.degree}
            onChange={(v) => onChange({ degree: v })}
            invalid={Boolean(errors("degree"))}
          />
        </FieldBox>
        <FieldBox id={FIELD_ID.status} label={LABELS.status} error={errors("status")}>
          <OptionSelect
            id={FIELD_ID.status}
            options={options}
            category="graduation_status"
            value={values.status}
            onChange={(v) => onChange({ status: v })}
            invalid={Boolean(errors("status"))}
          />
        </FieldBox>
        <div className="flex flex-col gap-2 sm:col-span-2">
          <span id="pb-period-label" className="text-sm leading-5 font-medium">
            {LABELS.period}
          </span>
          <div
            role="group"
            aria-labelledby="pb-period-label"
            aria-describedby={typeof periodError === "string" ? "pb-period-error" : undefined}
            className="flex flex-wrap items-center gap-2 sm:flex-nowrap"
          >
            <YearMonthSelect
              idPrefix="pb-start"
              label="기간 시작"
              year={values.startYear}
              month={values.startMonth}
              invalid={Boolean(periodError)}
              onChange={(startYear, startMonth) => onChange({ startYear, startMonth })}
            />
            <span aria-hidden>~</span>
            <YearMonthSelect
              idPrefix="pb-end"
              label="기간 종료"
              year={values.endYear}
              month={values.endMonth}
              invalid={Boolean(periodError)}
              onChange={(endYear, endMonth) => onChange({ endYear, endMonth })}
            />
          </div>
          <FieldErrorLine id="pb-period-error" message={typeof periodError === "string" ? periodError : undefined} />
        </div>
        <FieldBox id={FIELD_ID.major} label={LABELS.major} error={errors("major")}>
          <Input
            id={FIELD_ID.major}
            value={values.major}
            onChange={(e) => onChange({ major: e.target.value })}
            aria-invalid={Boolean(errors("major")) || undefined}
            aria-describedby={errors("major") ? `${FIELD_ID.major}-error` : undefined}
          />
        </FieldBox>
        <FieldBox id={FIELD_ID.gpa} label={LABELS.gpa} error={errors("gpa")}>
          <Input
            id={FIELD_ID.gpa}
            className="tabular-nums"
            value={values.gpa}
            onChange={(e) => onChange({ gpa: e.target.value })}
            aria-invalid={Boolean(errors("gpa")) || undefined}
            aria-describedby={errors("gpa") ? `${FIELD_ID.gpa}-error` : undefined}
          />
        </FieldBox>
      </div>
    </fieldset>
  )
}

function YearMonthSelect({
  idPrefix,
  label,
  year,
  month,
  invalid,
  onChange,
}: {
  idPrefix: string
  label: string
  year: string | null
  month: string | null
  invalid: boolean
  onChange: (year: string | null, month: string | null) => void
}) {
  const years = React.useMemo(() => yearList(), [])
  return (
    <div className="flex min-w-0 flex-1 basis-[calc(50%-1rem)] gap-2 sm:basis-0">
      <Select value={year ?? ""} onValueChange={(v) => onChange(v === NONE ? null : v, month)}>
        <SelectTrigger id={`${idPrefix}-year`} className="min-w-0 flex-1" aria-label={`${label} 연도`} aria-invalid={invalid || undefined}>
          <SelectValue placeholder="연도" />
        </SelectTrigger>
        <SelectContent className="max-h-72">
          <SelectItem value={NONE} className="text-muted-foreground">
            선택 안 함
          </SelectItem>
          <SelectSeparator />
          {years.map((y) => (
            <SelectItem key={y} value={y}>
              {y}년
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <Select value={month ?? ""} onValueChange={(v) => onChange(year, v === NONE ? null : v)}>
        <SelectTrigger id={`${idPrefix}-month`} className="min-w-0 flex-1" aria-label={`${label} 월`} aria-invalid={invalid || undefined}>
          <SelectValue placeholder="월" />
        </SelectTrigger>
        <SelectContent className="max-h-72">
          <SelectItem value={NONE} className="text-muted-foreground">
            선택 안 함
          </SelectItem>
          <SelectSeparator />
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

/** 저장 줄 (design-system 5.11.1 `SectionSaveBar`): C-06 + [저장], 섹션 끝 오른쪽, sticky 아님 (G-66) */
function SectionSaveBar({
  dirty,
  saving,
  savedAt,
  announce,
  onSave,
}: {
  dirty: boolean
  saving: boolean
  savedAt: Date | null
  announce: string
  onSave: () => void
}) {
  return (
    <div className="flex items-center justify-end gap-3 pt-2">
      <p className="flex items-center gap-1.5 text-sm text-muted-foreground" aria-live="polite">
        {!saving && savedAt ? (
          <>
            <Check className="size-3.5 text-success" aria-hidden />
            <span className="tabular-nums">저장됨 {formatTime(savedAt)}</span>
            <span className="sr-only">{announce}</span>
          </>
        ) : null}
      </p>
      <Button type="button" onClick={onSave} disabled={!dirty || saving}>
        {saving ? <Loader2 className="animate-spin" aria-hidden /> : null}
        {saving ? "저장 중…" : "저장"}
      </Button>
    </div>
  )
}
