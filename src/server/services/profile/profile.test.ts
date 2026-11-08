import { describe, expect, it, vi } from "vitest";
import { SaveProfileBasicsInput } from "@/lib/contracts/profile";
import {
  checkJobInterests,
  getProfile,
  readUpdatedAt,
  saveProfileBasics,
  toJobInterestsJson,
  toProfileBasicsDto,
  toProfileDto,
  toProfileOptionDto,
  toProfileValuesJson,
  storedOptionCodes,
  updateProfile,
} from "./index";

/** R13: 내 정보 (DM 2.1.1·2.1.2·§7). */

const basicsRow = {
  updated_at: "2026-11-05T01:00:00.000Z",
  display_name: "홍길동",
  job_search_status: "employed_open_to_offers",
  interested_company_type: "startup_seed_series_a",
  interested_industry: "it_software_platform",
  highest_education_school_name: "한국대학교",
  highest_education_degree: "bachelor",
  highest_education_status: "graduated",
  highest_education_start_month: "2018-03-01",
  highest_education_end_month: "2022-02-01",
  highest_education_major: "컴퓨터공학",
  highest_education_gpa: "3.8/4.5",
};

const parse = (input: unknown) => {
  const parsed = SaveProfileBasicsInput.safeParse(input);
  if (!parsed.success) throw parsed.error;
  return parsed.data;
};

const validInput = {
  values: {
    displayName: " 홍길동 ",
    jobSearchStatus: "employed_open_to_offers",
    interestedCompanyType: null,
    interestedIndustry: null,
    highestEducation: {
      schoolName: "한국대학교",
      degree: "bachelor",
      status: "graduated",
      startMonth: "2018-03",
      endMonth: "2022-02",
      major: "",
      gpa: null,
    },
  },
  jobInterests: [{ jobFamily: "engineering", jobRole: "backend" }],
  expectedUpdatedAt: basicsRow.updated_at,
};

describe("profile basics mapping", () => {
  it("rows → dto, pairs sorted by sort_order", () => {
    const dto = toProfileBasicsDto(basicsRow, [
      { sort_order: 2, job_family: "product", job_role: null },
      { sort_order: 1, job_family: "engineering", job_role: "backend" },
    ]);
    expect(dto.updatedAt).toBe(basicsRow.updated_at);
    expect(dto.highestEducation).toMatchObject({ schoolName: "한국대학교", degree: "bachelor", gpa: "3.8/4.5" });
    // DB date → 'YYYY-MM' (DM-4)
    expect(dto.highestEducation).toMatchObject({ startMonth: "2018-03", endMonth: "2022-02" });
    expect(dto.jobInterests.map((i) => i.sortOrder)).toEqual([1, 2]);
    expect(dto.jobInterests[1]).toEqual({ sortOrder: 2, jobFamily: "product", jobRole: null });
  });

  it("stored codes include the pair codes (inactive labels stay readable)", () => {
    const dto = toProfileBasicsDto(basicsRow, [{ sort_order: 1, job_family: "engineering", job_role: null }]);
    expect(storedOptionCodes(dto)).toEqual([
      "employed_open_to_offers",
      "startup_seed_series_a",
      "it_software_platform",
      "bachelor",
      "graduated",
      "engineering",
    ]);
  });

  it("an option row of an unknown category is a program error", () => {
    expect(() =>
      toProfileOptionDto({ category: "nope", code: "x", parent_code: null, label: "x", sort_order: 1, is_active: true }),
    ).toThrow();
  });

  it("p_values carries every column name (섹션 전체 덮어쓰기)", () => {
    expect(toProfileValuesJson(parse(validInput).values)).toEqual({
      display_name: "홍길동",
      job_search_status: "employed_open_to_offers",
      interested_company_type: null,
      interested_industry: null,
      highest_education_school_name: "한국대학교",
      highest_education_degree: "bachelor",
      highest_education_status: "graduated",
      highest_education_start_month: "2018-03",
      highest_education_end_month: "2022-02",
      // "" → null (빈 칸은 비우기)
      highest_education_major: null,
      highest_education_gpa: null,
    });
  });

  it("p_job_interests keeps the order; sort_order is the RPC's job", () => {
    expect(toJobInterestsJson(parse(validInput).jobInterests)).toEqual([{ job_family: "engineering", job_role: "backend" }]);
  });

  it("reads { updated_at } or a bare timestamp", () => {
    expect(readUpdatedAt({ updated_at: basicsRow.updated_at })).toBe(basicsRow.updated_at);
    expect(readUpdatedAt(basicsRow.updated_at)).toBe(basicsRow.updated_at);
    expect(readUpdatedAt({})).toBeNull();
  });
});

