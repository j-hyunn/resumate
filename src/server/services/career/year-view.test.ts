import { describe, expect, it } from "vitest";
import { currentYearInSeoul, groupCareerByYear, type YearViewInput } from "./year-view";

const NOW_YEAR = 2026;
const exp = (id: string, startMonth: string | null, endMonth: string | null = null, isCurrent = false) => ({
  id,
  startMonth,
  endMonth,
  isCurrent,
});
const edu = (id: string, startMonth: string | null, endMonth: string | null = null) => ({ id, startMonth, endMonth });
const proj = (
  id: string,
  startMonth: string | null,
  parent: { experienceId?: string; educationId?: string } = {},
  createdAt = "2026-01-01T00:00:00Z",
) => ({
  id,
  startMonth,
  experienceId: parent.experienceId ?? null,
  educationId: parent.educationId ?? null,
  createdAt,
});
const input = (p: Partial<YearViewInput>): YearViewInput => ({ experiences: [], educations: [], projects: [], ...p });

describe("groupCareerByYear (DM §2.4)", () => {
  it("returns no groups for empty data", () => {
    expect(groupCareerByYear(input({}), NOW_YEAR)).toEqual([]);
  });

  it("shows an experience in every active year, latest first", () => {
    const groups = groupCareerByYear(input({ experiences: [exp("e1", "2021-03", "2023-02")] }), NOW_YEAR);
    expect(groups.map((g) => g.year)).toEqual([2023, 2022, 2021]);
    for (const g of groups) expect(g.affiliations).toEqual([{ type: "experience", id: "e1", projectIds: [] }]);
  });

  it("a current job runs through this year", () => {
    const groups = groupCareerByYear(input({ experiences: [exp("e1", "2024-05", null, true)] }), NOW_YEAR);
    expect(groups.map((g) => g.year)).toEqual([2026, 2025, 2024]);
  });

  it("an experience with no end month also runs through this year", () => {
    const groups = groupCareerByYear(input({ experiences: [exp("e1", "2025-01")] }), NOW_YEAR);
    expect(groups.map((g) => g.year)).toEqual([2026, 2025]);
  });

  it("an education without end month runs through this year (재학 중)", () => {
    const groups = groupCareerByYear(input({ educations: [edu("d1", "2025-03")] }), NOW_YEAR);
    expect(groups.map((g) => g.year)).toEqual([2026, 2025]);
    expect(groups[0]!.affiliations[0]).toMatchObject({ type: "education", id: "d1" });
  });

  it("a start in the future still shows its start year", () => {
    const groups = groupCareerByYear(input({ experiences: [exp("e1", "2027-01")] }), NOW_YEAR);
    expect(groups.map((g) => g.year)).toEqual([2027]);
  });

  it("puts a project only in the year it started, under its experience", () => {
    const groups = groupCareerByYear(
      input({
        experiences: [exp("e1", "2021-01", "2023-12")],
        projects: [proj("p1", "2022-06", { experienceId: "e1" })],
      }),
      NOW_YEAR,
    );
    const byYear = Object.fromEntries(groups.map((g) => [g.year, g.affiliations[0]!.projectIds]));
    expect(byYear).toEqual({ 2023: [], 2022: ["p1"], 2021: [] });
  });

  it("a project without dates uses its affiliation's start year", () => {
    const groups = groupCareerByYear(
      input({
        educations: [edu("d1", "2019-03", "2023-02")],
        projects: [proj("p1", null, { educationId: "d1" })],
      }),
      NOW_YEAR,
    );
    expect(groups.find((g) => g.year === 2019)!.affiliations[0]!.projectIds).toEqual(["p1"]);
    expect(groups.filter((g) => g.year !== 2019).every((g) => g.affiliations[0]!.projectIds.length === 0)).toBe(true);
  });

  it("an independent project goes to that year's 기타 프로젝트", () => {
    const groups = groupCareerByYear(input({ projects: [proj("p1", "2024-02")] }), NOW_YEAR);
    expect(groups).toEqual([{ year: 2024, affiliations: [], otherProjectIds: ["p1"] }]);
  });

  it("an independent project without dates goes to 연도 미정, last", () => {
    const groups = groupCareerByYear(
      input({ experiences: [exp("e1", "2024-01", "2024-12")], projects: [proj("p1", null)] }),
      NOW_YEAR,
    );
    expect(groups.map((g) => g.year)).toEqual([2024, null]);
    expect(groups[1]).toEqual({ year: null, affiliations: [], otherProjectIds: ["p1"] });
  });

  it("an affiliation without start month (draft) and its undated projects go to 연도 미정", () => {
    const groups = groupCareerByYear(
      input({
        experiences: [exp("e1", null)],
        projects: [proj("p1", null, { experienceId: "e1" }), proj("p2", "2025-04", { experienceId: "e1" })],
      }),
      NOW_YEAR,
    );
    expect(groups).toEqual([
      { year: 2025, affiliations: [{ type: "experience", id: "e1", projectIds: ["p2"] }], otherProjectIds: [] },
      { year: null, affiliations: [{ type: "experience", id: "e1", projectIds: ["p1"] }], otherProjectIds: [] },
    ]);
  });

  it("a project dated outside its affiliation's years adds the header to that year", () => {
    const groups = groupCareerByYear(
      input({
        experiences: [exp("e1", "2022-01", "2022-12")],
        projects: [proj("p1", "2020-05", { experienceId: "e1" })],
      }),
      NOW_YEAR,
    );
    expect(groups.map((g) => [g.year, g.affiliations.map((a) => a.projectIds)])).toEqual([
      [2022, [[]]],
      [2020, [["p1"]]],
    ]);
  });

  it("orders affiliations in a year by start desc, and projects by start desc then creation", () => {
    const groups = groupCareerByYear(
      input({
        experiences: [exp("old", "2020-01", null, true), exp("new", "2024-03", null, true)],
        educations: [edu("edu", "2024-03", "2024-12")],
        projects: [
          proj("a", "2024-01", { experienceId: "old" }, "2026-01-02T00:00:00Z"),
          proj("b", "2024-09", { experienceId: "old" }, "2026-01-03T00:00:00Z"),
          proj("c", "2024-01", { experienceId: "old" }, "2026-01-01T00:00:00Z"),
        ],
      }),
      NOW_YEAR,
    );
    const y2024 = groups.find((g) => g.year === 2024)!;
    expect(y2024.affiliations.map((a) => a.id)).toEqual(["new", "edu", "old"]);
    expect(y2024.affiliations.find((a) => a.id === "old")!.projectIds).toEqual(["b", "c", "a"]);
  });

  it("treats a project pointing at an unknown affiliation as independent", () => {
    const groups = groupCareerByYear(input({ projects: [proj("p1", "2023-01", { experienceId: "gone" })] }), NOW_YEAR);
    expect(groups).toEqual([{ year: 2023, affiliations: [], otherProjectIds: ["p1"] }]);
  });

  it("mixes experience and education headers with 기타 프로젝트 in one year", () => {
    const groups = groupCareerByYear(
      input({
        experiences: [exp("e1", "2023-01", "2023-06")],
        educations: [edu("d1", "2023-07", "2023-12")],
        projects: [proj("p1", "2023-02", { experienceId: "e1" }), proj("p2", "2023-08", { educationId: "d1" }), proj("p3", "2023-10")],
      }),
      NOW_YEAR,
    );
    expect(groups).toEqual([
      {
        year: 2023,
        affiliations: [
          { type: "education", id: "d1", projectIds: ["p2"] },
          { type: "experience", id: "e1", projectIds: ["p1"] },
        ],
        otherProjectIds: ["p3"],
      },
    ]);
  });
});

describe("currentYearInSeoul", () => {
  it("uses Asia/Seoul: 2026-12-31T15:00Z is already 2027 in Korea", () => {
    expect(currentYearInSeoul(new Date("2026-12-31T15:00:00Z"))).toBe(2027);
    expect(currentYearInSeoul(new Date("2026-12-31T14:59:59Z"))).toBe(2026);
  });
});
