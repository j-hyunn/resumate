import type { Education, EducationType, EnrollmentStatus } from "@/types/db"
import { periodPatch } from "@/lib/data/row-save"
import { monthText, nn, type ConflictField } from "./form-parts"

/**
 * ED-7 (UX v5.10 C-22·S-34): 교육 추가·수정은 구분·상태를 입력받지 않는다. S-08 모달과 예전 S-34 폼이 같이 쓴다.
 * - 구분: 새 교육은 교육 과정(`course`), 수정이면 기존 값 유지 — 학위 과정은 화면에서 만들 수 없다.
 * - 상태: 진행 중이면 `enrolled`. 아니면 기존의 진행 중이 아닌 상태(수료·중퇴 등)를 유지하고, 없으면 종료월이 있을 때 `completed`.
 */
type Prev = Pick<Education, "education_type" | "enrollment_status"> | null | undefined

export function educationTypeOnSave(prev: Prev): EducationType {
  return prev?.education_type ?? "course"
}

export function enrollmentStatusOnSave(ongoing: boolean, endMonth: string | null, prev: Prev): EnrollmentStatus | null {
  if (ongoing) return "enrolled"
  const kept = prev?.enrollment_status && prev.enrollment_status !== "enrolled" ? prev.enrollment_status : null
  return kept ?? (endMonth ? "completed" : null)
}

/** S-34 form values (the old `/career/educations/*` form) */
export interface EducationValues {
  institution_name: string
  program_name: string
  start_month: string | null
  end_month: string | null
  /** 진행 중 = `enrollment_status` `enrolled` (ED-7: 상태는 입력받지 않는다) */
  ongoing: boolean
  description: string
}
export function toValues(e: Education | null): EducationValues {
  return {
    institution_name: e?.institution_name ?? "",
    program_name: e?.program_name ?? "",
    start_month: e?.start_month ?? null,
    end_month: e?.end_month ?? null,
    ongoing: e?.enrollment_status === "enrolled",
    description: e?.description ?? "",
  }
}

/** C-24 충돌 비교 — 라벨은 입력 라벨과 같다(ED-6) */
export function conflictFields(v: EducationValues): ConflictField[] {
  return [
    { label: "교육 명", value: v.program_name },
    { label: "운영 기관", value: v.institution_name },
    { label: "시작", value: monthText(v.start_month) },
    { label: "종료", value: v.ongoing ? "진행 중" : monthText(v.end_month) },
    { label: "설명", value: v.description },
  ]
}

/**
 * The patch the form sends. `prev` = the row the form works from (null for a new education): 구분 and a non-ongoing
 * 상태 are kept from it (ED-7). UQ-702: "진행 중" clears the end month.
 */
export function educationPatch(v: EducationValues, prev: Pick<Education, "education_type" | "enrollment_status"> | null) {
  const end = v.ongoing ? null : v.end_month
  return {
    institution_name: nn(v.institution_name),
    education_type: educationTypeOnSave(prev),
    program_name: nn(v.program_name),
    ...periodPatch(v.start_month, end),
    enrollment_status: enrollmentStatusOnSave(v.ongoing, end, prev),
    description: nn(v.description),
  }
}
