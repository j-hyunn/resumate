import { describe, expect, it } from "vitest";
import { a, AS_OF, careerRowsFixture, IDS, JD_ID, JD_UPDATED_AT, jdParts, koText } from "../__fixtures__/S7/drafts";
import { createFakeLlm, type FakeLlmResponse } from "../fake-llm";
import { toCanonicalJsonSchema } from "../providers/schema";
import { Ai04AdjustOutputSchema, Ai04OutputSchema } from "../schemas/AI-04";
import type { CompleteCoverLetterSectionPayload } from "../storage/drafts";
import type { AiStreamEvent } from "../streaming/events";
import { countChars, isLengthOutOfRange } from "../validation/drafts";
import {
  AI04_ADJUST_PROMPT_VERSION,
  AI04_PROMPT_VERSION,
  buildCoverLetterContext,
  computeCoverLetterInputHash,
  paragraphBlockId,
  streamCoverLetterSection,
  type CoverLetterQuestion,
  type CoverLetterView,
  type UserSourceInput,
} from "./AI-04";

const SECTION_ID = "91000000-0000-4000-8000-000000000001";

function question(over: Partial<CoverLetterQuestion> = {}): CoverLetterQuestion {
  return { section_id: SECTION_ID, question_text: "직무 역량", template_key: "job_competency", char_limit: null, count_basis: "with_spaces", user_note: null, ...over };
}

function context(q = question(), mode: "ai" | "user" = "ai", userSources: UserSourceInput[] = [], otherSections: Array<{ question_text: string; primary_project_ids: string[] }> = []) {
  const jd = jdParts();
  return buildCoverLetterContext({
    careerRows: careerRowsFixture(),
    asOf: AS_OF,
    jobDescriptionId: JD_ID,
    jobDescriptionUpdatedAt: JD_UPDATED_AT,
    sentences: jd.sentences,
    companySids: ["S1"],
    requirements: jd.requirements,
    positionTitle: jd.positionTitle,
    question: q,
    mode,
    userSources,
    otherSections,
  });
}

type Ctx = ReturnType<typeof context>;

async function run(ctx: Ctx, responses: FakeLlmResponse[]) {
  const llm = createFakeLlm(responses, { chunkSize: 13 });
  const persisted: CompleteCoverLetterSectionPayload[] = [];
  const events: AiStreamEvent[] = [];
  for await (const e of streamCoverLetterSection({ context: ctx }, { llm, now: () => new Date("2026-10-29T00:00:00.000Z"), persist: async (p) => (persisted.push(p), { resultId: SECTION_ID }) })) {
    events.push(e);
  }
  const validated = events.find((e) => e.type === "validated") as Extract<AiStreamEvent, { type: "validated" }> | undefined;
  return { llm, events, persisted, payload: persisted[0], view: validated?.result as CoverLetterView | undefined };
}

function paragraph(id: string, text: string, evidence: unknown[], extra: Record<string, unknown> = {}) {
  return { block_id: id, text, evidence, requirement_refs: [], placeholders: [], ...extra };
}

function source(ctx: Ctx, projectId: string, extra: Record<string, unknown> = {}) {
  const prj = a(ctx.aliases, "project", projectId);
  return {
    project_ref: prj,
    experience_ref: null,
    education_ref: null,
    detail_refs: [],
    role: "primary",
    rationale: "관련이 큽니다",
    requirement_refs: ["REQ-1"],
    reuse_reason: null,
    evidence: [{ source_type: "project", ref: prj, field: "role", quote: null }],
    ...extra,
  };
}

function output(ctx: Ctx, over: Record<string, unknown> = {}) {
  return { schema_version: 2, question_ref: "CLQ-1", question_class: "job_competency", selection_mode: "ai", sources: [], paragraphs: [], notes_for_user: [], ...over };
}

