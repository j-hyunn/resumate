import { describe, expect, it } from "vitest";
import { coverLetterContext, questionRow } from "../__fixtures__/S7/cover-letter-chat";
import { a, IDS } from "../__fixtures__/S7/drafts";
import type { CoverLetterChatContext } from "../context-pack/cover-letter-chat";
import type { Ai04Source } from "../schemas/AI-04";
import { toStoredSourceRef, toStoredSources, validateSources } from "./cover-letter";

/**
 * (CF-S1, 확정 2026-11-09 사용자 — 문서 PR #68 미머지) 문항 근거가 제안에 실려
 * 저장된다: 별칭 → `source_id` 변환은 블록 근거와 **같은 경로**이고, 기존
 * V-4·V-7·V-8·개수 상한·`primary` 1개 정규화가 그대로 걸린다.
 */
describe("문항 근거 sources[] (CF-S1)", () => {
  const ctx = (over: Parameters<typeof coverLetterContext>[0] = {}) => coverLetterContext(over);

  function source(c: CoverLetterChatContext, projectId: string, over: Partial<Ai04Source> = {}): Ai04Source {
    const prj = a(c.aliases, "project", projectId);
    return {
      project_ref: prj,
      experience_ref: null,
      education_ref: null,
      role: "primary",
      rationale: "직무 역량 요건과 가장 가깝습니다",
      requirement_refs: ["REQ-1"],
      reuse_reason: null,
      evidence: [{ source_type: "project", ref: prj, field: "name", quote: null }],
      ...over,
    } as Ai04Source;
  }

  it("converts aliases through the same path as block evidence (user_note → question_id)", () => {
    const c = ctx({ questions: [questionRow(1, { user_note: "결제 지연을 줄인 경험을 쓰고 싶어요" })] });
    const prj = a(c.aliases, "project", IDS.prjPay);
    expect(toStoredSourceRef(prj, c.aliases)).toMatchObject({ source_type: "project", source_id: IDS.prjPay });
    // 메모 별칭의 id는 그 문항의 question_id다 (DM 2.8, AI-04 저장 매핑).
    expect(toStoredSourceRef("NOTE-1", c.aliases)).toMatchObject({ source_type: "user_note", source_id: c.questions[0].questionId });
    // 알 수 없는 별칭·저장 불가 출처는 null.
    expect(toStoredSourceRef("PRJ-999", c.aliases)).toBeNull();
    expect(toStoredSourceRef("M3", c.aliases)).toBeNull();
  });

  it("keeps the normalized role (one primary, primary first) in the stored order", () => {
    const c = ctx({ questions: [questionRow(1, { template_key: "job_competency" })] });
    const raw = [source(c, IDS.prjPay, { role: "supporting" }), source(c, IDS.prjSettle, { role: "primary" })];
    const validated = validateSources(raw, "job_competency", { aliases: c.aliases, env: c.env, otherPrimaryProjectIds: new Set(), noteAlias: null }, {});
    const stored = toStoredSources(validated, c.aliases);
    expect(stored.map((s) => s.role)).toEqual(["primary", "supporting"]);
    expect(stored.filter((s) => s.role === "primary")).toHaveLength(1);
    expect(stored.every((s) => s.source_type === "project")).toBe(true);
  });

  it("drops a selection whose evidence did not survive (V-4) and one outside the pack (V-1)", () => {
    const c = ctx({ questions: [questionRow(1, { template_key: "job_competency" })] });
    const noEvidence = source(c, IDS.prjPay, { evidence: [] });
    const unknown = { ...source(c, IDS.prjSettle), project_ref: "PRJ-999" } as Ai04Source;
    const report: Record<string, number> = {};
    const validated = validateSources([noEvidence, unknown], "job_competency", { aliases: c.aliases, env: c.env, otherPrimaryProjectIds: new Set(), noteAlias: null }, report);
    expect(toStoredSources(validated, c.aliases)).toEqual([]);
    expect(report.sources_dropped_no_evidence).toBe(1);
    expect(report.sources_dropped_unknown_ref).toBe(1);
  });

  it("refuses a learnings quote as the selection's evidence in a job_competency question (V-8)", () => {
    const c = ctx({ questions: [questionRow(1, { template_key: "job_competency" })] });
    const prj = a(c.aliases, "project", IDS.prjPay);
    const learningsOnly = source(c, IDS.prjPay, {
      evidence: [{ source_type: "project", ref: prj, field: "learnings", quote: "측정 없이 최적화하면 안 된다는 것을 배웠다" }],
    });
    const competency = validateSources([learningsOnly], "job_competency", { aliases: c.aliases, env: c.env, otherPrimaryProjectIds: new Set(), noteAlias: null }, {});
    expect(toStoredSources(competency, c.aliases)).toEqual([]);

    // 같은 선택이 future_plan 문항에서는 회고 근거로 남는다 (C-9).
    const plan = validateSources([learningsOnly], "future_plan", { aliases: c.aliases, env: c.env, otherPrimaryProjectIds: new Set(), noteAlias: null }, {});
    expect(toStoredSources(plan, c.aliases)).toHaveLength(1);
  });

  it("keeps a selection out of V-7 scope from reaching the stored sources", () => {
    const c = ctx({ questions: [questionRow(1, { template_key: "job_competency" })] });
    const prjPay = a(c.aliases, "project", IDS.prjPay);
    const prjSettle = a(c.aliases, "project", IDS.prjSettle);
    // 선택은 prjPay인데 근거는 다른 프로젝트를 인용한다 → V-7로 근거가 사라지고 선택이 버려진다.
    const crossCited = source(c, IDS.prjPay, { evidence: [{ source_type: "project", ref: prjSettle, field: "name", quote: null }] });
    const validated = validateSources([crossCited], "job_competency", { aliases: c.aliases, env: c.env, otherPrimaryProjectIds: new Set(), noteAlias: null }, {});
    expect(toStoredSources(validated, c.aliases)).toEqual([]);
    expect(prjPay).not.toBe(prjSettle);
  });

  it("caps the stored sources at five and de-duplicates the same item (CF-S1 `[가정]`)", () => {
    const c = ctx({ questions: [questionRow(1, { template_key: null })] });
    const dup = [source(c, IDS.prjPay), source(c, IDS.prjPay)];
    const validated = validateSources(dup, "experience_story", { aliases: c.aliases, env: c.env, otherPrimaryProjectIds: new Set(), noteAlias: null }, {});
    expect(toStoredSources(validated, c.aliases)).toHaveLength(1);
  });
});
