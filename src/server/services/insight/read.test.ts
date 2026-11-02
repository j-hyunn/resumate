import { describe, expect, it } from "vitest";
import type { EvidenceChip } from "@/lib/contracts/evidence";
import { resolveInsightRun, toInsightResultView, type JobRow } from "./read";

/** Stored AI-02 result (ai storage/insight.ts InsightResult) → S-16 view. */

const REQ1 = "00000000-0000-4000-8000-000000000001";
const REQ2 = "00000000-0000-4000-8000-000000000002";
const PRJ = "00000000-0000-4000-8000-0000000000a1";

function chip(itemKey: string): EvidenceChip {
  return {
    id: `c-${itemKey}`,
    itemKey,
    sortOrder: 0,
    sourceType: "project_detail",
    sourceId: "d1",
    sourceField: "action",
    kindLabel: "상세 내용 · 행동",
    sourceLabel: null,
    quote: "q",
    quoteAdjusted: false,
    isReflection: false,
    state: "current",
    sourceSnapshotAt: null,
    sourceDeletedAt: null,
    target: null,
  };
}

const RESULT = {
  schema_version: 1,
  basis_note: "입력된 경력 데이터 기준 분석입니다",
  data_sufficiency: { level: "thin", hints: ["few_projects"] },
  requirement_matches: [
    { item_key: `requirement_matches.${REQ1}`, requirement_id: REQ1, status: "met", rationale: "r1", missing_aspect: null },
    { item_key: `requirement_matches.${REQ2}`, requirement_id: REQ2, status: "no_evidence", rationale: "r2", missing_aspect: "Kafka" },
  ],
  summary_counts: { met: 1, partial: 0, no_evidence: 1 },
  strengths: [{ item_key: "strengths.0", title: "t", description: "d", requirement_ids: [REQ1] }],
  gaps: [
    {
      item_key: "gaps.0",
      requirement_ids: [REQ2],
      gap_kind: "no_evidence",
      description: "g",
      actions: [
        { item_key: "gaps.0.actions.0", type: "add_data", text: "추가해 주세요" },
        { item_key: "gaps.0.actions.1", type: "prepare_answer", text: "대비" },
      ],
    },
  ],
  strategy: {
    positioning: "포지셔닝",
    positioning_item_key: "strategy.positioning",
    project_priorities: [{ item_key: "strategy.project_priorities.0", rank: 1, project_id: PRJ, reason: "이유", requirement_ids: [REQ1] }],
  },
};

const ROW = {
  id: "i1",
  version_no: 2,
  status: "ready",
  is_latest: true,
  result: RESULT,
  requirements_hash: "r",
  career_snapshot_hash: "c",
  provider: "gemini",
  model: "gemini-x",
  model_tier: "default",
  connection_tier: "free",
  prompt_version: "ai-02.v1",
  created_at: "2026-11-01T00:00:00.000Z",
  completed_at: "2026-11-01T00:00:40.000Z",
};