describe("SaveProfileBasicsInput", () => {
  it("종료 < 시작 is refused before the RPC (invalid_period)", () => {
    const bad = { ...validInput, values: { ...validInput.values, highestEducation: { ...validInput.values.highestEducation, endMonth: "2017-03-01" } } };
    expect(SaveProfileBasicsInput.safeParse(bad).success).toBe(false);
  });
  it("months must be 1일 고정", () => {
    const bad = { ...validInput, values: { ...validInput.values, highestEducation: { ...validInput.values.highestEducation, startMonth: "2018-03-01" } } };
    expect(SaveProfileBasicsInput.safeParse(bad).success).toBe(false);
  });
  it("길이 상한 100 / 100 / 20", () => {
    const edu = validInput.values.highestEducation;
    const tooLong = (field: string, len: number) =>
      SaveProfileBasicsInput.safeParse({
        ...validInput,
        values: { ...validInput.values, highestEducation: { ...edu, [field]: "가".repeat(len) } },
      }).success;
    expect(tooLong("schoolName", 101)).toBe(false);
    expect(tooLong("major", 101)).toBe(false);
    expect(tooLong("gpa", 21)).toBe(false);
    expect(tooLong("gpa", 20)).toBe(true);
  });
});

describe("checkJobInterests", () => {
  it("3쌍 → too_many_job_interests", () => {
    const pair = (n: number) => ({ jobFamily: `fam_${n}`, jobRole: null });
    expect(() => checkJobInterests([pair(1), pair(2), pair(3)])).toThrowError(expect.objectContaining({ code: "too_many_job_interests" }));
  });
  it("같은 쌍 → duplicate_job_interest", () => {
    expect(() =>
      checkJobInterests([
        { jobFamily: "engineering", jobRole: "backend" },
        { jobFamily: "engineering", jobRole: "backend" },
      ]),
    ).toThrowError(expect.objectContaining({ code: "duplicate_job_interest" }));
  });
  it("직무를 비운 쌍끼리도 중복이다 (R-SD-18)", () => {
    expect(() =>
      checkJobInterests([
        { jobFamily: "engineering", jobRole: null },
        { jobFamily: "engineering", jobRole: null },
      ]),
    ).toThrowError(expect.objectContaining({ code: "duplicate_job_interest" }));
  });
  it("같은 직군 + 다른 직무는 통과", () => {
    expect(() =>
      checkJobInterests([
        { jobFamily: "engineering", jobRole: "backend" },
        { jobFamily: "engineering", jobRole: null },
      ]),
    ).not.toThrow();
  });
});

