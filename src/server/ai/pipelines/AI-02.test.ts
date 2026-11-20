import { describe, expect, it } from "vitest";
import {
  alias,
  enInput,
  ev,
  koInput,
  koMatchOutput,
  koSynthesis,
  match,
  matchOutput,
  req,
  sidOf,
  thinRows,
  JD_ID,
  KO_JD_HASH,
  KO_JD_RAW,
} from "../__fixtures__/AI-02/insight";
import { careerRowsFixture, IDS } from "../__fixtures__/career-rows";
import { splitJdSentences } from "../context-pack/jd";
import { AiError } from "../errors";
import { createFakeLlm, type FakeLlm } from "../fake-llm";
import type { AiLogEntry } from "../log";
import { AI02_PROMPT_VERSION, AI02_SYSTEM } from "../prompts/AI-02";
import { toCanonicalJsonSchema } from "../providers/schema";
import { resolveModel } from "../providers/models";
import { Ai02MatchOutputSchema, Ai02SynthesisOutputSchema, type Ai02SynthesisOutput } from "../schemas/AI-02";
import { INSIGHT_ITEM_KEYS } from "../storage/insight";
import { NUMBER_CHECK_TOKEN } from "../validation/numbers";
import { MATCH_MAX_SIDS, MET_DOWNGRADE_MISSING_ASPECT, NO_EVIDENCE_RATIONALE, REQUIREMENT_TEXT_MAX } from "../validation/insight";
import {
  AI02_CALL_KEYS,
  AI02_MAX_MATCHES,
  AI02_TIER,
  THIN_HINTS,
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
  type MatchStageResult,
} from "./AI-02";

const NOW = new Date("2026-11-01T00:00:00.000Z");
const M = (n: number) => `MT-${n}`;

function ctxKo(rows = careerRowsFixture()): InsightContext {
  return buildInsightContext(koInput(rows));
}

async function runStage1(ctx: InsightContext, output: unknown, llm?: FakeLlm): Promise<{ match: MatchStageResult; llm: FakeLlm }> {
  const fake = llm ?? createFakeLlm([{ json: output }]);
  const match = await matchRequirements({ context: ctx }, { llm: fake, clock: fakeClock() });
  return { match, llm: fake };
}

