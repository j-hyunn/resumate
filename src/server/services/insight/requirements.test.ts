import { describe, expect, it } from "vitest";
import type { JobRecord } from "@/server/jobs/types";
import { insightJobPartial } from "./partial";
import { isV2Result, legacyRequirements, toV2Requirement, v2Requirements } from "./requirements";

/** R17: v2 insight results carry their own requirements (`M{n}`); v1 reads the preserved jd_requirements rows. */

const V2 = {
  schema_version: 2,
  requirement_matches: [
    { item_key: "requirement_matches.M1", requirement_id: "M1", requirement: { content: "Spring 경험", category: "required", importance: "high", sentence_ids: ["S2", "S3"] }, status: "met", rationale: "", missing_aspect: null },
    { item_key: "requirement_matches.M2", requirement_id: "M2", requirement: { content: "", category: "preferred" }, status: "partial", rationale: "", missing_aspect: null },
    { item_key: "requirement_matches.M3", requirement_id: "M3", requirement: { content: "결제 도메인", category: "bogus", importance: "x" }, status: "no_evidence", rationale: "", missing_aspect: null },
  ],
};

describe("insight requirements (R17 v2 / v1)", () => {
  it("detects v2 by schema_version only", () => {
    expect(isV2Result(V2)).toBe(true);
    expect(isV2Result({ schema_version: 1, requirement_matches: [] })).toBe(false);
    expect(isV2Result(null)).toBe(false);
  });

  it("v2: requirements come from the result, malformed ones dropped, unknown enums defaulted", () => {
    expect(v2Requirements(V2)).toEqual([
      { id: "M1", category: "required", content: "Spring 경험", importance: "high", sortOrder: 0, sentenceIds: ["S2", "S3"] },
      { id: "M3", category: "required", content: "결제 도메인", importance: "normal", sortOrder: 2, sentenceIds: [] },
    ]);
    expect(toV2Requirement("M9", null, 0)).toBeNull();
  });

  it("v1: legacy rows map one to one", () => {
    expect(legacyRequirements([{ id: "r1", category: "preferred", content: "AWS", importance: "normal", source_sids: ["S1"], sort_order: 4 }])).toEqual([
      { id: "r1", category: "preferred", content: "AWS", importance: "normal", sortOrder: 4, sentenceIds: ["S1"] },
    ]);
  });
});

describe("insightJobPartial (R17: one stage-1 call)", () => {
  const job = (stepOutputs: Record<string, unknown>): Pick<JobRecord, "jobType" | "stepOutputs" | "meta" | "progress"> => ({
    jobType: "insight",
    stepOutputs,
    meta: { runBase: 1, waitBase: 0, retries: {} },
    progress: { stage: "match", done: 0, total: 1 },
  });

  it("null before the match checkpoint, and for a pre-R17 `{ batches }` checkpoint", () => {
    expect(insightJobPartial(job({}))).toBeNull();
    expect(insightJobPartial(job({ match: { batches: [{ batchIndex: 0, matches: [] }] } }))).toBeNull();
  });

  it("reads the single MatchStageResult with the requirement text", () => {
    const partial = insightJobPartial(
      job({
        match: {
          v: 2,
          jdTextHash: "h",
          matches: [
            { requirement_id: "M1", requirement: { content: "Kotlin", category: "required", importance: "normal", sentence_ids: ["S4"] }, status: "partial", rationale: "일부", missing_aspect: "운영" },
            { requirement_id: "M2", status: "bogus" },
          ],
        },
      }),
    );
    expect(partial).toEqual({
      kind: "insight_matches",
      batchesDone: 1,
      batchesTotal: 1,
      requirementMatches: [
        {
          requirementId: "M1",
          requirement: { id: "M1", category: "required", content: "Kotlin", importance: "normal", sortOrder: 0, sentenceIds: ["S4"] },
          status: "partial",
          rationale: "일부",
          missingAspect: "운영",
        },
      ],
    });
  });
});
