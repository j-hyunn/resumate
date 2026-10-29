import { describe, expect, it } from "vitest";
import { a, AS_OF, careerRowsFixture, IDS, JD_ID, jdParts, manyProjectRows } from "../__fixtures__/S7/drafts";
import { buildCareerPack } from "../context-pack/career-pack";
import { buildSummaryCareerPack, SUMMARY_ACTION_MAX } from "../context-pack/summary-pack";
import { AiError } from "../errors";
import { createFakeLlm } from "../fake-llm";
import { toCanonicalJsonSchema } from "../providers/schema";
import { Ai11OutputSchema } from "../schemas/AI-11";
import {
  AI11_PROMPT_VERSION,
  buildRankingContext,
  computeDraftSourceRankingInputHash,
  DraftSourceRankingOutputSchema,
  fallbackSelection,
  rankDraftSources,
  selectionFromInsightPriorities,
  selectionFromRankingOutput,
} from "./AI-11";

const ctx = (rows = careerRowsFixture()) => buildRankingContext({ careerRows: rows, asOf: AS_OF, jobDescriptionId: JD_ID, requirements: jdParts().requirements });

describe("summary career pack (AI-11 입력)", () => {
  it("uses the full pack's aliases and hash, and leaves out learnings", () => {
    const rows = careerRowsFixture();
    const full = buildCareerPack(rows, { asOf: AS_OF });
    const summary = buildSummaryCareerPack(rows, { asOf: AS_OF });
    expect(summary.full.careerSnapshotHash).toBe(full.careerSnapshotHash);
    expect(summary.text).toContain(`${a(full.aliases, "project", IDS.prjPay)} 결제 승인 API 개선`);
    expect(summary.text).not.toContain("측정 없이 최적화"); // learnings (C-9)
    expect(summary.text).not.toContain("작성 중 프로젝트"); // draft rows stay out (C-1)
    expect(summary.text).toContain("기타 프로젝트");
    expect(summary.text).toContain("성과 지표: 승인 API 응답 시간");
    expect(summary.text).toContain("스킬: Spring Boot, Kotlin");
  });

  it("clips a detail's action to 200 characters", () => {
    const rows = careerRowsFixture();
    rows.projectDetails[0].action = "가".repeat(400);
    const summary = buildSummaryCareerPack(rows, { asOf: AS_OF });
    expect(summary.text).toContain(`행동: ${"가".repeat(SUMMARY_ACTION_MAX)}…`);
    expect(summary.text).not.toContain("가".repeat(SUMMARY_ACTION_MAX + 1));
  });
});

