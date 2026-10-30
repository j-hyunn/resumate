import { describe, expect, it } from "vitest";
import type { InsightMatchStatus } from "../schemas/AI-02";
import type { ValidatedEvidence } from "./evidence";
import { applyMatchRules, emptyAi02Report, mergeAi02Reports, supportsMet } from "./insight";

const e = (source_type: ValidatedEvidence["source_type"], field: string | null): ValidatedEvidence => ({
  source_type,
  ref: "X-1",
  field,
  quote: null,
  quote_adjusted: false,
});

describe("supportsMet (card 가드레일: action/result or achievement)", () => {
  it.each<[string, ValidatedEvidence[], boolean]>([
    ["detail action", [e("project_detail", "action")], true],
    ["detail result", [e("project_detail", "result")], true],
    ["achievement metric", [e("achievement", "metric")], true],
    ["achievement description", [e("achievement", "description")], true],
    ["detail situation", [e("project_detail", "situation")], false],
    ["detail task", [e("project_detail", "task")], false],
    ["skill only", [e("skill", "name")], false],
    ["project summary", [e("project", "summary")], false],
    ["experience summary", [e("experience", "summary")], false],
    ["jd sentence", [e("jd_sentence", null)], false],
    ["empty", [], false],
  ])("%s → %s", (_, evidence, expected) => {
    expect(supportsMet(evidence)).toBe(expected);
  });
});

describe("applyMatchRules (V-4 + met downgrade)", () => {
  it.each<[string, InsightMatchStatus, ValidatedEvidence[], InsightMatchStatus, Partial<Record<string, number>>]>([
    ["met with action stays met", "met", [e("project_detail", "action")], "met", {}],
    ["met with skill → partial", "met", [e("skill", "name")], "partial", { met_downgraded_partial: 1 }],
    ["met with situation → partial", "met", [e("project_detail", "situation")], "partial", { met_downgraded_partial: 1 }],
    ["met with JD only → no_evidence", "met", [e("jd_sentence", null)], "no_evidence", { items_downgraded: 1 }],
    ["met with nothing → no_evidence", "met", [], "no_evidence", { items_downgraded: 1 }],
    ["partial with skill stays partial", "partial", [e("skill", "name")], "partial", {}],
    ["partial with nothing → no_evidence", "partial", [], "no_evidence", { items_downgraded: 1 }],
    ["partial with learnings only → no_evidence", "partial", [e("project_detail", "learnings")], "no_evidence", { items_downgraded: 1 }],
    // A10: profile wishes are context, not a fact.
    ["partial with desired_job_title only → no_evidence (A10)", "partial", [e("profile", "desired_job_title")], "no_evidence", { items_downgraded: 1 }],
    ["partial with interested_industries only → no_evidence (A10)", "partial", [e("profile", "interested_industries")], "no_evidence", { items_downgraded: 1 }],
    ["partial with total_years_of_experience stays partial (연차 근거)", "partial", [e("profile", "total_years_of_experience")], "partial", {}],
    ["met with action + desired_job_title stays met", "met", [e("profile", "desired_job_title"), e("project_detail", "action")], "met", {}],
    ["no_evidence never upgraded, evidence cleared", "no_evidence", [e("project_detail", "action")], "no_evidence", {}],
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
