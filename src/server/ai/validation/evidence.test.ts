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

const action: ModelEvidence = { source_type: "project", ref: "PRJ-2", field: "action", quote: "병목 쿼리를 찾아 인덱스를 재설계했다" };

describe("checkEvidence V-1 → V-2 → V-3 → V-8 → V-7", () => {
  it.each<[string, ModelEvidence, EvidenceContext, string]>([
    ["V-1 unknown ref", { ...action, ref: "PRJ-99" }, ctx, "v1_ref"],
    ["V-1 removed alias type (v4.5 DET-n)", { ...action, ref: "DET-2" }, ctx, "v1_ref"],
    ["V-1 ref of another type", { ...action, ref: "EXP-1" }, ctx, "v1_ref"],
    ["V-1 malformed ref", { source_type: "skill", ref: "SKL-x", field: "name" }, ctx, "v1_ref"],
    ["V-1 writing_chat_message outside AI-12", { source_type: "writing_chat_message", ref: "M-1", quote: "x" }, ctx, "v1_ref"],
    ["V-2 field not allowed for type", { ...action, field: "company_name" }, ctx, "v2_field"],
    ["V-2 missing field for typed source", { ...action, field: null }, ctx, "v2_field"],
    ["V-2 field on field-less source", { source_type: "jd_sentence", ref: "S1", field: "text" }, ctx, "v2_field"],
    ["V-3 required quote missing", { ...action, quote: null }, ctx, "v3_quote"],
    ["V-3 invented quote", { ...action, quote: "Kafka 기반 이벤트 파이프라인을 구축했다" }, ctx, "v3_quote"],
    ["V-3 quote against the wrong field", { ...action, field: "result", quote: "병목 쿼리를 찾아 인덱스를 재설계했다" }, ctx, "v3_quote"],
    ["V-3 quote on empty field", { source_type: "project", ref: "PRJ-1", field: "task", quote: "무엇이든" }, ctx, "v3_quote"],
    ["V-2 removed project field (summary)", { source_type: "project", ref: "PRJ-1", field: "summary", quote: "무엇이든" }, ctx, "v2_field"],
    ["V-2 classification is never citable", { source_type: "project", ref: "PRJ-2", field: "project_type", quote: null }, ctx, "v2_field"],
    ["V-2 STAR field on a standalone project", { source_type: "project", ref: "PRJ-4", field: "action", quote: "문자 파싱으로 자동 기록을 만들었다" }, ctx, "v2_field"],
    ["V-2 role on an affiliated project", { source_type: "project", ref: "PRJ-2", field: "role", quote: "1인 개발" }, ctx, "v2_field"],
    ["V-2 description on an affiliated project", { source_type: "project", ref: "PRJ-2", field: "description", quote: "병목 쿼리" }, ctx, "v2_field"],
    ["V-3 deliverable body quote outside the pack text", { source_type: "project_deliverable", ref: "DLV-1", field: "body", quote: "Kafka 클러스터를 운영했다" }, ctx, "v3_quote"],
    ["V-3 deliverable body quote required", { source_type: "project_deliverable", ref: "DLV-1", field: "body", quote: null }, ctx, "v3_quote"],
    [
      "V-8 learnings where C-9 forbids",
      { source_type: "project", ref: "PRJ-2", field: "learnings", quote: "측정 없이 최적화하면 안 된다는 것을 배웠다" },
      ctx,
      "v8_learnings",
    ],
    ["V-7 out of selection scope", action, { ...ctx, scope: new Set(["PRJ-1"]) }, "v7_scope"],
  ])("%s → removed (%s)", (_, raw, context, rule) => {
    expect(checkEvidence(raw, context)).toEqual({ ok: false, rule });
  });

  it.each<[string, ModelEvidence]>([
    ["action with quote", action],
    ["project name without quote (optional)", { source_type: "project", ref: "PRJ-2", field: "name" }],
    ["result quote (numbers live in the narrative)", { source_type: "project", ref: "PRJ-2", field: "result", quote: "응답 시간이 0.7초로 줄었다" }],
    ["standalone role", { source_type: "project", ref: "PRJ-4", field: "role", quote: "1인 개발" }],
    ["standalone description", { source_type: "project", ref: "PRJ-4", field: "description", quote: "문자 파싱으로 자동 기록을 만들었다" }],
    ["deliverable title without quote", { source_type: "project_deliverable", ref: "DLV-1", field: "title" }],
    ["deliverable body on normalized text", { source_type: "project_deliverable", ref: "DLV-1", field: "body", quote: "은행 문자 10종의 형식을 정규식으로 분류했다" }],
    ["skill name", { source_type: "skill", ref: "SKL-1", field: "name" }],
    ["period", { source_type: "experience", ref: "EXP-1", field: "period" }],
    ["jd sentence without field", { source_type: "jd_sentence", ref: "S1" }],
    ["jd sentence with quote", { source_type: "jd_sentence", ref: "S1", field: null, quote: "결제 API 운영 경험" }],
    ["jd requirement", { source_type: "jd_requirement", ref: "REQ-1" }],
  ])("%s → kept", (_, raw) => {
    const result = checkEvidence(raw, ctx);
    expect(result.ok).toBe(true);
  });

  it("V-3 on STAR markdown (v4.10 UP-14): quotes match the plain text; list markers in the quote are ignored", () => {
    const rows = careerRowsFixture();
    const target = rows.projects.find((p) => p.action === "결제 승인 API의 병목 쿼리를 찾아 인덱스를 재설계했다")!;
    target.action = "1. **APM**으로 병목 쿼리를 찾음\n2. 인덱스를 \\[재\\]설계함\n   - 응답 2초 &lt;목표>";
    const md = buildCareerPack(rows, { asOf: { year: 2026, month: 10 } });
    const mdCtx: EvidenceContext = { aliases: md.aliases, learnings: "forbidden" };
    const ref = md.aliases.aliasOf("project", target.id)!;
    expect(md.text).toContain("1. **APM**으로 병목 쿼리를 찾음"); // the model sees the stored markdown
    const check = (quote: string) => checkEvidence({ source_type: "project", ref, field: "action", quote }, mdCtx);
    // Across list items: the plain text has no "2." between them.
    expect(check("병목 쿼리를 찾음 인덱스를 [재]설계함")).toMatchObject({ ok: true, evidence: { quote: "병목 쿼리를 찾음\n인덱스를 [재]설계함", quote_adjusted: false } });
    // The model copied the markdown (number, bold, escape, entity).
    expect(check("2. 인덱스를 \\[재\\]설계함\n   - 응답 2초 &lt;목표>")).toMatchObject({ ok: true, evidence: { quote: "인덱스를 [재]설계함\n응답 2초 <목표", quote_adjusted: false } });
    expect(check("**APM**으로 병목 쿼리를 찾음")).toMatchObject({ ok: true, evidence: { quote: "APM으로 병목 쿼리를 찾음" } });
    expect(check("Kafka로 병목을 없앰")).toEqual({ ok: false, rule: "v3_quote" });
  });

  it("stores the exact source span and null field for field-less sources", () => {
    expect(checkEvidence({ ...action, quote: "병목쿼리를 찾아 인덱스를 재설계 했다" }, ctx)).toEqual({
      ok: true,
      evidence: { source_type: "project", ref: "PRJ-2", field: "action", quote: "병목 쿼리를 찾아 인덱스를 재설계했다", quote_adjusted: false },
    });
    expect(checkEvidence({ source_type: "jd_requirement", ref: "REQ-1", field: "" }, ctx)).toMatchObject({ ok: true, evidence: { field: null } });
  });

  it("learnings are valid under reflection_only", () => {
    const raw: ModelEvidence = { source_type: "project", ref: "PRJ-2", field: "learnings", quote: "측정 없이 최적화하면 안 된다는 것을 배웠다" };
    expect(checkEvidence(raw, { ...ctx, learnings: "reflection_only" }).ok).toBe(true);
  });

  it("AI-12 may cite writing_chat_message when allowed and present", () => {
    const chat = new AliasMap();
    chat.add({ alias: "M-1", sourceType: "writing_chat_message", id: "m-uuid", fields: { "": "결제 시스템을 맡았어요" }, snapshotAt: null, label: null, parents: [] });
    expect(checkEvidence({ source_type: "writing_chat_message", ref: "M-1", quote: "결제 시스템을 맡았어요" }, { aliases: chat, learnings: "forbidden", allowWritingChatMessage: true }).ok).toBe(true);
  });
});