describe("saveProfileBasics", () => {
  const client = (result: { data: unknown; error: unknown }) => {
    const rpc = vi.fn().mockResolvedValue(result);
    return { client: { rpc } as unknown as Parameters<typeof saveProfileBasics>[0], rpc };
  };

  it("calls the RPC with the three arguments and returns updatedAt", async () => {
    const { client: c, rpc } = client({ data: { updated_at: "2026-11-05T02:00:00.000Z" }, error: null });
    await expect(saveProfileBasics(c, parse(validInput))).resolves.toEqual({ updatedAt: "2026-11-05T02:00:00.000Z" });
    expect(rpc).toHaveBeenCalledWith("save_profile_basics", {
      p_values: expect.objectContaining({ display_name: "홍길동" }),
      p_job_interests: [{ job_family: "engineering", job_role: "backend" }],
      p_expected_updated_at: basicsRow.updated_at,
    });
  });

  it("stale_write from the RPC keeps its code and the current version", async () => {
    const { client: c } = client({
      data: null,
      error: { code: "P0001", message: "stale_write", details: "2026-11-05T03:00:00.000Z" },
    });
    await expect(saveProfileBasics(c, parse(validInput))).rejects.toMatchObject({
      code: "stale_write",
      status: 409,
      details: { current_updated_at: "2026-11-05T03:00:00.000Z" },
    });
  });

  it("invalid_profile_option / field_too_long name the field", async () => {
    for (const message of ["invalid_profile_option", "field_too_long"]) {
      const { client: c } = client({ data: null, error: { code: "P0001", message, details: "highest_education_degree" } });
      await expect(saveProfileBasics(c, parse(validInput))).rejects.toMatchObject({
        code: message,
        details: { field: "highest_education_degree" },
      });
    }
  });

  // QA-R13-01: the RPC's raise detail is the pair's 1-based position; both paths must give the
  // same `details` shape so the screen can focus the row either way.
  it("duplicate_job_interest: the RPC path and the pre-check path give the same details", async () => {
    const { client: c } = client({ data: null, error: { code: "P0001", message: "duplicate_job_interest", details: "2" } });
    await expect(saveProfileBasics(c, parse(validInput))).rejects.toMatchObject({
      code: "duplicate_job_interest",
      status: 400,
      details: { field: "job_interests.2", sortOrder: 2 },
    });
    // same shape from the service's own check (2nd pair duplicates the 1st)
    try {
      checkJobInterests([
        { jobFamily: "engineering", jobRole: null },
        { jobFamily: "engineering", jobRole: null },
      ]);
      throw new Error("unreachable");
    } catch (err) {
      expect(err).toMatchObject({ code: "duplicate_job_interest", details: { field: "job_interests.2", sortOrder: 2 } });
    }
  });

  it("a raw 23505 on the pair table still becomes duplicate_job_interest", async () => {
    const { client: c } = client({
      data: null,
      error: { code: "23505", message: 'duplicate key value violates unique constraint "profile_job_interests_pair_key"' },
    });
    await expect(saveProfileBasics(c, parse(validInput))).rejects.toMatchObject({ code: "duplicate_job_interest" });
  });

  it("a 3rd pair never reaches the RPC", async () => {
    const { client: c, rpc } = client({ data: { updated_at: basicsRow.updated_at }, error: null });
    const input = parse({
      ...validInput,
      jobInterests: [
        { jobFamily: "a_fam", jobRole: null },
        { jobFamily: "b_fam", jobRole: null },
        { jobFamily: "c_fam", jobRole: null },
      ],
    });
    await expect(saveProfileBasics(c, input)).rejects.toMatchObject({ code: "too_many_job_interests" });
    expect(rpc).not.toHaveBeenCalled();
  });
});

describe("legacy S-04 path (display_name only)", () => {
  function fakeClient(result: { data: unknown; error: unknown }) {
    const chain = {
      select: vi.fn().mockReturnThis(),
      update: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      maybeSingle: vi.fn().mockResolvedValue(result),
    };
    const from = vi.fn().mockReturnValue(chain);
    return { client: { from } as unknown as Parameters<typeof getProfile>[0], from, chain };
  }
  const row = { id: "11111111-1111-4111-8111-111111111111", display_name: "홍길동", career_data_updated_at: null };

  it("row → dto without the dropped columns", () => {
    expect(toProfileDto(row)).toEqual({ id: row.id, displayName: "홍길동", careerDataUpdatedAt: null });
  });
  it("updates only display_name", async () => {
    const { client, chain } = fakeClient({ data: { ...row, display_name: "김" }, error: null });
    await expect(updateProfile(client, { id: row.id }, { displayName: "김" })).resolves.toMatchObject({ displayName: "김" });
    expect(chain.update).toHaveBeenCalledWith({ display_name: "김" });
  });
  it("missing row → not_found", async () => {
    const { client } = fakeClient({ data: null, error: null });
    await expect(getProfile(client, { id: row.id })).rejects.toMatchObject({ code: "not_found" });
  });
});