describe("streamCoverLetterSection (AI-04)", () => {
  it("job_competency: sources_selected first, V-7 on paragraphs, persisted payload", async () => {
    const ctx = context(question({ template_key: null, user_note: "결제 도메인에 계속 있고 싶다" }));
    const det1 = a(ctx.aliases, "project_detail", IDS.detPay1);
    const det2 = a(ctx.aliases, "project_detail", IDS.detPay2);
    const settleDet = a(ctx.aliases, "project_detail", IDS.detSettle);
    const out = output(ctx, {
      question_class: "job_competency",
      sources: [
        source(ctx, IDS.prjPay, {
          experience_ref: "EXP-9", // wrong parent → corrected
          detail_refs: [det1, settleDet], // settleDet belongs to another project → dropped
          evidence: [{ source_type: "project_detail", ref: det1, field: "action", quote: "결제 승인 API의 병목 쿼리를 찾아 인덱스를 재설계했다" }],
        }),
        source(ctx, IDS.prjSide, { role: "primary", evidence: [] }), // no evidence → dropped (V-4)
      ],
      paragraphs: [
        paragraph("q-p1", "저는 결제 승인 API의 병목을 찾아 응답 시간을 1.2초에서 0.7초로 줄였습니다.", [
          { source_type: "project_detail", ref: det1, field: "result", quote: "응답 시간이 0.7초로 줄었다" },
        ]),
        // det2 is outside detail_refs → V-7 removal; settle detail outside sources → V-7 removal → flagged.
        paragraph("q-p2", "장애 대응 런북을 정리했습니다.", [
          { source_type: "project_detail", ref: det2, field: "action", quote: "런북을 작성하고 알림 규칙을 정리했다" },
          { source_type: "project_detail", ref: settleDet, field: "action", quote: "정산 배치를 청크 단위로 재설계했다" },
        ]),
        paragraph("q-p3", "결제 도메인에서 계속 성장하고 싶습니다.", [{ source_type: "user_note", ref: "NOTE-1", field: null, quote: "결제 도메인에 계속 있고 싶다" }]),
      ],
    });
    const { events, payload, view, llm } = await run(ctx, [{ json: out }]);

    const types = events.map((e) => e.type);
    const selectedAt = types.indexOf("sources_selected");
    expect(selectedAt).toBeGreaterThanOrEqual(0);
    expect(selectedAt).toBeLessThan(types.indexOf("block_started"));
    expect(types.slice(-2)).toEqual(["validated", "done"]);
    expect(types).not.toContain("adjusting_length");

    const selected = events[selectedAt] as Extract<AiStreamEvent, { type: "sources_selected" }>;
    expect(selected.sources).toEqual([
      {
        sort_order: 0,
        role: "primary",
        project_id: IDS.prjPay,
        experience_id: IDS.expA,
        education_id: null,
        project_detail_ids: [IDS.detPay1],
        label: "예시페이 › 결제 승인 API 개선",
        rationale: "관련이 큽니다",
        reuse_reason: null,
        requirement_ids: [jdParts().requirements[0].id],
      },
    ]);
    expect(selected.questionClass).toBe("job_competency");

    expect(payload.question_class).toBe("job_competency");
    expect(payload.sources).toHaveLength(1);
    expect(payload.blocks.map((b) => b.block_id)).toEqual([1, 2, 3].map((n) => paragraphBlockId(SECTION_ID, n)));
    expect(payload.blocks.every((b) => b.block_kind === "paragraph")).toBe(true);
    expect(payload.blocks[0].flags).toEqual([]);
    expect(payload.blocks[1].flags).toEqual(["evidence_check_needed"]);
    expect(payload.blocks[2].flags).toEqual([]);
    const noteRow = payload.evidence.find((e) => e.source_type === "user_note");
    expect(noteRow).toMatchObject({ source_id: SECTION_ID, source_field: null, item_key: paragraphBlockId(SECTION_ID, 3) });
    expect(payload.evidence.find((e) => e.item_key === "sources.0")).toMatchObject({ source_id: IDS.detPay1, source_field: "action" });
    expect(payload.ai_char_count).toBe(countChars(payload.blocks.map((b) => b.text).join("\n"), "with_spaces"));
    expect(payload.correction_applied).toBe(false);
    expect(payload.char_adjust_needed).toBe(false);
    expect(payload.meta).toMatchObject({ prompt_version: AI04_PROMPT_VERSION, schema_version: 2, model_tier: "default" });
    expect(payload.meta.validation_report).toMatchObject({
      evidence_removed_v7_scope: 2,
      source_parent_corrected: 1,
      detail_refs_dropped: 1,
      sources_dropped_no_evidence: 1,
    });
    expect(JSON.stringify(payload.blocks)).not.toContain('"evidence"');
    expect(view?.blocks).toEqual(payload.blocks);

    // Prompt: data blocks, note as data, class rule for a user-added question.
    const text = llm.requests[0].userBlocks.map((b) => b.text).join("\n");
    expect(text).toContain('<note ref="NOTE-1">');
    expect(text).toContain("사용자 추가 문항(유형을 분류하세요)");
    expect(llm.requests[0].userBlocks[0].cache).toBe(true);
  });

  it("motivation without a note keeps [지원 동기 입력 필요]; template key fixes the class; count rule truncates", async () => {
    const ctx = context(question({ question_text: "지원 동기", template_key: "motivation" }));
    const out = output(ctx, {
      question_class: "experience_story", // overridden by template_key
      sources: [source(ctx, IDS.prjPay), source(ctx, IDS.prjSide, { role: "supporting", evidence: [{ source_type: "project", ref: a(ctx.aliases, "project", IDS.prjSide), field: "role", quote: null }] })],
      paragraphs: [
        paragraph("q-p1", "[지원 동기 입력 필요] 그리고 결제 백엔드 공고에 끌렸습니다.", [{ source_type: "jd_sentence", ref: "S1", field: null, quote: null }], {
          placeholders: [{ token: "[지원 동기 입력 필요]", hint: "이 회사를 고른 개인적 이유" }],
        }),
      ],
    });
    const { payload } = await run(ctx, [{ json: out }]);
    expect(payload.question_class).toBe("motivation");
    expect(payload.sources).toHaveLength(1); // motivation: 0~1 project
    expect(payload.blocks[0].text).toContain("[지원 동기 입력 필요]");
    expect(payload.blocks[0].placeholders).toEqual([{ token: "[지원 동기 입력 필요]", hint: "이 회사를 고른 개인적 이유" }]);
    // JD evidence alone does not support a claim about the user → flagged, placeholder not stripped.
    expect(payload.blocks[0].flags).toEqual(["evidence_check_needed"]);
    expect(payload.meta.validation_report).toMatchObject({ question_class_overridden: 1, sources_truncated: 1 });
  });

  it("learnings: reflection allowed in future_plan, removed in job_competency (V-8)", async () => {
    const reflect = (ctx: Ctx) => {
      const det1 = a(ctx.aliases, "project_detail", IDS.detPay1);
      return output(ctx, {
        question_class: ctx.question.template_key,
        sources: [source(ctx, IDS.prjPay, { detail_refs: [det1] })],
        paragraphs: [paragraph("q-p1", "측정 없이 최적화하면 안 된다는 것을 배웠습니다.", [{ source_type: "project_detail", ref: det1, field: "learnings", quote: "측정 없이 최적화하면 안 된다는 것을 배웠다" }])],
      });
    };
    const plan = context(question({ question_text: "입사 후 포부", template_key: "future_plan" }));
    const ok = await run(plan, [{ json: reflect(plan) }]);
    expect(ok.payload.blocks[0].flags).toEqual([]);
    expect(ok.payload.evidence.some((e) => e.source_field === "learnings")).toBe(true);

    const comp = context();
    const bad = await run(comp, [{ json: reflect(comp) }]);
    expect(bad.payload.blocks[0].flags).toEqual(["evidence_check_needed"]);
    expect(bad.payload.evidence.some((e) => e.source_field === "learnings")).toBe(false);
    expect(bad.payload.meta.validation_report).toMatchObject({ evidence_removed_v8_learnings: 1 });
  });

  it("user mode: keeps the user's list, drops model sources outside it", async () => {
    const userSources: UserSourceInput[] = [{ experience_id: null, education_id: null, project_id: IDS.prjEdu, project_detail_ids: [IDS.detEdu], role: "primary" }];
    const ctx = context(question(), "user", userSources);
    const capstone = a(ctx.aliases, "project", IDS.prjEdu);
    const out = output(ctx, {
      selection_mode: "user",
      sources: [
        source(ctx, IDS.prjEdu, { rationale: "캐시 일관성 경험", evidence: [{ source_type: "project", ref: capstone, field: "role", quote: null }] }),
        { ...source(ctx, IDS.prjEdu), project_ref: "PRJ-42" }, // not in the user's list (not even in the user-mode pack)
      ],
      paragraphs: [paragraph("q-p1", "쓰기 시 무효화 메시지를 발행해 캐시 일관성을 맞췄습니다.", [{ source_type: "project_detail", ref: a(ctx.aliases, "project_detail", IDS.detEdu), field: "action", quote: "쓰기 시 무효화 메시지를 발행했다" }])],
    });
    const { payload, llm } = await run(ctx, [{ json: out }]);
    expect(payload.sources).toEqual([
      expect.objectContaining({ project_id: IDS.prjEdu, education_id: IDS.edu, role: "primary", rationale: "캐시 일관성 경험", project_detail_ids: [IDS.detEdu] }),
    ]);
    expect(payload.meta.validation_report).toMatchObject({ sources_dropped_not_in_user_list: 1 });
    // User-mode pack holds only the selection (+ profile).
    expect(llm.requests[0].userBlocks[0].text).not.toContain("결제 승인 API 개선");
    expect(llm.requests[0].userBlocks.map((b) => b.text).join("\n")).toContain("<user_sources>");
  });

  it("length correction: adjusting_length → adjust call → validated (correction_applied)", async () => {
    const ctx = context(question({ char_limit: 100 }));
    const det1 = a(ctx.aliases, "project_detail", IDS.detPay1);
    const ev = [{ source_type: "project_detail", ref: det1, field: "action", quote: "결제 승인 API의 병목 쿼리를 찾아 인덱스를 재설계했다" }];
    const long = output(ctx, { sources: [source(ctx, IDS.prjPay)], paragraphs: [paragraph("q-p1", `${koText(290)} 처리량 4321배`, ev)] });
    const fixed = { schema_version: 2, paragraphs: [paragraph("q-p1", koText(95), ev)] };
    const { events, payload, llm } = await run(ctx, [{ json: long }, { json: fixed }]);

    const types = events.map((e) => e.type);
    expect(types.slice(-3)).toEqual(["adjusting_length", "validated", "done"]);
    expect(events.find((e) => e.type === "adjusting_length")).toMatchObject({ charLimit: 100, countBasis: "with_spaces", reasons: ["length", "numbers"] });
    expect(llm.requests[1]).toMatchObject({ callKey: "cover_letter.adjust", promptVersion: AI04_ADJUST_PROMPT_VERSION, reasoningLevel: "low" });
    const adjustText = llm.requests[1].userBlocks.map((b) => b.text).join("\n");
    expect(adjustText).toContain("<draft>");
    expect(adjustText).toContain("4321배");
    // Same cache prefix as the generate call (C-8).
    expect(llm.requests[1].userBlocks[0].text).toBe(llm.requests[0].userBlocks[0].text);
    expect(payload.correction_applied).toBe(true);
    expect(payload.char_adjust_needed).toBe(false);
    expect(payload.ai_char_count).toBe(95);
    expect(payload.meta.prompt_version).toContain("ai-04.adjust.v1");
    expect(payload.meta.usage?.inputTokens).toBe(200);
  });

  it("correction still out of range → char_adjust_needed; correction failure keeps the draft", async () => {
    const ctx = context(question({ char_limit: 100 }));
    const det1 = a(ctx.aliases, "project_detail", IDS.detPay1);
    const ev = [{ source_type: "project_detail", ref: det1, field: "action", quote: "결제 승인 API의 병목 쿼리를 찾아 인덱스를 재설계했다" }];
    const long = output(ctx, { sources: [source(ctx, IDS.prjPay)], paragraphs: [paragraph("q-p1", koText(300), ev)] });

    const still = await run(ctx, [{ json: long }, { json: { schema_version: 2, paragraphs: [paragraph("q-p1", koText(200), ev)] } }]);
    expect(still.payload).toMatchObject({ correction_applied: true, char_adjust_needed: true, ai_char_count: 200 });

    const failed = await run(ctx, [{ json: long }, { error: "rate_limited" }]);
    expect(failed.events.at(-1)?.type).toBe("done");
    expect(failed.payload).toMatchObject({ correction_applied: false, char_adjust_needed: true, ai_char_count: 300 });
    expect(failed.payload.meta.validation_report).toMatchObject({ length_adjust_failed: 1 });
  });

  it("invented numbers without a correction call are replaced and flagged", async () => {
    const ctx = context();
    const det1 = a(ctx.aliases, "project_detail", IDS.detPay1);
    const out = output(ctx, {
      sources: [source(ctx, IDS.prjPay)],
      paragraphs: [paragraph("q-p1", "처리량을 4321배로 늘렸습니다.", [{ source_type: "project_detail", ref: det1, field: "action", quote: "결제 승인 API의 병목 쿼리를 찾아 인덱스를 재설계했다" }])],
    });
    const { payload, events } = await run(ctx, [{ json: out }]);
    const completed = events.find((e) => e.type === "block_completed") as Extract<AiStreamEvent, { type: "block_completed" }>;
    expect((completed.block as { text: string }).text).toBe("처리량을 4321배로 늘렸습니다.");
    expect(payload.blocks[0]).toMatchObject({ text: "처리량을 [수치 확인 필요]로 늘렸습니다.", flags: ["number_check_needed"] });
  });

  it("reuse of another question's primary project without a reason is reported", async () => {
    const ctx = context(question(), "ai", [], [{ question_text: "지원 동기", primary_project_ids: [IDS.prjPay] }]);
    const out = output(ctx, { sources: [source(ctx, IDS.prjPay)], paragraphs: [paragraph("q-p1", "본문", [])] });
    const { payload, llm } = await run(ctx, [{ json: out }]);
    expect(payload.meta.validation_report).toMatchObject({ reuse_without_reason: 1 });
    expect(llm.requests[0].userBlocks.map((b) => b.text).join("\n")).toContain("<other_questions>");
  });
});