describe("rankDraftSources (AI-11)", () => {
  it("validates refs, cleans reasons, keeps ≤ 8 included and derives parents", async () => {
    const rows = manyProjectRows(9);
    const c = ctx(rows);
    const projects = c.projectRefs;
    const pay = a(c.aliases, "project", IDS.prjPay);
    const rankings = [
      { project_ref: pay, relevance: "high", include: true, requirement_refs: ["REQ-1", "REQ-99"], reason: `${pay}의 응답 시간 50% 단축` },
      { project_ref: pay, relevance: "high", include: true, requirement_refs: [], reason: "중복" },
      { project_ref: "PRJ-999", relevance: "high", include: true, requirement_refs: [], reason: "없는 프로젝트" },
      ...projects.filter((p) => p !== pay).map((p) => ({ project_ref: p, relevance: "medium", include: true, requirement_refs: [], reason: "관련" })),
    ];
    const llm = createFakeLlm([{ json: { schema_version: 1, rankings } }]);
    const result = await rankDraftSources({ context: c }, { llm });

    expect(result.includedProjectIds).toHaveLength(8);
    expect(result.includedProjectIds[0]).toBe(IDS.prjPay);
    expect(result.projectOrder).toHaveLength(projects.length);
    expect(result.includedExperienceIds).toContain(IDS.expA);
    expect(result.report).toMatchObject({ rankings_dropped_duplicate: 1, rankings_dropped_unknown_ref: 1, requirement_refs_dropped: 1 });
    expect(result.report.included_truncated).toBeGreaterThan(0);
    const top = result.ranking[0];
    expect(top.requirement_ids).toEqual([jdParts().requirements[0].id]);
    // Alias → name (QA-S6-04), invented number → [수치 확인 필요] (V-5).
    expect(top.reason).toBe("'결제 승인 API 개선'의 응답 시간 [수치 확인 필요] 단축");
    expect(DraftSourceRankingOutputSchema.parse(result.output).rankings).toEqual(result.ranking);
    expect(result.output.prompt_version).toBe(AI11_PROMPT_VERSION);

    const call = llm.requests[0];
    expect(call.tier).toBe("light");
    expect(call.callKey).toBe("draft_source_ranking.rank");
    expect(call.userBlocks[0].text).toContain('<career_data format="summary">');
  });

  it("no valid ranking → one retry, then schema_invalid (route falls back)", async () => {
    const bad = { json: { schema_version: 1, rankings: [{ project_ref: "PRJ-999", relevance: "high", include: true, requirement_refs: [], reason: "x" }] } };
    const llm = createFakeLlm([bad, bad]);
    await expect(rankDraftSources({ context: ctx() }, { llm })).rejects.toSatisfy((e: unknown) => e instanceof AiError && e.code === "schema_invalid" && !e.retryable);
    expect(llm.records).toHaveLength(2);
  });

  it("reuse path drops projects that left the pack", async () => {
    const c = ctx();
    const llm = createFakeLlm([
      {
        json: {
          schema_version: 1,
          rankings: c.projectRefs.map((p) => ({ project_ref: p, relevance: "high", include: true, requirement_refs: [], reason: "관련" })),
        },
      },
    ]);
    const result = await rankDraftSources({ context: c }, { llm });
    const rows = careerRowsFixture();
    rows.projects = rows.projects.filter((p) => p.id !== IDS.prjSide);
    const again = selectionFromRankingOutput(result.output, rows, AS_OF);
    expect(again.includedProjectIds).not.toContain(IDS.prjSide);
    expect(again.ranking.some((r) => r.project_id === IDS.prjSide)).toBe(false);
  });
});

describe("selection helpers", () => {
  it("fallback = pack order (latest experience first), parents derived", () => {
    const s = fallbackSelection(careerRowsFixture(), AS_OF);
    expect(s.includedProjectIds).toEqual([IDS.prjSettle, IDS.prjPay, IDS.prjEdu, IDS.prjSide]);
    expect(s.includedExperienceIds).toEqual([IDS.expA]);
    expect(s.includedEducationIds).toEqual([IDS.edu]);
  });

  it("insight priorities by rank; unknown projects skipped", () => {
    const s = selectionFromInsightPriorities(
      [
        { project_id: IDS.prjEdu, rank: 2 },
        { project_id: IDS.prjPay, rank: 1 },
        { project_id: IDS.prjDraft, rank: 3 },
      ],
      careerRowsFixture(),
      AS_OF,
    );
    expect(s.includedProjectIds).toEqual([IDS.prjPay, IDS.prjEdu]);
    expect(s.projectOrder.slice(0, 2)).toEqual([IDS.prjPay, IDS.prjEdu]);
  });

  it("input hash depends on provider and hashes", () => {
    const base = { provider: "anthropic" as const, model: "m", careerSnapshotHash: "c", requirementsHash: "r" };
    expect(computeDraftSourceRankingInputHash(base)).toBe(computeDraftSourceRankingInputHash({ ...base }));
    expect(computeDraftSourceRankingInputHash(base)).not.toBe(computeDraftSourceRankingInputHash({ ...base, provider: "openai" }));
    expect(computeDraftSourceRankingInputHash(base)).not.toBe(computeDraftSourceRankingInputHash({ ...base, requirementsHash: "r2" }));
  });

  it("output schema is canonical (C-10.2)", () => {
    expect(() => toCanonicalJsonSchema(Ai11OutputSchema)).not.toThrow();
  });
});
