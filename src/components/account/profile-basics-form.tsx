"use client"

/**
 * S-24 ① 계정 탭 "내 정보" (UX v5.17a S-24 ①, F-P1-01·F-P1-01a; design-system 5.11.1).
 *
 * 섹션 단위 저장: [저장] 하나로 이름 + 셀렉트 3 + 관심 직군·직무 쌍(최대 2) + 최종 학력 6칸을 한 번에
 * `save_profile_basics`로 보낸다(섹션 전체 덮어쓰기). 기대 버전 = 조회의 `profile.updatedAt`, 저장 응답의
 * `updatedAt`으로 갱신한다. 저장하지 않은 변경이 있으면 설정 다이얼로그가 닫기·탭 전환·회원 탈퇴 전에
 * 묻는다(`useSettingsGuard`). 입력은 임시 보존하지 않는다 — 다시 열면 늘 다시 읽는다.
 *
 * Parts: `SettingsFieldRow` (라벨 왼쪽 6rem 회색 + 칸 13rem h-8), `SectionSaveBar` (저장 줄 + 실패·충돌 줄),
 * `JobInterestRows` (쌍 행), `HighestEducationFields` (테두리 상자 하나 + `PeriodCell`). v5.12 원본 화면 맞춤:
 * 배치는 다이얼로그 본문의 컨테이너 쿼리(`@md/settings` 라벨 왼쪽 열, `@3xl/settings` 한 줄 두 쌍 · 학력 다섯 칸)로만 바꾼다.
 */
import * as React from "react"
import { Check, CircleAlert, Info, Loader2, Plus, TriangleAlert, X } from "lucide-react"
import { cn } from "@/lib/utils"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { InputGroupInput } from "@/components/ui/input-group"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectSeparator, SelectTrigger, SelectValue } from "@/components/ui/select"
import { MAX_JOB_INTERESTS, type ProfileOptionDto } from "@/lib/contracts/profile"
import type { ProfileBasicsViewDto } from "@/lib/contracts/profile"
import type { ProfileOptionCategory } from "@/lib/contracts/enums"
import { formatTime } from "@/lib/data/labels"
import { useSettingsGuard } from "@/components/common/shell/settings-guard"
import { SETTINGS_VISUAL_STYLE } from "@/components/common/shell/settings-visual"
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
  periodErrorA11y,
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
    <section aria-labelledby={SECTION_HEADING_ID} aria-describedby="settings-profile-desc" className="space-y-3">
      {/* v5.12: 안내는 섹션 머리 설명 줄 (AI 연결 탭 머리와 같은 모양, 아이콘 없음) */}
      <div className="space-y-0.5">
        <h3 id={SECTION_HEADING_ID} tabIndex={-1} className="text-base leading-6 font-semibold outline-none">
          내 정보
        </h3>
        <p id="settings-profile-desc" className="text-sm leading-5 text-muted-foreground">
          이 정보는 화면 표시와 Resumate 안 추천에만 써요. AI에는 보내지 않아요
        </p>
      </div>

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
              {/* 확정 2026-11-06 (사용자, UI42-3): 덮어쓰기 전 내가 고친 값을 경고 상자 안 목록으로 (G-72, P-26) */}
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

      {/* 칸 안 Enter로 제출되지 않게 (G-66). 칸 줄 사이 12px (화면 줄 간격 약 44 = 칸 32 + 12) */}
      <form noValidate onSubmit={(e) => e.preventDefault()} className="flex flex-col gap-3">
        <SettingsFieldRow id={FIELD_ID.displayName} label={LABELS.displayName} error={err("displayName")}>
          <Input
            id={FIELD_ID.displayName}
            className={FIELD_CONTROL}
            value={values.displayName}
            placeholder="이름을 입력해 주세요"
            onChange={(e) => update({ displayName: e.target.value })}
            aria-invalid={Boolean(err("displayName")) || undefined}
            aria-describedby={err("displayName") ? `${FIELD_ID.displayName}-error` : undefined}
          />
        </SettingsFieldRow>

        <SettingsFieldRow id={FIELD_ID.jobSearchStatus} label={LABELS.jobSearchStatus} error={err("jobSearchStatus")}>
          <OptionSelect
            id={FIELD_ID.jobSearchStatus}
            options={options}
            category="job_search_status"
            value={values.jobSearchStatus}
            onChange={(v) => update({ jobSearchStatus: v })}
            invalid={Boolean(err("jobSearchStatus"))}
          />
        </SettingsFieldRow>

        {/* 관심 기업군 | 관심 산업 — 본문 ≥ 768이면 한 줄에 두 쌍 (화면) */}
        <div className={PAIR_LINE}>
          <SettingsFieldRow pairSide="left" id={FIELD_ID.interestedCompanyType} label={LABELS.interestedCompanyType} error={err("interestedCompanyType")}>
            <OptionSelect
              id={FIELD_ID.interestedCompanyType}
              options={options}
              category="company_type"
              value={values.interestedCompanyType}
              onChange={(v) => update({ interestedCompanyType: v })}
              invalid={Boolean(err("interestedCompanyType"))}
            />
          </SettingsFieldRow>
          <SettingsFieldRow pairSide="right" id={FIELD_ID.interestedIndustry} label={LABELS.interestedIndustry} error={err("interestedIndustry")}>
            <OptionSelect
              id={FIELD_ID.interestedIndustry}
              options={options}
              category="industry"
              value={values.interestedIndustry}
              onChange={(v) => update({ interestedIndustry: v })}
              invalid={Boolean(err("interestedIndustry"))}
            />
          </SettingsFieldRow>
        </div>

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

