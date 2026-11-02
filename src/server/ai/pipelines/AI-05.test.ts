import { describe, expect, it } from "vitest";
import { a, ai05Output, AS_OF, careerRowsFixture, IDS, JD_ID, JD_UPDATED_AT, jdParts, q, reqId, sid, thinCultureRows } from "../__fixtures__/S8/interview";
import type { CareerRows } from "../context-pack/career-rows";
import { AiError } from "../errors";
import { createFakeLlm, type FakeLlmResponse } from "../fake-llm";
import { toCanonicalJsonSchema } from "../providers/schema";
import { Ai05OutputSchema } from "../schemas/AI-05";
import type { DataSufficiencyLevel, QuestionCount } from "../schemas/interview-common";
import type { NormalizedUsage } from "../providers/types";
import type { SaveInterviewQuestionPayload } from "../storage/interview";
import {
  AI05_PROMPT_VERSION,
  buildCompleteInterviewQuestionsPayload,
  buildInterviewQuestionContext,
  accumulateQuestionSetRecord,
  emptySequences,
  generateInterviewQuestions,
  premisesUserFacts,
  runInterviewQuestions,
  type ExistingInterviewQuestion,
  type InterviewQuestionContext,
} from "./AI-05";

function context(over: { type?: "job" | "culture_fit"; count?: QuestionCount; level?: DataSufficiencyLevel; rows?: CareerRows | null; insight?: boolean } = {}) {
  const jd = jdParts();
  return buildInterviewQuestionContext({
    interviewType: over.type ?? "job",
    questionCount: over.count ?? 5,
    dataSufficiency: over.level ?? "ok",
    careerRows: over.rows === undefined ? careerRowsFixture() : over.rows,
    asOf: AS_OF,
    jobDescriptionId: JD_ID,
    jobDescriptionUpdatedAt: JD_UPDATED_AT,
    sentences: jd.sentences,
    cultureSids: jd.cultureSids,
    requirements: jd.requirements,
    positionTitle: jd.positionTitle,
    insightSignal: over.insight ? { insightId: "60000000-0000-4000-8000-000000000001", matches: [{ requirement_id: reqId(8), status: "no_evidence", missing_aspect: "운영 서술" }] } : null,
    recentQuestions: ["예전에 연습한 질문입니다"],
  });
}

const R = (ctx: InterviewQuestionContext, n: number) => a(ctx.aliases, "jd_requirement", reqId(n));
const det = (ctx: InterviewQuestionContext, id: string, field: string, quote: string) => ({ source_type: "project_detail", ref: a(ctx.aliases, "project_detail", id), field, quote });

/** A valid job set of 5 (pdd 3, rf 1, gap 1). */
function jobSet(ctx: InterviewQuestionContext) {
  return [
    q({ text: "결제 승인 API 응답 시간을 1.2초에서 0.7초로 줄이셨는데, 병목을 어떻게 찾았고 직접 바꾼 부분은 무엇이었나요?", target_requirement_refs: [R(ctx, 6)], evidence: [det(ctx, IDS.detPay1, "action", "결제 승인 API의 병목 쿼리를 찾아 인덱스를 재설계했다")] }),
    q({ text: "정산 배치를 청크 단위로 재설계하실 때 어떤 기준으로 나누셨나요?", target_requirement_refs: [R(ctx, 2)], evidence: [det(ctx, IDS.detSettle, "action", "정산 배치를 청크 단위로 재설계했다")] }),
    q({ source_kind: "requirement_fit", text: "장애 대응 체계 운영 요건과 관련해 런북을 작성하신 과정을 설명해 주세요.", target_requirement_refs: [R(ctx, 3)], evidence: [{ source_type: "jd_requirement", ref: R(ctx, 3), field: null, quote: null }, det(ctx, IDS.detPay2, "action", "런북을 작성하고 알림 규칙을 정리했다")] }),
    q({ source_kind: "gap_probe", anchor: "jd", text: "메시지 큐 운영 경험이 데이터에 보이지 않는데, 비동기 처리 장애를 어떻게 다루시겠어요?", target_gap_requirement_refs: [R(ctx, 8)], evidence: [{ source_type: "jd_requirement", ref: R(ctx, 8), field: null, quote: null }] }),
    q({ text: "캐시 무효화 메시지를 발행하는 방식을 고른 이유는 무엇인가요?", evidence: [det(ctx, IDS.detEdu, "action", "쓰기 시 무효화 메시지를 발행했다")] }),
  ];
}

