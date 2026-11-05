import type { Education, EducationType, EnrollmentStatus } from "@/types/db"

/**
 * ED-7 (UX v5.10 C-22·S-34): 교육 추가·수정은 구분·상태를 입력받지 않는다. S-08 추가·수정 모달이 쓴다(예전 S-34 폼은 2026-11-05 삭제).
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
