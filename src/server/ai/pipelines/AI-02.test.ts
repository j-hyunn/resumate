import { describe, expect, it } from "vitest";
import {
  alias,
  enInput,
  ev,
  koInput,
  koMatchOutputs,
  koSynthesis,
  match,
  matchOutput,
  reqId,
  thinRows,
  JD_ID,
} from "../__fixtures__/AI-02/insight";
import { careerRowsFixture, IDS } from "../__fixtures__/career-rows";
import { AiError } from "../errors";
import { createFakeLlm, type FakeLlm } from "../fake-llm";
import type { AiLogEntry } from "../log";
import { AI02_PROMPT_VERSION, AI02_SYSTEM } from "../prompts/AI-02";
import { toCanonicalJsonSchema } from "../providers/schema";
import { resolveModel } from "../providers/models";
import { Ai02MatchOutputSchema, Ai02SynthesisOutputSchema, type Ai02SynthesisOutput } from "../schemas/AI-02";
import { INSIGHT_ITEM_KEYS } from "../storage/insight";
import { NUMBER_CHECK_TOKEN } from "../validation/numbers";
import { MET_DOWNGRADE_MISSING_ASPECT, NO_EVIDENCE_RATIONALE } from "../validation/insight";
import {
  AI02_BATCH_SIZE,
  AI02_TIER,
  THIN_HINTS,
  batchRequirements,
  buildInsightContext,
  computeInsightInputHash,
  finalizeInsight,
  matchRequirements,
  restoreMatches,
  regenerateSynthesis,
  synthesizeOnce,
  InsightRequirementsChangedError,
  type SynthesisAttempt,
  type InsightContext,
  type MatchBatchResult,
} from "./AI-02";

const NOW = new Date("2026-11-01T00:00:00.000Z");

function ctxKo(rows = careerRowsFixture()): InsightContext {
  return buildInsightContext(koInput(rows));
}

async function runStage1(ctx: InsightContext, outputs: readonly unknown[], llm?: FakeLlm): Promise<{ batches: MatchBatchResult[]; llm: FakeLlm }> {
  const fake = llm ?? createFakeLlm(outputs.map((json) => ({ json })));
  const ids = ctx.requirements.map((r) => r.id);
  const batches: MatchBatchResult[] = [];
  for (const [i, batch] of batchRequirements(ids).entries()) {
    batches.push(await matchRequirements({ context: ctx, batchIndex: i, requirementIds: batch }, { llm: fake }));
  }
  return { batches, llm: fake };
}

/** JSON round trip, as the job runner stores step outputs. */
function roundTrip<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function hasKeyDeep(value: unknown, key: string): boolean {
  if (Array.isArray(value)) return value.some((v) => hasKeyDeep(v, key));
  if (value === null || typeof value !== "object") return false;
  return Object.entries(value).some(([k, v]) => k === key || hasKeyDeep(v, key));
}

async function rejectsWith(promise: Promise<unknown>, code: string, retryable = false) {
  const err = await promise.then(
    () => null,
    (e: unknown) => e,
  );
  expect(err).toBeInstanceOf(AiError);
  expect((err as AiError).code).toBe(code);
  expect((err as AiError).retryable).toBe(retryable);
}

type Synthesis = { first: SynthesisAttempt; regen: SynthesisAttempt | null };

/** The job's step order: synthesize → synthesize_regen (only with violations), each a separate step (QA-S6-03). */
async function synthesizeSteps(ctx: InsightContext, batches: readonly MatchBatchResult[], llm: FakeLlm, logger?: (e: AiLogEntry) => void): Promise<Synthesis> {
  const first = roundTrip(await synthesizeOnce({ context: ctx, batches }, { llm, logger }));
  const regen = first.violations.length ? roundTrip(await regenerateSynthesis({ context: ctx, batches, violations: first.violations }, { llm, logger })) : null;
  return { first, regen };
}

function finalize(ctx: InsightContext, batches: readonly MatchBatchResult[], s: Synthesis, snapshot = { careerSnapshotHash: ctx.careerSnapshotHash, requirementsHash: ctx.requirementsHash }) {
  return finalizeInsight({ context: ctx, batches, first: s.first, regen: s.regen, snapshot, provider: "anthropic", modelTier: "default", connectionTier: "paid", now: NOW });
}

describe("batchRequirements", () => {
  it("splits into batches of 8 by default", () => {
    const ids = Array.from({ length: 17 }, (_, i) => i);
    expect(batchRequirements(ids).map((b) => b.length)).toEqual([8, 8, 1]);
    expect(batchRequirements(ids.slice(0, 8)).map((b) => b.length)).toEqual([8]);
    expect(batchRequirements([])).toEqual([]);
    expect(AI02_BATCH_SIZE).toBe(8);
  });

  it("rejects a non-positive size", () => {
    expect(() => batchRequirements([1], 0)).toThrow();
  });
});