describe("validateItem V-4", () => {
  const bad: ModelEvidence = { ...action, ref: "PRJ-99" };
  const jdOnly: ModelEvidence = { source_type: "jd_requirement", ref: "REQ-1" };
  const learn: ModelEvidence = { source_type: "project", ref: "PRJ-2", field: "learnings", quote: "측정 없이 최적화하면 안 된다는 것을 배웠다" };
  // (v4.12, SD-6) `profile` is not a source type any more: V-2 drops it whatever the field.
  const wish = { source_type: "profile" as never, ref: "PROFILE", field: "desired_job_title", quote: "백엔드 개발자" } as ModelEvidence;
  const years = { source_type: "profile" as never, ref: "PROFILE", field: "total_years_of_experience", quote: null } as ModelEvidence;

  it.each<[string, Parameters<typeof validateItem>[0], string, string[]]>([
    ["judgment with evidence → keep", { key: "strengths.0", kind: "judgment", evidence: [action] }, "keep", []],
    ["judgment loses all evidence → drop", { key: "strengths.0", kind: "judgment", evidence: [bad] }, "drop", []],
    ["judgment with JD evidence only → drop", { key: "strengths.0", kind: "judgment", evidence: [jdOnly] }, "drop", []],
    ["match without evidence → downgrade", { key: "requirement_matches.REQ-1", kind: "match", evidence: [bad] }, "downgrade", []],
    ["draft block without evidence → flag", { key: "p3-b1", kind: "draft_block", evidence: [], text: "x" }, "flag", ["evidence_check_needed"]],
    ["reference item may have none", { key: "gaps.0", kind: "reference", evidence: [jdOnly] }, "keep", []],
    // (v4.12, SD-6) V-4 has no profile exception left: every profile evidence is
    // dropped by V-2, so an item that rests on one has zero evidence.
    ["judgment on a profile source only → drop (SD-6)", { key: "strategy.positioning", kind: "judgment", evidence: [wish] }, "drop", []],
    ["match on a profile source only → downgrade (SD-6)", { key: "requirement_matches.REQ-1", kind: "match", evidence: [wish, years] }, "downgrade", []],
    ["draft block on a profile source only → flag (SD-6)", { key: "q1-p1", kind: "draft_block", evidence: [wish], text: "x" }, "flag", ["evidence_check_needed"]],
    ["judgment on profile + action → keep (the action carries it)", { key: "strengths.0", kind: "judgment", evidence: [wish, action] }, "keep", []],
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
  it("an affiliated project is its own STAR scope (no DET/ACH in v4.5), plus JD — (v4.12, SD-6) no profile", () => {
    const scope = buildSelectionScope(aliases, { refs: ["PRJ-2"] });
    expect([...scope].sort()).toEqual(["PRJ-2", "REQ-1", "S1", "S2"].sort());
  });

  it("a selected standalone project brings its deliverables and skills, not other projects'", () => {
    const scope = buildSelectionScope(aliases, { refs: ["PRJ-4"] });
    expect([...scope].sort()).toEqual(["DLV-1", "DLV-2", "PRJ-4", "REQ-1", "S1", "S2", "SKL-1", "SKL-2"].sort());
    expect(buildSelectionScope(aliases, { refs: ["PRJ-2"] }).has("DLV-1")).toBe(false);
    expect(buildSelectionScope(aliases, { refs: ["PRJ-2"] }).has("SKL-1")).toBe(false);
  });

  it("selecting an experience includes its projects only", () => {
    const scope = buildSelectionScope(aliases, { refs: ["EXP-1"] });
    expect(scope.has("PRJ-1")).toBe(true);
    expect(scope.has("PRJ-2")).toBe(true);
    expect(scope.has("PRJ-3")).toBe(false);
    expect(scope.has("PRJ-4")).toBe(false);
    expect(scope.has("EXP-2")).toBe(false);
    expect(scope.has("SKL-3")).toBe(false); // manual skill isn't under a selected project
  });
});

describe("isCareerSupportEvidence (A10)", () => {
  it.each<[string, { source_type: string; field: string | null }, boolean]>([
    ["profile desired_job_title", { source_type: "profile", field: "desired_job_title" }, false],
    ["profile interested_industries", { source_type: "profile", field: "interested_industries" }, false],
    ["profile (dropped source type, SD-6)", { source_type: "profile", field: "total_years_of_experience" }, false],
    ["project action", { source_type: "project", field: "action" }, true],
    ["deliverable body", { source_type: "project_deliverable", field: "body" }, true],
    ["removed type project_detail", { source_type: "project_detail", field: "action" }, false],
    ["skill", { source_type: "skill", field: "name" }, true],
    ["jd sentence", { source_type: "jd_sentence", field: null }, false],
    ["jd requirement", { source_type: "jd_requirement", field: null }, false],
    ["unknown type", { source_type: "nope", field: null }, false],
  ])("%s → %s", (_, e, expected) => {
    expect(isCareerSupportEvidence(e)).toBe(expected);
  });

  it("a feature's own support set narrows the types (SD-6: no profile exception left)", () => {
    const onlyProjects = new Set<EvidenceSourceType>(["project"]);
    expect(isCareerSupportEvidence({ source_type: "project", field: "action" }, onlyProjects)).toBe(true);
    expect(isCareerSupportEvidence({ source_type: "skill", field: "name" }, onlyProjects)).toBe(false);
    expect(isCareerSupportEvidence({ source_type: "profile", field: "total_years_of_experience" })).toBe(false);
  });
});
