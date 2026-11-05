/**
 * ED-7 (UX v5.10 C-22·S-34): 교육 추가·수정은 구분·상태를 입력받지 않는다 — S-08 모달(`add-career-dialog.tsx`)의 저장 규칙.
 */
import { describe, expect, it } from "vitest"
import type { Education } from "@/types/db"
import { educationTypeOnSave, enrollmentStatusOnSave } from "./education-derive"

const row = (over: Partial<Education>) =>
  ({ id: "e1", status: "complete", institution_name: "코드스쿨", program_name: "백엔드 부트캠프", education_type: "degree", start_month: "2017-03-01", end_month: "2017-06-01", enrollment_status: "graduated", description: null, updated_at: "2026-10-01T00:00:00Z", ...over }) as Education

describe("education 구분·상태 on save (ED-7)", () => {
  it("구분: a new education is course; an edit keeps the stored value (degree stays degree)", () => {
    expect(educationTypeOnSave(null)).toBe("course")
    expect(educationTypeOnSave(row({ education_type: "degree" }))).toBe("degree")
  })

  it("상태: 진행 중 → enrolled; otherwise keeps a stored non-ongoing status, else completed when an end month exists", () => {
    expect(enrollmentStatusOnSave(true, null, row({}))).toBe("enrolled")
    expect(enrollmentStatusOnSave(false, "2017-06-01", row({ enrollment_status: "dropped_out" }))).toBe("dropped_out")
    expect(enrollmentStatusOnSave(false, "2017-06-01", row({ enrollment_status: "enrolled" }))).toBe("completed")
    expect(enrollmentStatusOnSave(false, "2017-06-01", null)).toBe("completed")
    expect(enrollmentStatusOnSave(false, null, null)).toBeNull()
  })
})
