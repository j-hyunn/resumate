import { describe, expect, it } from "vitest";
import {
  AddManualSkillInput,
  AddProjectSkillInput,
  DataReadiness,
  DeleteCareerItemInput,
  DeletionImpactInput,
  ReorderProjectDetailsInput,
  SaveAchievementInput,
  SaveEducationInput,
  SaveExperienceInput,
  SaveProjectDetailInput,
  SaveProjectInput,
  UpdateSkillInput,
  dateToYearMonth,
  normalizeSkillName,
  yearMonthToDate,
} from "./career";

const ID = "6f1c1d2e-8a4b-4c3d-9e2f-1a2b3c4d5e6f";
const ID2 = "7a2d2e3f-9b5c-4d4e-8f30-2b3c4d5e6f70";

describe("year-month", () => {
  it("round-trips YYYY-MM ↔ first-of-month date", () => {
    expect(yearMonthToDate("2024-03")).toBe("2024-03-01");
    expect(dateToYearMonth("2024-03-01")).toBe("2024-03");
    expect(dateToYearMonth(null)).toBeNull();
  });
  it("rejects bad months", () => {
    expect(() => yearMonthToDate("2024-13")).toThrow();
    expect(SaveExperienceInput.safeParse({ id: ID, startMonth: "2024-3" }).success).toBe(false);
    expect(SaveExperienceInput.safeParse({ id: ID, startMonth: "2024-03-01" }).success).toBe(false);
  });
});

describe("SaveExperienceInput", () => {
  it("accepts an empty draft (auto-save)", () => {
    expect(SaveExperienceInput.parse({ id: ID })).toEqual({ id: ID });
  });
  it("trims, turns '' into null, keeps omitted keys omitted", () => {
    expect(SaveExperienceInput.parse({ id: ID, companyName: "  회사 ", jobRank: "", startMonth: "" })).toEqual({
      id: ID,
      companyName: "회사",
      jobRank: null,
      startMonth: null,
    });
  });
  it("ignores status from the client", () => {
    expect(SaveExperienceInput.parse({ id: ID, status: "complete" })).toEqual({ id: ID });
  });
  it("rejects end before start and current-with-end", () => {
    expect(SaveExperienceInput.safeParse({ id: ID, startMonth: "2024-05", endMonth: "2024-04" }).success).toBe(false);
    expect(SaveExperienceInput.safeParse({ id: ID, isCurrent: true, endMonth: "2024-04" }).success).toBe(false);
    expect(SaveExperienceInput.safeParse({ id: ID, isCurrent: true, endMonth: null }).success).toBe(true);
  });
  it("checks employment_type and summary length", () => {
    expect(SaveExperienceInput.safeParse({ id: ID, employmentType: "part_time" }).success).toBe(false);
    expect(SaveExperienceInput.safeParse({ id: ID, summary: "가".repeat(2001) }).success).toBe(false);
    expect(SaveExperienceInput.safeParse({ id: ID, summary: "가".repeat(2000) }).success).toBe(true);
  });
  it("rejects a non-uuid id", () => {
    expect(SaveExperienceInput.safeParse({ id: "1" }).success).toBe(false);
  });
});

