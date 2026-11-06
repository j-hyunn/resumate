/**
 * 설정 "내 정보" 데이터 계층 (S-24 ① 계정 탭, 04 §2.1.1·2.1.2·§7, R13). Server only.
 *
 * 조회 = `profiles` + `profile_job_interests` + `profile_options`(라벨), 저장 = RPC
 * `save_profile_basics` 하나(섹션 전체 덮어쓰기). `?state=` 미리보기(UI 42)는 mock store의
 * `profiles` 행 + `profile_job_interests` + `profile_options`(시드 101행)로 같은 모양을 만들고,
 * 저장도 RPC와 같은 오류 코드·`details` 모양으로 막는다.
 */
import type {
  ProfileBasicsDto,
  ProfileBasicsViewDto,
  ProfileOptionDto,
  SaveProfileBasicsInput,
  SaveProfileBasicsResult,
} from "@/lib/contracts/profile"
import { MAX_JOB_INTERESTS, PROFILE_LIMITS } from "@/lib/contracts/profile"
import * as profileActions from "@/server/actions/profile"
import { AppError } from "@/lib/contracts/errors"
import { previewOr, unwrap } from "./source"
import { clone, mockRequest } from "@/lib/mock/store"
import type { MockDb } from "@/lib/mock/fixtures"
import { nowIso } from "@/lib/mock/time"

export { MAX_JOB_INTERESTS }
export type { ProfileBasicsDto, ProfileBasicsViewDto, ProfileOptionDto, SaveProfileBasicsResult }

/** Options of one category in display order, active rows first (04 §2.1.1 `sort_order`). */
export function optionsOf(options: readonly ProfileOptionDto[], category: ProfileOptionDto["category"]): ProfileOptionDto[] {
  return options.filter((o) => o.category === category).sort((a, b) => a.sortOrder - b.sortOrder)
}

/** 직무 목록은 고른 직군에 속한 것만 (04 §2.1.2 상하 관계, PRD 9.7 (4)(5)). */
export function jobRolesOf(options: readonly ProfileOptionDto[], jobFamily: string | null): ProfileOptionDto[] {
  if (!jobFamily) return []
  return optionsOf(options, "job_role").filter((o) => o.parentCode === jobFamily)
}

/** Label of a stored code; falls back to the code itself when the row is missing. */
export function optionLabel(options: readonly ProfileOptionDto[], category: ProfileOptionDto["category"], code: string | null): string | null {
  if (!code) return null
  return options.find((o) => o.category === category && o.code === code)?.label ?? code
}

function emptyBasics(updatedAt: string, displayName: string | null): ProfileBasicsDto {
  return {
    updatedAt,
    displayName,
    jobSearchStatus: null,
    interestedCompanyType: null,
    interestedIndustry: null,
    highestEducation: { schoolName: null, degree: null, status: null, startMonth: null, endMonth: null, major: null, gpa: null },
    jobInterests: [],
  }
}

/** date column (그 달 1일) → `'YYYY-MM'` (DM-4, 서비스와 같은 규칙) */
const toMonth = (v: string | null): string | null => (v ? v.slice(0, 7) : null)
/** `'YYYY-MM'` → date column (그 달 1일) */
const fromMonth = (v: string | null | undefined): string | null => (v ? `${v}-01` : null)

function mockView(db: MockDb): ProfileBasicsViewDto {
  const row = db.profiles[0]
  if (!row) return { profile: emptyBasics(new Date().toISOString(), null), options: [] }
  return {
    profile: {
      updatedAt: row.updated_at,
      displayName: row.display_name,
      jobSearchStatus: row.job_search_status,
      interestedCompanyType: row.interested_company_type,
      interestedIndustry: row.interested_industry,
      highestEducation: {
        schoolName: row.highest_education_school_name,
        degree: row.highest_education_degree,
        status: row.highest_education_status,
        startMonth: toMonth(row.highest_education_start_month),
        endMonth: toMonth(row.highest_education_end_month),
        major: row.highest_education_major,
        gpa: row.highest_education_gpa,
      },
      jobInterests: [...db.profile_job_interests]
        .sort((a, b) => a.sort_order - b.sort_order)
        .map((j) => ({ sortOrder: j.sort_order, jobFamily: j.job_family, jobRole: j.job_role })),
    },
    options: db.profile_options.map((o) => ({
      category: o.category as ProfileOptionDto["category"],
      code: o.code,
      parentCode: o.parent_code,
      label: o.label,
      sortOrder: o.sort_order,
      isActive: o.is_active,
    })),
  }
}

/** S-24 ① 조회. */
export async function getProfileBasics(): Promise<ProfileBasicsViewDto> {
  return previewOr(
    async () => clone(mockView(await mockRequest())),
    async () => unwrap(await profileActions.getProfileBasics()),
  )
}

/**
 * S-24 ① [저장]. 오류 6종은 AppError의 `code`로 올라온다 —
 * `stale_write`(409) · `invalid_profile_option` · `field_too_long` ·
 * `invalid_period` · `too_many_job_interests` · `duplicate_job_interest`(400).
 */
