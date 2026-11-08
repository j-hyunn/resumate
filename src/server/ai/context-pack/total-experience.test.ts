import { describe, expect, it } from "vitest";
import { emptyTotalExperience, kstDateString, parseTotalExperience } from "./total-experience";

/** C-1 / DM 6.2 (SD-2): the server reads the DB function's one row; it never recomputes the sum. */
describe("parseTotalExperience", () => {
  it("reads a record result", () => {
    expect(parseTotalExperience({ total_months: 94, open_ended_experience_count: 2, as_of_month: "2026-11-01" }, "2026-11-05")).toEqual({
      totalMonths: 94,
      openEndedExperienceCount: 2,
      asOfMonth: { year: 2026, month: 11 },
    });
  });

  it("reads a one-row table result", () => {
    expect(parseTotalExperience([{ total_months: 0, open_ended_experience_count: 0, as_of_month: "2026-02-01" }], "2026-02-10").asOfMonth).toEqual({
      year: 2026,
      month: 2,
    });
  });

  it("falls back to p_as_of's month and to zero for a missing row", () => {
    expect(parseTotalExperience(null, "2027-01-31")).toEqual(emptyTotalExperience({ year: 2027, month: 1 }));
  });

  it("never returns a negative or fractional month count", () => {
    const parsed = parseTotalExperience({ total_months: -3, open_ended_experience_count: 1.7, as_of_month: null }, "2026-11-05");
    expect(parsed.totalMonths).toBe(0);
    expect(parsed.openEndedExperienceCount).toBe(1);
  });
});

describe("kstDateString", () => {
  it("is the KST calendar date (the p_as_of every caller passes)", () => {
    // 2026-11-05T15:30Z = 2026-11-06 00:30 KST.
    expect(kstDateString(new Date("2026-11-05T15:30:00Z"))).toBe("2026-11-06");
    expect(kstDateString(new Date("2026-11-05T14:30:00Z"))).toBe("2026-11-05");
  });
});
