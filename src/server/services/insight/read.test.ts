import { describe, expect, it } from "vitest";
import type { EvidenceChip } from "@/lib/contracts/evidence";
import { resolveInsightRun, toInsightResultView, withRawTextStale, type JobRow } from "./read";

/** Stored AI-02 result (ai storage/insight.ts InsightResult) → S-16 view. */

const PRJ = "00000000-0000-4000-8000-0000000000a1";

function chip(itemKey: string): EvidenceChip {
  return {
    id: `c-${itemKey}`,
    itemKey,
    sortOrder: 0,
    sourceType: "project",
    sourceId: "p1",
    sourceField: "action",
    kindLabel: "프로젝트 · 행동",
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

/** schema 2 (DM v4.16 2.7.0): MT-n requirement items, `match_keys`. */
const RESULT = {
  schema_version: 2,
  basis_note: "입력된 경력 데이터 기준 분석입니다",
  data_sufficiency: { level: "thin", hints: ["few_projects"] },
  requirement_matches: [
    { item_key: "requirement_matches.MT-1", match_key: "MT-1", requirement_text: "Spring 서버 개발", sids: ["S2", "S3"], status: "met", rationale: "r1", missing_aspect: null },
    { item_key: "requirement_matches.MT-2", match_key: "MT-2", requirement_text: "Kafka 운영", sids: ["S5"], status: "no_evidence", rationale: "r2", missing_aspect: "Kafka" },
  ],
  summary_counts: { met: 1, partial: 0, no_evidence: 1 },
  strengths: [{ item_key: "strengths.0", title: "t", description: "d", match_keys: ["MT-1"] }],
  gaps: [
    {
      item_key: "gaps.0",
      match_keys: ["MT-2"],
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
    project_priorities: [{ item_key: "strategy.project_priorities.0", rank: 1, project_id: PRJ, reason: "이유", match_keys: ["MT-1"] }],
  },
};

const ROW = {
  id: "i1",
  version_no: 2,
  status: "ready",
  is_latest: true,
  result: RESULT,
  schema_version: 2,
  raw_text_hash: "r",
  career_snapshot_hash: "c",
  provider: "gemini",
  model: "gemini-x",
  model_tier: "default",
  connection_tier: "free",
  prompt_version: "ai-02.match.v6+ai-02.synthesize.v6+common.v5",
  created_at: "2026-11-01T00:00:00.000Z",
  completed_at: "2026-11-01T00:00:40.000Z",
};

describe("toInsightResultView", () => {
  it("maps schema-2 items (MT-n, requirement_text, sids), chips by item_key, match_keys, project names, F-P2-09 add_data links", () => {
    const keys = ["requirement_matches.MT-1", "strengths.0", "gaps.0.actions.1", "strategy.positioning", "strategy.project_priorities.0"];
    const view = toInsightResultView(ROW, {
      chips: new Map(keys.map((k) => [k, [chip(k)]])),
      projectNames: new Map([[PRJ, "결제 시스템"]]),
      stale: { career: true, rawText: false },
    });
    expect(view).toMatchObject({
      id: "i1",
      versionNo: 2,
      schemaVersion: 2,
      provider: "gemini",
      connectionTier: "free",
      stale: true,
      staleReasons: { career: true, rawText: false },
      dataSufficiency: { level: "thin", hints: ["few_projects"] },
      summaryCounts: { met: 1, partial: 0, no_evidence: 1 },
    });
    expect(view.requirementMatches[0]).toMatchObject({ itemKey: "requirement_matches.MT-1", matchKey: "MT-1", requirementText: "Spring 서버 개발", sentenceIds: ["S2", "S3"], status: "met" });
    expect(view.requirementMatches[0]!.evidence).toHaveLength(1);
    expect(view.requirementMatches[1]).toMatchObject({ matchKey: "MT-2", evidence: [] });
    expect(view.strengths[0]).toMatchObject({ matchKeys: ["MT-1"] });
    expect(view.gaps[0]).toMatchObject({ itemKey: "gaps.0", matchKeys: ["MT-2"] });
    expect(view.gaps[0]!.actions[0]).toMatchObject({ type: "add_data", relatedMatchKeys: ["MT-2"], evidence: [] });
    expect(view.gaps[0]!.actions[1]).toMatchObject({ type: "prepare_answer", relatedMatchKeys: [] });
    expect(view.gaps[0]!.actions[1]!.evidence).toHaveLength(1);
    expect(view.strategy.positioning).toMatchObject({ text: "포지셔닝" });
    expect(view.strategy.projectPriorities[0]).toMatchObject({ projectId: PRJ, projectName: "결제 시스템", rank: 1, matchKeys: ["MT-1"] });
  });

  it("QA-06: rawText stale → the insight's jd_sentence chips read changed with no old-split locator; career chips untouched", () => {
    const jd: EvidenceChip = { ...chip("gaps.0"), sourceType: "jd_sentence", sourceField: null, kindLabel: "공고 원문", target: { type: "jd_sentence", jobDescriptionId: "jd", sid: "S5", start: 10, end: 20 } };
    const chips = new Map([["gaps.0", [jd, chip("gaps.0")]]]);
    const stale = toInsightResultView(ROW, { chips, projectNames: new Map(), stale: { career: false, rawText: true } });
    expect(stale.gaps[0]!.evidence[0]).toMatchObject({ sourceType: "jd_sentence", state: "changed", target: { type: "jd_sentence", sid: null, start: null, end: null } });
    expect(stale.gaps[0]!.evidence[1]).toMatchObject({ sourceType: "project", state: "current" });
    const fresh = toInsightResultView(ROW, { chips, projectNames: new Map(), stale: { career: false, rawText: false } });
    expect(fresh.gaps[0]!.evidence[0]).toMatchObject({ state: "current", target: { sid: "S5", start: 10, end: 20 } });
    expect(withRawTextStale({ ...jd, state: "deleted" }).state).toBe("deleted");
  });

  it("rawText stale alone makes the view stale (공고가 바뀌었어요)", () => {
    const view = toInsightResultView(ROW, { chips: new Map(), projectNames: new Map(), stale: { career: false, rawText: true } });
    expect(view).toMatchObject({ stale: true, staleReasons: { career: false, rawText: true } });
  });

  it("schema 1 (JR-Q3 (b)): no body, schemaVersion 1 — the screen asks to regenerate", () => {
    const legacy = { ...ROW, schema_version: 1, result: { ...RESULT, requirement_matches: [{ item_key: "requirement_matches.x", requirement_id: "x", status: "met", rationale: "r" }] } };
    const view = toInsightResultView(legacy, { chips: new Map([["strengths.0", [chip("strengths.0")]]]), projectNames: new Map(), stale: { career: false, rawText: false } });
    expect(view).toMatchObject({ schemaVersion: 1, basisNote: "", requirementMatches: [], strengths: [], gaps: [], strategy: { positioning: null, projectPriorities: [] }, summaryCounts: { met: 0, partial: 0, no_evidence: 0 } });
  });

  it("tolerates malformed members (drops them); a v1-shaped match without match_key is dropped", () => {
    const view = toInsightResultView(
      { ...ROW, result: { requirement_matches: [{ status: "bogus" }, { requirement_id: "r", status: "met" }], gaps: [{ gap_kind: "x" }], strategy: null } },
      { chips: new Map(), projectNames: new Map(), stale: { career: false, rawText: false } },
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

describe("resolveInsightRun — failures of the old raw text (DM 2.6.1)", () => {
  const row = (over: Partial<JobRow>): JobRow => ({
    id: "j1",
    status: "failed",
    progress: {},
    provider: "gemini",
    connection_tier: "free",
    error_code: "input_too_long",
    retry_after: null,
    quota_resets_at: null,
    finished_at: "2026-11-01T00:00:00Z",
    created_at: "2026-11-01T00:00:00Z",
    ...over,
  });
  const EDITED = "2026-11-02T00:00:00Z";

  it("a job failed before the edit isn't surfaced; never edited → as before", () => {
    expect(resolveInsightRun([row({})], null, -Infinity, EDITED).lastFailure).toBeNull();
    expect(resolveInsightRun([row({})], null, -Infinity, null).lastFailure).toMatchObject({ code: "input_too_long", jobId: "j1" });
  });

  it("R17 QA-02: a legacy `not_a_jd` row is an input failure without retry (same rule as the runner / status)", () => {
    expect(resolveInsightRun([row({ error_code: "not_a_jd" })], null, -Infinity, null).lastFailure).toEqual({
      code: "not_a_jd",
      category: "input",
      failureCause: null,
      message: "채용 공고가 아닌 것 같습니다. 내용을 확인해 주세요.",
      retryable: false,
      retryAfter: null,
      quotaResetsAt: null,
      jobId: "j1",
      failedAt: "2026-11-01T00:00:00Z",
    });
  });

  it("a job failed after the edit is surfaced", () => {
    expect(resolveInsightRun([row({ finished_at: "2026-11-03T00:00:00Z" })], null, -Infinity, EDITED).lastFailure).toMatchObject({ code: "input_too_long" });
  });

  it("a generating row whose job failed before the edit isn't surfaced either; a gone job can't be compared", () => {
    const pending = { status: "generating", ai_job_id: "j1" };
    expect(resolveInsightRun([row({})], pending, -Infinity, EDITED).lastFailure).toBeNull();
    expect(resolveInsightRun([], pending, -Infinity, EDITED).lastFailure).toMatchObject({ code: "stalled" });
  });

  it("an active job still wins", () => {
    const out = resolveInsightRun([row({ id: "j2", status: "running", finished_at: null }), row({})], null, -Infinity, EDITED);
    expect(out.activeJob?.jobId).toBe("j2");
    expect(out.lastFailure).toBeNull();
  });
});