describe("buildInsightContext", () => {
  it("is deterministic and numbers requirements REQ-1.. by sort_order", () => {
    const a = ctxKo();
    const b = ctxKo();
    expect(a.pack.text).toBe(b.pack.text);
    expect(a.jdText).toBe(b.jdText);
    expect(a.requirements.map((r) => r.ref)).toEqual(Array.from({ length: 10 }, (_, i) => `REQ-${i + 1}`));
    expect(a.requirements[0].id).toBe(reqId(1));
    expect(a.careerSnapshotHash).toBe(b.careerSnapshotHash);
  });

  it("puts the seniority label in the JD block and allows its numbers (V-5)", () => {
    const ctx = ctxKo();
    expect(ctx.jdText).toContain("seniority: 백엔드 개발 경력 5년 이상");
    expect(ctx.jdText.endsWith("</jd>")).toBe(true);
    expect(ctx.allowedNumbers.has("5")).toBe(true);
    expect(ctx.allowedNumbers.has("1.2")).toBe(true);
    // learnings-only number (99%) is not a fact (C-9)
    expect(ctx.allowedNumbers.has("99")).toBe(false);
  });

  it("data_sufficiency: ok with 4 complete projects and quantitative achievements", () => {
    expect(ctxKo().dataSufficiency).toEqual({ level: "ok", hints: [] });
  });

  it("data_sufficiency: thin with ≤ 2 projects and no quantitative achievement [가정 S6-4]", () => {
    const ctx = ctxKo(thinRows());
    expect(ctx.dataSufficiency.level).toBe("thin");
    expect(ctx.dataSufficiency.hints).toEqual([THIN_HINTS.fewProjects, THIN_HINTS.noQuantitative]);
  });
});

