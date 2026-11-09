import { describe, expect, it } from "vitest";
import { coverLetterContext, questionRow } from "../__fixtures__/S7/cover-letter-chat";
import { a, IDS } from "../__fixtures__/S7/drafts";
import type { CoverLetterChatContext } from "../context-pack/cover-letter-chat";
import { selectDraftBatch } from "../context-pack/cover-letter-chat";
import { createFakeLlm, type FakeLlmResponse } from "../fake-llm";
import { AI04_OUTPUT_SCHEMA_VERSION } from "../schemas/AI-04";
import { countChars } from "../validation/drafts";
import { compose, coverLetterCallKey, planCoverLetterTurn, type ComposeEvent, type ComposeResult } from "./AI-04";

/**
 * AI-04 초안 턴 (R15): 문항 배열 · 답변 제목(CF-6) · 글자 수 보정.
 * 실제 공급자 API를 부르지 않는다 — 가짜 SDK(createFakeLlm)만 쓴다.
 */

const BODY_TEXT = "결제 승인 API의 응답 시간을 1.2초에서 0.7초로 줄였습니다. 병목 쿼리를 분석해 인덱스를 재설계했습니다.";

function source(ctx: CoverLetterChatContext, projectId: string) {
  const prj = a(ctx.aliases, "project", projectId);
  return {
    project_ref: prj,
    experience_ref: null,
    education_ref: null,
    role: "primary",
    rationale: "직무 역량 요건과 가장 가깝습니다",
    requirement_refs: ["REQ-1"],
    reuse_reason: null,
    evidence: [{ source_type: "project", ref: prj, field: "name", quote: null }],
  };
}

function paragraph(ctx: CoverLetterChatContext, projectId: string, text = BODY_TEXT) {
  const prj = a(ctx.aliases, "project", projectId);
  return {
    block_id: "p1",
    text,
    evidence: [{ source_type: "project", ref: prj, field: "name", quote: null }],
    source_fact_ids: [],
    source_body_quotes: [],
    requirement_refs: ["REQ-1"],
    placeholders: [],
  };
}

function composeOutput(ctx: CoverLetterChatContext, questions: Array<Record<string, unknown>>) {
  return { schema_version: AI04_OUTPUT_SCHEMA_VERSION, draft_type: "cover_letter", turn_kind: "compose", questions };
}

function question(ctx: CoverLetterChatContext, slot: string, over: Record<string, unknown> = {}) {
  const projectId = ctx.pack.aliases.get("PRJ-1")!.id;
  return {
    question_slot: slot,
    question_class: "job_competency",
    sources: [source(ctx, projectId)],
    paragraphs: [paragraph(ctx, projectId)],
    answer_title: "응답 시간을 0.7초로 줄인 병목 분석",
    notes_for_user: [],
    ...over,
  };
}

async function run(ctx: CoverLetterChatContext, responses: FakeLlmResponse[], batchSlots?: string[]) {
  const llm = createFakeLlm(responses, { chunkSize: 23 });
  const batch = batchSlots ? ctx.questions.filter((q) => batchSlots.includes(q.slot)) : selectDraftBatch(ctx);
  const events: ComposeEvent[] = [];
  const it = compose(ctx, { llm }, { batch });
  let next = await it.next();
  while (!next.done) {
    events.push(next.value);
    next = await it.next();
  }
  return { llm, events, result: next.value as ComposeResult };
}

