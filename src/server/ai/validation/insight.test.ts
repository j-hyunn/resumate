import { describe, expect, it } from "vitest";
import type { InsightMatchStatus } from "../schemas/AI-02";
import type { ValidatedEvidence } from "./evidence";
import { careerRowsFixture } from "../__fixtures__/career-rows";
import { buildCareerPack } from "../context-pack/career-pack";
import { checkEvidence } from "./evidence";
import { applyMatchRules, emptyAi02Report, mergeAi02Reports, supportsMet } from "./insight";

const e = (source_type: ValidatedEvidence["source_type"], field: string | null): ValidatedEvidence => ({
  source_type,
  ref: "X-1",
  field,
  quote: null,
  quote_adjusted: false,
});

describe("supportsMet (card 가드레일 v4.5: affiliated action/result, standalone description, deliverable body)", () => {
  it.each<[string, ValidatedEvidence[], boolean]>([
    ["project action", [e("project", "action")], true],
    ["project result", [e("project", "result")], true],
    ["standalone description", [e("project", "description")], true],
    ["deliverable body", [e("project_deliverable", "body")], true],
    ["deliverable title", [e("project_deliverable", "title")], false],
    ["project situation", [e("project", "situation")], false],
    ["project task", [e("project", "task")], false],
    ["standalone role", [e("project", "role")], false],
    ["project learnings", [e("project", "learnings")], false],
    ["skill only", [e("skill", "name")], false],
    ["project name", [e("project", "name")], false],
    ["experience summary", [e("experience", "summary")], false],
    ["jd sentence", [e("jd_sentence", null)], false],
    ["empty", [], false],
  ])("%s → %s", (_, evidence, expected) => {
    expect(supportsMet(evidence)).toBe(expected);
  });
});

describe("applyMatchRules (V-4 + met downgrade)", () => {
  it.each<[string, InsightMatchStatus, ValidatedEvidence[], InsightMatchStatus, Partial<Record<string, number>>]>([
    ["met with action stays met", "met", [e("project", "action")], "met", {}],
    ["met with skill → partial", "met", [e("skill", "name")], "partial", { met_downgraded_partial: 1 }],
    ["met with situation → partial", "met", [e("project", "situation")], "partial", { met_downgraded_partial: 1 }],
    ["met with JD only → no_evidence", "met", [e("jd_sentence", null)], "no_evidence", { items_downgraded: 1 }],
    ["met with nothing → no_evidence", "met", [], "no_evidence", { items_downgraded: 1 }],
    ["partial with skill stays partial", "partial", [e("skill", "name")], "partial", {}],
    ["partial with nothing → no_evidence", "partial", [], "no_evidence", { items_downgraded: 1 }],
    ["partial with learnings only → no_evidence", "partial", [e("project", "learnings")], "no_evidence", { items_downgraded: 1 }],
    // (v4.12, SD-6) profile is not a source type any more — nothing rests on it.
    ["partial with a profile source only → no_evidence (SD-6)", "partial", [e("profile" as never, "desired_job_title")], "no_evidence", { items_downgraded: 1 }],
    ["partial with total_years_of_experience only → no_evidence (SD-6)", "partial", [e("profile" as never, "total_years_of_experience")], "no_evidence", { items_downgraded: 1 }],
    ["met with action + a profile source stays met", "met", [e("profile" as never, "desired_job_title"), e("project", "action")], "met", {}],
    ["no_evidence never upgraded, evidence cleared", "no_evidence", [e("project", "action")], "no_evidence", {}],
  ])("%s", (_, model, evidence, expected, counts) => {
    const report = emptyAi02Report();
    const out = applyMatchRules(model, evidence, report);
    expect(out.status).toBe(expected);
    if (expected === "no_evidence") expect(out.evidence).toEqual([]);
    expect(report).toMatchObject({ met_downgraded_partial: 0, items_downgraded: 0, ...counts });
  });
});

describe("mergeAi02Reports", () => {
  it("sums common and AI-02 keys; ignores unknown keys", () => {
    const merged = mergeAi02Reports({ items_total: 2, met_downgraded_partial: 1, junk: 5 }, { items_total: 1, met_downgraded_partial: 2 });
    expect(merged.items_total).toBe(3);
    expect(merged.met_downgraded_partial).toBe(3);
    expect("junk" in merged).toBe(false);
  });
});

describe("V-2 project scope (v4.5)", () => {
  const pack = buildCareerPack(careerRowsFixture(), { asOf: { year: 2026, month: 10 } });
  const ctx = { aliases: pack.aliases, learnings: "forbidden" as const };
  // PRJ-2 = 결제 승인 API 개선 (affiliated), PRJ-4 = 개인 가계부 앱 (standalone).
  it.each<[string, string, string, string, boolean]>([
    ["task on a standalone project", "PRJ-4", "task", "응답 시간", false],
    ["role on an affiliated project", "PRJ-2", "role", "백엔드", false],
    ["description on an affiliated project", "PRJ-2", "description", "결제", false],
    ["classification is never a field", "PRJ-2", "project_type", "개선", false],
    ["action on an affiliated project", "PRJ-2", "action", "인덱스를 재설계했다", true],
    ["description on a standalone project", "PRJ-4", "description", "문자 파싱으로 자동 기록을 만들었다", true],
  ])("%s", (_, ref, field, quote, ok) => {
    const r = checkEvidence({ source_type: "project", ref, field, quote }, ctx);
    expect(r.ok).toBe(ok);
    if (!ok) expect(r).toEqual({ ok: false, rule: "v2_field" });
  });

  it("deliverable body quote is checked against the normalized pack text", () => {
    expect(checkEvidence({ source_type: "project_deliverable", ref: "DLV-1", field: "body", quote: "은행 문자 10종의 형식을 정규식으로 분류했다" }, ctx).ok).toBe(true);
    expect(checkEvidence({ source_type: "project_deliverable", ref: "DLV-1", field: "body", quote: null }, ctx)).toEqual({ ok: false, rule: "v3_quote" });
  });
});