export async function saveProfileBasics(input: SaveProfileBasicsInput): Promise<SaveProfileBasicsResult> {
  return previewOr(
    async () => {
      // 미리보기: 실제 경로와 같은 순서·모양으로 막는다 (QA-42-01) —
      // ① 서비스 checkJobInterests (쌍 수 → 쌍 중복, RPC보다 먼저) ② RPC save_profile_basics: stale_write →
      // field_too_long → invalid_period ③ 쓰기 트리거 validate_profile_options: profiles 코드(바뀐 값만
      // is_active 검사) → 쌍(job_family → job_role, details.field에 위치 없음 — 내려간 코드는 저장 전에 이 사용자가
      // 갖고 있던 코드면 통과, RPC가 넘기는 `resumate.held_job_codes`와 같은 판정).
      const db = await mockRequest()
      const row = db.profiles[0]
      if (!row) throw new AppError("not_found")
      const fieldError = (code: string, field: string) => new AppError(code, undefined, { details: { field, fields: [field] } })
      if (input.jobInterests.length > MAX_JOB_INTERESTS) throw new AppError("too_many_job_interests")
      const seen = new Set<string>()
      input.jobInterests.forEach((j, i) => {
        const key = `${j.jobFamily}\u0000${j.jobRole ?? ""}`
        if (seen.has(key))
          throw new AppError("duplicate_job_interest", undefined, { details: { field: `job_interests.${i + 1}`, sortOrder: i + 1 } })
        seen.add(key)
      })
      if (row.updated_at !== input.expectedUpdatedAt)
        throw new AppError("stale_write", undefined, { status: 409, details: { current_updated_at: row.updated_at } })
      const v = input.values
      const e = v.highestEducation
      const len = (t: string | null | undefined) => (t?.trim() ?? "").length
      if (len(v.displayName) > PROFILE_LIMITS.displayName) throw fieldError("field_too_long", "display_name")
      if (len(e.schoolName) > PROFILE_LIMITS.schoolName) throw fieldError("field_too_long", "highest_education_school_name")
      if (len(e.major) > PROFILE_LIMITS.major) throw fieldError("field_too_long", "highest_education_major")
      if (len(e.gpa) > PROFILE_LIMITS.gpa) throw fieldError("field_too_long", "highest_education_gpa")
      if (e.startMonth && e.endMonth && e.endMonth < e.startMonth) throw fieldError("invalid_period", "highest_education_end_month")
      const option = (category: string, code: string) => db.profile_options.find((o) => o.category === category && o.code === code)
      /** profile_option_check: 없는 코드는 늘 거부, 내려간 코드(is_active = false)는 새로 고를 때만 거부 */
      const check = (category: string, code: string | null | undefined, stored: string | null, field: string) => {
        if (!code) return
        const o = option(category, code)
        if (!o || (code !== stored && !o.is_active)) throw fieldError("invalid_profile_option", field)
      }
      check("job_search_status", v.jobSearchStatus, row.job_search_status, "job_search_status")
      check("company_type", v.interestedCompanyType, row.interested_company_type, "interested_company_type")
      check("industry", v.interestedIndustry, row.interested_industry, "interested_industry")
      check("degree", e.degree, row.highest_education_degree, "highest_education_degree")
      check("graduation_status", e.status, row.highest_education_status, "highest_education_status")
      // 쌍은 delete → insert라, 저장 전에 이 사용자가 갖고 있던 코드를 "이미 고른 값"으로 본다 (UI-42, DM 2.1.1)
      const heldPairs = db.profile_job_interests.filter((p) => p.user_id === row.id)
      const heldFamilies = new Set(heldPairs.map((p) => p.job_family))
      const heldRoles = new Set(heldPairs.flatMap((p) => (p.job_role ? [p.job_role] : [])))
      for (const j of input.jobInterests) {
        check("job_family", j.jobFamily, heldFamilies.has(j.jobFamily) ? j.jobFamily : null, "job_family")
        if (j.jobRole) {
          const r = option("job_role", j.jobRole)
          if (!r || (!heldRoles.has(j.jobRole) && !r.is_active) || r.parent_code !== j.jobFamily)
            throw fieldError("invalid_profile_option", "job_role")
        }
      }
      const trim = (t: string | null | undefined) => (t?.trim() ? t.trim() : null)
      Object.assign(row, {
        display_name: trim(v.displayName),
        job_search_status: v.jobSearchStatus ?? null,
        interested_company_type: v.interestedCompanyType ?? null,
        interested_industry: v.interestedIndustry ?? null,
        highest_education_school_name: trim(e.schoolName),
        highest_education_degree: e.degree ?? null,
        highest_education_status: e.status ?? null,
        highest_education_start_month: fromMonth(e.startMonth),
        highest_education_end_month: fromMonth(e.endMonth),
        highest_education_major: trim(e.major),
        highest_education_gpa: trim(e.gpa),
        updated_at: nowIso(),
      })
      db.profile_job_interests = input.jobInterests.map((j, i) => ({
        user_id: row.id,
        sort_order: i + 1,
        job_family: j.jobFamily,
        job_role: j.jobRole ?? null,
        created_at: row.updated_at,
      }))
      return { updatedAt: row.updated_at }
    },
    async () => unwrap(await profileActions.saveProfileBasics(input)),
  )
}
