import { describe, expect, it } from "vitest";
import { a, AS_OF, careerRowsFixture, IDS } from "../__fixtures__/S7/drafts";
import { buildCareerPack } from "../context-pack/career-pack";
import { filterCareerRows } from "../context-pack/selection";
import { buildSourceScope, buildTermCorpus, findUnknownTechTerms, isSituationTaskOnly } from "./drafts";
import type { ValidatedEvidence } from "./evidence";

const corpus = buildTermCorpus(["Spring Boot 기반 결제 서버", "Kotlin", "Node.js 배치", "p95 응답 시간"]);

describe("skill-name guard (AI-03 키워드 끼워 넣기)", () => {
  it.each([
    ["Spring Boot로 결제 서버 구현", []],
    ["kotlin 전환", []],
    ["Node.js 배치 개선", []],
    ["Kafka 기반 이벤트 처리", ["Kafka"]],
    ["K8s와 Terraform 도입", ["K8s", "Terraform"]],
    ["API 응답 p95 개선, DB 인덱스", []],
    ["[수치 입력 필요] 단축", []],
  ] as const)("%s → %j", (text, expected) => {
    expect(findUnknownTechTerms(text, corpus)).toEqual(expected);
  });
});

describe("situation/task-only self claim", () => {
  const ev = (source_type: ValidatedEvidence["source_type"], field: string | null): ValidatedEvidence => ({ source_type, ref: "X", field, quote: null, quote_adjusted: false });
  it.each([
    [[ev("project", "situation")], true],
    [[ev("project", "situation"), ev("project", "task")], true],
    [[ev("project", "role")], true],
    [[ev("project", "situation"), ev("project", "action")], false],
    [[ev("project", "task"), ev("project", "result")], false],
    [[ev("project", "role"), ev("project", "description")], false],
    [[ev("project", "role"), ev("project_deliverable", "body")], false],
    [[ev("project", "situation"), ev("jd_requirement", null)], true],
    [[ev("project", "situation"), ev("project", "learnings")], true],
    [[ev("jd_requirement", null)], false],
    [[], false],
  ] as const)("%j → %s", (evidence, expected) => {
    expect(isSituationTaskOnly(evidence)).toBe(expected);
  });
});

describe("buildSourceScope (AI-04 V-7)", () => {
  const pack = buildCareerPack(careerRowsFixture(), { asOf: AS_OF });
  const al = pack.aliases;
  const pay = a(al, "project", IDS.prjPay);
  const exp = a(al, "experience", IDS.expA);

  it("affiliated project source: the project (STAR) and its parent; not siblings", () => {
    const scope = buildSourceScope(al, [{ projectAlias: pay, parentAlias: exp }]);
    expect(scope.has(pay)).toBe(true);
    expect(scope.has(exp)).toBe(true);
    expect(scope.has(a(al, "project", IDS.prjSettle))).toBe(false); // sibling
    expect(scope.has(a(al, "skill", IDS.sklKotlin))).toBe(false); // standalone project's skill
    expect(scope.has(a(al, "project_deliverable", IDS.dlvSide1))).toBe(false);
    expect(scope.has("PROFILE")).toBe(false); // (v4.12, SD-6)
  });

  it("standalone project source: its deliverables and skills", () => {
    const side = a(al, "project", IDS.prjSide);
    const scope = buildSourceScope(al, [{ projectAlias: side, parentAlias: null }]);
    expect(scope.has(side)).toBe(true);
    expect(scope.has(a(al, "project_deliverable", IDS.dlvSide1))).toBe(true);
    expect(scope.has(a(al, "project_deliverable", IDS.dlvSide2))).toBe(true);
    expect(scope.has(a(al, "skill", IDS.sklKotlin))).toBe(true);
    expect(scope.has(pay)).toBe(false);
    expect(scope.has(exp)).toBe(false);
  });

  it("experience-only source: the whole experience", () => {
    const scope = buildSourceScope(al, [{ projectAlias: null, parentAlias: exp }]);
    expect(scope.has(a(al, "project", IDS.prjSettle))).toBe(true);
    expect(scope.has(pay)).toBe(true);
    expect(scope.has(a(al, "project", IDS.prjEdu))).toBe(false);
  });

  it("no sources: nothing in scope (JD/notes when present) — (v4.12, SD-6) no profile", () => {
    const scope = buildSourceScope(al, []);
    expect([...scope]).toEqual([]);
  });
});

describe("filterCareerRows", () => {
  it("keeps selected projects with parents as headers, whole parents with all projects", () => {
    const rows = filterCareerRows(careerRowsFixture(), { projectIds: [IDS.prjEdu], wholeExperienceIds: [IDS.expA] });
    expect(rows.projects.map((p) => p.id).sort()).toEqual([IDS.prjDraft, IDS.prjEdu, IDS.prjPay, IDS.prjSettle].sort());
    expect(rows.educations.map((e) => e.id)).toEqual([IDS.edu]);
    expect(rows.skills.map((s) => s.id)).not.toContain(IDS.sklManual);
    // (v4.12, SD-2) the server-computed sum travels with any filtered selection.
    expect(rows.totalExperience.totalMonths).toBeGreaterThan(0);
  });
});
