import { describe, expect, it } from "vitest";
import { KO_JD_HASH } from "../__fixtures__/AI-02/insight";
import { coverLetterContext, questionRow } from "../__fixtures__/S7/cover-letter-chat";
import {
  firstDraftChipLabel,
  firstTurnVariant,
  mergeQuestions,
  MAX_QUESTIONS_PER_DRAFT_TURN,
  planDraftBatches,
  questionsPerTurn,
  renderDocumentState,
  selectDraftBatch,
} from "./cover-letter-chat";

/** (R15) CF-5 문항 ≤ 5 · CL-10 한 턴 ≤ 3문항 · S-46 폼 스냅숏. */
describe("buildCoverLetterChatContext", () => {
  it("keeps one career pack assembly point with the source aliases (CL-Q1 제약 ①·②)", () => {
    const ctx = coverLetterContext();
    expect(ctx.packText).toContain("EXP-1");
    expect(ctx.packText).toContain("PRJ-1");
    // (R17) JD는 원문 문장 전체(S-n)뿐이다 — 요건 REQ-n·회사 소개 구분 없음.
    expect(ctx.jdText).not.toMatch(/REQ-\d/);
    const sids = [...ctx.aliases.values()].filter((e) => e.sourceType === "jd_sentence").map((e) => e.alias);
    expect(sids.length).toBeGreaterThan(10);
    for (const sid of sids) expect(ctx.jdText).toContain(`${sid}: `);
    expect([...ctx.aliases.values()].some((e) => e.sourceType === "jd_requirement")).toBe(false);
    expect(ctx.jdTextHash).toBe(KO_JD_HASH);
    expect(ctx.careerSnapshotHash).toMatch(/^[0-9a-f]{64}$/);
  });

  it("numbers the questions from 1 and gives each note its own alias", () => {
    const ctx = coverLetterContext({
      questions: [questionRow(1, { user_note: "결제 지연을 줄인 경험을 쓰고 싶어요" }), questionRow(2)],
    });
    expect(ctx.questions.map((q) => [q.slot, q.index, q.noteAlias])).toEqual([
      ["q_1", 1, "NOTE-1"],
      ["q_2", 2, null],
    ]);
    expect(ctx.aliases.get("NOTE-1")?.id).toBe(ctx.questions[0].questionId);
  });

  it("prefers the form snapshot over the row, per question (S-46)", () => {
    const ctx = coverLetterContext({
      questions: [questionRow(1, { body: "저장된 본문", answer_title: "저장된 제목" }), questionRow(2, { body: "두 번째 저장본" })],
      formSnapshot: { questions: [{ slot: "q_1", body: "작성 중인 본문", answer_title: null }, { slot: "q_9", body: "없는 문항" }] },
    });
    expect(ctx.questions[0].body).toBe("작성 중인 본문");
    expect(ctx.questions[0].answerTitle).toBeNull();
    expect(ctx.questions[0].valueSource).toBe("form_snapshot");
    // 정본에 없는 슬롯은 무시한다 (문항을 만드는 길은 저장 RPC뿐이다).
    expect(ctx.questions).toHaveLength(2);
    expect(ctx.questions[1].body).toBe("두 번째 저장본");
    expect(renderDocumentState(ctx)).toContain("작성 중인 본문");
  });

  it("counts a title-only question as empty", () => {
    const ctx = coverLetterContext({ questions: [questionRow(1, { answer_title: "제목만 있음", body: "  " })] });
    expect(ctx.questions[0].empty).toBe(true);
  });

  it("caps the document at five questions (CF-5)", () => {
    const rows = Array.from({ length: 7 }, (_, i) => questionRow(i + 1));
    expect(mergeQuestions(rows, null)).toHaveLength(5);
  });
});

describe("초안 턴 분할 (CF-5 + CL-10)", () => {
  it("splits five questions into two draft turns (1~3번 → 4~5번)", () => {
    const ctx = coverLetterContext({}, 5);
    const batches = planDraftBatches(ctx.questions);
    expect(batches.map((b) => b.map((q) => q.slot))).toEqual([["q_1", "q_2", "q_3"], ["q_4", "q_5"]]);
  });

  it("runs one draft turn when the document has three questions or fewer", () => {
    const ctx = coverLetterContext({}, 3);
    expect(planDraftBatches(ctx.questions)).toHaveLength(1);
    expect(MAX_QUESTIONS_PER_DRAFT_TURN).toBe(3);
  });

  it("drops to two questions per turn when the char limits add up over 3,000 [가정]", () => {
    const ctx = coverLetterContext({ questions: [1, 2, 3, 4, 5].map((n) => questionRow(n, { char_limit: 1500 })) }, 5);
    expect(questionsPerTurn(ctx.questions)).toBe(2);
    expect(planDraftBatches(ctx.questions).map((b) => b.length)).toEqual([2, 2, 1]);
  });

  it("takes the empty questions first, and the requested ones when the user picked some", () => {
    const ctx = coverLetterContext({
      questions: [questionRow(1, { body: "채워진 본문" }), questionRow(2), questionRow(3)],
    });
    expect(selectDraftBatch(ctx).map((q) => q.slot)).toEqual(["q_2", "q_3"]);

    const picked = coverLetterContext({ questions: [questionRow(1), questionRow(2), questionRow(3)], requestedSlots: ["q_3"] });
    expect(selectDraftBatch(picked).map((q) => q.slot)).toEqual(["q_3"]);
  });

  it("re-proposes from the first question when every answer is filled (CL-4)", () => {
    const ctx = coverLetterContext({ questions: [1, 2].map((n) => questionRow(n, { body: "이미 쓴 답변" })) });
    expect(selectDraftBatch(ctx).map((q) => q.slot)).toEqual(["q_1", "q_2"]);
  });
});

describe("첫 턴 문구 분기 (CF-5 `[가정]`, 최종 문구는 UX)", () => {
  it("4~5문항이면 1~3번만 먼저", () => {
    const ctx = coverLetterContext({}, 5);
    expect(firstTurnVariant(5)).toBe("batched");
    expect(firstTurnVariant(4)).toBe("batched");
    expect(firstDraftChipLabel(ctx.questions)).toBe("먼저 1~3번 문항 초안 만들기");
  });

  it("3문항 이하면 바로 초안", () => {
    const ctx = coverLetterContext({}, 3);
    expect(firstTurnVariant(3)).toBe("all");
    expect(firstTurnVariant(1)).toBe("all");
    expect(firstDraftChipLabel(ctx.questions)).toBe("초안 만들기");
  });
});