/** Deterministic clock: every read advances 1,000 ms. */
function fakeClock(step = 1000): () => number {
  let t = 0;
  return () => (t += step);
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
async function synthesizeSteps(ctx: InsightContext, match: MatchStageResult, llm: FakeLlm, logger?: (e: AiLogEntry) => void): Promise<Synthesis> {
  const first = roundTrip(await synthesizeOnce({ context: ctx, match }, { llm, logger }));
  const regen = first.violations.length ? roundTrip(await regenerateSynthesis({ context: ctx, match, violations: first.violations }, { llm, logger })) : null;
  return { first, regen };
}

function finalize(ctx: InsightContext, match: MatchStageResult, s: Synthesis, snapshot = { careerSnapshotHash: ctx.careerSnapshotHash, rawTextHash: ctx.rawTextHash }) {
  return finalizeInsight({ context: ctx, match, first: s.first, regen: s.regen, snapshot, provider: "anthropic", modelTier: "default", connectionTier: "paid", now: NOW });
}

describe("buildInsightContext (v4.16: raw JD)", () => {
  it("is deterministic; the JD block is the title + every sentence, no REQ-n / seniority", () => {
    const a = ctxKo();
    const b = ctxKo();
    expect(a.pack.text).toBe(b.pack.text);
    expect(a.jdText).toBe(b.jdText);
    expect(a.careerSnapshotHash).toBe(b.careerSnapshotHash);
    const sentences = splitJdSentences(KO_JD_RAW);
    expect(a.sentenceCount).toBe(sentences.length);
    for (const s of sentences) expect(a.jdText).toContain(`${s.sid}: ${s.text}`);
    expect(a.jdText).toContain("position_title: 결제 백엔드 엔지니어");
    expect(a.jdText).not.toMatch(/REQ-\d|seniority|<requirements>/);
    expect(a.rawTextHash).toBe(KO_JD_HASH);
  });

  it("allows JD numbers for V-5 (the seniority sentence is just a sentence now)", () => {
    const ctx = ctxKo();
    expect(ctx.allowedNumbers.has("5")).toBe(true);
    expect(ctx.allowedNumbers.has("1.2")).toBe(true);
    // learnings-only number (99%) is not a fact (C-9)
    expect(ctx.allowedNumbers.has("99")).toBe(false);
  });

  it("data_sufficiency: ok with 4 complete projects and numbers in results", () => {
    expect(ctxKo().dataSufficiency).toEqual({ level: "ok", hints: [] });
  });

  it("data_sufficiency: thin with ≤ 2 projects and no number in results [가정 C-14 v4.5]", () => {
    const ctx = ctxKo(thinRows());
    expect(ctx.dataSufficiency.level).toBe("thin");
    expect(ctx.dataSufficiency.hints).toEqual([THIN_HINTS.fewProjects, THIN_HINTS.noQuantitative]);
  });

  it("data_sufficiency: enough projects but no number in results, descriptions or deliverables → thin (numbers elsewhere don't count)", () => {
    const rows = careerRowsFixture();
    rows.projects = rows.projects.map((p) => ({
      ...p,
      result: p.result ? "결과가 좋아졌다" : null,
      description: p.description ? "문자 파싱으로 자동 기록을 만들었다" : null,
    }));
    rows.deliverables = [];
    expect(ctxKo(rows).dataSufficiency).toEqual({ level: "thin", hints: [THIN_HINTS.noQuantitative] });
  });

  it("data_sufficiency: a number only in a deliverable body counts", () => {
    const rows = careerRowsFixture();
    rows.projects = rows.projects.map((p) => ({ ...p, result: p.result ? "결과가 좋아졌다" : null, description: p.description ? "자동 기록 앱" : null }));
    expect(ctxKo(rows).dataSufficiency).toEqual({ level: "ok", hints: [] });
  });
});

describe("matchRequirements (stage 1, one call)", () => {
  it("ONE call insight.match.1: default tier, low reasoning, structured output, [pack] → [jd] → [task]", async () => {
    const ctx = ctxKo();
    const { match, llm } = await runStage1(ctx, koMatchOutput(ctx));
    expect(llm.requests).toHaveLength(1);
    const [r] = llm.requests;
    expect(r.tier).toBe(AI02_TIER);
    expect(r.reasoningLevel).toBe("low");
    expect(r.outputSchema).not.toBeNull();
    expect(r.callKey).toBe("insight.match.1");
    expect(AI02_CALL_KEYS.match).toBe("insight.match.1");
    expect(r.userBlocks[0].text).toBe(ctx.pack.text);
    expect(r.userBlocks[1].text).toBe(ctx.jdText);
    expect(r.userBlocks[2].text).toContain(`최대 ${AI02_MAX_MATCHES}개`);
    expect(AI02_MAX_MATCHES).toBe(15);
    expect(match.items).toHaveLength(10);
    expect(match.items.map((m) => m.match_key)).toEqual(Array.from({ length: 10 }, (_, i) => M(i + 1)));
    expect(llm.records).toHaveLength(1);
    expect(match).toMatchObject({ v: 3, calls: 1, attempts: 1, rawTextHash: KO_JD_HASH, careerSnapshotHash: ctx.careerSnapshotHash });
  });

  it("measures stage-1 latency (4.24 #18) and logs it as ai_stage_timing — ids and numbers only", async () => {
    const ctx = ctxKo();
    const logs: AiLogEntry[] = [];
    const llm = createFakeLlm([{ json: koMatchOutput(ctx) }]);
    const match = await matchRequirements({ context: ctx }, { llm, clock: fakeClock(1500), logger: (e) => logs.push(e), jobId: "job-1" });
    expect(match.latencyMs).toBe(1500);
    const timing = logs.find((l) => l.event === "ai_stage_timing");
    expect(timing).toEqual({ event: "ai_stage_timing", jobId: "job-1", feature: "AI-02.match", callKey: "insight.match.1", promptVersion: match.promptVersion, latencyMs: 1500, calls: 1, attempts: 1 });
  });

  it("stage-1 output survives a JSON round trip unchanged (job step output); evidence in UUID form", async () => {
    const ctx = ctxKo();
    const { match } = await runStage1(ctx, koMatchOutput(ctx));
    expect(roundTrip(match)).toEqual(match);
    expect(match.items[0].evidence[0].source_id).toBe(IDS.prjPay);
    expect(match.items[0]).toMatchObject({ match_key: "MT-1", requirement_text: "결제 승인 API 설계 및 운영", sids: [sidOf(ctx, "결제 승인 API")] });
    expect(match.items[0]).not.toHaveProperty("category");
    expect(match.items[0]).not.toHaveProperty("importance");
  });

  it("applies the verdict rules (met downgrade, V-4, V-8, V-3 adjust)", async () => {
    const ctx = ctxKo();
    const { match } = await runStage1(ctx, koMatchOutput(ctx));
    const byKey = (n: number) => match.items.find((m) => m.match_key === M(n))!;
    expect(byKey(1).status).toBe("met");
    expect(byKey(2).status).toBe("met");
    expect(byKey(3)).toMatchObject({ status: "met", evidence: [{ source_type: "project_deliverable", source_id: IDS.dlvSide1, field: "body" }] });
    expect(byKey(4)).toMatchObject({ status: "partial", model_status: "met", missing_aspect: MET_DOWNGRADE_MISSING_ASPECT });
    expect(byKey(5).status).toBe("partial");
    expect(byKey(6).status).toBe("partial");
    expect(byKey(7).status).toBe("met");
    expect(byKey(7).evidence[0].quote_adjusted).toBe(true);
    expect(byKey(8).status).toBe("no_evidence");
    expect(byKey(9)).toMatchObject({ status: "no_evidence", evidence: [], rationale: NO_EVIDENCE_RATIONALE });
    expect(byKey(10)).toMatchObject({ status: "no_evidence", model_status: "no_evidence", evidence: [] });
    expect(match.report).toMatchObject({
      requirements_total: 10,
      met_downgraded_partial: 2,
      quotes_adjusted: 1,
      evidence_removed_v8_learnings: 1,
      items_downgraded: 1,
    });
  });

  it("card 1 — sids: unknown / non-sentence refs dropped, duplicates merged, > 5 cut; no valid sid → dropped_requirements", async () => {
    const ctx = ctxKo();
    const s1 = sidOf(ctx, "결제 승인 API");
    const many = ["결제 승인 API", "정산 배치", "장애 대응", "Spring Boot", "Kotlin", "대용량 트래픽", "RDBMS"].map((n) => sidOf(ctx, n));
    const out = matchOutput([
      match(ctx, req(1), "no_evidence", [], { sids: [s1, "S999", "PRJ-1", s1] }),
      match(ctx, req(2), "no_evidence", [], { sids: ["S999"] }),
      match(ctx, req(3), "no_evidence", [], { sids: [] }),
      match(ctx, req(4), "no_evidence", [], { sids: [...many].reverse() }),
    ]);
    const { match: result } = await runStage1(ctx, out);
    expect(result.items.map((m) => m.requirement_text)).toEqual(["결제 승인 API 설계 및 운영", "Spring Boot 기반 서버 개발 경험"]);
    expect(result.items[0].sids).toEqual([s1]);
    // ascending, first five of the model's list (the last five reversed)
    expect(result.items[1].sids).toHaveLength(MATCH_MAX_SIDS);
    expect(result.items[1].sids).toEqual([...many].reverse().slice(0, MATCH_MAX_SIDS).sort((a, b) => Number(a.slice(1)) - Number(b.slice(1))));
    expect(result.report).toMatchObject({ sids_dropped: 3, sids_truncated: 2, dropped_requirements: 2, requirements_total: 2 });
  });

  it("card 2 — requirement_text: whitespace collapsed, empty dropped, cut at 120 without ellipsis", async () => {
    const ctx = ctxKo();
    const long = "결제 승인 API 설계 ".repeat(30);
    const out = matchOutput([
      match(ctx, req(1), "no_evidence", [], { requirement_text: long }),
      match(ctx, req(2), "no_evidence", [], { requirement_text: "  정산   배치\n 시스템 개선 " }),
      match(ctx, req(3), "no_evidence", [], { requirement_text: "   " }),
    ]);
    const { match: result } = await runStage1(ctx, out);
    expect(Array.from(result.items[0].requirement_text).length).toBeLessThanOrEqual(REQUIREMENT_TEXT_MAX);
    expect(result.items[0].requirement_text.endsWith("…")).toBe(false);
    expect(result.items[1].requirement_text).toBe("정산 배치 시스템 개선");
    expect(result.items).toHaveLength(2);
    expect(result.report).toMatchObject({ requirement_text_clipped: 1, requirements_dropped_empty: 1 });
  });

  it("card 2 — V-5 on requirement_text uses only its own sentences; a violation → its first sentence (no regeneration)", async () => {
    const ctx = ctxKo();
    const seniority = sidOf(ctx, "5년 이상");
    const sentence = splitJdSentences(KO_JD_RAW).find((x) => x.sid === seniority)!.text;
    const out = matchOutput([
      // 5 is in its sentence → kept
      { ...match(ctx, req(1), "no_evidence"), requirement_text: "백엔드 개발 경력 5년 이상", sids: [seniority] },
      // 1.2 exists elsewhere in the pack, but not in this item's sentence → replaced
      match(ctx, req(4), "no_evidence", [], { requirement_text: "Spring Boot 1.2 이상 서버 개발 경험" }),
      // invented 7년 on the seniority sentence → replaced by the sentence itself
      { ...match(ctx, req(1), "no_evidence"), requirement_text: "백엔드 개발 경력 7년 이상", sids: [seniority] },
    ]);
    const { match: result, llm } = await runStage1(ctx, out);
    expect(ctx.allowedNumbers.has("1.2")).toBe(true);
    const texts = result.items.map((m) => m.requirement_text);
    expect(texts).toContain("백엔드 개발 경력 5년 이상");
    expect(texts).toContain(splitJdSentences(KO_JD_RAW).find((x) => x.sid === sidOf(ctx, "Spring Boot"))!.text);
    // the 7년 item became the same text + sids as the 5년 item → dropped as a duplicate (card 3)
    expect(texts.filter((t) => t === sentence)).toHaveLength(1);
    expect(result.report).toMatchObject({ requirement_text_replaced: 2, requirements_duplicate: 1, number_violations: 2 });
    expect(llm.requests).toHaveLength(1);
  });

  it("card 3 — duplicates: same normalized text and same sids → the later one dropped; same text, other sids → kept", async () => {
    const ctx = ctxKo();
    const out = matchOutput([
      match(ctx, req(5), "partial", [ev.skill(ctx, IDS.sklKotlin)]),
      match(ctx, req(5), "no_evidence", [], { requirement_text: "Kotlin  사용 경험" }),
      match(ctx, req(5), "no_evidence", [], { sids: [sidOf(ctx, "Spring Boot")] }),
    ]);
    const { match: result } = await runStage1(ctx, out);
    expect(result.items.map((m) => [m.requirement_text, m.status])).toEqual([
      ["Kotlin 사용 경험", "no_evidence"],
      ["Kotlin 사용 경험", "partial"],
    ]);
    expect(result.report.requirements_duplicate).toBe(1);
  });

  it(`card 4·5 — keeps the first ${AI02_MAX_MATCHES} in model order (truncated_requirements), then keys MT-n by first sid`, async () => {
    const ctx = ctxKo();
    // model order: reversed JD order, 10 distinct + 8 extra with distinct text
    const distinct = [...Array.from({ length: 10 }, (_, i) => req(10 - i))].map((d) => match(ctx, d, "no_evidence"));
    const suffix = ["가", "나", "다", "라", "마", "바", "사", "아"];
    const extra = suffix.map((x) => match(ctx, req(1), "no_evidence", [], { requirement_text: `결제 승인 API 세부 요건 ${x}` }));
    const { match: result } = await runStage1(ctx, matchOutput([...distinct, ...extra]));
    expect(result.items).toHaveLength(AI02_MAX_MATCHES);
    expect(result.report.truncated_requirements).toBe(3);
    // MT-1 … in JD order: the 결제 승인 API sentence first (its six items in model order), 쿠버네티스 last
    expect(result.items[0].requirement_text).toBe("결제 승인 API 설계 및 운영");
    expect(result.items.slice(1, 6).map((m) => m.requirement_text)).toEqual(suffix.slice(0, 5).map((x) => `결제 승인 API 세부 요건 ${x}`));
    expect(result.items.at(-1)!.requirement_text).toBe("쿠버네티스 운영 경험");
    expect(result.items.map((m) => m.match_key)).toEqual(Array.from({ length: AI02_MAX_MATCHES }, (_, i) => M(i + 1)));
    const firstSid = result.items.map((m) => Number(m.sids[0].slice(1)));
    expect([...firstSid].sort((a, b) => a - b)).toEqual(firstSid);
  });

  it("card 6 — zero items after validation: stage 1 runs once more; the retry's items are used", async () => {
    const ctx = ctxKo();
    const llm = createFakeLlm([{ json: matchOutput([match(ctx, req(1), "no_evidence", [], { sids: ["S999"] })]) }, { json: koMatchOutput(ctx) }]);
    const result = await matchRequirements({ context: ctx }, { llm, clock: fakeClock() });
    expect(llm.requests.map((r) => r.callKey)).toEqual(["insight.match.1", "insight.match.1"]);
    expect(result).toMatchObject({ calls: 2, attempts: 2 });
    expect(result.items).toHaveLength(10);
    expect(result.usage.inputTokens).toBe(200);
    expect(result.report.stage1_empty_retried).toBe(1);
  });

  it("card 6 — zero items twice → schema_invalid, not retryable; the synthesis is never called", async () => {
    const ctx = ctxKo();
    const llm = createFakeLlm([{ json: matchOutput([]) }, { json: matchOutput([]) }]);
    await rejectsWith(matchRequirements({ context: ctx }, { llm }), "schema_invalid");
    expect(llm.requests).toHaveLength(2);
  });

  it("removes bad evidence (V-1/V-2/V-3) and moves JD evidence out of the match", async () => {
    const ctx = ctxKo();
    const out = matchOutput([
      match(ctx, req(1), "met", [
        { source_type: "project", ref: "PRJ-99", field: "action", quote: "없는 프로젝트" },
        { source_type: "project", ref: alias(ctx, "project", IDS.prjPay), field: "outcome", quote: "응답 시간이 0.7초로 줄었다" },
        { source_type: "project", ref: alias(ctx, "project", IDS.prjPay), field: "result", quote: "전혀 다른 문장이 인용되었다고 가정한다" },
        ev.sentence(ctx, "결제 승인 API"),
        ev.result(ctx, IDS.prjPay, "응답 시간이 0.7초로 줄었다"),
      ]),
      match(ctx, req(2), "no_evidence", [ev.action(ctx, IDS.prjSettle, "정산 배치를 청크 단위로 재설계했다")]),
    ]);
    const { match: result } = await runStage1(ctx, out);
    expect(result.items.map((m) => m.status)).toEqual(["met", "no_evidence"]);
    expect(result.items[0].evidence).toEqual([expect.objectContaining({ source_type: "project", field: "result" })]);
    expect(result.items[1].evidence).toEqual([]);
    expect(result.report).toMatchObject({
      evidence_removed_v1_ref: 1,
      evidence_removed_v2_field: 1,
      evidence_removed_v3_quote: 1,
      match_jd_evidence_dropped: 1,
    });
  });

  it("a jd_requirement (REQ-n) source is no longer part of the output schema (V-6)", () => {
    const ctx = ctxKo();
    const out = matchOutput([match(ctx, req(1), "met", [{ source_type: "jd_requirement" as never, ref: "REQ-1", field: null, quote: null }])]);
    expect(Ai02MatchOutputSchema.safeParse(out).success).toBe(false);
  });

  it("V-5 and alias labels in rationale / missing_aspect; aliases in requirement_text become labels", async () => {
    const ctx = ctxKo();
    const prj = alias(ctx, "project", IDS.prjPay);
    const dlv = alias(ctx, "project_deliverable", IDS.dlvSide1);
    const out = matchOutput([
      match(ctx, req(1), "met", [ev.action(ctx, IDS.prjPay, "결제 승인 API의 병목 쿼리를 찾아 인덱스를 재설계했다")], {
        requirement_text: `결제 승인 API 설계 및 운영(${prj})`,
        rationale: `${prj}의 ${dlv}.body이 응답 시간을 45% 줄이고 1.2초 병목을 해결했습니다(PRJ-99).`,
        missing_aspect: "MT-1 운영 규모",
      }),
    ]);
    const { match: result, llm } = await runStage1(ctx, out);
    expect(result.items[0].requirement_text).toBe("결제 승인 API 설계 및 운영('결제 승인 API 개선')");
    expect(result.items[0].rationale).toBe(`'결제 승인 API 개선'의 '문자 파싱 설계'이 응답 시간을 ${NUMBER_CHECK_TOKEN} 줄이고 1.2초 병목을 해결했습니다.`);
    expect(result.items[0].missing_aspect).toBe("운영 규모");
    expect(result.report).toMatchObject({ number_violations: 1, numbers_replaced: 1, aliases_replaced: 3, aliases_removed: 2 });
    expect(llm.requests).toHaveLength(1);
  });

  it("V-6: schema mismatch twice → schema_invalid, not retryable (v1 / R17-first-cut output shapes are a miss)", async () => {
    const ctx = ctxKo();
    const v1 = { schema_version: 1, matches: [{ requirement_ref: "REQ-1", status: "met", rationale: "x", missing_aspect: null, evidence: [] }] };
    const r17a = { schema_version: 2, matches: [{ requirement: "x", category: "required", importance: "high", sentence_refs: ["S1"], status: "met", rationale: "x", missing_aspect: null, evidence: [] }] };
    const llm = createFakeLlm([{ json: v1 }, { json: r17a }]);
    await rejectsWith(matchRequirements({ context: ctx }, { llm }), "schema_invalid");
    expect(llm.requests).toHaveLength(2);
  });

  it("provider errors propagate as is", async () => {
    const ctx = ctxKo();
    const llm = createFakeLlm([{ error: "rate_limited", retryAfterMs: 1000 }]);
    await rejectsWith(matchRequirements({ context: ctx }, { llm }), "rate_limited", true);
  });

  it("English JD: skill-only evidence stays partial", async () => {
    const ctx = buildInsightContext(enInput());
    expect(ctx.jdText).toContain("Experience tuning PostgreSQL queries in production.");
    const out = matchOutput([
      {
        requirement_text: "PostgreSQL 쿼리 튜닝 운영 경험",
        sids: [sidOf(ctx, "PostgreSQL")],
        status: "met",
        rationale: "관련 스킬이 있습니다.",
        missing_aspect: null,
        evidence: [ev.skill(ctx, IDS.sklManual)],
      },
    ]);
    const { match: result } = await runStage1(ctx, out);
    expect(result.items[0].status).toBe("partial");
  });
});

describe("synthesizeOnce / regenerateSynthesis + finalizeInsight (stage 2)", () => {
  async function fullRun(synthOutputs: unknown[] = [], rows = careerRowsFixture()) {
    const ctx = ctxKo(rows);
    const { match } = await runStage1(ctx, koMatchOutput(ctx));
    const llm = createFakeLlm((synthOutputs.length ? synthOutputs : [koSynthesis(ctx)]).map((json) => ({ json })));
    const synthesis = await synthesizeSteps(ctx, roundTrip(match), llm);
    return { ctx, match, llm, synthesis, final: finalize(ctx, roundTrip(match), synthesis) };
  }

  it("medium reasoning, same cache prefix as stage 1, verdicts with requirement text in <match_results>", async () => {
    const { ctx, llm, synthesis } = await fullRun();
    const r = llm.requests[0];
    expect(r.reasoningLevel).toBe("medium");
    expect(r.callKey).toBe("insight.synthesize");
    expect(r.systemBlocks[1].text).toBe(AI02_SYSTEM);
    expect(r.userBlocks[1].text).toBe(ctx.jdText);
    const results = r.userBlocks[2].text;
    expect(results).toContain("<match_results>");
    expect(results).toContain(`MT-4 | Spring Boot 기반 서버 개발 경험 | 문장: ${sidOf(ctx, "Spring Boot")} | status: partial`);
    expect(results).toContain(`MT-1 | 결제 승인 API 설계 및 운영 | 문장: ${sidOf(ctx, "결제 승인 API")} | status: met`);
    expect(results).toContain("MT-10 | 쿠버네티스 운영 경험");
    expect(results).not.toMatch(/자격 요건|주요 업무|우대 사항|중요/);
    expect(synthesis.regen).toBeNull();
    expect(synthesis.first.violations).toEqual([]);
  });

  it("payload v2 (DM 2.7.0): match_key / requirement_text / sids, match_keys, item_keys, UUIDs, no evidence in result", async () => {
    const { ctx, final } = await fullRun();
    const { payload } = final;
    expect(hasKeyDeep(payload.result, "evidence")).toBe(false);
    expect(hasKeyDeep(payload.result, "positioning_evidence")).toBe(false);
    expect(hasKeyDeep(payload.match_stage_result, "evidence")).toBe(false);
    expect(payload.result.schema_version).toBe(2);

    expect(payload.result.requirement_matches).toHaveLength(10);
    expect(payload.result.requirement_matches[0]).toEqual({
      item_key: "requirement_matches.MT-1",
      match_key: "MT-1",
      requirement_text: "결제 승인 API 설계 및 운영",
      sids: [sidOf(ctx, "결제 승인 API")],
      status: "met",
      rationale: "관련 경험이 데이터에 있습니다.",
      missing_aspect: null,
    });
    expect(payload.result.summary_counts).toEqual({ met: 4, partial: 3, no_evidence: 3 });
    expect(payload.result.data_sufficiency).toEqual({ level: "ok", hints: [] });
    expect(payload.result.basis_note).toBe("입력된 경력 데이터 기준 분석입니다");

    expect(payload.result.strengths.map((s) => s.item_key)).toEqual(["strengths.0", "strengths.1"]);
    expect(payload.result.strengths[0].match_keys).toEqual([M(1), M(7)]);
    expect(payload.result.gaps[0]).toMatchObject({ item_key: "gaps.0", match_keys: [M(8)], gap_kind: "no_evidence" });
    expect(payload.result.gaps[0].actions.map((a) => a.item_key)).toEqual(["gaps.0.actions.0", "gaps.0.actions.1"]);
    expect(payload.result.strategy.positioning_item_key).toBe(INSIGHT_ITEM_KEYS.positioning);
    expect(payload.result.strategy.project_priorities[0]).toMatchObject({ item_key: "strategy.project_priorities.0", rank: 1, project_id: IDS.prjPay, match_keys: [M(1), M(3)] });
    for (const key of ["requirement_id", "requirement_ids", "requirement", "category", "importance", "sentence_ids"]) expect(hasKeyDeep(payload.result, key)).toBe(false);

    expect(Object.keys(payload.match_stage_result).sort()).toEqual(["items", "prompt_version"]);
    expect(payload.match_stage_result.prompt_version).toBe("ai-02.match.v6+common.v5");
    expect(payload.match_stage_result.items[3]).toEqual({
      match_key: "MT-4",
      requirement_text: "Spring Boot 기반 서버 개발 경험",
      sids: [sidOf(ctx, "Spring Boot")],
      status: "partial",
      model_status: "met",
      rationale: "관련 경험이 데이터에 있습니다.",
      missing_aspect: MET_DOWNGRADE_MISSING_ASPECT,
    });
  });

  it("evidence rows (DM 2.8): requirement rows are career evidence only (sids are no rows); jd_sentence only on stage-2 items", async () => {
    const { ctx, final } = await fullRun();
    const { payload } = final;
    const keys = new Set(payload.evidence.map((e) => e.item_key));
    expect(keys).toEqual(
      new Set([
        // matches with career evidence after validation (MT-8 · MT-9 · MT-10 are no_evidence)
        ...[1, 2, 3, 4, 5, 6, 7].map((n) => `requirement_matches.MT-${n}`),
        "strengths.0",
        "strengths.1",
        "gaps.0",
        "gaps.0.actions.1",
        "gaps.1.actions.0",
        "strategy.positioning",
      ]),
    );
    for (const e of payload.evidence) expect(e.source_id).toMatch(/^[0-9a-f-]{36}$/);
    expect(payload.evidence.some((e) => e.source_type === "jd_requirement")).toBe(false);

    const matchRows = payload.evidence.filter((e) => e.item_key.startsWith("requirement_matches."));
    expect(matchRows.some((e) => e.source_type === "jd_sentence")).toBe(false);
    expect(payload.evidence.filter((e) => e.item_key === "requirement_matches.MT-1").map((e) => e.source_type)).toEqual(["project", "project"]);
    // the strength's cited sentence is a jd_sentence row with its locator
    const sentence = payload.evidence.find((e) => e.item_key === "strengths.0" && e.source_type === "jd_sentence")!;
    const s = splitJdSentences(KO_JD_RAW).find((x) => x.sid === sidOf(ctx, "결제 승인 API"))!;
    expect(sentence).toMatchObject({ source_id: JD_ID, source_field: null, source_locator: { sid: s.sid, start: s.start, end: s.end } });
    // sort_order restarts per item
    expect(payload.evidence.filter((e) => e.item_key === "strengths.0").map((e) => e.sort_order)).toEqual([0, 1, 2]);
  });

  it("payload meta and hashes: {raw_text_hash, career_snapshot_hash, input_hash}; input_hash equals the route's reuse hash", async () => {
    const { ctx, final } = await fullRun();
    const { payload } = final;
    expect(payload.meta).toMatchObject({ schema_version: 2, prompt_version: AI02_PROMPT_VERSION, provider: "anthropic", model_tier: "default", connection_tier: "paid" });
    expect(payload.meta.model).toBe(resolveModel("anthropic", "default"));
    const routeHash = computeInsightInputHash({
      provider: "anthropic",
      model: resolveModel("anthropic", "default"),
      careerSnapshotHash: ctx.careerSnapshotHash,
      rawTextHash: KO_JD_HASH,
    });
    expect(payload.hashes).toEqual({ raw_text_hash: KO_JD_HASH, career_snapshot_hash: ctx.careerSnapshotHash, input_hash: routeHash });
    expect(payload.meta.prompt_version).toBe("ai-02.match.v6+ai-02.synthesize.v6+common.v5");
    expect(final.inputHash).toBe(routeHash);
    // usage = 1 match call + 1 synthesize call
    expect(payload.meta.usage.inputTokens).toBe(200);
    expect(payload.meta.validation_report.met_downgraded_partial).toBe(2);
    expect(payload.meta.validation_report.requirements_total).toBe(10);
    expect(Object.values(payload.meta.validation_report).every((v) => typeof v === "number")).toBe(true);
  });

  it("input_hash changes with the JD raw_text_hash", () => {
    const base = { provider: "anthropic" as const, model: "m", careerSnapshotHash: "c" };
    expect(computeInsightInputHash({ ...base, rawTextHash: "a" })).not.toBe(computeInsightInputHash({ ...base, rawTextHash: "b" }));
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
        { ...good, title: "회고만", evidence: [ev.learnings(ctx, IDS.prjPay, "측정 없이 최적화하면 안 된다는 것을 배웠다")] },
        { ...good, title: "JD만", evidence: [ev.sentence(ctx, "Kafka")] },
        { ...good, title: "no_evidence 요건만", requirement_refs: ["MT-8", "MT-99"] },
        { ...good, title: "둘째", requirement_refs: ["MT-8", "MT-4", "M-1"] },
      ],
    };
    const { final } = await fullRun([out]);
    const strengths = final.payload.result.strengths;
    expect(strengths.map((s) => s.title)).toEqual(["정산 배치 재설계", "둘째"]);
    expect(strengths[1].match_keys).toEqual([M(4)]);
    expect(final.report).toMatchObject({ strengths_dropped_no_match: 1, evidence_removed_v8_learnings: 2 /* 1 from stage 1 (MT-9) */, requirement_refs_dropped: 4 });
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
        { ...base.gaps[0], requirement_refs: ["MT-1"] },
        {
          requirement_refs: ["MT-1", "MT-6"],
          gap_kind: "no_evidence",
          description: "대용량 트래픽에서 본인 기여가 불명확합니다.",
          actions: [
            { type: "reframe", text: "근거 없는 재구성", evidence: [] },
            { type: "prepare_answer", text: "회고만으로 대비", evidence: [ev.learnings(ctx, IDS.prjPay, "측정 없이 최적화하면 안 된다는 것을 배웠다")] },
            { type: "add_data", text: "트래픽 규모를 입력해 주세요.", evidence: [] },
          ],
          evidence: [],
        },
      ],
    };
    const { final } = await fullRun([out]);
    const gaps = final.payload.result.gaps;
    expect(gaps).toHaveLength(1);
    expect(gaps[0]).toMatchObject({ item_key: "gaps.0", match_keys: [M(6)], gap_kind: "partial" });
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
          { rank: 3, ref: prj(IDS.prjSettle), reason: "정산", requirement_refs: ["MT-2"] },
          { rank: 1, ref: "PRJ-99", reason: "없음", requirement_refs: [] },
          { rank: 2, ref: prj(IDS.prjPay), reason: "결제", requirement_refs: ["MT-1", "MT-8"] },
          { rank: 4, ref: prj(IDS.prjPay), reason: "중복", requirement_refs: [] },
          { rank: 5, ref: alias(ctx, "project_deliverable", IDS.dlvSide1), reason: "산출물은 프로젝트가 아님", requirement_refs: [] },
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
    expect(strategy.project_priorities[0].match_keys).toEqual([M(1)]);
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
    expect(final.usage.inputTokens).toBe(300); // match + first + regen
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

  it("aliases and match refs in stage-2 prose become labels; none reach the stored result (QA-S6-04)", async () => {
    const ctx = ctxKo();
    const base = koSynthesis(ctx);
    const prj = alias(ctx, "project", IDS.prjEdu);
    const out: Ai02SynthesisOutput = {
      ...base,
      gaps: [{ ...base.gaps[0], actions: [base.gaps[0].actions[0], { ...base.gaps[0].actions[1], text: `${prj}의 무효화 메시지 발행(DET-99)을 MT-8 질문에 대비해 정리하세요(MT-77, REQ-2).` }] }],
      strategy: { ...base.strategy, positioning: `${alias(ctx, "project", IDS.prjPay)} 중심으로 포지셔닝합니다.` },
    };
    const { final } = await fullRun([out]);
    const r = final.payload.result;
    expect(r.gaps[0].actions[1].text).toBe("'캡스톤 분산 캐시'의 무효화 메시지 발행을 'Kafka 등 메시지 큐 운영 경험' 질문에 대비해 정리하세요.");
    expect(r.strategy.positioning).toBe("'결제 승인 API 개선' 중심으로 포지셔닝합니다.");
    // MT-n stays only in the key fields (match_key, match_keys, item_key) — never in prose.
    const prose = JSON.stringify([
      r.requirement_matches.map((m) => [m.requirement_text, m.rationale, m.missing_aspect]),
      r.strengths.map((x) => [x.title, x.description]),
      r.gaps.map((g) => [g.description, g.actions.map((a) => a.text)]),
      r.strategy.positioning,
      r.strategy.project_priorities.map((p) => p.reason),
    ]);
    expect(prose).not.toMatch(/\b(?:EXP|EDU|PRJ|DET|ACH|SKL|REQ|MT|M)-\d+\b/);
    expect(final.report).toMatchObject({ aliases_replaced: 3, aliases_removed: 3 });
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
    const { match } = await runStage1(ctx, koMatchOutput(ctx));
    const llm = createFakeLlm([{ json: { schema_version: 2, strengths: [] } }, { json: { nope: true } }]);
    await rejectsWith(synthesizeOnce({ context: ctx, match }, { llm }), "schema_invalid");
  });

  it("career data changed between stage 1 and stage 2: vanished evidence is dropped and verdicts re-ruled; sentences stay", async () => {
    const ctx1 = ctxKo();
    const { match } = await runStage1(ctx1, koMatchOutput(ctx1));
    const rows = careerRowsFixture();
    rows.projects = rows.projects.map((p) => (p.id === IDS.prjPay ? { ...p, status: "draft" } : p));
    const ctx2 = ctxKo(rows);
    const restored = restoreMatches(roundTrip(match), ctx2);
    const byId = (n: number) => restored.matches.find((m) => m.key === M(n))!;
    expect(restored.matches).toHaveLength(10);
    expect(byId(1)).toMatchObject({ key: "MT-1", status: "no_evidence", rationale: NO_EVIDENCE_RATIONALE });
    expect(byId(1).sids).toEqual([sidOf(ctx2, "결제 승인 API")]);
    expect(byId(6).status).toBe("no_evidence");
    expect(byId(7).status).toBe("no_evidence");
    expect(byId(2).status).toBe("met");
    expect(restored.report.evidence_lost_on_restore).toBe(4);
    expect(byId(2).evidence[0].ref).toBe(alias(ctx2, "project", IDS.prjSettle));
  });

  it("career data changed between synthesize and validate: the stored attempt is re-mapped by row id; MT-n keys stay", async () => {
    const { match, synthesis } = await fullRun();
    const rows = careerRowsFixture();
    rows.projects.push({ ...rows.projects.find((p) => p.id === IDS.prjSettle)!, id: "30000000-0000-4000-8000-0000000000ff", name: "새 프로젝트", start_month: "2025-01-01" });
    rows.projects = rows.projects.map((p) => (p.id === IDS.prjSettle ? { ...p, action: "야간 작업을 줄였다" } : p));
    const ctx2 = ctxKo(rows);
    expect(alias(ctx2, "project", IDS.prjPay)).not.toBe(synthesis.first.output.strategy.project_priorities[0].ref);
    const final = finalize(ctx2, roundTrip(match), synthesis);
    const r = final.payload.result;
    expect(r.strengths.map((s) => s.title)).toEqual(["결제 승인 API 성능 개선"]);
    expect(r.strengths[0].match_keys).toEqual([M(1), M(7)]);
    expect(r.strategy.project_priorities.map((p) => p.project_id)).toEqual([IDS.prjPay, IDS.prjSettle]);
    const ids = new Set(final.payload.evidence.map((e) => e.source_id));
    expect(ids.has(IDS.prjSettle)).toBe(false);
    expect(ids.has(IDS.prjPay)).toBe(true);
  });

  it("finalize stores the prepare-time snapshot hashes (QA-S6-09)", async () => {
    const { ctx, match, synthesis } = await fullRun();
    const snapshot = { careerSnapshotHash: "career-at-prepare", rawTextHash: "jd-at-prepare" };
    const final = finalize(ctx, match, synthesis, snapshot);
    expect(final.payload.hashes).toEqual({ career_snapshot_hash: "career-at-prepare", raw_text_hash: "jd-at-prepare", input_hash: final.inputHash });
    expect(final.inputHash).toBe(
      computeInsightInputHash({ provider: "anthropic", model: resolveModel("anthropic", "default"), careerSnapshotHash: "career-at-prepare", rawTextHash: "jd-at-prepare" }),
    );
  });

  it("JD raw text changed mid-job → InsightRequirementsChangedError (code kept)", async () => {
    const { match, synthesis } = await fullRun();
    const ctx2 = buildInsightContext({ ...koInput(), rawTextHash: "another-hash" });
    expect(() => finalize(ctx2, match, synthesis)).toThrow(InsightRequirementsChangedError);
    await expect(synthesizeOnce({ context: ctx2, match }, { llm: createFakeLlm([]) })).rejects.toMatchObject({ code: "requirements_changed" });
  });

  it("regenerateSynthesis refuses an empty violation list; finalize refuses swapped or older-version attempts", async () => {
    const { ctx, match, synthesis } = await fullRun();
    await expect(regenerateSynthesis({ context: ctx, match, violations: [] }, { llm: createFakeLlm([]) })).rejects.toThrow();
    expect(() => finalize(ctx, match, { first: { ...synthesis.first, kind: "regen" }, regen: null })).toThrow();
    expect(() => finalize(ctx, match, { first: { ...synthesis.first, v: 2 as never }, regen: null })).toThrow();
    expect(() => finalize(ctx, { ...match, v: 2 as never }, synthesis)).toThrow();
  });

  it("thin data, all no_evidence: data_sufficiency thin, empty synthesis stored", async () => {
    const rows = thinRows();
    const ctx = ctxKo(rows);
    const { match: stage } = await runStage1(ctx, matchOutput([match(ctx, req(8), "no_evidence")]));
    const synthesisOut: Ai02SynthesisOutput = {
      schema_version: 2,
      strengths: [],
      gaps: [],
      strategy: { positioning: "", positioning_evidence: [], project_priorities: [] },
    };
    const llm = createFakeLlm([{ json: synthesisOut }]);
    const synthesis = await synthesizeSteps(ctx, stage, llm);
    expect(llm.requests[0].userBlocks[2].text).toContain("MT-1 | Kafka 등 메시지 큐 운영 경험");
    const final = finalize(ctx, stage, synthesis);
    expect(final.payload.result.data_sufficiency.level).toBe("thin");
    expect(final.summaryCounts).toEqual({ met: 0, partial: 0, no_evidence: 1 });
    expect(final.payload.result.requirement_matches.map((m) => m.match_key)).toEqual(["MT-1"]);
    expect(final.payload.result.strategy.positioning).toBeNull();
    expect(final.payload.evidence).toEqual([]);
  });

  it("logs counts only (C-7)", async () => {
    const ctx = ctxKo();
    const logs: AiLogEntry[] = [];
    const { match } = await runStage1(ctx, koMatchOutput(ctx));
    const llm = createFakeLlm([{ json: koSynthesis(ctx) }]);
    const synthesis = await synthesizeSteps(ctx, match, llm, (e) => logs.push(e));
    finalizeInsight({
      context: ctx,
      match,
      ...synthesis,
      snapshot: { careerSnapshotHash: ctx.careerSnapshotHash, rawTextHash: ctx.rawTextHash },
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
