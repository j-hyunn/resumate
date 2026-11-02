import { describe, expect, it } from "vitest";
import type { CareerListItem } from "@/lib/contracts/career";
import { currentYearInSeoul, groupCareerByYear } from "./year-view";

const item = (
  id: string,
  startMonth: string | null,
  entityType: CareerListItem["entityType"] = "experience",
  createdAt = "2026-01-01T00:00:00Z",
): CareerListItem => ({ entityType, id, name: id, startMonth, status: "complete", createdAt });

describe("groupCareerByYear (DM §2.4 v4.4, CR-4)", () => {
  it("returns no groups for empty data", () => {
    expect(groupCareerByYear([])).toEqual([]);
  });

  it("puts each item once, under its start year, latest year first", () => {
    const groups = groupCareerByYear([item("e1", "2021-03"), item("p1", "2023-11", "project"), item("d1", "2021-09", "education")]);
    expect(groups.map((g) => g.year)).toEqual([2023, 2021]);
    expect(groups[1]!.items.map((i) => i.id)).toEqual(["d1", "e1"]);
  });

  it("orders inside a year by start_month desc, then created_at desc, kinds mixed", () => {
    const groups = groupCareerByYear([
      item("old", "2024-05", "experience", "2026-01-01T00:00:00Z"),
      item("new", "2024-05", "project", "2026-02-01T00:00:00Z"),
      item("late", "2024-09", "education"),
    ]);
    expect(groups[0]!.items.map((i) => i.id)).toEqual(["late", "new", "old"]);
  });

  it("puts items without a start month in the last 연도 미정 bucket", () => {
    const groups = groupCareerByYear([item("p0", null, "project"), item("e1", "2020-01")]);
    expect(groups.map((g) => g.year)).toEqual([2020, null]);
    expect(groups[1]!.items.map((i) => i.id)).toEqual(["p0"]);
  });
});

describe("currentYearInSeoul", () => {
  it("uses the KST calendar year", () => {
    expect(currentYearInSeoul(new Date("2025-12-31T15:30:00Z"))).toBe(2026);
    expect(currentYearInSeoul(new Date("2025-12-31T14:30:00Z"))).toBe(2025);
  });
});