describe("save meta (QA-S2-01/02/03)", () => {
  it("id is required and client-generated", () => {
    expect(SaveExperienceInput.safeParse({ companyName: "x" }).success).toBe(false);
  });
  it("accepts any Postgres-style uuid (z.guid), not only RFC versions", () => {
    expect(SaveExperienceInput.safeParse({ id: "aaaaaaaa-1111-0000-0000-000000000001" }).success).toBe(true);
    expect(SaveExperienceInput.safeParse({ id: "not-a-uuid" }).success).toBe(false);
  });
  it("expectedUpdatedAt must be an ISO datetime with offset", () => {
    expect(SaveExperienceInput.safeParse({ id: ID, expectedUpdatedAt: "2026-10-25T02:57:38.123456+00:00" }).success).toBe(true);
    expect(SaveExperienceInput.safeParse({ id: ID, expectedUpdatedAt: "2026-10-25T02:57:38Z" }).success).toBe(true);
    expect(SaveExperienceInput.safeParse({ id: ID, expectedUpdatedAt: "yesterday" }).success).toBe(false);
    expect(SaveExperienceInput.safeParse({ id: ID, expectedUpdatedAt: "2026-10-25" }).success).toBe(false);
  });
  it("year-month is limited to 1900–2099", () => {
    expect(SaveExperienceInput.safeParse({ id: ID, startMonth: "0000-01" }).success).toBe(false);
    expect(SaveExperienceInput.safeParse({ id: ID, startMonth: "1899-12" }).success).toBe(false);
    expect(SaveExperienceInput.safeParse({ id: ID, startMonth: "1900-01" }).success).toBe(true);
    expect(SaveExperienceInput.safeParse({ id: ID, startMonth: "2099-12" }).success).toBe(true);
    expect(SaveExperienceInput.safeParse({ id: ID, startMonth: "2100-01" }).success).toBe(false);
  });
});

describe("SaveEducationInput", () => {
  it("enrolled cannot have an end month", () => {
    expect(SaveEducationInput.safeParse({ id: ID, enrollmentStatus: "enrolled", endMonth: "2024-02" }).success).toBe(false);
    expect(SaveEducationInput.safeParse({ id: ID, enrollmentStatus: "graduated", endMonth: "2024-02" }).success).toBe(true);
  });
  it("checks enum values and lengths", () => {
    expect(SaveEducationInput.safeParse({ id: ID, educationType: "bootcamp" }).success).toBe(false);
    expect(SaveEducationInput.safeParse({ id: ID, institutionName: "a".repeat(101) }).success).toBe(false);
  });
});

describe("SaveProjectInput", () => {
  it("affiliation is one of experience / education / none", () => {
    expect(SaveProjectInput.parse({ id: ID, affiliation: { type: "none" } })).toEqual({ id: ID, affiliation: { type: "none" } });
    expect(SaveProjectInput.safeParse({ id: ID, affiliation: { type: "experience", id: ID } }).success).toBe(true);
    expect(SaveProjectInput.safeParse({ id: ID, affiliation: { type: "experience" } }).success).toBe(false);
  });
  it("summary ≤ 200, team size positive int", () => {
    expect(SaveProjectInput.safeParse({ id: ID, summary: "a".repeat(201) }).success).toBe(false);
    expect(SaveProjectInput.safeParse({ id: ID, teamSize: 0 }).success).toBe(false);
    expect(SaveProjectInput.safeParse({ id: ID, teamSize: 2.5 }).success).toBe(false);
    expect(SaveProjectInput.safeParse({ id: ID, teamSize: null }).success).toBe(true);
  });
});

describe("SaveProjectDetailInput", () => {
  it("projectId is optional (needed only to create)", () => {
    expect(SaveProjectDetailInput.safeParse({ title: "t" }).success).toBe(false); // id is required
    expect(SaveProjectDetailInput.safeParse({ id: ID, projectId: ID2, title: "t" }).success).toBe(true);
    expect(SaveProjectDetailInput.safeParse({ id: ID, title: "t" }).success).toBe(true);
  });
  it("limits STAR fields to 2,000 chars and title to 100", () => {
    expect(SaveProjectDetailInput.safeParse({ id: ID, action: "a".repeat(2001) }).success).toBe(false);
    expect(SaveProjectDetailInput.safeParse({ id: ID, title: "a".repeat(101) }).success).toBe(false);
  });
});

describe("ReorderProjectDetailsInput", () => {
  it("rejects duplicates and empty lists", () => {
    expect(ReorderProjectDetailsInput.safeParse({ projectId: ID, orderedIds: [ID2, ID2] }).success).toBe(false);
    expect(ReorderProjectDetailsInput.safeParse({ projectId: ID, orderedIds: [] }).success).toBe(false);
    expect(ReorderProjectDetailsInput.safeParse({ projectId: ID, orderedIds: [ID2, ID] }).success).toBe(true);
  });
});

