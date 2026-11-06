/**
 * S-24 ① "내 정보" 폼 모델 (pure, unit-tested): 폼 값 ↔ DTO, 저장 페이로드(섹션 전체 덮어쓰기),
 * dirty 판정, 화면 검증(UX S-24 ① 검증 문구), 서버 `details.field` → 칸 매핑.
 */
import { PROFILE_LIMITS, type ProfileBasicsDto } from "@/lib/contracts/profile"

export interface PairRow {
  key: string
  jobFamily: string | null
  jobRole: string | null
}

export interface ProfileFormValues {
  displayName: string
  jobSearchStatus: string | null
  interestedCompanyType: string | null
  interestedIndustry: string | null
  pairs: PairRow[]
  schoolName: string
  degree: string | null
  status: string | null
  startYear: string | null
  startMonth: string | null
  endYear: string | null
  endMonth: string | null
  major: string
  gpa: string
}

export type FieldKey =
  | "displayName"
  | "jobSearchStatus"
  | "interestedCompanyType"
  | "interestedIndustry"
  | "schoolName"
  | "degree"
  | "status"
  | "period"
  | "major"
  | "gpa"

/** focus targets (the first control of each field) */
export const FIELD_ID: Record<FieldKey, string> = {
  displayName: "pb-name",
  jobSearchStatus: "pb-job-search-status",
  interestedCompanyType: "pb-company-type",
  interestedIndustry: "pb-industry",
  schoolName: "pb-school",
  degree: "pb-degree",
  status: "pb-grad-status",
  period: "pb-start-year",
  major: "pb-major",
  gpa: "pb-gpa",
}
export const FIELD_ORDER: FieldKey[] = [
  "displayName",
  "jobSearchStatus",
  "interestedCompanyType",
  "interestedIndustry",
  "schoolName",
  "degree",
  "status",
  "period",
  "major",
  "gpa",
]

export const LABELS: Record<FieldKey, string> = {
  displayName: "이름",
  jobSearchStatus: "구직 상태",
  interestedCompanyType: "관심 기업군",
  interestedIndustry: "관심 산업",
  schoolName: "학교 명",
  degree: "학위",
  status: "졸업 상태",
  period: "기간",
  major: "전공",
  gpa: "학점",
}

/** server `details.field` (column names / pair paths) → form field (DM §7, R13 api notes §1) */
export const SERVER_FIELD: Record<string, FieldKey> = {
  display_name: "displayName",
  job_search_status: "jobSearchStatus",
  interested_company_type: "interestedCompanyType",
  interested_industry: "interestedIndustry",
  highest_education_school_name: "schoolName",
  highest_education_degree: "degree",
  highest_education_status: "status",
  highest_education_start_month: "period",
  highest_education_end_month: "period",
  highest_education_major: "major",
  highest_education_gpa: "gpa",
}

let pairSeq = 0
export const newPair = (jobFamily: string | null = null, jobRole: string | null = null): PairRow => ({
  key: `pair-${(pairSeq += 1)}`,
  jobFamily,
  jobRole,
})

export function fromDto(p: ProfileBasicsDto): ProfileFormValues {
  const e = p.highestEducation
  const pairs = [...p.jobInterests].sort((a, b) => a.sortOrder - b.sortOrder).map((j) => newPair(j.jobFamily, j.jobRole))
  return {
    displayName: p.displayName ?? "",
    jobSearchStatus: p.jobSearchStatus,
    interestedCompanyType: p.interestedCompanyType,
    interestedIndustry: p.interestedIndustry,
    // 쌍이 0개면 빈 행 1개 (UX S-24 ① 빈 상태 `[가정]`)
    pairs: pairs.length ? pairs : [newPair()],
    schoolName: e.schoolName ?? "",
    degree: e.degree,
    status: e.status,
    startYear: e.startMonth?.slice(0, 4) ?? null,
    startMonth: e.startMonth ? String(Number(e.startMonth.slice(5, 7))) : null,
    endYear: e.endMonth?.slice(0, 4) ?? null,
    endMonth: e.endMonth ? String(Number(e.endMonth.slice(5, 7))) : null,
    major: e.major ?? "",
    gpa: e.gpa ?? "",
  }
}

export const ym = (y: string | null, m: string | null) => (y && m ? `${y}-${m.padStart(2, "0")}` : null)
export const textOrNull = (t: string) => (t.trim() ? t.trim() : null)
export const filledPairs = (v: ProfileFormValues) =>
  v.pairs.filter((p) => p.jobFamily).map((p) => ({ jobFamily: p.jobFamily as string, jobRole: p.jobRole }))

