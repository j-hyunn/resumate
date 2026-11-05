/**
 * 설정 "내 정보" 데이터 계층 (S-24 ① 계정 탭, 04 §2.1.1·2.1.2·§7, R13). Server only.
 *
 * 조회 = `profiles` + `profile_job_interests` + `profile_options`(라벨), 저장 = RPC
 * `save_profile_basics` 하나(섹션 전체 덮어쓰기). `?state=` 미리보기는 mock store의
 * `profiles` 행 + 코드 목록으로 같은 모양을 만든다.
 *
 * S-24 재구현은 `resumate-ui` 몫이다 — 이 모듈은 그 화면이 쓸 계약을 먼저 둔다.
 */
import type {
  ProfileBasicsDto,
  ProfileBasicsViewDto,
  ProfileOptionDto,
  SaveProfileBasicsInput,
  SaveProfileBasicsResult,
} from "@/lib/contracts/profile"
import { MAX_JOB_INTERESTS } from "@/lib/contracts/profile"
import * as profileActions from "@/server/actions/profile"
import { previewOr, unwrap } from "./source"
import { mockRequest } from "@/lib/mock/store"

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

/** S-24 ① 조회. */
export async function getProfileBasics(): Promise<ProfileBasicsViewDto> {
  return previewOr(
    async () => {
      // 미리보기: mock store에는 아직 내 정보 새 컬럼·쌍·코드 표가 없다 (src/lib/mock은 UI 소유).
      const db = await mockRequest()
      const row = db.profiles[0]
      return { profile: emptyBasics(row?.updated_at ?? new Date().toISOString(), row?.display_name ?? null), options: [] }
    },
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
      const db = await mockRequest()
      const row = db.profiles[0]
      if (row) row.display_name = input.values.displayName ?? null
      return { updatedAt: row?.updated_at ?? new Date().toISOString() }
    },
    async () => unwrap(await profileActions.saveProfileBasics(input)),
  )
}
