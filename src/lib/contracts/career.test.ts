import { describe, expect, it } from "vitest";
import {
  AddManualSkillInput,
  AddProjectSkillInput,
  DataReadiness,
  DeleteCareerItemInput,
  CreateProjectInput,
  DeletionImpactInput,
  ReorderDeliverablesInput,
  SaveDeliverableInput,
  SaveEducationInput,
  SaveExperienceInput,
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

describe("CreateProjectInput (C-23, CR-6)", () => {
  it("needs a name and an affiliation", () => {
    expect(CreateProjectInput.parse({ name: "  결제 개선 ", affiliation: { type: "none" } })).toEqual({ name: "결제 개선", affiliation: { type: "none" } });
    expect(CreateProjectInput.safeParse({ name: "   ", affiliation: { type: "none" } }).success).toBe(false);
    expect(CreateProjectInput.safeParse({ name: "a".repeat(101), affiliation: { type: "none" } }).success).toBe(false);
    expect(CreateProjectInput.safeParse({ name: "x" }).success).toBe(false);
    expect(CreateProjectInput.safeParse({ id: ID, name: "x", affiliation: { type: "experience", id: ID2 } }).success).toBe(true);
  });
});

describe("SaveProjectInput v4.4 (section saves)", () => {
  it("affiliation is one of experience / education / none; name can't be cleared", () => {
    expect(SaveProjectInput.parse({ id: ID, affiliation: { type: "none" } })).toEqual({ id: ID, affiliation: { type: "none" } });
    expect(SaveProjectInput.safeParse({ id: ID, affiliation: { type: "experience" } }).success).toBe(false);
    expect(SaveProjectInput.safeParse({ id: ID, name: "" }).success).toBe(false);
    expect(SaveProjectInput.safeParse({ id: ID, name: null }).success).toBe(false);
  });
  it("STAR ≤ 2,000, description ≤ 5,000, '' clears", () => {
    expect(SaveProjectInput.safeParse({ id: ID, action: "a".repeat(2001) }).success).toBe(false);
    expect(SaveProjectInput.parse({ id: ID, action: "" })).toEqual({ id: ID, action: null });
    expect(SaveProjectInput.safeParse({ id: ID, description: "a".repeat(5001) }).success).toBe(false);
    expect(SaveProjectInput.safeParse({ id: ID, description: "a".repeat(5000) }).success).toBe(true);
  });
  it("classification keys (CR-17): one type, one experience type, ≤ 3 distinct competencies", () => {
    expect(SaveProjectInput.safeParse({ id: ID, projectType: "improvement", experienceType: "problem_solving" }).success).toBe(true);
    expect(SaveProjectInput.safeParse({ id: ID, projectType: "unknown" }).success).toBe(false);
    expect(SaveProjectInput.safeParse({ id: ID, competencies: ["analysis", "execution", "planning"] }).success).toBe(true);
    expect(SaveProjectInput.safeParse({ id: ID, competencies: ["analysis", "execution", "planning", "leadership"] }).success).toBe(false);
    expect(SaveProjectInput.safeParse({ id: ID, competencies: ["analysis", "analysis"] }).success).toBe(false);
    expect(SaveProjectInput.safeParse({ id: ID, competencies: [] }).success).toBe(true);
  });
  it("is_current excludes an end month (CR-22); link must be http(s)", () => {
    expect(SaveProjectInput.safeParse({ id: ID, isCurrent: true, endMonth: "2024-04" }).success).toBe(false);
    expect(SaveProjectInput.safeParse({ id: ID, isCurrent: true, endMonth: null }).success).toBe(true);
    expect(SaveProjectInput.safeParse({ id: ID, linkUrl: "ftp://x" }).success).toBe(false);
    expect(SaveProjectInput.parse({ id: ID, linkUrl: "" })).toEqual({ id: ID, linkUrl: null });
    expect(SaveProjectInput.safeParse({ id: ID, linkUrl: "https://example.com/a" }).success).toBe(true);
  });
  it("summary / team size are gone (v4.4)", () => {
    expect(SaveProjectInput.parse({ id: ID, summary: "x", teamSize: 3 })).toEqual({ id: ID });
  });
});

describe("deliverables (S-44, CR-8)", () => {
  it("title 1..100, body ≤ 20,000", () => {
    expect(SaveDeliverableInput.safeParse({ id: ID, projectId: ID2, title: "기획서" }).success).toBe(true);
    expect(SaveDeliverableInput.safeParse({ id: ID, title: " " }).success).toBe(false);
    expect(SaveDeliverableInput.safeParse({ id: ID, title: "a".repeat(101) }).success).toBe(false);
    expect(SaveDeliverableInput.safeParse({ id: ID, body: "a".repeat(20001) }).success).toBe(false);
  });
  it("reorder: no duplicates, ≤ 50", () => {
    expect(ReorderDeliverablesInput.safeParse({ projectId: ID, orderedIds: [ID2, ID2] }).success).toBe(false);
    expect(ReorderDeliverablesInput.safeParse({ projectId: ID, orderedIds: [] }).success).toBe(false);
    expect(ReorderDeliverablesInput.safeParse({ projectId: ID, orderedIds: [ID2, ID] }).success).toBe(true);
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

describe("deletion inputs (DM §4.2 v4.4)", () => {
  it("default modes are delete_projects / keep_results; keep_projects is refused (CR-15)", () => {
    expect(DeleteCareerItemInput.parse({ entityType: "experience", entityId: ID })).toEqual({
      entityType: "experience",
      entityId: ID,
      affiliationMode: "delete_projects",
      resultMode: "keep_results",
    });
    expect(DeleteCareerItemInput.safeParse({ entityType: "experience", entityId: ID, affiliationMode: "keep_projects" }).success).toBe(false);
  });
  it("entity types: project_deliverable added; project_detail / achievement removed", () => {
    expect(DeletionImpactInput.safeParse({ entityType: "writing_chat", entityId: ID }).success).toBe(true);
    expect(DeletionImpactInput.safeParse({ entityType: "project_deliverable", entityId: ID }).success).toBe(true);
    expect(DeletionImpactInput.safeParse({ entityType: "project_detail", entityId: ID }).success).toBe(false);
    expect(DeletionImpactInput.safeParse({ entityType: "achievement", entityId: ID }).success).toBe(false);
  });
});

describe("DataReadiness (DM §6 v4.4)", () => {
  const sample = {
    ai_connection: { active_provider: "gemini", key_status: "valid", connection_tier: "free", consent_required: true },
    counts: {
      complete_experiences: 1,
      complete_educations: 1,
      complete_projects: 0,
      projects_without_complete_star: 1,
      standalone_projects_without_description: 0,
      draft_experiences: 0,
      draft_educations: 0,
      draft_projects: 1,
    },
    draft_item_ids: { experiences: [], educations: [], projects: [ID] },
    features: {
      insight: { ready: false, missing: ["complete_project"], hints: ["project_star"], next_action: "writing_chat", suggested_project_id: ID },
      draft: { ready: false, missing: ["complete_project"], hints: [], next_action: "create_project" },
    },
  };
  it("parses the DM §6 v4.4 example shape", () => {
    expect(DataReadiness.safeParse(sample).success).toBe(true);
    expect(DataReadiness.safeParse({ ...sample, ai_connection: { active_provider: null, key_status: null, connection_tier: null, consent_required: null } }).success).toBe(true);
    expect(DataReadiness.safeParse({ ...sample, ai_connection: { active_provider: "gemini", key_status: "valid", connection_tier: "free" } }).success).toBe(false);
  });
  it("v4.3 names are refused (hint complete_project_detail, old counts)", () => {
    const f = DataReadiness.shape.features.shape.draft;
    expect(f.safeParse({ ready: false, missing: ["complete_project"], hints: ["complete_project_detail"], next_action: "form" }).success).toBe(false);
    expect(f.safeParse({ ready: false, missing: ["complete_project"], hints: ["project_fields"], next_action: "form", suggested_project_id: ID }).success).toBe(true);
    expect(DataReadiness.safeParse({ ...sample, counts: { ...sample.counts, projects_without_complete_star: undefined } }).success).toBe(false);
  });
  // R13 (DM 6-A, SD-A18): the response has no `profile_filled` key and no `profile` hint.
  it("profile_filled is gone from counts and `profile` is not a hint", () => {
    expect(Object.keys(DataReadiness.shape.counts.shape)).not.toContain("profile_filled");
    expect(DataReadiness.safeParse({ ...sample, counts: { ...sample.counts, profile_filled: true } }).data?.counts).not.toHaveProperty(
      "profile_filled",
    );
    const f = DataReadiness.shape.features.shape.draft;
    expect(f.safeParse({ ready: false, missing: ["complete_project"], hints: ["profile"], next_action: "form" }).success).toBe(false);
  });
  it("a ready feature needs no next_action", () => {
    const f = DataReadiness.shape.features.shape.insight;
    expect(f.safeParse({ ready: true }).success).toBe(true);
    expect(f.safeParse({ ready: false, missing: [], hints: [] }).success).toBe(false);
  });
});