async function gen(ctx: InterviewQuestionContext, responses: FakeLlmResponse[], opts: { existing?: ExistingInterviewQuestion[]; attempt?: number } = {}) {
  const llm = createFakeLlm(responses, { chunkSize: 17 });
  const saved: SaveInterviewQuestionPayload[] = [];
  const result = await generateInterviewQuestions(
    { context: ctx, existingQuestions: opts.existing, attempt: opts.attempt },
    { llm, onQuestion: async (p) => void saved.push(p), now: () => new Date("2026-11-03T00:00:00.000Z") },
  );
  return { llm, saved, result };
}

describe("AI-05 schema", () => {
  it("canonical schema converts (C-10.2)", () => {
    expect(() => toCanonicalJsonSchema(Ai05OutputSchema)).not.toThrow();
  });
});

describe("AI-05 job interview", () => {
  it("5 valid questions → saved one by one with sequences 1..5, evidence as UUID rows, weak ids", async () => {
    const ctx = context({ insight: true });
    const { saved, result, llm } = await gen(ctx, [{ json: ai05Output("job", jobSet(ctx), [R(ctx, 8), "REQ-99"]) }]);
    expect(saved.map((s) => s.sequence)).toEqual([1, 2, 3, 4, 5]);
    expect(saved.map((s) => s.source_kind)).toEqual(["project_deep_dive", "project_deep_dive", "requirement_fit", "gap_probe", "project_deep_dive"]);
    expect(result).toMatchObject({ remaining: 0, totalSaved: 5, dropped: 0, missingKinds: {} });
    expect(result.weakRequirementIds).toEqual([reqId(8)]);
    expect(result.report).toMatchObject({ weak_refs_dropped: 1 });
    expect(saved[0].evidence[0]).toMatchObject({ item_key: "question", source_type: "project_detail", source_id: IDS.detPay1, source_field: "action" });
    expect(saved[0].target_requirement_ids).toEqual([reqId(6)]);
    expect(saved[3].target_gap_requirement_ids).toEqual([reqId(8)]);
    expect(saved[0].meta).toMatchObject({ prompt_version: AI05_PROMPT_VERSION, model_tier: "default", provider: "anthropic", schema_version: 2 });
    // C-8 order: pack → JD → reference → session → task; job gets no JD sentences.
    const blocks = llm.requests[0].userBlocks.map((b) => b.text);
    expect(blocks[0]).toMatch(/^<career_data>/);
    expect(blocks[1]).toMatch(/^<jd>/);
    expect(blocks[1]).not.toContain("<sentences>");
    expect(blocks[2]).toContain("<reference>");
    expect(blocks.join("\n")).toContain("예전에 연습한 질문입니다");
    expect(llm.requests[0]).toMatchObject({ callKey: "interview_questions.generate", reasoningLevel: "low", tier: "default" });

    const complete = buildCompleteInterviewQuestionsPayload({ context: ctx, weakRequirementIds: result.weakRequirementIds, model: result.model, provider: "anthropic", connectionTier: "paid" });
    expect(complete).toMatchObject({ weak_requirement_ids: [reqId(8)], insight_id: "60000000-0000-4000-8000-000000000001", career_snapshot_hash: ctx.base.careerSnapshotHash });
  });

  it("A22: complete payload carries the set-level validation_report and usage top-level (and in meta)", async () => {
    const ctx = context();
    const usage = { inputTokens: 100, cachedInputTokens: 0, cacheWriteTokens: 0, outputTokens: 50, reasoningTokens: 0, usageSource: "provider_reported" } satisfies NormalizedUsage;
    const first = accumulateQuestionSetRecord(null, { report: { questions_total: 6, questions_dropped: 2, dropped_composition: 2 }, usage });
    const set = accumulateQuestionSetRecord(first, { report: { questions_total: 2, composition_relaxed: 1 }, usage: { ...usage, outputTokens: 30 } });
    expect(set).toMatchObject({ attempts: 2, report: { questions_total: 8, questions_dropped: 2, dropped_composition: 2, composition_relaxed: 1 } });
    expect(set.usage).toMatchObject({ inputTokens: 200, outputTokens: 80 });
    // Usage missing on one call keeps the other's.
    expect(accumulateQuestionSetRecord(first, { report: {}, usage: null }).usage).toEqual(first.usage);

    const complete = buildCompleteInterviewQuestionsPayload({ context: ctx, weakRequirementIds: [], model: "m", usage: set.usage, report: set.report, attempts: set.attempts, provider: "anthropic", connectionTier: "paid" });
    expect(complete.validation_report).toEqual({ questions_total: 8, questions_dropped: 2, dropped_composition: 2, composition_relaxed: 1, attempts: 2, regenerated: 1 });
    expect(complete.usage).toEqual(set.usage);
    expect(complete.meta.validation_report).toEqual(complete.validation_report);
    expect(complete.meta.usage).toEqual(complete.usage);
    // Counts only: no text values anywhere in the report.
    expect(Object.values(complete.validation_report ?? {}).every((v) => typeof v === "number")).toBe(true);

    const bare = buildCompleteInterviewQuestionsPayload({ context: ctx, weakRequirementIds: [], model: "m", provider: "anthropic", connectionTier: "paid" });
    expect(bare).toMatchObject({ validation_report: null, usage: null });
    const single = buildCompleteInterviewQuestionsPayload({ context: ctx, weakRequirementIds: [], model: "m", attempts: 1, provider: "anthropic", connectionTier: "paid" });
    expect(single.validation_report).toEqual({ attempts: 1, regenerated: 0 });
  });

  it("forbidden topic, invented number, learnings premise and unknown refs are dropped (per question)", async () => {
    const ctx = context();
    const set = jobSet(ctx);
    const bad = [
      q({ text: "결혼 계획이 있으신가요? 업무에 영향이 있을까요?", evidence: [det(ctx, IDS.detPay1, "action", "결제 승인 API의 병목 쿼리를 찾아 인덱스를 재설계했다")] }),
      q({ text: "응답 시간을 4321배 줄이셨는데 어떻게 하셨나요?", evidence: [det(ctx, IDS.detPay1, "result", "응답 시간이 0.7초로 줄었다")] }),
      q({ text: "측정 없이 최적화하면 안 된다는 것을 어떻게 배우셨나요?", evidence: [det(ctx, IDS.detPay1, "learnings", "측정 없이 최적화하면 안 된다는 것을 배웠다")] }),
      q({ text: "없는 상세 내용 질문", evidence: [{ source_type: "project_detail", ref: "DET-99", field: "action", quote: "x" }] }),
    ];
    const { saved, result } = await gen(ctx, [{ json: ai05Output("job", [...bad, ...set.slice(0, 3)]) }]);
    expect(saved.map((s) => s.question_text)).toEqual(set.slice(0, 3).map((x) => x.text));
    expect(result).toMatchObject({ remaining: 2, dropped: 4 });
    expect(result.report).toMatchObject({
      dropped_forbidden_topic: 1,
      dropped_unsupported_numbers: 1,
      dropped_anchor_evidence_missing: 2,
      evidence_removed_v8_learnings: 1,
      evidence_removed_v1_ref: 1,
    });
    expect(result.unsupportedNumbers).toEqual(["4321배"]);
  });

  it("A11: every fact-premised job question needs action/result/성과 evidence; a gap_probe that premises nothing is exempt", async () => {
    const ctx = context();
    const set = jobSet(ctx);
    const req = (n: number) => ({ source_type: "jd_requirement", ref: R(ctx, n), field: null, quote: null });
    const bad = [
      // requirement_fit premised on a situation only (팀 맥락일 수 있음).
      q({ source_kind: "requirement_fit", text: "장애 대응이 사람마다 달랐던 상황에서 어떤 원칙을 세우셨나요?", target_requirement_refs: [R(ctx, 3)], evidence: [req(3), det(ctx, IDS.detPay2, "situation", "야간 장애 대응이 사람마다 달랐다")] }),
      // requirement_fit on the profile's wish only (A10: not a career fact → no experience evidence).
      q({ source_kind: "requirement_fit", text: "백엔드 개발자로서 장애 대응 요건을 어떻게 충족하시나요?", target_requirement_refs: [R(ctx, 3)], evidence: [req(3), { source_type: "profile", ref: "PROFILE", field: "desired_job_title", quote: "백엔드 개발자" }] }),
      // gap_probe citing a project summary as its "similar experience".
      q({ source_kind: "gap_probe", anchor: "jd", text: "응답 속도 개선 경험을 메시지 큐 운영에 어떻게 연결하시겠어요?", target_gap_requirement_refs: [R(ctx, 8)], evidence: [req(8), { source_type: "project", ref: a(ctx.aliases, "project", IDS.prjPay), field: "summary", quote: "결제 승인 응답 속도 개선" }] }),
      // gap_probe naming a project with no fact evidence at all.
      q({ source_kind: "gap_probe", anchor: "jd", text: "결제 승인 API 개선 때처럼 메시지 큐 장애를 다뤄 보셨나요?", target_gap_requirement_refs: [R(ctx, 8)], evidence: [req(8)] }),
      // gap_probe anchored on experience with a skill tag only.
      q({ source_kind: "gap_probe", anchor: "experience", text: "Spring Boot로 비동기 처리를 해 보셨는데 메시지 큐는 어떻게 다루시겠어요?", target_gap_requirement_refs: [R(ctx, 8)], evidence: [req(8), { source_type: "skill", ref: a(ctx.aliases, "skill", IDS.sklSpring), field: "name", quote: null }] }),
    ];
    const { saved, result } = await gen(ctx, [{ json: ai05Output("job", [...bad, ...set]) }]);
    expect(result).toMatchObject({ dropped: 5, remaining: 0 });
    expect(result.report).toMatchObject({ dropped_fact_premise_unsupported: 4, dropped_anchor_evidence_missing: 1 });
    expect(saved.map((s) => s.question_text)).toEqual(set.map((x) => x.text));
    // The jobSet gap_probe ("…경험이 데이터에 보이지 않는데…", anchor jd, no career evidence) premises nothing → saved.
    expect(saved[3]).toMatchObject({ source_kind: "gap_probe", anchor: "jd" });
  });

  it("A11: gap_probe pointing at similar experience is kept when that evidence is an action/result", async () => {
    const ctx = context({ count: 3 });
    const set = jobSet(ctx);
    const gap = q({
      source_kind: "gap_probe",
      anchor: "experience",
      text: "런북을 작성하신 경험을 메시지 큐 운영 장애에는 어떻게 적용하시겠어요?",
      target_gap_requirement_refs: [R(ctx, 8)],
      evidence: [{ source_type: "jd_requirement", ref: R(ctx, 8), field: null, quote: null }, det(ctx, IDS.detPay2, "action", "런북을 작성하고 알림 규칙을 정리했다")],
    });
    const rf = q({ ...set[2], evidence: [{ source_type: "jd_requirement", ref: R(ctx, 3), field: null, quote: null }, det(ctx, IDS.detSettle, "action", "정산 배치를 청크 단위로 재설계했다")] });
    const { saved, result } = await gen(ctx, [{ json: ai05Output("job", [set[0], rf, gap]) }]);
    expect(result).toMatchObject({ dropped: 0, remaining: 0 });
    expect(saved.map((s) => s.source_kind)).toEqual(["project_deep_dive", "requirement_fit", "gap_probe"]);
  });

  it.each<[string, Parameters<typeof premisesUserFacts>, boolean]>([
    ["project_deep_dive always", ["project_deep_dive", "experience", 0, 0], true],
    ["requirement_fit always", ["requirement_fit", "experience", 0, 0], true],
    ["gap_probe, jd anchor, nothing about the user", ["gap_probe", "jd", 0, 0], false],
    ["gap_probe, experience anchor", ["gap_probe", "experience", 0, 0], true],
    ["gap_probe with factual career evidence", ["gap_probe", "jd", 1, 0], true],
    ["gap_probe naming a career proper noun", ["gap_probe", "jd", 0, 1], true],
    ["culture fit kinds are out of scope (4.1 culture rules)", ["collaboration", "experience", 1, 1], false],
  ])("premisesUserFacts: %s → %s", (_, args, expected) => {
    expect(premisesUserFacts(...args)).toBe(expected);
  });

  it("duplicates: same project ≤ 2, same detail 1, same requirement 1, same text", async () => {
    const ctx = context();
    const set = jobSet(ctx);
    const out = [
      set[0],
      q({ text: "같은 상세 내용으로 다른 질문을 합니다", evidence: [det(ctx, IDS.detPay1, "result", "응답 시간이 0.7초로 줄었다")] }),
      set[2], // prjPay #2
      q({ text: "결제 프로젝트에 대한 세 번째 질문입니다", evidence: [{ source_type: "project", ref: a(ctx.aliases, "project", IDS.prjPay), field: "role", quote: null }, det(ctx, IDS.detPay2, "result", "장애 복구 시간이 줄었다")] }),
      q({ ...set[1], target_requirement_refs: [R(ctx, 6)] }), // REQ-6 already primary of Q1
      set[0],
    ];
    const { result } = await gen(ctx, [{ json: ai05Output("job", out) }]);
    expect(result.report).toMatchObject({ dropped_duplicate_detail: 1, dropped_duplicate_project: 1, dropped_duplicate_requirement: 1, dropped_duplicate_text: 1 });
    expect(result.saved.map((s) => s.question_text)).toEqual([set[0].text, set[2].text]);
  });

  it("composition: a question that would make the 4.1 minimum impossible is dropped; regeneration relaxes it", async () => {
    const ctx = context({ count: 3 });
    const set = jobSet(ctx);
    // 3문항: pdd ≥1, rf ≥1, gap = 1. Two pdd first → the second blocks the minimum.
    const strict = await gen(ctx, [{ json: ai05Output("job", [set[0], set[1], set[2]]) }]);
    expect(strict.saved.map((s) => s.source_kind)).toEqual(["project_deep_dive", "requirement_fit"]);
    expect(strict.result.report).toMatchObject({ dropped_composition: 1 });
    expect(strict.result.missingKinds).toEqual({ gap_probe: 1 });

    const relaxed = await gen(ctx, [{ json: ai05Output("job", [set[0], set[1], set[2]]) }], { attempt: 1 });
    expect(relaxed.saved).toHaveLength(3);
    expect(relaxed.result.report).toMatchObject({ composition_relaxed: 2, composition_unmet: 1 });
  });

  it("empty slots: saved 1, 2, 4 of 5 → the new questions get 3 then 5; the request lists existing questions and what is still needed", async () => {
    const ctx = context();
    const set = jobSet(ctx);
    const existing: ExistingInterviewQuestion[] = [
      { sequence: 1, source_kind: "project_deep_dive", anchor: "experience", question_text: set[0].text as string, target_requirement_ids: [reqId(6)], target_gap_requirement_ids: [], evidence_sources: [{ source_type: "project_detail", source_id: IDS.detPay1 }] },
      { sequence: 2, source_kind: "project_deep_dive", anchor: "experience", question_text: set[1].text as string, target_requirement_ids: [reqId(2)], target_gap_requirement_ids: [] },
      { sequence: 4, source_kind: "requirement_fit", anchor: "experience", question_text: set[2].text as string, target_requirement_ids: [reqId(3)], target_gap_requirement_ids: [] },
    ];
    expect(emptySequences(5, existing)).toEqual([3, 5]);
    const { saved, result, llm } = await gen(ctx, [{ json: ai05Output("job", [set[0], set[3], set[4]]) }], { existing });
    expect(saved.map((s) => [s.sequence, s.source_kind])).toEqual([
      [3, "gap_probe"],
      [5, "project_deep_dive"],
    ]);
    expect(result.report).toMatchObject({ dropped_duplicate_text: 1 });
    expect(result).toMatchObject({ remaining: 0, totalSaved: 5 });
    const text = llm.requests[0].userBlocks.map((b) => b.text).join("\n");
    expect(text).toContain("existing_questions:");
    expect(text).toContain("남은 2개만");
    expect(text).toContain("반드시 포함할 source_kind: gap_probe 1개");
    // A gap_probe already saved earlier counts into weak ids.
    expect(result.weakRequirementIds).toContain(reqId(8));
  });

  it("runInterviewQuestions: first call short → one regeneration with existing + V-5 feedback; still short → schema_invalid", async () => {
    const ctx = context();
    const set = jobSet(ctx);
    const invented = q({ text: "처리량을 4321배 늘리셨는데요?", evidence: [det(ctx, IDS.detPay1, "action", "결제 승인 API의 병목 쿼리를 찾아 인덱스를 재설계했다")] });
    const llm = createFakeLlm([{ json: ai05Output("job", [set[0], set[1], set[2], invented]) }, { json: ai05Output("job", [set[3], set[4]]) }], { chunkSize: 23 });
    const saved: SaveInterviewQuestionPayload[] = [];
    const run = await runInterviewQuestions({ context: ctx }, { llm, onQuestion: async (p) => void saved.push(p) });
    expect(saved.map((s) => s.sequence)).toEqual([1, 2, 3, 4, 5]);
    expect(run.attempts).toHaveLength(2);
    expect(llm.requests[1].callKey).toBe("interview_questions.generate.2");
    const regen = llm.requests[1].userBlocks.map((b) => b.text).join("\n");
    expect(regen).toContain("4321배");
    expect(regen).toContain("existing_questions:");

    const short = createFakeLlm([{ json: ai05Output("job", [set[0]]) }, { json: ai05Output("job", []) }]);
    await expect(runInterviewQuestions({ context: ctx }, { llm: short, onQuestion: async () => {} })).rejects.toMatchObject({ code: "schema_invalid", retryable: false });
  });

  it("provider error mid-stream: questions saved before it stay, the error is thrown", async () => {
    const ctx = context();
    const out = ai05Output("job", jobSet(ctx));
    const llm = createFakeLlm([{ errorAfterChunks: "provider_unavailable", json: out, chunks: 40 }], { chunkSize: 20 });
    const saved: SaveInterviewQuestionPayload[] = [];
    await expect(generateInterviewQuestions({ context: ctx }, { llm, onQuestion: async (p) => void saved.push(p) })).rejects.toBeInstanceOf(AiError);
    expect(saved.length).toBeGreaterThan(0);
    expect(saved.length).toBeLessThan(5);
  });

  it("truncated JSON is not an error: closed questions are saved, the rest is remaining", async () => {
    const ctx = context();
    const text = JSON.stringify(ai05Output("job", jobSet(ctx)));
    const cut = text.slice(0, text.indexOf("정산 배치를 청크") + 5);
    const { saved, result } = await gen(ctx, [{ text: cut }]);
    expect(saved).toHaveLength(1);
    expect(result).toMatchObject({ remaining: 4 });
    expect(result.report).toMatchObject({ stream_incomplete: 1 });
  });

  it("onQuestion failure propagates", async () => {
    const ctx = context();
    const llm = createFakeLlm([{ json: ai05Output("job", jobSet(ctx)) }]);
    await expect(
      generateInterviewQuestions({ context: ctx }, { llm, onQuestion: async () => Promise.reject(new Error("db down")) }),
    ).rejects.toThrow("db down");
  });

  it("aliases in question prose become names", async () => {
    const ctx = context({ count: 3 });
    const prj = a(ctx.aliases, "project", IDS.prjPay);
    const set = jobSet(ctx);
    const out = [q({ ...set[0], text: `${prj}에서 응답 시간을 1.2초에서 0.7초로 줄이셨는데 어떻게 하셨나요?` }), set[2], set[3]];
    const { saved } = await gen(ctx, [{ json: ai05Output("job", out) }]);
    expect(saved[0].question_text).toBe("'결제 승인 API 개선'에서 응답 시간을 1.2초에서 0.7초로 줄이셨는데 어떻게 하셨나요?");
  });
});

