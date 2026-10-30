import { describe, expect, it } from "vitest";
import { careerRowsFixture } from "../__fixtures__/career-rows";
import { AliasMap } from "../context-pack/aliases";
import { buildCareerPack } from "../context-pack/career-pack";
import { buildJdContext, splitJdSentences } from "../context-pack/jd";
import { isCareerSupportEvidence, type EvidenceSourceType } from "../evidence-rules";
import { buildSelectionScope, checkEvidence, validateItem, type EvidenceContext, type ModelEvidence } from "./evidence";

const pack = buildCareerPack(careerRowsFixture(), { asOf: { year: 2026, month: 10 } });
const jdRaw = "결제 API 운영 경험이 필요합니다.\nKafka 경험 우대";
const jd = buildJdContext({
  jobDescriptionId: "jd-1",
  sentences: splitJdSentences(jdRaw),
  requirements: [
    { id: "req-uuid-1", category: "required", content: "결제 API 운영 경험", importance: "high", source_sids: ["S1"], sort_order: 1, updated_at: null },
  ],
  includeSentences: "all",
});
const aliases = AliasMap.merge(pack.aliases, jd.aliases);
const ctx: EvidenceContext = { aliases, learnings: "forbidden" };

const action: ModelEvidence = { source_type: "project_detail", ref: "DET-2", field: "action", quote: "병목 쿼리를 찾아 인덱스를 재설계했다" };

describe("checkEvidence V-1 → V-2 → V-3 → V-8 → V-7", () => {
  it.each<[string, ModelEvidence, EvidenceContext, string]>([
    ["V-1 unknown ref", { ...action, ref: "DET-99" }, ctx, "v1_ref"],
    ["V-1 ref of another type", { ...action, ref: "PRJ-2" }, ctx, "v1_ref"],
    ["V-1 malformed ref", { source_type: "skill", ref: "SKL-x", field: "name" }, ctx, "v1_ref"],
    ["V-1 writing_chat_message outside AI-12", { source_type: "writing_chat_message", ref: "M-1", quote: "x" }, ctx, "v1_ref"],
    ["V-2 field not allowed for type", { ...action, field: "company_name" }, ctx, "v2_field"],
    ["V-2 missing field for typed source", { ...action, field: null }, ctx, "v2_field"],
    ["V-2 field on field-less source", { source_type: "jd_sentence", ref: "S1", field: "text" }, ctx, "v2_field"],
    ["V-3 required quote missing", { ...action, quote: null }, ctx, "v3_quote"],
    ["V-3 invented quote", { ...action, quote: "Kafka 기반 이벤트 파이프라인을 구축했다" }, ctx, "v3_quote"],
    ["V-3 quote against the wrong field", { ...action, field: "result", quote: "병목 쿼리를 찾아 인덱스를 재설계했다" }, ctx, "v3_quote"],
    ["V-3 quote on empty field", { source_type: "project", ref: "PRJ-1", field: "summary", quote: "무엇이든" }, ctx, "v3_quote"],
    [
      "V-8 learnings where C-9 forbids",
      { source_type: "project_detail", ref: "DET-2", field: "learnings", quote: "측정 없이 최적화하면 안 된다는 것을 배웠다" },
      ctx,
      "v8_learnings",
    ],
    ["V-7 out of selection scope", action, { ...ctx, scope: new Set(["PRJ-1", "DET-1"]) }, "v7_scope"],
  ])("%s → removed (%s)", (_, raw, context, rule) => {
    expect(checkEvidence(raw, context)).toEqual({ ok: false, rule });
  });

  it.each<[string, ModelEvidence]>([
    ["action with quote", action],
    ["metric without quote (optional)", { source_type: "achievement", ref: "ACH-2", field: "metric" }],
    ["skill name", { source_type: "skill", ref: "SKL-1", field: "name" }],
    ["period", { source_type: "experience", ref: "EXP-1", field: "period" }],
    ["profile", { source_type: "profile", ref: "PROFILE", field: "desired_job_title", quote: "백엔드 개발자" }],
    ["jd sentence without field", { source_type: "jd_sentence", ref: "S1" }],
    ["jd sentence with quote", { source_type: "jd_sentence", ref: "S1", field: null, quote: "결제 API 운영 경험" }],
    ["jd requirement", { source_type: "jd_requirement", ref: "REQ-1" }],
  ])("%s → kept", (_, raw) => {
    const result = checkEvidence(raw, ctx);
    expect(result.ok).toBe(true);
  });

  it("stores the exact source span and null field for field-less sources", () => {
    expect(checkEvidence({ ...action, quote: "병목쿼리를 찾아 인덱스를 재설계 했다" }, ctx)).toEqual({
      ok: true,
      evidence: { source_type: "project_detail", ref: "DET-2", field: "action", quote: "병목 쿼리를 찾아 인덱스를 재설계했다", quote_adjusted: false },
    });
    expect(checkEvidence({ source_type: "jd_requirement", ref: "REQ-1", field: "" }, ctx)).toMatchObject({ ok: true, evidence: { field: null } });
  });

  it("learnings are valid under reflection_only", () => {
    const raw: ModelEvidence = { source_type: "project_detail", ref: "DET-2", field: "learnings", quote: "측정 없이 최적화하면 안 된다는 것을 배웠다" };
    expect(checkEvidence(raw, { ...ctx, learnings: "reflection_only" }).ok).toBe(true);
  });

  it("AI-12 may cite writing_chat_message when allowed and present", () => {
    const chat = new AliasMap();
    chat.add({ alias: "M-1", sourceType: "writing_chat_message", id: "m-uuid", fields: { "": "결제 시스템을 맡았어요" }, snapshotAt: null, label: null, parents: [] });
    expect(checkEvidence({ source_type: "writing_chat_message", ref: "M-1", quote: "결제 시스템을 맡았어요" }, { aliases: chat, learnings: "forbidden", allowWritingChatMessage: true }).ok).toBe(true);
  });
});