describe("compose (초안 턴)", () => {
  it("keeps a grounded answer_title and puts it on the replace_draft op (CF-6)", async () => {
    const ctx = coverLetterContext({}, 3);
    const { result } = await run(ctx, [{ json: composeOutput(ctx, [question(ctx, "q_1")]) }], ["q_1"]);

    expect(result.outcome).toBe("draft");
    expect(result.questions[0].answerTitle).toBe("응답 시간을 0.7초로 줄인 병목 분석");
    const op = result.patch.ops.find((o) => o.op === "replace_draft");
    expect(op).toBeDefined();
    if (op?.op !== "replace_draft") throw new Error("no replace_draft");
    expect(op.slot).toBe("q_1");
    expect(op.draft.answer_title).toBe("응답 시간을 0.7초로 줄인 병목 분석");
    expect(op.draft.blocks[0].block_id).toBe("q_1.1");
  });

  it("drops only the title when it claims a number the body does not have — the body survives", async () => {
    const ctx = coverLetterContext({}, 3);
    const { result } = await run(ctx, [{ json: composeOutput(ctx, [question(ctx, "q_1", { answer_title: "응답 시간 40% 단축" })]) }], ["q_1"]);

    expect(result.questions[0].answerTitle).toBeNull();
    expect(result.questions[0].titleRejected).toBe("numbers");
    expect(result.questions[0].blocks).toHaveLength(1);
    expect(result.questions[0].blocks[0].text).toContain("0.7초");
    expect(result.validationReport.answer_title_dropped).toBe(1);
    expect(result.assistantMessage).toContain("1번 문항 제목은");
  });

  it("asks for no title when the question already has one (사용자 제목을 덮지 않는다)", async () => {
    const ctx = coverLetterContext({ questions: [questionRow(1, { answer_title: "내가 쓴 제목" })] });
    const { llm, result } = await run(ctx, [{ json: composeOutput(ctx, [question(ctx, "q_1")]) }], ["q_1"]);

    expect(result.questions[0].answerTitle).toBeNull();
    expect(result.questions[0].titleRejected).toBeNull();
    const task = llm.requests[0].userBlocks.map((b) => b.text).join("\n");
    expect(task).toContain("제목이 이미 있으므로 answer_title은 null입니다");
  });

  it("leaves the answer_title out of the char count and out of the adjust call (CF-6)", async () => {
    // 제한 1,000자 · 본문 한 문단: 보정이 필요하므로 adjust 호출이 한 번 더 간다.
    const ctx = coverLetterContext({ questions: [questionRow(1, { char_limit: 1000 })] });
    const long = `${BODY_TEXT} `.repeat(6).trim();
    const adjusted = {
      schema_version: AI04_OUTPUT_SCHEMA_VERSION,
      draft_type: "cover_letter",
      turn_kind: "adjust_length",
      questions: [{ question_slot: "q_1", paragraphs: [paragraph(ctx, ctx.pack.aliases.get("PRJ-1")!.id, long)] }],
    };
    const { events, result, llm } = await run(
      ctx,
      [{ json: composeOutput(ctx, [question(ctx, "q_1", { answer_title: "응답 시간을 0.7초로 줄인 병목 분석" })]) }, { json: adjusted }],
      ["q_1"],
    );

    expect(events.some((e) => e.type === "adjusting_length")).toBe(true);
    expect(llm.requests).toHaveLength(2);
    const adjustBlocks = llm.requests[1].userBlocks.map((b) => b.text).join("\n");
    expect(adjustBlocks).toContain("답변 제목은 담지 않습니다");
    expect(adjustBlocks).not.toContain("응답 시간을 0.7초로 줄인 병목 분석");

    const q = result.questions[0];
    const bodyOnly = q.blocks.map((b) => b.text).join("\n");
    expect(q.charCount).toBe(countChars(bodyOnly, "with_spaces"));
    // 제목을 더한 길이보다 반드시 짧다 (제목이 글자 수에 들어가지 않는다).
    expect(q.charCount).toBeLessThan(countChars(bodyOnly + (q.answerTitle ?? ""), "with_spaces"));
    expect(q.correctionApplied).toBe(true);
  });

  it("writes one replace_draft per question of the turn (문항 배열)", async () => {
    const ctx = coverLetterContext({}, 5);
    const batch = selectDraftBatch(ctx).map((q) => q.slot);
    expect(batch).toEqual(["q_1", "q_2", "q_3"]);
    const { result, events } = await run(ctx, [{ json: composeOutput(ctx, batch.map((slot) => question(ctx, slot))) }]);

    expect(result.patch.ops.filter((o) => o.op === "replace_draft")).toHaveLength(3);
    expect(result.questions.map((q) => q.slot)).toEqual(batch);
    expect(events.filter((e) => e.type === "sources_selected").map((e) => (e as { slot: string }).slot)).toEqual(batch);
    expect(events.filter((e) => e.type === "draft_block")).toHaveLength(3);
    expect(result.assistantMessage).toContain("1~3번 문항 초안을 만들었어요");
  });

  it("ignores a question the turn did not ask for (모델이 문항을 만들지 못한다)", async () => {
    const ctx = coverLetterContext({}, 3);
    const { result } = await run(ctx, [{ json: composeOutput(ctx, [question(ctx, "q_1"), question(ctx, "q_777")]) }], ["q_1"]);

    expect(result.questions.map((q) => q.slot)).toEqual(["q_1"]);
    expect(result.validationReport.questions_dropped_unknown_slot).toBe(1);
  });

  it("counts the turn only (count_draft) when nothing survives validation", async () => {
    const ctx = coverLetterContext({}, 3);
    const empty = question(ctx, "q_1", { paragraphs: [{ ...paragraph(ctx, ctx.pack.aliases.get("PRJ-1")!.id, "   "), evidence: [] }] });
    const { result } = await run(ctx, [{ json: composeOutput(ctx, [empty]) }], ["q_1"]);

    expect(result.outcome).toBe("empty");
    expect(result.patch.ops).toEqual([{ op: "count_draft" }]);
    expect(result.assistantMessage).toBe("초안을 만들 내용이 아직 부족해요.");
  });

  // V-8 (C-9): 배운 점은 job_competency 문항에서 근거가 될 수 없다 — 저장 RPC의
  // 마지막 안전망(`source_type='project' AND source_field='learnings'` 거부)과 같은 규칙이다.
  it("refuses a learnings evidence in a job_competency question and keeps it in a future_plan one (V-8)", async () => {
    const learningsEvidence = (ctx: CoverLetterChatContext) => [
      { source_type: "project", ref: a(ctx.aliases, "project", IDS.prjPay), field: "learnings", quote: "측정 없이 최적화하면 안 된다는 것을 배웠다" },
    ];

    const competency = coverLetterContext({ questions: [questionRow(1, { template_key: "job_competency" })] });
    const withLearnings = (ctx: CoverLetterChatContext) =>
      question(ctx, "q_1", {
        sources: [source(ctx, IDS.prjPay)],
        paragraphs: [{ ...paragraph(ctx, IDS.prjPay, "측정의 중요성을 배웠습니다. 그 뒤 지표를 먼저 봅니다."), evidence: learningsEvidence(ctx) }],
        answer_title: null,
      });
    const a1 = await run(competency, [{ json: composeOutput(competency, [withLearnings(competency)]) }], ["q_1"]);
    expect(a1.result.questions[0].blocks[0]?.evidence ?? []).toHaveLength(0);

    const plan = coverLetterContext({ questions: [questionRow(1, { template_key: "future_plan" })] });
    const a2 = await run(plan, [{ json: composeOutput(plan, [withLearnings(plan)]) }], ["q_1"]);
    expect(a2.result.questions[0].blocks[0].evidence.some((e) => e.source_field === "learnings")).toBe(true);
  });

  // (CF-S1, 2026-11-09 사용자 결정 — 문서 PR #68 미머지) 문항 근거는 제안에 실려 저장된다.
  it("carries the question sources on replace_draft, always with the key present (CF-S1)", async () => {
    const ctx = coverLetterContext({ questions: [questionRow(1, { template_key: "job_competency" })] });
    const { result } = await run(ctx, [{ json: composeOutput(ctx, [question(ctx, "q_1")]) }], ["q_1"]);

    const op = result.patch.ops.find((o) => o.op === "replace_draft");
    if (op?.op !== "replace_draft") throw new Error("no replace_draft");
    expect(op.draft.sources).toEqual([{ source_type: "project", source_id: ctx.pack.aliases.get("PRJ-1")!.id, role: "primary" }]);
    expect(result.questions[0].storedSources).toEqual(op.draft.sources);
  });

  it("sends an empty sources array (not a missing key) when the question legitimately selected none", async () => {
    // motivation 문항은 프로젝트 0개가 정상이다 (AI-04 문항 유형별 규칙).
    const ctx = coverLetterContext({ questions: [questionRow(1, { template_key: "motivation" })] });
    const prj = a(ctx.aliases, "project", IDS.prjPay);
    const noSources = question(ctx, "q_1", {
      question_class: "motivation",
      sources: [],
      paragraphs: [{ ...paragraph(ctx, IDS.prjPay), evidence: [{ source_type: "project", ref: prj, field: "name", quote: null }] }],
    });
    const { result } = await run(ctx, [{ json: composeOutput(ctx, [noSources]) }], ["q_1"]);

    const op = result.patch.ops.find((o) => o.op === "replace_draft");
    if (op?.op !== "replace_draft") throw new Error("no replace_draft");
    // 키가 **있고** 값이 빈 배열이다 — db는 이것을 "근거 행 없음으로 교체"로 읽는다.
    expect(Object.prototype.hasOwnProperty.call(op.draft, "sources")).toBe(true);
    expect(op.draft.sources).toEqual([]);
  });

  // db-engineer R15 노트 ②-5 대조: `{op, slot, question_id?, draft}` 모양이고
  // `value`는 보내지 않는다(DB가 blocks로 재조립), `char_limit_at_generation`은
  // null이면 키를 두지 않는다(db가 null을 invalid_value로 본다).
  it("matches the RPC payload shape of replace_draft", async () => {
    const ctx = coverLetterContext({ questions: [questionRow(1, { char_limit: null })] });
    const { result } = await run(ctx, [{ json: composeOutput(ctx, [question(ctx, "q_1")]) }], ["q_1"]);
    const op = result.patch.ops.find((o) => o.op === "replace_draft");
    if (op?.op !== "replace_draft") throw new Error("no replace_draft");

    expect(Object.keys(op).sort()).toEqual(["draft", "op", "question_id", "slot"]);
    expect(op.question_id).toBe(ctx.questions[0].questionId);
    expect(Object.prototype.hasOwnProperty.call(op.draft, "value")).toBe(false);
    expect(Object.prototype.hasOwnProperty.call(op.draft, "char_limit_at_generation")).toBe(false);
    expect(op.draft.blocks.length).toBeGreaterThan(0);
    expect(op.draft.blocks.every((b) => b.block_id.length <= 50 && /^[A-Za-z0-9_.:-]{1,64}$/.test(b.block_id))).toBe(true);
    expect(op.draft.blocks.every((b) => b.review === "ok" || b.review === "needs_review")).toBe(true);
    expect(op.draft.blocks.every((b) => b.basis === "new" || b.basis === "current_body")).toBe(true);
    expect(typeof op.draft.char_count).toBe("number");
    expect(typeof op.draft.base_body_hash).toBe("string");
    expect(op.draft.missing_slots).toEqual([]);
    expect(op.draft.dropped_block_count).toBeLessThanOrEqual(999);
  });

  it("uses the turn-numbered call keys (C-13)", () => {
    expect(coverLetterCallKey(2, "compose")).toBe("cover_letter.turn.2.compose");
    expect(coverLetterCallKey(2, "adjust_length")).toBe("cover_letter.turn.2.adjust_length");
  });
});

describe("planCoverLetterTurn", () => {
  it("refuses a requested draft once the chat used its six draft proposals", () => {
    const ctx = coverLetterContext({
      requestedAction: "compose_draft",
      structuredDraft: { target: "cover_letter", draft_count: 6 },
    });
    expect(planCoverLetterTurn(ctx)).toEqual({ kind: "reject_draft_limit" });
  });

  it("is a question turn when nothing asked for a draft", () => {
    expect(planCoverLetterTurn(coverLetterContext())).toEqual({ kind: "question" });
  });
});
