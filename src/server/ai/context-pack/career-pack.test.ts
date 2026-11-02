import { describe, expect, it } from "vitest";
import { careerRowsFixture, IDS } from "../__fixtures__/career-rows";
import { buildCareerPack, metricText } from "./career-pack";
import { mergedMonths, monthsInclusive } from "./months";

const asOf = { year: 2026, month: 10 };

function shuffled<T>(list: T[]): T[] {
  return [...list].reverse();
}

describe("buildCareerPack (C-1)", () => {
  it("includes complete rows only and drops children of draft or missing parents", () => {
    const pack = buildCareerPack(careerRowsFixture(), { asOf });
    const ids = new Set([...pack.aliases.values()].map((e) => e.id));
    expect(ids.has(IDS.expDraft)).toBe(false);
    expect(ids.has(IDS.prjUnderDraftExp)).toBe(false); // complete project under a draft experience
    expect(ids.has(IDS.prjDraft)).toBe(false);
    expect(ids.has(IDS.detUnderDraftPrj)).toBe(false); // complete detail under a draft project
    expect(ids.has(IDS.detDraft)).toBe(false);
    expect(ids.has(IDS.achUnderDraftDet)).toBe(false); // complete achievement under a draft detail
    expect(ids.has(IDS.sklOrphan)).toBe(false); // skill tagged only on an excluded project
    expect(pack.text).not.toContain("숨겨질");
    expect(pack.counts).toEqual({ experiences: 2, educations: 1, projects: 4, details: 5, achievements: 2, skills: 3 });
  });

  it("is deterministic: same rows in another order give the same bytes and hash", () => {
    const a = careerRowsFixture();
    const b = careerRowsFixture();
    b.experiences = shuffled(b.experiences);
    b.projects = shuffled(b.projects);
    b.projectDetails = shuffled(b.projectDetails);
    b.achievements = shuffled(b.achievements);
    b.skills = shuffled(b.skills);
    b.projectSkills = shuffled(b.projectSkills);
    const pa = buildCareerPack(a, { asOf });
    const pb = buildCareerPack(b, { asOf });
    expect(pb.text).toBe(pa.text);
    expect(pb.careerSnapshotHash).toBe(pa.careerSnapshotHash);
    expect([...pb.aliases.values()]).toEqual([...pa.aliases.values()]);
  });

  it("assigns aliases in pack order: latest experience first, details by sort_order", () => {
    const pack = buildCareerPack(careerRowsFixture(), { asOf });
    expect(pack.aliases.get("EXP-1")?.id).toBe(IDS.expA); // ongoing, started 2021-03
    expect(pack.aliases.get("EXP-2")?.id).toBe(IDS.expB);
    expect(pack.aliases.get("PRJ-1")?.id).toBe(IDS.prjSettle); // started 2023-03, latest under EXP-1
    expect(pack.aliases.get("DET-2")?.id).toBe(IDS.detPay1); // sort_order 1 before 2
    expect(pack.aliases.get("DET-3")?.id).toBe(IDS.detPay2);
    expect(pack.aliases.get("EDU-1")?.id).toBe(IDS.edu);
    expect(pack.aliases.get("PRJ-4")?.parents).toEqual([]); // standalone project
    expect(pack.aliases.get("PROFILE")?.id).toBe(IDS.profile);
  });

  it("records parents for V-7 scope, including every project that tags a skill", () => {
    const pack = buildCareerPack(careerRowsFixture(), { asOf });
    expect(pack.aliases.get("DET-2")?.parents).toEqual(["PRJ-2"]);
    expect(pack.aliases.get("ACH-1")?.parents).toEqual(["EXP-1"]); // experience-level achievement
    const spring = [...pack.aliases.values()].find((e) => e.id === IDS.sklSpring);
    expect(spring?.parents).toEqual(["PRJ-1", "PRJ-2"]);
    const manual = [...pack.aliases.values()].find((e) => e.id === IDS.sklManual);
    expect(manual?.parents).toEqual([]);
  });

  it("wraps learnings in <reflection> and keeps them out of V-5 factual text", () => {
    const pack = buildCareerPack(careerRowsFixture(), { asOf });
    expect(pack.text).toMatch(/<reflection>\nlearnings: 측정 없이[^\n]*\n<\/reflection>/);
    expect(pack.numberSources.factualTexts.join("\n")).not.toContain("99%");
    expect(pack.numberSources.factualTexts.join("\n")).toContain("1.2초");
  });

  it("never sends display_name and escapes angle brackets in user text", () => {
    const rows = careerRowsFixture();
    const withName = { ...rows, profile: { ...rows.profile!, display_name: "홍길동" } as typeof rows.profile };
    const pack = buildCareerPack(withName, { asOf });
    expect(pack.text).not.toContain("홍길동");
    expect(pack.text).toContain("운영 ＜리드＞");
    expect(pack.text).not.toContain("<리드>");
    // The alias map keeps the raw DB text (V-3 compares against it).
    expect(pack.aliases.get("EXP-1")?.fields.summary).toBe("결제 플랫폼 백엔드 개발 및 운영 <리드>");
  });

  it("computes durations from dates for V-5 and keeps the snapshot hash independent of asOf", () => {
    const now = buildCareerPack(careerRowsFixture(), { asOf });
    const later = buildCareerPack(careerRowsFixture(), { asOf: { year: 2027, month: 1 } });
    expect(now.text).toContain("computed_duration: 5년 8개월 (68개월)");
    expect(now.numberSources.computedNumbers).toEqual(expect.arrayContaining([68, 5, 8, 6, 26, 2]));
    expect(later.text).not.toBe(now.text);
    expect(later.careerSnapshotHash).toBe(now.careerSnapshotHash);
  });

  it("changes the snapshot hash when included content changes, not when excluded rows change", () => {
    const base = buildCareerPack(careerRowsFixture(), { asOf }).careerSnapshotHash;
    const edited = careerRowsFixture();
    edited.projectDetails[1] = { ...edited.projectDetails[1], action: "다른 행동" };
    expect(buildCareerPack(edited, { asOf }).careerSnapshotHash).not.toBe(base);
    const draftEdited = careerRowsFixture();
    draftEdited.experiences[2] = { ...draftEdited.experiences[2], summary: "draft change" };
    expect(buildCareerPack(draftEdited, { asOf }).careerSnapshotHash).toBe(base);
  });

  it("handles an empty career", () => {
    const pack = buildCareerPack(
      { profile: null, experiences: [], educations: [], projects: [], projectDetails: [], achievements: [], skills: [], projectSkills: [] },
      { asOf },
    );
    expect(pack.text).toBe("<career_data>\n</career_data>");
    expect(pack.aliases.size).toBe(0);
  });
});

describe("metricText / months", () => {
  it.each([
    [{ metric_name: "응답 시간", value_before: 1.2, value_after: 0.7, unit: "초" }, "응답 시간: 1.2 → 0.7 초"],
    [{ metric_name: "처리량", value_before: null, value_after: 1200, unit: "건" }, "처리량: 1200 건"],
    [{ metric_name: "만족도", value_before: null, value_after: null, unit: null }, "만족도"],
    [{ metric_name: null, value_before: null, value_after: null, unit: null }, null],
  ])("%j → %s", (input, expected) => {
    expect(metricText(input)).toBe(expected);
  });

  it("counts months inclusively and merges overlaps", () => {
    expect(monthsInclusive({ year: 2021, month: 3 }, { year: 2024, month: 2 })).toBe(36);
    expect(monthsInclusive({ year: 2021, month: 3 }, { year: 2021, month: 2 })).toBeNull();
    expect(
      mergedMonths([
        { start: { year: 2020, month: 1 }, end: { year: 2020, month: 12 } },
        { start: { year: 2020, month: 6 }, end: { year: 2021, month: 6 } },
        { start: { year: 2022, month: 1 }, end: { year: 2022, month: 1 } },
      ]),
    ).toBe(19);
  });
});