describe("matchRequirements (stage 1)", () => {
  it("one call per batch: default tier, low reasoning, structured output, shared cache prefix", async () => {
    const ctx = ctxKo();
    const { batches, llm } = await runStage1(ctx, koMatchOutputs(ctx));
    expect(llm.requests).toHaveLength(2);
    const [r1, r2] = llm.requests;
    expect(r1.tier).toBe(AI02_TIER);
    expect(r1.reasoningLevel).toBe("low");
    expect(r1.outputSchema).not.toBeNull();
    expect(r1.callKey).toBe("insight.match.1");
    expect(r2.callKey).toBe("insight.match.2");
    // C-8: system + pack + JD identical across batches; only the task differs.
    expect(r1.systemBlocks).toEqual(r2.systemBlocks);
    expect(r1.userBlocks.slice(0, 2)).toEqual(r2.userBlocks.slice(0, 2));
    expect(r1.userBlocks[2].text).toContain("REQ-1, REQ-2");
    expect(r2.userBlocks[2].text).toContain("REQ-9, REQ-10");
    expect(batches.map((b) => b.matches.length)).toEqual([8, 2]);
    expect(llm.records).toHaveLength(2);
  });

  it("stage-1 output survives a JSON round trip unchanged (job step output)", async () => {
    const ctx = ctxKo();
    const { batches } = await runStage1(ctx, koMatchOutputs(ctx));
    expect(roundTrip(batches)).toEqual(batches);
    // UUIDs, not aliases
    const ev1 = batches[0].matches[0].evidence[0];
    expect(ev1.source_id).toBe(IDS.detPay1);
    expect(batches[0].matches[0].requirement_id).toBe(reqId(1));
  });

  it("applies the verdict rules (met downgrade, V-4, V-8, fill, V-3 adjust)", async () => {
    const ctx = ctxKo();
    const { batches } = await runStage1(ctx, koMatchOutputs(ctx));
    const all = batches.flatMap((b) => b.matches);
    const byReq = (n: number) => all.find((m) => m.requirement_id === reqId(n))!;
    expect(byReq(1).status).toBe("met");
    expect(byReq(2).status).toBe("met");
    // skill tag only → partial (card 가드레일)
    expect(byReq(4).status).toBe("partial");
    expect(byReq(4).model_status).toBe("met");
    expect(byReq(4).missing_aspect).toBe(MET_DOWNGRADE_MISSING_ASPECT);
    expect(byReq(5).status).toBe("partial");
    // situation only → partial
    expect(byReq(6).status).toBe("partial");
    // partial quote → closest source span, quote_adjusted
    expect(byReq(7).status).toBe("met");
    expect(byReq(7).evidence[0].quote_adjusted).toBe(true);
    expect(byReq(8).status).toBe("no_evidence");
    // learnings only → V-8 removes it → V-4 no_evidence
    expect(byReq(9).status).toBe("no_evidence");
    expect(byReq(9).evidence).toEqual([]);
    expect(byReq(9).rationale).toBe(NO_EVIDENCE_RATIONALE);
    // skipped by the model → filled [가정 S6-2]
    expect(byReq(10)).toMatchObject({ status: "no_evidence", model_status: null, evidence: [] });

    expect(batches[0].report.met_downgraded_partial).toBe(2);
    expect(batches[0].report.quotes_adjusted).toBe(1);
    expect(batches[1].report.evidence_removed_v8_learnings).toBe(1);
    expect(batches[1].report.items_downgraded).toBe(1);
    expect(batches[1].report.matches_filled_missing).toBe(1);
  });

  it("drops unknown requirement refs and duplicates, removes bad evidence (V-1/V-2/V-3)", async () => {
    const ctx = ctxKo();
    const ids = ctx.requirements.slice(0, 2).map((r) => r.id);
    const out = matchOutput([
      match("REQ-1", "met", [
        { source_type: "project_detail", ref: "DET-99", field: "action", quote: "없는 상세" },
        { source_type: "project_detail", ref: alias(ctx, "project_detail", IDS.detPay1), field: "outcome", quote: "응답 시간이 0.7초로 줄었다" },
        { source_type: "project_detail", ref: alias(ctx, "project_detail", IDS.detPay1), field: "result", quote: "전혀 다른 문장이 인용되었다고 가정한다" },
        ev.result(ctx, IDS.detPay1, "응답 시간이 0.7초로 줄었다"),
      ]),
      match("REQ-1", "no_evidence"),
      match("REQ-9", "met", [ev.action(ctx, IDS.detPay2, "런북을 작성하고 알림 규칙을 정리했다")]),
      match("REQ-2", "no_evidence", [ev.action(ctx, IDS.detSettle, "정산 배치를 청크 단위로 재설계했다")]),
    ]);
    const llm = createFakeLlm([{ json: out }]);
    const result = await matchRequirements({ context: ctx, batchIndex: 0, requirementIds: ids }, { llm });
    expect(result.matches.map((m) => m.status)).toEqual(["met", "no_evidence"]);
    expect(result.matches[0].evidence).toHaveLength(1);
    // no_evidence verdicts cite nothing
    expect(result.matches[1].evidence).toEqual([]);
    expect(result.report).toMatchObject({
      matches_dropped_unknown_ref: 1,
      matches_dropped_duplicate: 1,
      evidence_removed_v1_ref: 1,
      evidence_removed_v2_field: 1,
      evidence_removed_v3_quote: 1,
    });
  });

  it("V-5 in rationale: an invented number is replaced (no regeneration in stage 1)", async () => {
    const ctx = ctxKo();
    const out = matchOutput([
      match("REQ-1", "met", [ev.action(ctx, IDS.detPay1, "결제 승인 API의 병목 쿼리를 찾아 인덱스를 재설계했다")], {
        rationale: "응답 시간을 40% 줄이고 1.2초 병목을 해결했습니다.",
      }),
    ]);
    const llm = createFakeLlm([{ json: out }]);
    const result = await matchRequirements({ context: ctx, batchIndex: 0, requirementIds: [reqId(1)] }, { llm });
    expect(result.matches[0].rationale).toBe(`응답 시간을 ${NUMBER_CHECK_TOKEN} 줄이고 1.2초 병목을 해결했습니다.`);
    expect(result.report.number_violations).toBe(1);
    expect(result.report.numbers_replaced).toBe(1);
    expect(llm.requests).toHaveLength(1);
  });

  it("aliases in stage-1 prose become labels (QA-S6-04)", async () => {
    const ctx = ctxKo();
    const prj = alias(ctx, "project", IDS.prjPay);
    const det = alias(ctx, "project_detail", IDS.detPay1);
    const out = matchOutput([
      match("REQ-1", "met", [ev.action(ctx, IDS.detPay1, "결제 승인 API의 병목 쿼리를 찾아 인덱스를 재설계했다")], {
        rationale: `${prj}의 ${det}.action이 REQ-1을 뒷받침합니다(PRJ-99).`,
        missing_aspect: "REQ-1 운영 규모",
      }),
    ]);
    const result = await matchRequirements({ context: ctx, batchIndex: 0, requirementIds: [reqId(1)] }, { llm: createFakeLlm([{ json: out }]) });
    expect(result.matches[0].rationale).toBe("'결제 승인 API 개선'의 '승인 API 병목 제거'이 '결제 승인 API 설계 및 운영'을 뒷받침합니다.");
    expect(result.matches[0].missing_aspect).toBe("'결제 승인 API 설계 및 운영' 운영 규모");
    expect(result.report).toMatchObject({ aliases_replaced: 4, aliases_removed: 1 });
  });

  it("V-6: schema mismatch twice → schema_invalid, not retryable", async () => {
    const ctx = ctxKo();
    const llm = createFakeLlm([{ json: { schema_version: 1 } }, { text: "not json" }]);
    await rejectsWith(matchRequirements({ context: ctx, batchIndex: 0, requirementIds: [reqId(1)] }, { llm }), "schema_invalid");
    expect(llm.requests).toHaveLength(2);
  });

  it("provider errors propagate as is", async () => {
    const ctx = ctxKo();
    const llm = createFakeLlm([{ error: "rate_limited", retryAfterMs: 1000 }]);
    await rejectsWith(matchRequirements({ context: ctx, batchIndex: 0, requirementIds: [reqId(1)] }, { llm }), "rate_limited", true);
  });

  it("rejects an empty batch or an unknown requirement id (caller bug)", async () => {
    const ctx = ctxKo();
    const llm = createFakeLlm([]);
    await expect(matchRequirements({ context: ctx, batchIndex: 0, requirementIds: [] }, { llm })).rejects.toThrow();
    await expect(matchRequirements({ context: ctx, batchIndex: 0, requirementIds: ["nope"] }, { llm })).rejects.toThrow();
  });

  it("English JD requirement: one batch, skill-only evidence stays partial", async () => {
    const ctx = buildInsightContext(enInput());
    expect(ctx.requirements).toHaveLength(1);
    const out = matchOutput([match("REQ-1", "met", [ev.skill(ctx, IDS.sklManual)], { missing_aspect: null })]);
    const { batches } = await runStage1(ctx, [out]);
    expect(batches[0].matches[0].status).toBe("partial");
    expect(ctx.jdText).toContain("Experience tuning PostgreSQL queries in production.");
  });
});