describe("toInsightResultView", () => {
  it("maps items, chips by item_key, requirement contents, project names, F-P2-09 add_data links", () => {
    const keys = [`requirement_matches.${REQ1}`, "strengths.0", "gaps.0.actions.1", "strategy.positioning", "strategy.project_priorities.0"];
    const view = toInsightResultView(ROW, {
      chips: new Map(keys.map((k) => [k, [chip(k)]])),
      requirements: new Map([[REQ1, { id: REQ1, category: "required", content: "Spring", importance: "high", sortOrder: 0 }]]),
      projectNames: new Map([[PRJ, "결제 시스템"]]),
      stale: { career: true, requirements: false },
    });
    expect(view).toMatchObject({
      id: "i1",
      versionNo: 2,
      provider: "gemini",
      connectionTier: "free",
      stale: true,
      staleReasons: { career: true, requirements: false },
      dataSufficiency: { level: "thin", hints: ["few_projects"] },
      summaryCounts: { met: 1, partial: 0, no_evidence: 1 },
    });
    expect(view.requirementMatches[0]).toMatchObject({ requirementId: REQ1, requirement: { content: "Spring" }, status: "met" });
    expect(view.requirementMatches[0]!.evidence).toHaveLength(1);
    expect(view.requirementMatches[1]).toMatchObject({ requirement: null, evidence: [] });
    expect(view.gaps[0]!.actions[0]).toMatchObject({ type: "add_data", relatedRequirementIds: [REQ2], evidence: [] });
    expect(view.gaps[0]!.actions[1]).toMatchObject({ type: "prepare_answer", relatedRequirementIds: [] });
    expect(view.gaps[0]!.actions[1]!.evidence).toHaveLength(1);
    expect(view.strategy.positioning).toMatchObject({ text: "포지셔닝" });
    expect(view.strategy.projectPriorities[0]).toMatchObject({ projectId: PRJ, projectName: "결제 시스템", rank: 1 });
  });

  it("tolerates malformed members (drops them)", () => {
    const view = toInsightResultView(
      { ...ROW, result: { requirement_matches: [{ status: "bogus" }], gaps: [{ gap_kind: "x" }], strategy: null } },
      { chips: new Map(), requirements: new Map(), projectNames: new Map(), stale: { career: false, requirements: false } },
    );
    expect(view.requirementMatches).toEqual([]);
    expect(view.gaps).toEqual([]);
    expect(view.strategy).toEqual({ positioning: null, projectPriorities: [] });
    expect(view.summaryCounts).toEqual({ met: 0, partial: 0, no_evidence: 0 });
  });
});

describe("resolveInsightRun (generating row outliving its job, QA-S5-06 skip locked)", () => {
  const job = (id: string, status: string, extra: Partial<JobRow> = {}): JobRow => ({
    id,
    status,
    progress: { stage: "match", done: 1, total: 2 },
    provider: "anthropic",
    connection_tier: "paid",
    error_code: status === "failed" ? "rate_limited" : null,
    retry_after: null,
    quota_resets_at: null,
    finished_at: status === "queued" || status === "running" ? null : "2026-11-01T00:01:00.000Z",
    created_at: "2026-11-01T00:00:00.000Z",
    ...extra,
  });

  it("generating row + running job → in progress, no failure", () => {
    const out = resolveInsightRun([job("j1", "running")], { status: "generating", ai_job_id: "j1" }, -Infinity);
    expect(out.activeJob).toMatchObject({ jobId: "j1", progress: { stage: "match", done: 1, total: 2 } });
    expect(out.lastFailure).toBeNull();
  });

  it("generating row + failed job → that failure", () => {
    const out = resolveInsightRun([job("j1", "failed")], { status: "generating", ai_job_id: "j1" }, Date.parse("2026-11-02T00:00:00Z"));
    expect(out).toMatchObject({ activeJob: null, lastFailure: { code: "rate_limited", jobId: "j1" } });
  });

  it("generating row + job gone or succeeded without complete → stalled", () => {
    expect(resolveInsightRun([], { status: "generating", ai_job_id: "j9" }, -Infinity).lastFailure).toMatchObject({ code: "stalled", jobId: "j9", failedAt: null });
    expect(resolveInsightRun([job("j1", "succeeded")], { status: "generating", ai_job_id: "j1" }, -Infinity).lastFailure).toMatchObject({ code: "stalled" });
  });

  it("generating row + canceled job → no failure (user cancel)", () => {
    expect(resolveInsightRun([job("j1", "canceled")], { status: "generating", ai_job_id: "j1" }, -Infinity)).toEqual({ activeJob: null, lastFailure: null });
  });

  it("no pending row: newest failed job after the shown result is the failure; older ones are not", () => {
    expect(resolveInsightRun([job("j2", "failed")], null, -Infinity).lastFailure).toMatchObject({ jobId: "j2" });
    expect(resolveInsightRun([job("j2", "failed")], null, Date.parse("2026-11-03T00:00:00Z")).lastFailure).toBeNull();
  });
});
