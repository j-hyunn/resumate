import { describe, expect, it } from "vitest";
import { careerRowsFixture, IDS, project, TOTAL_EXPERIENCE_FIXTURE } from "../__fixtures__/career-rows";
import { buildCareerPack } from "./career-pack";
import { sourceLabel } from "./selection";
import type { CareerRows } from "./career-rows";
import { DELIVERABLE_PACK_MAX_CHARS, DELIVERABLE_PACK_TOTAL_CHARS } from "./deliverable-text";
import { monthsInclusive } from "./months";

const asOf = { year: 2026, month: 10 };

function shuffled<T>(list: T[]): T[] {
  return [...list].reverse();
}

function emptyRows(): CareerRows {
  return {
    totalExperience: { totalMonths: 0, openEndedExperienceCount: 0, asOfMonth: asOf },
    experiences: [],
    educations: [],
    projects: [],
    deliverables: [],
    skills: [],
    projectSkills: [],
  };
}

describe("buildCareerPack (C-1 v4.5)", () => {
  it("includes complete rows only and drops children of draft or missing parents", () => {
    const pack = buildCareerPack(careerRowsFixture(), { asOf });
    const ids = new Set([...pack.aliases.values()].map((e) => e.id));
    expect(ids.has(IDS.expDraft)).toBe(false);
    expect(ids.has(IDS.prjUnderDraftExp)).toBe(false); // complete project under a draft experience
    expect(ids.has(IDS.prjDraft)).toBe(false);
    expect(ids.has(IDS.prjSideDraft)).toBe(false);
    expect(ids.has(IDS.dlvOfDraft)).toBe(false); // deliverable of a draft standalone project
    expect(ids.has(IDS.sklOrphan)).toBe(false); // tagged on an affiliated (CR-10) or draft project only
    expect(pack.text).not.toContain("숨김");
    expect(pack.text).not.toContain("숨겨질");
    expect(pack.counts).toEqual({ experiences: 2, educations: 1, projects: 4, deliverables: 2, skills: 3 });
  });

  it("has no DET-n / ACH-n aliases and no link_url", () => {
    const pack = buildCareerPack(careerRowsFixture(), { asOf });
    const aliases = [...pack.aliases.values()].map((e) => e.alias);
    expect(aliases.some((a) => /^(DET|ACH)-/.test(a))).toBe(false);
    expect(pack.text).not.toMatch(/DET-|ACH-|link_url|example\.com\/app/);
  });

  it("is deterministic: same rows in another order give the same bytes and hash", () => {
    const a = careerRowsFixture();
    const b = careerRowsFixture();
    b.experiences = shuffled(b.experiences);
    b.projects = shuffled(b.projects);
    b.deliverables = shuffled(b.deliverables);
    b.skills = shuffled(b.skills);
    b.projectSkills = shuffled(b.projectSkills);
    const pa = buildCareerPack(a, { asOf });
    const pb = buildCareerPack(b, { asOf });
    expect(pb.text).toBe(pa.text);
    expect(pb.careerSnapshotHash).toBe(pa.careerSnapshotHash);
    const withoutLocate = (p: typeof pa) => [...p.aliases.values()].map((e) => ({ ...e, locate: e.locate ? "fn" : undefined }));
    expect(withoutLocate(pb)).toEqual(withoutLocate(pa));
  });

  it("assigns aliases in pack order: experience → its projects → education → standalone → deliverables", () => {
    const pack = buildCareerPack(careerRowsFixture(), { asOf });
    expect(pack.aliases.get("EXP-1")?.id).toBe(IDS.expA); // ongoing, started 2021-03
    expect(pack.aliases.get("EXP-2")?.id).toBe(IDS.expB);
    expect(pack.aliases.get("PRJ-1")?.id).toBe(IDS.prjSettle); // started 2023-03, latest under EXP-1
    expect(pack.aliases.get("PRJ-2")?.id).toBe(IDS.prjPay);
    expect(pack.aliases.get("EDU-1")?.id).toBe(IDS.edu);
    expect(pack.aliases.get("PRJ-3")?.id).toBe(IDS.prjEdu);
    expect(pack.aliases.get("PRJ-4")?.id).toBe(IDS.prjSide);
    expect(pack.aliases.get("DLV-1")?.id).toBe(IDS.dlvSide1); // sort_order 1 before 2
    expect(pack.aliases.get("DLV-2")?.id).toBe(IDS.dlvSide2);
    expect(pack.text.indexOf("<standalone_projects>")).toBeGreaterThan(pack.text.indexOf("</education>"));
  });

  it("marks project scope and puts STAR on affiliated projects, role/description on standalone ones", () => {
    const pack = buildCareerPack(careerRowsFixture(), { asOf });
    const pay = pack.aliases.get("PRJ-2")!;
    expect(pay.scope).toBe("affiliated");
    expect(Object.keys(pay.fields).sort()).toEqual(["action", "learnings", "name", "period", "result", "situation", "task"]);
    expect(pay.parents).toEqual(["EXP-1"]);
    const side = pack.aliases.get("PRJ-4")!;
    expect(side.scope).toBe("standalone");
    expect(Object.keys(side.fields).sort()).toEqual(["description", "name", "period", "role"]);
    expect(side.parents).toEqual([]);
    expect(pack.aliases.get("DLV-1")?.parents).toEqual(["PRJ-4"]);
  });

  it("uses content_updated_at as the project snapshot and updated_at for deliverables (DM 2.8)", () => {
    const pack = buildCareerPack(careerRowsFixture(), { asOf });
    expect(pack.aliases.get("PRJ-2")?.snapshotAt).toBe("2026-02-01T00:00:00.000Z");
    expect(pack.aliases.get("DLV-1")?.snapshotAt).toBe("2026-02-01T00:00:00.000Z");
  });

  it("renders classification as reference only (display names, not an alias field)", () => {
    const pack = buildCareerPack(careerRowsFixture(), { asOf });
    expect(pack.text).toContain("<classification>프로젝트 종류: 개선·고도화 / 경험 유형: 문제 해결 / 역량: 문제 해결력, 분석력</classification>");
    expect(pack.aliases.get("PRJ-2")?.fields).not.toHaveProperty("project_type");
    expect(pack.numberSources.factualTexts.join("\n")).not.toContain("개선·고도화");
  });

  it("hangs skills off standalone projects only and records parents for V-7", () => {
    const pack = buildCareerPack(careerRowsFixture(), { asOf });
    const spring = [...pack.aliases.values()].find((e) => e.id === IDS.sklSpring);
    expect(spring?.parents).toEqual(["PRJ-4"]);
    const manual = [...pack.aliases.values()].find((e) => e.id === IDS.sklManual);
    expect(manual?.parents).toEqual([]);
    expect(pack.text).toMatch(/<project ref="PRJ-4">[\s\S]*skills: SKL-1 Kotlin, SKL-2 Spring Boot[\s\S]*<\/project>/);
  });

  it("wraps learnings in <reflection> and keeps them out of V-5 factual text", () => {
    const pack = buildCareerPack(careerRowsFixture(), { asOf });
    expect(pack.text).toMatch(/<reflection>\nlearnings: 측정 없이[^\n]*\n<\/reflection>/);
    const facts = pack.numberSources.factualTexts.join("\n");
    expect(facts).not.toContain("99%");
    expect(facts).toContain("1.2초");
    expect(facts).toContain("1,200건"); // result narrative is a number source (CR-11)
    expect(facts).toContain("300명"); // standalone description
    expect(facts).toContain("97%"); // deliverable text in the pack
  });

  it("normalizes deliverable markdown and maps a quote back to the raw span", () => {
    const rows = careerRowsFixture();
    const pack = buildCareerPack(rows, { asOf });
    const dlv = pack.aliases.get("DLV-1")!;
    expect(dlv.fields.body).toBe("설계\n\n은행 문자 10종의 형식을 정규식으로 분류했다\n\n항목 / 값\n정확도 / 97%\n\nparse(sms)");
    expect(pack.text).toContain('<deliverable ref="DLV-1">');
    const raw = rows.deliverables.find((d) => d.id === IDS.dlvSide1)!.body;
    const span = dlv.locate!("body", "10종의 형식을 정규식") as { start: number; end: number };
    expect(raw.slice(span.start, span.end)).toBe("10종*의 형식을 [정규식");
    expect(dlv.locate!("title", "문자 파싱 설계")).toBeNull();
    expect(dlv.locate!("body", "없는 문장")).toBeNull();
  });

  it("applies the deliverable budget: per-item cut with truncated flag, titles only after the total", () => {
    const rows = emptyRows();
    rows.projects = [project({ id: "p1", name: "독립", description: "내용", start_month: "2024-01-01" })];
    const para = "가".repeat(4000);
    rows.deliverables = [1, 2, 3, 4, 5].map((n) => ({
      id: `d${n}`,
      project_id: "p1",
      title: `문서 ${n}`,
      body: `${para}\n\n${para}`,
      sort_order: n,
      created_at: "2026-01-01T00:00:00.000Z",
      updated_at: "2026-01-01T00:00:00.000Z",
    }));
    const pack = buildCareerPack(rows, { asOf });
    const bodies = [1, 2, 3, 4, 5].map((n) => pack.aliases.get(`DLV-${n}`)!.fields.body);
    // 8,002 chars > 6,000 → cut at the blank line (4,000 chars).
    expect(bodies[0]).toHaveLength(4000);
    expect(bodies.slice(0, 3).every((b) => b!.length === 4000)).toBe(true);
    // 15,000 − 12,000 = 3,000 left: no paragraph boundary inside → hard cut at 3,000.
    expect(bodies[3]).toHaveLength(DELIVERABLE_PACK_TOTAL_CHARS - 12000);
    expect(bodies[4]).toBeNull(); // budget exhausted → title only
    expect(pack.text).toContain('<deliverable ref="DLV-5" truncated="true">');
    expect(pack.text).toContain("title: 문서 5");
    expect(DELIVERABLE_PACK_MAX_CHARS).toBe(6000);
  });

  it("limits deliverable bodies to the given projects (C-1.1)", () => {
    const rows = careerRowsFixture();
    const none = buildCareerPack(rows, { asOf, deliverableProjectIds: new Set() });
    expect([...none.aliases.values()].some((e) => e.sourceType === "project_deliverable")).toBe(false);
    expect(none.aliases.get("PRJ-4")?.fields.description).toContain("문자 파싱");
    expect(none.careerSnapshotHash).toBe(buildCareerPack(rows, { asOf }).careerSnapshotHash);
  });

  it("sends no profile value and escapes angle brackets in user text", () => {
    const pack = buildCareerPack(careerRowsFixture(), { asOf });
    // (v4.12, SD-6) no profile block, not even an empty one.
    expect(pack.text).not.toContain("<profile");
    expect(pack.text).not.toContain("PROFILE");
    expect(pack.text).not.toContain("desired_job_title");
    expect(pack.text).not.toContain("interested_industries");
    expect(pack.text).not.toContain("total_years_of_experience");
    expect(pack.text).toContain("운영 ＜리드＞");
    expect(pack.text).not.toContain("<리드>");
    // The alias map keeps the raw DB text (V-3 compares against it).
    expect(pack.aliases.get("EXP-1")?.fields.summary).toBe("결제 플랫폼 백엔드 개발 및 운영 <리드>");
  });

  it("renders project periods with is_current (CR-22) and counts ongoing months for V-5", () => {
    const pack = buildCareerPack(careerRowsFixture(), { asOf });
    expect(pack.aliases.get("PRJ-1")?.fields.period).toBe("2023-03 ~ 현재");
    expect(pack.numberSources.computedNumbers).toEqual(expect.arrayContaining([44])); // 2023-03 … 2026-10
    expect(pack.aliases.get("PRJ-4")?.fields.period).toBe("2024-05 ~ (종료 미입력)");
    expect(pack.text).toMatch(/<project ref="PRJ-4">\nname: 개인 가계부 앱\nperiod: 2024-05 ~ \(종료 미입력\)\nrole:/); // no computed_duration
  });

  it("computes durations from dates for V-5 and keeps the snapshot hash independent of asOf", () => {
    const now = buildCareerPack(careerRowsFixture(), { asOf });
    const later = buildCareerPack(careerRowsFixture(), { asOf: { year: 2027, month: 1 } });
    expect(now.text).toContain("computed_duration: 5년 8개월 (68개월)");
    expect(now.numberSources.computedNumbers).toEqual(expect.arrayContaining([68, 5, 8, 6, 26, 2]));
    expect(later.text).not.toBe(now.text);
    expect(later.careerSnapshotHash).toBe(now.careerSnapshotHash);
  });

  it("changes the snapshot hash with STAR, classification, is_current, deliverable body — not link-only or excluded rows", () => {
    const base = buildCareerPack(careerRowsFixture(), { asOf }).careerSnapshotHash;
    const edit = (f: (r: CareerRows) => void) => {
      const rows = careerRowsFixture();
      f(rows);
      return buildCareerPack(rows, { asOf }).careerSnapshotHash;
    };
    const payIndex = (r: CareerRows) => r.projects.findIndex((p) => p.id === IDS.prjPay);
    expect(edit((r) => (r.projects[payIndex(r)] = { ...r.projects[payIndex(r)], action: "다른 행동" }))).not.toBe(base);
    expect(edit((r) => (r.projects[payIndex(r)] = { ...r.projects[payIndex(r)], competencies: ["execution"] }))).not.toBe(base);
    expect(edit((r) => (r.projects[payIndex(r)] = { ...r.projects[payIndex(r)], is_current: true, end_month: null }))).not.toBe(base);
    expect(edit((r) => (r.deliverables[0] = { ...r.deliverables[0], body: "바뀐 본문" }))).not.toBe(base);
    expect(edit((r) => (r.experiences[2] = { ...r.experiences[2], summary: "draft change" }))).toBe(base);
    expect(edit((r) => r.deliverables.push({ ...r.deliverables[2], id: "x", sort_order: 9 }))).toBe(base); // deliverable of a draft project
  });

  it("reports whether results / descriptions / deliverables carry numbers (C-14 thin)", () => {
    expect(buildCareerPack(careerRowsFixture(), { asOf }).hasResultNumbers).toBe(true);
    const rows = emptyRows();
    rows.experiences = [careerRowsFixture().experiences[1]];
    rows.projects = [project({ id: "p", name: "숫자 없음", experience_id: rows.experiences[0].id, situation: "트래픽 3배", action: "캐시 도입", result: "빨라졌다", learnings: "99% 확신" })];
    expect(buildCareerPack(rows, { asOf }).hasResultNumbers).toBe(false);
  });

  it("handles an empty career", () => {
    const pack = buildCareerPack(emptyRows(), { asOf });
    expect(pack.text).toBe("<career_data>\ncomputed_total_months: 등록된 경력 기간 합계 0개월 (총 0개월, 기준 2026-10, 서버 계산)\n</career_data>");
    expect(pack.aliases.size).toBe(0);
  });

  // (v4.12, SD-2) C-1 "경력 합계 (서버 계산)": the number comes from the DB
  // function (DM 6.2); the pack only renders it and feeds it to V-5.
  describe("computed_total_months (SD-2)", () => {
    it("puts the server-computed sum on the pack's head line and allows its numbers in V-5", () => {
      const pack = buildCareerPack(careerRowsFixture(), { asOf });
      expect(pack.text.split("\n")[1]).toBe("computed_total_months: 등록된 경력 기간 합계 7년 10개월 (총 94개월, 기준 2026-10, 서버 계산)");
      expect(pack.numberSources.computedNumbers).toEqual(expect.arrayContaining([94, 7, 10]));
      expect(pack.text).not.toContain("computed_open_ended_experiences");
    });

    it("adds the open-ended line from the same call's count, and never counts them itself", () => {
      const rows = careerRowsFixture();
      rows.totalExperience = { totalMonths: 26, openEndedExperienceCount: 2, asOfMonth: asOf };
      const pack = buildCareerPack(rows, { asOf });
      expect(pack.text).toContain("computed_total_months: 등록된 경력 기간 합계 2년 2개월 (총 26개월, 기준 2026-10, 서버 계산)");
      expect(pack.text).toContain("computed_open_ended_experiences: 기간 미입력 경력 2건(합계에 넣지 않음)");
    });

    it("stays out of career_snapshot_hash (DM 6.2: it changes every month)", () => {
      const base = buildCareerPack(careerRowsFixture(), { asOf });
      const rows = careerRowsFixture();
      rows.totalExperience = { totalMonths: TOTAL_EXPERIENCE_FIXTURE.totalMonths + 1, openEndedExperienceCount: 1, asOfMonth: { year: 2026, month: 11 } };
      const next = buildCareerPack(rows, { asOf });
      expect(next.careerSnapshotHash).toBe(base.careerSnapshotHash);
      expect(next.text).not.toBe(base.text);
    });
  });
});