/** 폼 칸 높이·폭 — 이 다이얼로그 전용 h-8 (다른 화면은 h-10). 본문 < 448이면 본문 폭 전체 (design-system 5.11.0) */
const FIELD_CONTROL = "h-8 w-full data-[size=default]:h-8"
/** 라벨+칸 두 쌍을 한 줄에 (본문 ≥ 768, 화면 배치). 그 아래는 두 줄 — 둘째 칸 x가 서로 맞도록 같은 gap */
const PAIR_LINE = "flex flex-col gap-3 @3xl/settings:flex-row @3xl/settings:items-start @3xl/settings:gap-x-11"
/** 칸 열 시작(라벨 열 6rem)에 맞춘 줄 */
const FIELD_COLUMN = "@md/settings:pl-24"

/**
 * `SettingsFieldRow` (design-system 5.11.1, v5.12): 라벨 왼쪽(6rem, 회색 본문 크기) · 칸 오른쪽(13rem) 한 줄.
 * 본문 < 448이면 라벨이 칸 위. `label` 없음 = 쌍 2행의 빈 라벨 칸 (칸 이름은 `aria-label`로).
 */
/**
 * 오류 줄 폭 (QA-43-05): 13rem 칸 열에 가두지 않고 칸 열 시작부터 본문 끝까지(`100cqw` = `@container/settings` 폭).
 * 한 줄 두 쌍(본문 ≥ 768)에서는 왼쪽 쌍은 오른쪽 쌍의 칸 시작 전까지, 오른쪽 쌍은 본문 끝까지.
 */
const ERROR_LINE_WIDTH = {
  single: "@md/settings:col-start-2 @md/settings:w-max @md/settings:max-w-[calc(100cqw-6rem)]",
  left: "@md/settings:col-start-2 @md/settings:w-max @md/settings:max-w-[calc(100cqw-6rem)] @3xl/settings:max-w-[20rem]",
  right: "@md/settings:col-start-2 @md/settings:w-max @md/settings:max-w-[calc(100cqw-6rem)] @3xl/settings:max-w-[calc(100cqw-27.75rem)]",
} as const