describe("synthesizeOnce / regenerateSynthesis + finalizeInsight (stage 2)", () => {
  async function fullRun(synthOutputs: unknown[] = [], rows = careerRowsFixture()) {
    const ctx = ctxKo(rows);
    const { batches } = await runStage1(ctx, koMatchOutputs(ctx));
    const llm = createFakeLlm((synthOutputs.length ? synthOutputs : [koSynthesis(ctx)]).map((json) => ({ json })));
    const synthesis = await synthesizeSteps(ctx, roundTrip(batches), llm);
    return { ctx, batches, llm, synthesis, final: finalize(ctx, roundTrip(batches), synthesis) };
  }

  it("medium reasoning, same cache prefix as stage 1, verdicts in <match_results>", async () => {
    const { llm, synthesis } = await fullRun();
    const req = llm.requests[0];
    expect(req.reasoningLevel).toBe("medium");
    expect(req.callKey).toBe("insight.synthesize");
    expect(req.systemBlocks[1].text).toBe(AI02_SYSTEM);
    const results = req.userBlocks[2].text;
    expect(results).toContain("<match_results>");
    expect(results).toContain("REQ-4 | status: partial");
    expect(results).toContain("REQ-10 | status: no_evidence");
    expect(synthesis.regen).toBeNull();
    expect(synthesis.first.violations).toEqual([]);
  });

  it("payload: complete_insight shape, item_keys, UUIDs, no evidence in result", async () => {
    const { final } = await fullRun();
    const { payload } = final;
    expect(hasKeyDeep(payload.result, "evidence")).toBe(false);
    expect(hasKeyDeep(payload.result, "positioning_evidence")).toBe(false);
    expect(hasKeyDeep(payload.match_stage_result, "evidence")).toBe(false);

    expect(payload.result.requirement_matches).toHaveLength(10);
    expect(payload.result.requirement_matches[0]).toMatchObject({ item_key: `requirement_matches.${reqId(1)}`, requirement_id: reqId(1), status: "met" });
    expect(payload.result.summary_counts).toEqual({ met: 4, partial: 3, no_evidence: 3 });
    expect(payload.result.data_sufficiency).toEqual({ level: "ok", hints: [] });
    expect(payload.result.basis_note).toBe("입력된 경력 데이터 기준 분석입니다");

    expect(payload.result.strengths.map((s) => s.item_key)).toEqual(["strengths.0", "strengths.1"]);
    expect(payload.result.strengths[0].requirement_ids).toEqual([reqId(1), reqId(7)]);
    expect(payload.result.gaps[0]).toMatchObject({ item_key: "gaps.0", requirement_ids: [reqId(8)], gap_kind: "no_evidence" });
    expect(payload.result.gaps[0].actions.map((a) => a.item_key)).toEqual(["gaps.0.actions.0", "gaps.0.actions.1"]);
    expect(payload.result.strategy.positioning_item_key).toBe(INSIGHT_ITEM_KEYS.positioning);
    expect(payload.result.strategy.project_priorities[0]).toMatchObject({ item_key: "strategy.project_priorities.0", rank: 1, project_id: IDS.prjPay });

    // evidence rows: UUIDs, item keys that exist in result, JD sentence locator
    const keys = new Set(payload.evidence.map((e) => e.item_key));
    expect(keys).toEqual(
      new Set([
        ...[1, 2, 3, 4, 5, 6, 7].map((n) => `requirement_matches.${reqId(n)}`),
        "strengths.0",
        "strengths.1",
        "gaps.0",
        "gaps.0.actions.1",
        "gaps.1.actions.0",
        "strategy.positioning",
      ]),
    );
    for (const e of payload.evidence) expect(e.source_id).toMatch(/^[0-9a-f-]{36}$/);
    const sentence = payload.evidence.find((e) => e.source_type === "jd_sentence")!;
    expect(sentence.source_id).toBe(JD_ID);
    expect(sentence.source_locator).toMatchObject({ sid: expect.stringMatching(/^S\d+$/), start: expect.any(Number), end: expect.any(Number) });
    const req = payload.evidence.find((e) => e.source_type === "jd_requirement")!;
    expect(req.source_id).toBe(reqId(1));
    expect(req.source_field).toBeNull();
    // sort_order restarts per item
    expect(payload.evidence.filter((e) => e.item_key === "strengths.0").map((e) => e.sort_order)).toEqual([0, 1, 2]);
  });

  it("payload meta and hashes: input_hash equals the route's reuse hash", async () => {
    const { ctx, final } = await fullRun();
    const { payload } = final;
    expect(payload.meta).toMatchObject({ schema_version: 1, prompt_version: AI02_PROMPT_VERSION, provider: "anthropic", model_tier: "default", connection_tier: "paid" });
    expect(payload.meta.model).toBe(resolveModel("anthropic", "default"));
    const routeHash = computeInsightInputHash({
      provider: "anthropic",
      model: resolveModel("anthropic", "default"),
      careerSnapshotHash: ctx.careerSnapshotHash,
      requirementsHash: ctx.requirementsHash,
    });
    expect(payload.hashes).toEqual({ requirements_hash: ctx.requirementsHash, career_snapshot_hash: ctx.careerSnapshotHash, input_hash: routeHash });
    // usage = 2 batches + 1 synthesize call
    expect(payload.meta.usage.inputTokens).toBe(300);
    expect(payload.meta.validation_report.met_downgraded_partial).toBe(2);
    expect(payload.match_stage_result.batches).toBe(2);
    expect(Object.values(payload.meta.validation_report).every((v) => typeof v === "number")).toBe(true);
  });

  it("strengths: dropped without career evidence (V-4/V-8) or without a met/partial requirement", async () => {
    const ctx = ctxKo();
    const base = koSynthesis(ctx);
    const good = base.strengths[1];
    const out: Ai02SynthesisOutput = {
      ...base,
      strengths: [
        good,
        { ...good, title: "근거 없음", evidence: [] },
        { ...good, title: "회고만", evidence: [ev.learnings(ctx, IDS.detPay1, "측정 없이 최적화하면 안 된다는 것을 배웠다")] },
        { ...good, title: "JD만", evidence: [ev.sentence(ctx, "Kafka")] },
        { ...good, title: "no_evidence 요건만", requirement_refs: ["REQ-8", "REQ-99"] },
        { ...good, title: "둘째", requirement_refs: ["REQ-8", "REQ-4"] },
      ],
    };
    const { final } = await fullRun([out]);
    const strengths = final.payload.result.strengths;
    expect(strengths.map((s) => s.title)).toEqual(["정산 배치 재설계", "둘째"]);
    // mixed refs: the no_evidence one is removed
    expect(strengths[1].requirement_ids).toEqual([reqId(4)]);
    expect(final.report).toMatchObject({ strengths_dropped_no_match: 1, evidence_removed_v8_learnings: 2 /* 1 from stage 1 (REQ-9) */, requirement_refs_dropped: 3 });
    expect(final.report.items_dropped).toBe(4);
  });

  it("strengths: trimmed to 3; identical evidence across strengths is flagged", async () => {
    const ctx = ctxKo();
    const base = koSynthesis(ctx);
    const good = base.strengths[1];
    const out: Ai02SynthesisOutput = { ...base, strengths: [good, { ...good, title: "둘째" }, { ...good, title: "셋째" }, { ...good, title: "넷째" }] };
    const { final } = await fullRun([out]);
    expect(final.payload.result.strengths.map((s) => s.title)).toEqual(["정산 배치 재설계", "둘째", "셋째"]);
    expect(final.report).toMatchObject({ strengths_truncated: 1, strengths_same_evidence: 1 });
  });

  it("gaps: met refs dropped, gap_kind recomputed, reframe/prepare_answer need career evidence", async () => {
    const ctx = ctxKo();
    const base = koSynthesis(ctx);
    const out: Ai02SynthesisOutput = {
      ...base,
      gaps: [
        { ...base.gaps[0], requirement_refs: ["REQ-1"] },
        {
          requirement_refs: ["REQ-1", "REQ-6"],
          gap_kind: "no_evidence",
          description: "대용량 트래픽에서 본인 기여가 불명확합니다.",
          actions: [
            { type: "reframe", text: "근거 없는 재구성", evidence: [] },
            { type: "prepare_answer", text: "회고만으로 대비", evidence: [ev.learnings(ctx, IDS.detPay1, "측정 없이 최적화하면 안 된다는 것을 배웠다")] },
            { type: "add_data", text: "트래픽 규모를 입력해 주세요.", evidence: [] },
          ],
          evidence: [],
        },
      ],
    };
    const { final } = await fullRun([out]);
    const gaps = final.payload.result.gaps;
    expect(gaps).toHaveLength(1);
    expect(gaps[0]).toMatchObject({ item_key: "gaps.0", requirement_ids: [reqId(6)], gap_kind: "partial" });
    expect(gaps[0].actions.map((a) => a.type)).toEqual(["add_data"]);
    expect(final.report).toMatchObject({ gaps_dropped_no_requirement: 1, gap_kind_corrected: 1, actions_dropped: 2 });
  });

  it("strategy: positioning without career evidence → null; priorities validated, re-ranked, ≤ 5", async () => {
    const ctx = ctxKo();
    const base = koSynthesis(ctx);
    const prj = (id: string) => alias(ctx, "project", id);
    const out: Ai02SynthesisOutput = {
      ...base,
      strategy: {
        positioning: "결제 엔지니어로 포지셔닝합니다.",
        positioning_evidence: [ev.sentence(ctx, "결제 승인 API")],
        project_priorities: [
          { rank: 3, ref: prj(IDS.prjSettle), reason: "정산", requirement_refs: ["REQ-2"] },
          { rank: 1, ref: "PRJ-99", reason: "없음", requirement_refs: [] },
          { rank: 2, ref: prj(IDS.prjPay), reason: "결제", requirement_refs: ["REQ-1", "REQ-8"] },
          { rank: 4, ref: prj(IDS.prjPay), reason: "중복", requirement_refs: [] },
          { rank: 5, ref: alias(ctx, "project_detail", IDS.detPay1), reason: "상세는 프로젝트가 아님", requirement_refs: [] },
          { rank: 6, ref: prj(IDS.prjEdu), reason: "캡스톤", requirement_refs: [] },
          { rank: 7, ref: prj(IDS.prjSide), reason: "개인", requirement_refs: [] },
        ],
      },
    };
    const { final } = await fullRun([out]);
    const strategy = final.payload.result.strategy;
    expect(strategy.positioning).toBeNull();
    expect(strategy.project_priorities.map((p) => [p.rank, p.project_id])).toEqual([
      [1, IDS.prjPay],
      [2, IDS.prjSettle],
      [3, IDS.prjEdu],
      [4, IDS.prjSide],
    ]);
    // no_evidence requirement refs removed from a priority
    expect(strategy.project_priorities[0].requirement_ids).toEqual([reqId(1)]);
    expect(final.report).toMatchObject({ positioning_dropped: 1, priorities_dropped: 3 });
    expect(final.payload.evidence.some((e) => e.item_key === "strategy.positioning")).toBe(false);
  });

  it("V-5: an invented number triggers one regeneration; a clean retry is used as is", async () => {
    const ctx = ctxKo();
    const base = koSynthesis(ctx);
    const bad: Ai02SynthesisOutput = { ...base, strategy: { ...base.strategy, positioning: "결제 응답 시간을 45% 줄인 엔지니어로 포지셔닝합니다." } };
    const { llm, synthesis, final } = await fullRun([bad, base]);
    expect(llm.requests.map((r) => r.callKey)).toEqual(["insight.synthesize", "insight.synthesize.regen"]);
    expect(llm.requests[1].userBlocks.at(-1)!.text).toContain("45%");
    expect(synthesis.first.violations).toEqual(["45%"]);
    expect(synthesis.regen).toMatchObject({ kind: "regen", violations: [] });
    expect(final.payload.result.strategy.positioning).toBe(base.strategy.positioning);
    expect(final.report).toMatchObject({ number_violations: 1, numbers_replaced: 0, synthesis_regenerated: 1 });
    expect(final.usage.inputTokens).toBe(400); // 2 batches + first + regen
  });

  it("V-5: still invented after the regeneration → replaced with [수치 확인 필요]", async () => {
    const ctx = ctxKo();
    const base = koSynthesis(ctx);
    const bad: Ai02SynthesisOutput = {
      ...base,
      strengths: [{ ...base.strengths[0], description: "응답 시간을 1.2초에서 0.7초로, 처리량을 250배 늘렸습니다." }],
      gaps: [{ ...base.gaps[0], actions: [{ ...base.gaps[0].actions[0], text: "메시지 큐 경험 4,321건을 추가해 주세요." }] }],
    };
    const { llm, final } = await fullRun([bad, bad]);
    expect(llm.requests).toHaveLength(2);
    expect(final.payload.result.strengths[0].description).toBe(`응답 시간을 1.2초에서 0.7초로, 처리량을 ${NUMBER_CHECK_TOKEN} 늘렸습니다.`);
    expect(final.payload.result.gaps[0].actions[0].text).toBe(`메시지 큐 경험 ${NUMBER_CHECK_TOKEN}을 추가해 주세요.`);
    expect(final.report).toMatchObject({ numbers_replaced: 2, synthesis_regenerated: 1 });
    expect(final.report.number_violations).toBe(4);
  });

  it("aliases in stage-2 prose become labels; none reach the stored result (QA-S6-04)", async () => {
    const ctx = ctxKo();
    const base = koSynthesis(ctx);
    const prj = alias(ctx, "project", IDS.prjEdu);
    const out: Ai02SynthesisOutput = {
      ...base,
      gaps: [{ ...base.gaps[0], actions: [base.gaps[0].actions[0], { ...base.gaps[0].actions[1], text: `${prj}의 무효화 메시지 발행(DET-99)을 REQ-8 질문에 대비해 정리하세요.` }] }],
      strategy: { ...base.strategy, positioning: `${alias(ctx, "project", IDS.prjPay)} 중심으로 포지셔닝합니다.` },
    };
    const { final } = await fullRun([out]);
    const r = final.payload.result;
    expect(r.gaps[0].actions[1].text).toBe("'캡스톤 분산 캐시'의 무효화 메시지 발행을 'Kafka 등 메시지 큐 운영 경험' 질문에 대비해 정리하세요.");
    expect(r.strategy.positioning).toBe("'결제 승인 API 개선' 중심으로 포지셔닝합니다.");
    const prose = JSON.stringify(r);
    expect(prose).not.toMatch(/\b(?:EXP|EDU|PRJ|DET|ACH|SKL|REQ)-\d+\b/);
    expect(final.report).toMatchObject({ aliases_replaced: 3, aliases_removed: 1 });
  });

  it("an alias-shaped token from the user's own data is kept (AWS S3)", async () => {
    const rows = careerRowsFixture();
    rows.projects = rows.projects.map((p) => (p.id === IDS.prjSide ? { ...p, name: "AWS S3 백업 도구" } : p));
    const ctx = ctxKo(rows);
    const base = koSynthesis(ctx);
    const out: Ai02SynthesisOutput = { ...base, strategy: { ...base.strategy, positioning: "S3 기반 백업 경험과 결제 API 경험을 함께 내세웁니다." } };
    const { final } = await fullRun([out], rows);
    expect(final.payload.result.strategy.positioning).toBe("S3 기반 백업 경험과 결제 API 경험을 함께 내세웁니다.");
  });

  it("V-6 on stage 2 → schema_invalid after one retry", async () => {
    const ctx = ctxKo();
    const { batches } = await runStage1(ctx, koMatchOutputs(ctx));
    const llm = createFakeLlm([{ json: { schema_version: 1, strengths: [] } }, { json: { nope: true } }]);
    await rejectsWith(synthesizeOnce({ context: ctx, batches }, { llm }), "schema_invalid");
  });

  it("career data changed between stage 1 and stage 2: vanished evidence is dropped and verdicts re-ruled", async () => {
    const ctx1 = ctxKo();
    const { batches } = await runStage1(ctx1, koMatchOutputs(ctx1));
    // detPay1 goes back to draft → its achievement (achPay) leaves the pack too.
    const rows = careerRowsFixture();
    rows.projectDetails = rows.projectDetails.map((d) => (d.id === IDS.detPay1 ? { ...d, status: "draft" } : d));
    const ctx2 = ctxKo(rows);
    const restored = restoreMatches(roundTrip(batches), ctx2);
    const byReq = (n: number) => restored.matches.find((m) => m.requirementId === reqId(n))!;
    expect(byReq(1).status).toBe("no_evidence"); // action + achievement both gone
    expect(byReq(1).rationale).toBe(NO_EVIDENCE_RATIONALE);
    expect(byReq(6).status).toBe("no_evidence"); // situation of detPay1 gone
    expect(byReq(7).status).toBe("no_evidence");
    expect(byReq(2).status).toBe("met"); // untouched
    expect(restored.report.evidence_lost_on_restore).toBe(4);
    // aliases were renumbered but restored evidence points at the same rows
    expect(byReq(2).evidence[0].ref).toBe(alias(ctx2, "project_detail", IDS.detSettle));
  });

  it("career data changed between synthesize and validate: the stored attempt is re-mapped by row id", async () => {
    const { batches, synthesis } = await fullRun();
    // A new project sorts first → every PRJ/DET/ACH alias shifts; detSettle disappears.
    const rows = careerRowsFixture();
    rows.projects.push({ ...rows.projects.find((p) => p.id === IDS.prjSettle)!, id: "30000000-0000-4000-8000-0000000000ff", name: "새 프로젝트", start_month: "2025-01-01" });
    rows.projectDetails = rows.projectDetails.filter((d) => d.id !== IDS.detSettle);
    const ctx2 = ctxKo(rows);
    expect(alias(ctx2, "project", IDS.prjPay)).not.toBe(synthesis.first.output.strategy.project_priorities[0].ref);
    const final = finalize(ctx2, roundTrip(batches), synthesis);
    const r = final.payload.result;
    // strengths.1 cited only detSettle → dropped; priorities still point at the same projects
    expect(r.strengths.map((s) => s.title)).toEqual(["결제 승인 API 성능 개선"]);
    expect(r.strategy.project_priorities.map((p) => p.project_id)).toEqual([IDS.prjPay, IDS.prjSettle]);
    const ids = new Set(final.payload.evidence.map((e) => e.source_id));
    expect(ids.has(IDS.detSettle)).toBe(false);
    expect(ids.has(IDS.detPay1)).toBe(true);
  });

  it("finalize stores the prepare-time snapshot hashes (QA-S6-09)", async () => {
    const { ctx, batches, synthesis } = await fullRun();
    const snapshot = { careerSnapshotHash: "career-at-prepare", requirementsHash: "reqs-at-prepare" };
    const final = finalize(ctx, batches, synthesis, snapshot);
    expect(final.payload.hashes).toMatchObject({ career_snapshot_hash: "career-at-prepare", requirements_hash: "reqs-at-prepare" });
    expect(final.inputHash).toBe(
      computeInsightInputHash({ provider: "anthropic", model: resolveModel("anthropic", "default"), careerSnapshotHash: "career-at-prepare", requirementsHash: "reqs-at-prepare" }),
    );
  });

  it("requirement list changed mid-job → InsightRequirementsChangedError (QA-S6-09)", async () => {
    const { batches, synthesis } = await fullRun();
    const input = koInput();
    const ctx2 = buildInsightContext({ ...input, requirements: input.requirements.slice(0, 9) });
    expect(() => finalize(ctx2, batches, synthesis)).toThrow(InsightRequirementsChangedError);
  });

  it("regenerateSynthesis refuses an empty violation list; finalize refuses swapped attempts", async () => {
    const { ctx, batches, synthesis } = await fullRun();
    await expect(regenerateSynthesis({ context: ctx, batches, violations: [] }, { llm: createFakeLlm([]) })).rejects.toThrow();
    expect(() => finalize(ctx, batches, { first: { ...synthesis.first, kind: "regen" }, regen: null })).toThrow();
  });

  it("restore refuses batches that don't cover the requirements", async () => {
    const ctx = ctxKo();
    const { batches } = await runStage1(ctx, koMatchOutputs(ctx));
    expect(() => restoreMatches([batches[0]], ctx)).toThrow();
    expect(() => restoreMatches([batches[0], batches[0], batches[1]], ctx)).toThrow();
  });

  it("thin data: data_sufficiency thin goes to the result", async () => {
    const rows = thinRows();
    const ctx = ctxKo(rows);
    const outputs = [
      matchOutput([match("REQ-2", "met", [ev.action(ctx, IDS.detSettle, "정산 배치를 청크 단위로 재설계했다")])]),
      matchOutput([]),
    ];
    const { batches } = await runStage1(ctx, outputs);
    const synthesisOut: Ai02SynthesisOutput = {
      schema_version: 1,
      strengths: [],
      gaps: [],
      strategy: { positioning: "", positioning_evidence: [], project_priorities: [] },
    };
    const llm = createFakeLlm([{ json: synthesisOut }]);
    const synthesis = await synthesizeSteps(ctx, batches, llm);
    const final = finalize(ctx, batches, synthesis);
    expect(final.payload.result.data_sufficiency.level).toBe("thin");
    expect(final.summaryCounts).toEqual({ met: 1, partial: 0, no_evidence: 9 });
    expect(final.payload.result.strategy.positioning).toBeNull();
  });

  it("logs counts only (C-7)", async () => {
    const ctx = ctxKo();
    const logs: AiLogEntry[] = [];
    const { batches } = await runStage1(ctx, koMatchOutputs(ctx));
    const llm = createFakeLlm([{ json: koSynthesis(ctx) }]);
    const synthesis = await synthesizeSteps(ctx, batches, llm, (e) => logs.push(e));
    finalizeInsight({
      context: ctx,
      batches,
      ...synthesis,
      snapshot: { careerSnapshotHash: ctx.careerSnapshotHash, requirementsHash: ctx.requirementsHash },
      provider: "anthropic",
      modelTier: "default",
      connectionTier: "paid",
      now: NOW,
      logger: (e) => logs.push(e),
    });
    const entry = logs.find((l) => l.event === "ai_validation")!;
    expect(entry).toBeDefined();
    if (entry.event === "ai_validation") for (const v of Object.values(entry.stats)) expect(typeof v).toBe("number");
    expect(JSON.stringify(logs)).not.toContain("결제");
  });
});

describe("AI-02 schemas", () => {
  it("convert to the canonical JSON schema (C-10.2)", () => {
    expect(() => toCanonicalJsonSchema(Ai02MatchOutputSchema)).not.toThrow();
    expect(() => toCanonicalJsonSchema(Ai02SynthesisOutputSchema)).not.toThrow();
  });
});