describe("months", () => {
  it("counts months inclusively", () => {
    expect(monthsInclusive({ year: 2021, month: 3 }, { year: 2024, month: 2 })).toBe(36);
    expect(monthsInclusive({ year: 2021, month: 3 }, { year: 2021, month: 2 })).toBeNull();
  });

  describe("education label = display name (UQ-734 / UI32-2)", () => {
    const withEducation = (program_name: string | null, institution_name: string) => {
      const rows = careerRowsFixture();
      rows.educations = rows.educations.map((e) => ({ ...e, program_name, institution_name }));
      return buildCareerPack(rows, { asOf });
    };

    it.each([
      ["program name when present", "컴퓨터공학", "가상대학교", "컴퓨터공학"],
      ["trimmed program name", "  컴퓨터공학  ", "가상대학교", "컴퓨터공학"],
      ["institution when program is null", null, "가상대학교", "가상대학교"],
      ["trimmed institution when program is blank", "   ", "  가상대학교 ", "가상대학교"],
      ["null when both are blank", " ", "  ", null],
    ])("uses the %s", (_name, program, institution, label) => {
      expect(withEducation(program, institution).aliases.get("EDU-1")?.label).toBe(label);
    });

    it("keeps both raw fields model-facing", () => {
      const pack = withEducation("컴퓨터공학", "가상대학교");
      const edu = pack.aliases.get("EDU-1")!;
      expect(edu.fields.institution_name).toBe("가상대학교");
      expect(edu.fields.program_name).toBe("컴퓨터공학");
      expect(pack.text).toContain("institution_name: 가상대학교");
      expect(pack.text).toContain("program_name: 컴퓨터공학");
    });

    it("puts the display name in the parent part of a project source label", () => {
      const pack = withEducation("컴퓨터공학", "가상대학교");
      expect(pack.aliases.get("PRJ-3")?.parents).toEqual(["EDU-1"]);
      expect(sourceLabel(pack.aliases, { parentAlias: "EDU-1", projectAlias: "PRJ-3" })).toBe("컴퓨터공학 › 캡스톤 분산 캐시");
      expect(sourceLabel(withEducation(null, "가상대학교").aliases, { parentAlias: "EDU-1", projectAlias: "PRJ-3" })).toBe(
        "가상대학교 › 캡스톤 분산 캐시",
      );
      expect(sourceLabel(withEducation(null, " ").aliases, { parentAlias: "EDU-1", projectAlias: "PRJ-3" })).toBe("캡스톤 분산 캐시");
    });

  });
});