function SettingsFieldRow({
  id,
  label,
  error,
  pairSide,
  className,
  children,
}: {
  id: string
  label: string | null
  error?: string | true
  /** 한 줄 두 쌍(`PAIR_LINE`) 안에서의 자리 — 오류 줄 폭 계산용 */
  pairSide?: "left" | "right"
  className?: string
  children: React.ReactNode
}) {
  return (
    <div
      className={cn(
        "grid gap-1.5 @md/settings:grid-cols-[6rem_13rem] @md/settings:items-center @md/settings:gap-x-0 @md/settings:gap-y-1.5",
        className,
      )}
    >
      {label ? (
        <Label htmlFor={id} className="text-base leading-6 font-normal text-muted-foreground">
          {label}
        </Label>
      ) : (
        <span aria-hidden className="hidden @md/settings:block" />
      )}
      {children}
      <FieldErrorLine id={`${id}-error`} message={typeof error === "string" ? error : undefined} className={ERROR_LINE_WIDTH[pairSide ?? "single"]} />
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
  variant = "default",
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
  /** `cell` = 최종 학력 상자 안 칸 (테두리 없음, 화살표 없음) */
  variant?: "default" | "cell"
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
        variant={variant}
        className={variant === "cell" ? undefined : FIELD_CONTROL}
        aria-label={ariaLabel}
        aria-invalid={invalid || undefined}
        aria-describedby={invalid ? `${id}-error` : undefined}
      >
        <SelectValue placeholder={placeholder} />
      </SelectTrigger>
      <SelectContent className="max-h-72">
        {/* 확정 2026-11-06 (사용자, UI42-2): "선택 안 함" 항목 (G-65, P-25) */}
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
    <fieldset className="space-y-3" aria-describedby={tooMany ? TOO_MANY_ID : undefined} aria-invalid={tooMany || undefined}>
      {/* v5.12: 보이는 legend·열 머리 줄 없음 — 1행 라벨이 행 안에 있다 (화면) */}
      <legend className="sr-only">관심 직군 · 관심 직무</legend>
      <ol className="space-y-3">
        {rows.map((row, i) => {
          const n = i + 1
          const error = rowErrors[i]
          const errorId = `${pairFamilyId(n)}-error`
          return (
            <li key={row.key} className="space-y-1.5">
              <div className={PAIR_LINE}>
                {/* 2행은 라벨 칸만 비운다 (화면의 라벨 없는 셀렉트 줄) — 칸 이름은 aria-label */}
                <SettingsFieldRow pairSide="left" id={pairFamilyId(n)} label={n === 1 ? "관심 직군" : null}>
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
                </SettingsFieldRow>
                <div className="flex items-end gap-1 @md/settings:items-center">
                  <SettingsFieldRow pairSide="right" id={pairRoleId(n)} label={n === 1 ? "관심 직무" : null} className="min-w-0 flex-1 @md/settings:flex-none">
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
                  </SettingsFieldRow>
                  <Button
                    type="button"
                    variant="muted-ghost"
                    size="icon-sm"
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
                    <X className="size-4" aria-hidden />
                  </Button>
                </div>
              </div>
              <FieldErrorLine id={errorId} message={error} className={FIELD_COLUMN} />
            </li>
          )
        })}
      </ol>
      <div className={cn("flex flex-wrap items-center gap-2", FIELD_COLUMN)}>
        <Button
          id={ADD_PAIR_ID}
          type="button"
          variant="secondary"
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
      <FieldErrorLine id={TOO_MANY_ID} message={tooMany ? "관심 직군·직무는 최대 2개까지 고를 수 있어요" : undefined} className={FIELD_COLUMN} />
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

/** 학력 상자 아랫줄 칸 — 본문 ≥ 768이면 둘째 칸부터 왼쪽 세로 구분선 (화면, 높이 약 18px · 테두리보다 진한 회색) */
const EDU_CELL_DIVIDER =
  "@3xl/settings:pl-3 @3xl/settings:before:absolute @3xl/settings:before:top-1/2 @3xl/settings:before:left-0 @3xl/settings:before:h-4.5 @3xl/settings:before:w-px @3xl/settings:before:-translate-y-1/2 @3xl/settings:before:bg-muted-foreground/70"
/** 학력 상자 안 글자 칸 (InputGroupInput = 테두리·바탕 없음) */
const EDU_TEXT_CELL = "h-7 w-full px-0 text-base"

/**
 * 최종 학력 (design-system 5.11.1 `HighestEducationFields`, v5.12 — 테두리 상자 하나, 평면 6칸 DM v4.12).
 * 윗줄 학교 명(굵게), 아랫줄 학위 | 졸업 상태 | 기간 | 전공 | 학점. 칸마다 보이는 라벨이 없어 placeholder = 칸 이름,
 * 접근 이름은 aria-label — 확정 2026-11-06 (사용자, UI43-1) P-27 (UX 셀렉트 placeholder "선택해 주세요"의 예외). 칸 오류 문장은 상자 아래.
 */
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
  const msg = (k: FieldKey) => {
    const e = errors(k)
    return typeof e === "string" ? e : undefined
  }
  const textCell = (k: "schoolName" | "major" | "gpa") => ({
    id: FIELD_ID[k],
    value: values[k],
    placeholder: LABELS[k], // 확정 2026-11-06 (사용자, UI43-1) P-27
    "aria-label": LABELS[k],
    onChange: (e: React.ChangeEvent<HTMLInputElement>) => onChange({ [k]: e.target.value }),
    "aria-invalid": Boolean(errors(k)) || undefined,
    "aria-describedby": msg(k) ? `${FIELD_ID[k]}-error` : undefined,
  })
  return (
    <div className="grid gap-1.5 @md/settings:grid-cols-[6rem_minmax(0,1fr)] @md/settings:items-start">
      <span id="pb-edu-label" className="text-base leading-6 text-muted-foreground @md/settings:pt-2">
        최종 학력
      </span>
      <div className="min-w-0 space-y-1.5">
        <div
          role="group"
          aria-labelledby="pb-edu-label"
          className="rounded-control border border-input px-2.5 py-2 has-[[aria-invalid=true]]:border-destructive"
        >
          <InputGroupInput {...textCell("schoolName")} className={cn(EDU_TEXT_CELL, "font-semibold placeholder:font-semibold")} />
          <div className="grid grid-cols-2 gap-x-3 gap-y-1 @3xl/settings:grid-cols-[3fr_2fr_3fr_3fr_2fr] @3xl/settings:gap-x-0">
            <div className="relative min-w-0">
              <OptionSelect
                id={FIELD_ID.degree}
                variant="cell"
                placeholder={LABELS.degree}
                ariaLabel={LABELS.degree}
                options={options}
                category="degree"
                value={values.degree}
                onChange={(v) => onChange({ degree: v })}
                invalid={Boolean(errors("degree"))}
              />
            </div>
            <div className={cn("relative min-w-0", EDU_CELL_DIVIDER)}>
              <OptionSelect
                id={FIELD_ID.status}
                variant="cell"
                placeholder={LABELS.status}
                ariaLabel={LABELS.status}
                options={options}
                category="graduation_status"
                value={values.status}
                onChange={(v) => onChange({ status: v })}
                invalid={Boolean(errors("status"))}
              />
            </div>
            <div className={cn("relative col-span-2 min-w-0 @3xl/settings:col-span-1", EDU_CELL_DIVIDER)}>
              <PeriodCell values={values} error={errors("period")} onChange={onChange} />
            </div>
            <div className={cn("relative min-w-0", EDU_CELL_DIVIDER)}>
              <InputGroupInput {...textCell("major")} className={EDU_TEXT_CELL} />
            </div>
            <div className={cn("relative min-w-0", EDU_CELL_DIVIDER)}>
              <InputGroupInput {...textCell("gpa")} className={cn(EDU_TEXT_CELL, "tabular-nums")} />
            </div>
          </div>
        </div>
        {/* 칸 오류 줄 — 칸 순서대로, 상자 바로 아래 (칸이 좁아 칸 아래에 두지 않는다) */}
        <FieldErrorLine id={`${FIELD_ID.schoolName}-error`} message={msg("schoolName")} />
        <FieldErrorLine id={`${FIELD_ID.degree}-error`} message={msg("degree")} />
        <FieldErrorLine id={`${FIELD_ID.status}-error`} message={msg("status")} />
        <PeriodErrorLine error={errors("period")} />
        <FieldErrorLine id={`${FIELD_ID.major}-error`} message={msg("major")} />
        <FieldErrorLine id={`${FIELD_ID.gpa}-error`} message={msg("gpa")} />
        <p className="flex items-start gap-1.5 text-sm text-muted-foreground">
          <Info className="mt-0.5 size-4 shrink-0" aria-hidden />
          커리어의 교육과는 별개 값이에요. 한쪽을 고쳐도 다른 쪽은 바뀌지 않아요
        </p>
      </div>
    </div>
  )
}

/** 기간 오류 줄: 문구가 있으면 보이는 오류 줄, 연도·월 하나만 고른 경우(문구 없음, UI42-2)는 sr-only 문장 (QA-43-03) */
function PeriodErrorLine({ error }: { error: string | true | undefined }) {
  const a11y = periodErrorA11y(error)
  if (a11y.message) return <FieldErrorLine id={`${FIELD_ID.period}-error`} message={a11y.message} />
  if (a11y.srMessage)
    return (
      <p id={`${FIELD_ID.period}-error`} className="sr-only">
        {a11y.srMessage}
      </p>
    )
  return null
}

/**
 * 기간 칸 `PeriodCell` (design-system 5.11.1, v5.12): 화면의 "yyyy.mm - yyyy.mm" 한 칸. 누르면 팝오버 안에 연월 셀렉트 4개
 * (입력 방식은 UI42-2 그대로). 값 "2015.03 - 2019.02" — 기간 길이 "(N년 N개월)"은 칸이 좁아 생략 — 확정 2026-11-06 (사용자, UI43-2).
 * 오류·검증 포커스는 이 버튼으로 온다(`FIELD_ID.period`). 팝오버를 닫아도 값은 폼에 남는다(저장은 [저장]).
 */
function PeriodCell({
  values,
  error,
  onChange,
}: {
  values: ProfileFormValues
  error: string | true | undefined
  onChange: (patch: Partial<ProfileFormValues>) => void
}) {
  const a11y = periodErrorA11y(error)
  const invalid = a11y.invalid
  const side = (y: string | null, m: string | null) =>
    y || m ? (
      <span>{`${y ?? "yyyy"}.${m ? m.padStart(2, "0") : "mm"}`}</span>
    ) : (
      <span className="text-muted-foreground">yyyy.mm</span>
    )
  const empty = !values.startYear && !values.startMonth && !values.endYear && !values.endMonth
  return (
    <Popover>
      <PopoverTrigger asChild>
        {/* design-system 5.11.1: the period trigger carries aria-invalid (QA-43-03). ARIA 1.2 dropped it as a global
            attribute, but screen readers still announce it on a button, and this is the only control the error focuses. */}
        {/* eslint-disable-next-line jsx-a11y/role-supports-aria-props */}
        <button
          id={FIELD_ID.period}
          type="button"
          aria-label={LABELS.period}
          aria-invalid={invalid || undefined}
          aria-describedby={a11y.describedBy}
          className="flex h-7 w-full items-center gap-1 text-left text-base whitespace-nowrap tabular-nums outline-none focus-visible:underline focus-visible:decoration-ring focus-visible:underline-offset-4 aria-invalid:text-destructive aria-invalid:underline aria-invalid:decoration-destructive aria-invalid:underline-offset-4 [&[aria-invalid=true]_span]:text-destructive"
        >
          {/* 확정 2026-11-06 (사용자, UI43-1) P-27: 비었을 때 칸 이름 대신 형식 "yyyy.mm - yyyy.mm" (화면) */}
          {empty ? (
            <span className="text-muted-foreground">yyyy.mm - yyyy.mm</span>
          ) : (
            <>
              {side(values.startYear, values.startMonth)}
              <span aria-hidden>-</span>
              {side(values.endYear, values.endMonth)}
            </>
          )}
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-auto p-3" style={SETTINGS_VISUAL_STYLE}>
        <div className="space-y-2">
          <YearMonthSelect
            idPrefix="pb-start"
            label="기간 시작"
            caption="시작"
            year={values.startYear}
            month={values.startMonth}
            invalid={invalid}
            onChange={(startYear, startMonth) => onChange({ startYear, startMonth })}
          />
          <YearMonthSelect
            idPrefix="pb-end"
            label="기간 종료"
            caption="종료"
            year={values.endYear}
            month={values.endMonth}
            invalid={invalid}
            onChange={(endYear, endMonth) => onChange({ endYear, endMonth })}
          />
          <FieldErrorLine id={`${FIELD_ID.period}-popover-error`} message={a11y.message} />
        </div>
      </PopoverContent>
    </Popover>
  )
}

function YearMonthSelect({
  idPrefix,
  label,
  caption,
  year,
  month,
  invalid,
  onChange,
}: {
  idPrefix: string
  label: string
  caption: string
  year: string | null
  month: string | null
  invalid: boolean
  onChange: (year: string | null, month: string | null) => void
}) {
  const years = React.useMemo(() => yearList(), [])
  return (
    <div className="flex items-center gap-2">
      <span aria-hidden className="w-8 text-sm text-muted-foreground">
        {caption}
      </span>
      <Select value={year ?? ""} onValueChange={(v) => onChange(v === NONE ? null : v, month)}>
        <SelectTrigger
          id={`${idPrefix}-year`}
          className="h-8 w-24 data-[size=default]:h-8"
          aria-label={`${label} 연도`}
          aria-invalid={invalid || undefined}
        >
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
        <SelectTrigger
          id={`${idPrefix}-month`}
          className="h-8 w-20 data-[size=default]:h-8"
          aria-label={`${label} 월`}
          aria-invalid={invalid || undefined}
        >
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
    // v5.12: 내 정보 섹션 끝, 학력 상자 아래 오른쪽 (화면엔 [저장]이 없다 — UX 섹션 저장, G-80)
    <div className="flex items-center justify-end gap-3 pt-1">
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