describe("validateItem V-4", () => {
  const bad: ModelEvidence = { ...action, ref: "DET-99" };
  const jdOnly: ModelEvidence = { source_type: "jd_requirement", ref: "REQ-1" };
  const learn: ModelEvidence = { source_type: "project_detail", ref: "DET-2", field: "learnings", quote: "측정 없이 최적화하면 안 된다는 것을 배웠다" };
  const wish: ModelEvidence = { source_type: "profile", ref: "PROFILE", field: "desired_job_title", quote: "백엔드 개발자" };
  const industries: ModelEvidence = { source_type: "profile", ref: "PROFILE", field: "interested_industries", quote: null };
  const years: ModelEvidence = { source_type: "profile", ref: "PROFILE", field: "total_years_of_experience", quote: null };

  it.each<[string, Parameters<typeof validateItem>[0], string, string[]]>([
    ["judgment with evidence → keep", { key: "strengths.0", kind: "judgment", evidence: [action] }, "keep", []],
    ["judgment loses all evidence → drop", { key: "strengths.0", kind: "judgment", evidence: [bad] }, "drop", []],
    ["judgment with JD evidence only → drop", { key: "strengths.0", kind: "judgment", evidence: [jdOnly] }, "drop", []],
    ["match without evidence → downgrade", { key: "requirement_matches.REQ-1", kind: "match", evidence: [bad] }, "downgrade", []],
    ["draft block without evidence → flag", { key: "p3-b1", kind: "draft_block", evidence: [], text: "x" }, "flag", ["evidence_check_needed"]],
    ["reference item may have none", { key: "gaps.0", kind: "reference", evidence: [jdOnly] }, "keep", []],
    // A10 (C-3 V-4 v4.3): profile wishes never count as support; total_years_of_experience does.
    ["judgment on desired_job_title only → drop (A10)", { key: "strategy.positioning", kind: "judgment", evidence: [wish] }, "drop", []],
    ["judgment on interested_industries only → drop (A10)", { key: "strengths.0", kind: "judgment", evidence: [industries] }, "drop", []],
    ["match on profile wishes only → downgrade (A10)", { key: "requirement_matches.REQ-1", kind: "match", evidence: [wish, industries] }, "downgrade", []],
    ["draft block on desired_job_title only → flag (A10)", { key: "q1-p1", kind: "draft_block", evidence: [wish], text: "x" }, "flag", ["evidence_check_needed"]],
    ["match on total_years_of_experience → keep (연차 근거)", { key: "requirement_matches.REQ-1", kind: "match", evidence: [years] }, "keep", []],
    ["judgment on wish + action → keep", { key: "strengths.0", kind: "judgment", evidence: [wish, action] }, "keep", []],
    [
      "learnings never the sole support (reflection_only judgment)",
      { key: "strengths.0", kind: "judgment", evidence: [learn], learnings: "reflection_only" },
      "drop",
      [],
    ],
    [
      "reflection block on learnings alone with reflective wording → keep",
      { key: "q3-b1", kind: "draft_block", evidence: [learn], learnings: "reflection_only", text: "측정의 중요성을 배웠습니다." },
      "keep",
      [],
    ],
    [
      "reflection block on learnings alone with assertive claim → flag (C-9 표현 검사)",
      { key: "q3-b1", kind: "draft_block", evidence: [learn], learnings: "reflection_only", text: "응답 시간을 크게 단축했습니다." },
      "flag",
      ["evidence_check_needed"],
    ],
  ])("%s", (_, item, action_, flags) => {
    const { outcome } = validateItem(item, ctx);
    expect(outcome.action).toBe(action_);
    expect(outcome.flags).toEqual(flags);
    if (action_ === "drop") expect(outcome.evidence).toEqual([]);
  });

  it("counts removals per rule and dedupes repeated evidence in the report", () => {
    const { outcome, report } = validateItem(
      {
        key: "strengths.0",
        kind: "judgment",
        evidence: [action, action, bad, { ...action, field: "company_name" }, learn, { ...action, quote: "인덱스를 재설계했습니" }],
      },
      ctx,
    );
    expect(outcome.evidence.map((e) => e.quote_adjusted)).toEqual([false, true]);
    expect(report).toMatchObject({
      items_total: 1,
      evidence_total: 6,
      evidence_kept: 2,
      evidence_removed_v1_ref: 1,
      evidence_removed_v2_field: 1,
      evidence_removed_v8_learnings: 1,
      quotes_adjusted: 1,
    });
  });
});