describe("SaveAchievementInput", () => {
  it("target is optional (needed only to create) and must be a detail or an experience", () => {
    expect(SaveAchievementInput.safeParse({ id: ID, description: "수상" }).success).toBe(true);
    expect(SaveAchievementInput.safeParse({ id: ID, target: { type: "experience", id: ID2 }, description: "수상" }).success).toBe(true);
    expect(SaveAchievementInput.safeParse({ id: ID, target: { type: "project", id: ID2 } }).success).toBe(false);
  });
  it("values are finite numbers", () => {
    expect(SaveAchievementInput.safeParse({ id: ID, valueBefore: Number.POSITIVE_INFINITY }).success).toBe(false);
    expect(SaveAchievementInput.safeParse({ id: ID, valueBefore: 1.5, valueAfter: null }).success).toBe(true);
  });
});

describe("skills", () => {
  it("normalizes names like the DB generated column", () => {
    expect(normalizeSkillName("  Type   Script ")).toBe("type script");
    expect(normalizeSkillName("React")).toBe(normalizeSkillName("react"));
  });
  it("cleans the display name and checks its length", () => {
    expect(AddProjectSkillInput.parse({ projectId: ID, name: "  Next.js  14 " }).name).toBe("Next.js 14");
    expect(AddProjectSkillInput.safeParse({ projectId: ID, name: "   " }).success).toBe(false);
    expect(AddManualSkillInput.safeParse({ name: "a".repeat(51) }).success).toBe(false);
    expect(AddManualSkillInput.safeParse({ name: "Go", proficiency: "guru" }).success).toBe(false);
  });
  it("update needs something to change", () => {
    expect(UpdateSkillInput.safeParse({ id: ID }).success).toBe(false);
    expect(UpdateSkillInput.safeParse({ id: ID, proficiency: null }).success).toBe(true);
  });
});

describe("deletion inputs", () => {
  it("default modes are keep_projects / keep_results", () => {
    expect(DeleteCareerItemInput.parse({ entityType: "experience", entityId: ID })).toEqual({
      entityType: "experience",
      entityId: ID,
      affiliationMode: "keep_projects",
      resultMode: "keep_results",
    });
  });
  it("writing_chat is not deletable in S2", () => {
    expect(DeletionImpactInput.safeParse({ entityType: "writing_chat", entityId: ID }).success).toBe(false);
  });
});

describe("DataReadiness", () => {
  it("parses the DM §6 example shape", () => {
    const sample = {
      counts: {
        complete_experiences: 1,
        complete_educations: 1,
        complete_projects: 0,
        projects_without_complete_detail: 1,
        complete_project_details: 0,
        draft_project_details: 1,
        draft_experiences: 0,
        draft_educations: 0,
        draft_projects: 1,
        profile_filled: true,
      },
      draft_item_ids: { experiences: [], educations: [], projects: [ID], project_details: [ID2] },
      features: {
        insight: {
          ready: false,
          missing: ["complete_project"],
          hints: ["complete_project_detail"],
          next_action: "writing_chat",
          suggested_mode: "augment_project",
          suggested_project_id: ID,
        },
        draft: { ready: false, missing: ["complete_project"], hints: [], next_action: "writing_chat", suggested_mode: "new_project" },
        job_interview: { ready: false, missing: ["complete_experience", "complete_project"], hints: [], next_action: "form" },
        culture_fit_interview: { ready: true, data_sufficiency: "thin" },
      },
    };
    expect(DataReadiness.safeParse(sample).success).toBe(true);
  });
  it("a ready feature needs no next_action", () => {
    const f = DataReadiness.shape.features.shape.insight;
    expect(f.safeParse({ ready: true }).success).toBe(true);
    expect(f.safeParse({ ready: false, missing: [], hints: [] }).success).toBe(false);
  });
});