describe("AI-05 culture fit", () => {
  it("none: experience anchor dropped, jd anchor needs its sentence, general has no evidence; no user facts assumed", async () => {
    const ctx = context({ type: "culture_fit", level: "none", rows: null, count: 3 });
    const s1 = sid(ctx.aliases, "스쿼드");
    const out = [
      q({ source_kind: "collaboration", anchor: "experience", text: "팀에서 협업하신 경험을 말씀해 주세요." }),
      q({ source_kind: "conflict", anchor: "jd", text: "직군이 다른 동료와 우선순위가 부딪쳤을 때 어떻게 하시나요?", evidence: [] }),
      q({ source_kind: "conflict", anchor: "jd", text: "이 팀은 기획·개발·운영이 한 스쿼드로 일합니다. 우선순위가 부딪쳤을 때 어떻게 풀어 본 적이 있나요?", evidence: [{ source_type: "jd_sentence", ref: s1, field: null, quote: null }] }),
      q({ source_kind: "values", anchor: "general", text: "일의 우선순위를 정할 때 가장 중요하게 보는 것은 무엇인가요?", evidence: [{ source_type: "jd_sentence", ref: s1, field: null, quote: null }] }),
      q({ source_kind: "failure_growth", anchor: "general", text: "최근 3년 동안 가장 큰 실패는 무엇이었나요?" }),
      q({ source_kind: "failure_growth", anchor: "general", text: "실수한 뒤 바꾼 일하는 방식이 있나요?" }),
    ];
    const { saved, result, llm } = await gen(ctx, [{ json: ai05Output("culture_fit", out, [], "none") }]);
    expect(saved.map((s) => [s.source_kind, s.anchor])).toEqual([
      ["conflict", "jd"],
      ["values", "general"],
      ["failure_growth", "general"],
    ]);
    expect(saved[0].evidence).toHaveLength(1);
    expect(saved[1].evidence).toEqual([]);
    expect(saved.every((s) => s.target_requirement_ids.length === 0)).toBe(true);
    expect(result.report).toMatchObject({ dropped_anchor_not_allowed: 1, dropped_anchor_evidence_missing: 1, dropped_unsupported_numbers: 1, evidence_dropped_off_anchor: 1 });
    // Culture JD block carries the way-of-working sentences.
    expect(llm.requests[0].userBlocks[1].text).toContain("<sentences>");
  });

  it("thin: career proper nouns in a non-experience question are dropped; experience anchor uses learnings only as quoted reflection", async () => {
    const rows = careerRowsFixture();
    const ctx = context({ type: "culture_fit", level: "ok", rows, count: 5 });
    const learn = det(ctx, IDS.detPay1, "learnings", "측정 없이 최적화하면 안 된다는 것을 배웠다");
    const out = [
      q({ source_kind: "collaboration", anchor: "general", text: "예시페이에서 파트장으로 일하실 때 협업은 어땠나요?" }),
      q({ source_kind: "failure_growth", anchor: "experience", text: "측정 없이 최적화하면 안 된다는 것을 배웠다고 정리하셨는데, 그 뒤 실제로 바뀐 점은 무엇인가요?", evidence: [learn] }),
      q({ source_kind: "values", anchor: "experience", text: "최적화할 때 무엇을 먼저 보시나요?", evidence: [learn] }),
      q({ source_kind: "motivation_career", anchor: "general", text: "백엔드 개발자로서 다음에 어떤 일을 하고 싶으신가요?" }),
    ];
    const { saved, result } = await gen(ctx, [{ json: ai05Output("culture_fit", out) }]);
    expect(saved.map((s) => s.source_kind)).toEqual(["failure_growth", "motivation_career"]);
    expect(saved[0].evidence[0]).toMatchObject({ source_field: "learnings" });
    expect(result.report).toMatchObject({ dropped_career_terms_in_non_experience: 1, dropped_anchor_evidence_missing: 1, evidence_removed_v8_learnings: 1 });
  });

  it("topics must differ (5 questions) and motivation_career is reserved", async () => {
    const ctx = context({ type: "culture_fit", level: "thin", rows: thinCultureRows(), count: 3 });
    const out = [
      q({ source_kind: "values", anchor: "general", text: "가치관 질문 하나" }),
      q({ source_kind: "values", anchor: "general", text: "가치관 질문 둘" }),
      q({ source_kind: "collaboration", anchor: "general", text: "협업 질문" }),
      q({ source_kind: "project_deep_dive", anchor: "general", text: "직무 종류 질문" }),
    ];
    const { saved, result } = await gen(ctx, [{ json: ai05Output("culture_fit", out) }]);
    expect(saved.map((s) => s.source_kind)).toEqual(["values", "collaboration"]);
    expect(result.report).toMatchObject({ dropped_composition: 1, dropped_kind_not_allowed: 1 });
  });
});
