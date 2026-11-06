import { describe, expect, it } from "vitest"
import type { ProfileBasicsDto } from "@/lib/contracts/profile"
import {
  FIELD_ID,
  PERIOD_PARTIAL_SR_TEXT,
  fromDto,
  isEmpty,
  pairRowOf,
  payloadOf,
  periodErrorA11y,
  sameValues,
  sentPairRows,
  validate,
} from "./profile-basics-model"

const dto = (over: Partial<ProfileBasicsDto> = {}): ProfileBasicsDto => ({
  updatedAt: "2026-11-05T00:00:00.000Z",
  displayName: "김지우",
  jobSearchStatus: "employed_considering",
  interestedCompanyType: null,
  interestedIndustry: "b2b_saas",
  highestEducation: { schoolName: "한국대학교", degree: "bachelor", status: "graduated", startMonth: "2012-03", endMonth: "2018-02", major: null, gpa: "3.8/4.5" },
  jobInterests: [
    { sortOrder: 2, jobFamily: "product_planning", jobRole: null },
    { sortOrder: 1, jobFamily: "engineering", jobRole: "backend" },
  ],
  ...over,
})

describe("profile basics model (S-24 ①)", () => {
  it("round-trips the DTO into the save payload (pairs in sort_order, 'YYYY-MM', trimmed text)", () => {
    const v = fromDto(dto())
    const p = payloadOf({ ...v, displayName: "  김지우 " })
    expect(p.values.displayName).toBe("김지우")
    expect(p.values.highestEducation.startMonth).toBe("2012-03")
    expect(p.values.highestEducation.endMonth).toBe("2018-02")
    expect(p.jobInterests).toEqual([
      { jobFamily: "engineering", jobRole: "backend" },
      { jobFamily: "product_planning", jobRole: null },
    ])
  })

  it("shows one empty pair row when there are no pairs, and does not send it", () => {
    const v = fromDto(dto({ jobInterests: [] }))
    expect(v.pairs).toHaveLength(1)
    expect(payloadOf(v).jobInterests).toEqual([])
  })

  it("dirty = differs from the last saved values (whitespace-only edits are not changes)", () => {
    const saved = fromDto(dto())
    expect(sameValues({ ...saved, displayName: "김지우 " }, saved)).toBe(true)
    expect(sameValues({ ...saved, interestedIndustry: null }, saved)).toBe(false)
    expect(sameValues({ ...saved, startMonth: null }, saved)).toBe(false)
  })

  it("isEmpty only when every value is blank", () => {
    const blank = fromDto(
      dto({
        displayName: null,
        jobSearchStatus: null,
        interestedIndustry: null,
        highestEducation: { schoolName: null, degree: null, status: null, startMonth: null, endMonth: null, major: null, gpa: null },
        jobInterests: [],
      }),
    )
    expect(isEmpty(blank)).toBe(true)
    expect(isEmpty(fromDto(dto()))).toBe(false)
  })

  it("validates lengths and the period with the UX copy", () => {
    const v = fromDto(dto())
    expect(validate({ ...v, displayName: "가".repeat(51) }).displayName).toBe("이름은 50자까지 쓸 수 있어요")
    expect(validate({ ...v, schoolName: "가".repeat(101) }).schoolName).toBe("학교 명은 100자까지 쓸 수 있어요")
    expect(validate({ ...v, major: "가".repeat(101) }).major).toBe("전공은 100자까지 쓸 수 있어요")
    expect(validate({ ...v, gpa: "1".repeat(21) }).gpa).toBe("학점은 20자까지 쓸 수 있어요")
    expect(validate({ ...v, endYear: "2010" }).period).toBe("종료 시점이 시작보다 앞설 수 없어요")
    // 연도만 고른 경우: 문구 없이 묶음 강조만 [UI-가정]
    expect(validate({ ...v, endMonth: null }).period).toBe(true)
    expect(validate(v)).toEqual({})
  })

  it("maps a server pair position (sent list, 1-based) back to the screen row — empty rows are not sent (QA-42-02)", () => {
    const v = fromDto(dto())
    // 1행 빈 칸 + 2행 값
    const rows = { ...v, pairs: [{ key: "a", jobFamily: null, jobRole: null }, { key: "b", jobFamily: "engineering", jobRole: "backend" }] }
    const sent = sentPairRows(rows)
    expect(sent).toEqual([1])
    expect(pairRowOf({ field: "job_interests.1", sortOrder: 1 }, sent)).toBe(1)
    expect(pairRowOf({ field: "job_interests.1" }, sent)).toBe(1)
    // 위치 없는 쌍 오류 (job_family / job_role) → 보낸 첫 쌍의 행
    expect(pairRowOf({ field: "job_role", fields: ["job_role"] }, sent)).toBe(1)
    // 둘 다 보낸 경우: 두 번째 위치 = 두 번째 행
    expect(pairRowOf({ sortOrder: 2 }, sentPairRows(v))).toBe(1)
  })

  it("period cell: a partial period (year without month) is invalid and described for screen readers (QA-43-03)", () => {
    const partial = validate({ ...fromDto(dto()), startYear: "2012", startMonth: null })
    expect(partial.period).toBe(true)
    expect(periodErrorA11y(partial.period)).toEqual({
      invalid: true,
      describedBy: `${FIELD_ID.period}-error`,
      message: undefined,
      srMessage: PERIOD_PARTIAL_SR_TEXT,
    })
    expect(FIELD_ID.period).toBe("pb-period")
    const reversed = periodErrorA11y("종료 시점이 시작보다 앞설 수 없어요")
    expect(reversed).toMatchObject({ invalid: true, message: "종료 시점이 시작보다 앞설 수 없어요", srMessage: undefined })
    expect(periodErrorA11y(undefined)).toMatchObject({ invalid: false, describedBy: undefined })
  })
})