describe("buildSelectionScope (V-7)", () => {
  it("expands selected projects to their details, achievements and skills, plus profile and JD", () => {
    const scope = buildSelectionScope(aliases, { refs: ["PRJ-2"] });
    expect([...scope].sort()).toEqual(["ACH-2", "DET-2", "DET-3", "PRJ-2", "PROFILE", "REQ-1", "S1", "S2", "SKL-1", "SKL-2"].sort());
  });

  it("selecting an experience includes its projects and experience-level achievements; detailRefs narrows details", () => {
    const scope = buildSelectionScope(aliases, { refs: ["EXP-1"], detailRefs: ["DET-2"] });
    expect(scope.has("ACH-1")).toBe(true);
    expect(scope.has("PRJ-1")).toBe(true);
    expect(scope.has("DET-2")).toBe(true);
    expect(scope.has("ACH-2")).toBe(true);
    expect(scope.has("DET-3")).toBe(false);
    expect(scope.has("DET-1")).toBe(false);
    expect(scope.has("EXP-2")).toBe(false);
    expect(scope.has("SKL-3")).toBe(false); // manual skill isn't under a selected project
  });
});

describe("isCareerSupportEvidence (A10)", () => {
  it.each<[string, { source_type: string; field: string | null }, boolean]>([
    ["profile desired_job_title", { source_type: "profile", field: "desired_job_title" }, false],
    ["profile interested_industries", { source_type: "profile", field: "interested_industries" }, false],
    ["profile total_years_of_experience", { source_type: "profile", field: "total_years_of_experience" }, true],
    ["detail action", { source_type: "project_detail", field: "action" }, true],
    ["skill", { source_type: "skill", field: "name" }, true],
    ["jd sentence", { source_type: "jd_sentence", field: null }, false],
    ["jd requirement", { source_type: "jd_requirement", field: null }, false],
    ["unknown type", { source_type: "nope", field: null }, false],
  ])("%s → %s", (_, e, expected) => {
    expect(isCareerSupportEvidence(e)).toBe(expected);
  });

  it("a feature's own support set still excludes profile wishes", () => {
    const onlyProfile = new Set<EvidenceSourceType>(["profile"]);
    expect(isCareerSupportEvidence({ source_type: "profile", field: "desired_job_title" }, onlyProfile)).toBe(false);
    expect(isCareerSupportEvidence({ source_type: "profile", field: "total_years_of_experience" }, onlyProfile)).toBe(true);
    expect(isCareerSupportEvidence({ source_type: "skill", field: "name" }, onlyProfile)).toBe(false);
  });
});
