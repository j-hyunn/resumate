/**
 * ED-6·ED-7 (UX v5.10 C-22·S-34): 교육 추가·수정은 구분·상태를 입력받지 않는다. S-08 모달(`add-career-dialog.tsx`)과
 * 예전 S-34 폼(`education-form.tsx`)이 같은 규칙을 쓰는지, 폼 라벨이 모달과 같은지 본다.
 */
import { readFileSync } from "node:fs"
import { join } from "node:path"
import { describe, expect, it } from "vitest"
import type { Education } from "@/types/db"
import { conflictFields, educationPatch, educationTypeOnSave, enrollmentStatusOnSave, toValues } from "./education-derive"

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

describe("S-34 form (ED-6·ED-7)", () => {
  it("a new education can't become a degree program; 진행 중 clears the end month", () => {
    const v = { ...toValues(null), institution_name: "코드스쿨", program_name: "백엔드 부트캠프", start_month: "2024-01-01", end_month: "2024-06-01", ongoing: true }
    expect(educationPatch(v, null)).toMatchObject({ education_type: "course", enrollment_status: "enrolled", end_month: null, institution_name: "코드스쿨", program_name: "백엔드 부트캠프" })
  })

  it("an edit keeps 구분 and a stored 상태", () => {
    const prev = row({})
    expect(educationPatch(toValues(prev), prev)).toMatchObject({ education_type: "degree", enrollment_status: "graduated", end_month: "2017-06-01" })
  })

  it("toValues reads 진행 중 from enrolled", () => {
    expect(toValues(row({ enrollment_status: "enrolled" })).ongoing).toBe(true)
    expect(toValues(row({})).ongoing).toBe(false)
  })

  it("C-24 conflict labels use the new names and have no 구분·상태", () => {
    const labels = conflictFields(toValues(row({}))).map((f) => f.label)
    expect(labels).toEqual(["교육 명", "운영 기관", "시작", "종료", "설명"])
    expect(conflictFields(toValues(row({ enrollment_status: "enrolled" }))).find((f) => f.label === "종료")?.value).toBe("진행 중")
  })

  it("the form source has the modal's labels and no 구분·상태 inputs (source guard, no render harness)", () => {
    const src = readFileSync(join(process.cwd(), "src/components/career/education-form.tsx"), "utf8")
    expect(src).toContain('label="교육 명"')
    expect(src).toMatch(/label="운영 기관" required/)
    expect(src).not.toMatch(/기관명|전공\/과정명|RadioGroup|edu-status|EDUCATION_TYPE_LABELS|ENROLLMENT_STATUS_LABELS/)
  })
})