/**
 * 보낸 위치 → 화면 행 (QA-42-02): 저장은 직군 없는 빈 행을 빼고 보내므로, 서버의 1-based 위치 n은 보낸 목록 기준이다.
 * `sentPairRows(v)[n - 1]` = 그 쌍의 화면 행 index. 저장 직전 값으로 만든다.
 */
export function sentPairRows(v: ProfileFormValues): number[] {
  return v.pairs.flatMap((p, i) => (p.jobFamily ? [i] : []))
}

/**
 * 서버 `details`(`sortOrder` 또는 `field = "job_interests.{n}"`) → 화면 행 index. 위치가 없으면(쌍의
 * `invalid_profile_option`은 `job_family`/`job_role`만 준다) 보낸 첫 쌍의 행 [UI-가정].
 */
export function pairRowOf(details: Record<string, unknown> | null | undefined, sentRows: readonly number[]): number {
  const field = typeof details?.field === "string" ? details.field : null
  const n =
    typeof details?.sortOrder === "number" ? details.sortOrder : field?.startsWith("job_interests.") ? Number(field.split(".")[1]) : NaN
  if (Number.isInteger(n) && n >= 1 && sentRows[n - 1] !== undefined) return sentRows[n - 1]
  return sentRows[0] ?? 0
}

/** what the save sends (and what dirty compares) */
export function payloadOf(v: ProfileFormValues) {
  return {
    values: {
      displayName: textOrNull(v.displayName),
      jobSearchStatus: v.jobSearchStatus,
      interestedCompanyType: v.interestedCompanyType,
      interestedIndustry: v.interestedIndustry,
      highestEducation: {
        schoolName: textOrNull(v.schoolName),
        degree: v.degree,
        status: v.status,
        startMonth: ym(v.startYear, v.startMonth),
        endMonth: ym(v.endYear, v.endMonth),
        major: textOrNull(v.major),
        gpa: textOrNull(v.gpa),
      },
    },
    jobInterests: filledPairs(v),
  }
}

export function sameValues(a: ProfileFormValues, b: ProfileFormValues): boolean {
  // half-filled periods count as a change too (they are blocked at save time)
  const raw = (v: ProfileFormValues) => [v.startYear, v.startMonth, v.endYear, v.endMonth]
  return JSON.stringify([payloadOf(a), raw(a)]) === JSON.stringify([payloadOf(b), raw(b)])
}

export function isEmpty(v: ProfileFormValues): boolean {
  const { values: p, jobInterests } = payloadOf(v)
  const e = p.highestEducation
  return (
    jobInterests.length === 0 &&
    [p.displayName, p.jobSearchStatus, p.interestedCompanyType, p.interestedIndustry, e.schoolName, e.degree, e.status, e.startMonth, e.endMonth, e.major, e.gpa].every(
      (x) => x === null,
    )
  )
}

export type Errors = Partial<Record<FieldKey, string | true>>

export function validate(v: ProfileFormValues): Errors {
  const errors: Errors = {}
  // 검증 문구 (UX S-24 ① `[가정]`, 길이 상한 DM v4.12)
  if (v.displayName.trim().length > PROFILE_LIMITS.displayName) errors.displayName = "이름은 50자까지 쓸 수 있어요"
  if (v.schoolName.trim().length > PROFILE_LIMITS.schoolName) errors.schoolName = "학교 명은 100자까지 쓸 수 있어요"
  if (v.major.trim().length > PROFILE_LIMITS.major) errors.major = "전공은 100자까지 쓸 수 있어요"
  if (v.gpa.trim().length > PROFILE_LIMITS.gpa) errors.gpa = "학점은 20자까지 쓸 수 있어요"
  const half = (y: string | null, m: string | null) => Boolean(y) !== Boolean(m)
  if (half(v.startYear, v.startMonth) || half(v.endYear, v.endMonth)) {
    // [UI-가정] 연도·월 중 하나만 고른 경우: 문구가 없어 묶음 강조만 (design-system 5.11.1, P-25)
    errors.period = true
  } else {
    const start = ym(v.startYear, v.startMonth)
    const end = ym(v.endYear, v.endMonth)
    if (start && end && end < start) errors.period = "종료 시점이 시작보다 앞설 수 없어요"
  }
  return errors
}