describe("AI-04 schema misses", () => {
  it("no paragraph → schema_invalid error, nothing persisted", async () => {
    const ctx = context();
    const { events, persisted } = await run(ctx, [{ json: output(ctx, { paragraphs: [] }) }]);
    expect(events.at(-1)).toMatchObject({ type: "error", code: "schema_invalid", retryable: true });
    expect(persisted).toEqual([]);
  });
});

describe("AI-04 helpers", () => {
  it.each([
    ["가 나\n다", "with_spaces", 5],
    ["가 나\n다", "without_spaces", 3],
    ["[수치 입력 필요]", "without_spaces", 8],
  ] as const)("countChars(%j, %s) = %i", (text, basis, n) => {
    expect(countChars(text, basis)).toBe(n);
  });

  it.each([
    [89, 100, true],
    [90, 100, false],
    [110, 100, false],
    [111, 100, true],
    [5000, null, false],
  ] as const)("isLengthOutOfRange(%i, %s) = %s", (count, limit, out) => {
    expect(isLengthOutOfRange(count, limit)).toBe(out);
  });

  it("input hash covers question, note, limit, mode and user sources", () => {
    const base = {
      provider: "anthropic" as const,
      model: "m",
      careerSnapshotHash: "c",
      requirementsHash: "r",
      question: question({ char_limit: 500 }),
      mode: "ai" as const,
      userSources: [],
    };
    const h = computeCoverLetterInputHash(base);
    expect(computeCoverLetterInputHash({ ...base, question: question({ char_limit: 600 }) })).not.toBe(h);
    expect(computeCoverLetterInputHash({ ...base, question: question({ char_limit: 500, user_note: "메모" }) })).not.toBe(h);
    expect(computeCoverLetterInputHash({ ...base, mode: "user" })).not.toBe(h);
  });

  it("schemas are canonical (C-10.2)", () => {
    expect(() => toCanonicalJsonSchema(Ai04OutputSchema)).not.toThrow();
    expect(() => toCanonicalJsonSchema(Ai04AdjustOutputSchema)).not.toThrow();
  });
});
