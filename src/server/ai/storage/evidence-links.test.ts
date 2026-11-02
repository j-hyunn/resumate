import { describe, expect, it } from "vitest";
import { careerRowsFixture, IDS } from "../__fixtures__/career-rows";
import { AliasMap } from "../context-pack/aliases";
import { buildCareerPack } from "../context-pack/career-pack";
import { buildJdContext, splitJdSentences } from "../context-pack/jd";
import { validateItem } from "../validation/evidence";
import { resolveRefs, stripEvidence, toEvidenceLinkRows } from "./evidence-links";

const pack = buildCareerPack(careerRowsFixture(), { asOf: { year: 2026, month: 10 } });
const raw = "결제 API 운영 경험이 필요합니다.";
const jd = buildJdContext({
  jobDescriptionId: "jd-uuid",
  sentences: splitJdSentences(raw),
  requirements: [{ id: "req-uuid", category: "required", content: "결제 API 운영", importance: "high", source_sids: ["S1"], sort_order: 1, updated_at: "2026-03-01T00:00:00.000Z" }],
  includeSentences: "all",
});
const aliases = AliasMap.merge(pack.aliases, jd.aliases);
const now = new Date("2026-10-26T00:00:00.000Z");
const owner = { ownerType: "insight" as const, ownerId: "insight-uuid", applicationProjectId: "ap-uuid" };

describe("toEvidenceLinkRows (C-3 저장)", () => {
  it("maps aliases to UUIDs, keeps item_key and order, fills snapshot/label/locator, omits user_id", () => {
    const { outcome } = validateItem(
      {
        key: "strengths.0",
        kind: "judgment",
        evidence: [
          { source_type: "project_detail", ref: "DET-2", field: "action", quote: "병목 쿼리를 찾아 인덱스를 재설계했다" },
          { source_type: "jd_sentence", ref: "S1" },
          { source_type: "jd_requirement", ref: "REQ-1" },
          { source_type: "profile", ref: "PROFILE", field: "desired_job_title" },
        ],
      },
      { aliases, learnings: "forbidden" },
    );
    const rows = toEvidenceLinkRows({ owner, items: [{ itemKey: outcome.key, evidence: outcome.evidence }], aliases, now });
    expect(rows).toEqual([
      {
        owner_type: "insight",
        owner_id: "insight-uuid",
        application_project_id: "ap-uuid",
        item_key: "strengths.0",
        sort_order: 0,
        source_type: "project_detail",
        source_id: IDS.detPay1,
        source_field: "action",
        quote: "병목 쿼리를 찾아 인덱스를 재설계했다",
        quote_adjusted: false,
        source_snapshot_at: "2026-02-01T00:00:00.000Z",
        source_label: "결제 승인 API 개선 › 승인 API 병목 제거",
        source_locator: null,
      },
      expect.objectContaining({
        sort_order: 1,
        source_type: "jd_sentence",
        source_id: "jd-uuid",
        source_field: null,
        source_snapshot_at: now.toISOString(),
        source_locator: { sid: "S1", start: 0, end: raw.length },
      }),
      expect.objectContaining({ sort_order: 2, source_type: "jd_requirement", source_id: "req-uuid", source_field: null, source_snapshot_at: "2026-03-01T00:00:00.000Z" }),
      // QA-S3-06: profile snapshot = profiles.updated_at (not career_data_updated_at).
      expect.objectContaining({
        sort_order: 3,
        source_type: "profile",
        source_id: IDS.profile,
        source_field: "desired_job_title",
        quote: null,
        source_snapshot_at: "2026-03-15T00:00:00.000Z",
      }),
    ]);
    for (const row of rows) expect(row).not.toHaveProperty("user_id");
  });

  it("refuses writing_chat_message (DM-15) and evidence that isn't in the map", () => {
    expect(() =>
      toEvidenceLinkRows({
        owner,
        items: [{ itemKey: "x", evidence: [{ source_type: "writing_chat_message", ref: "M-1", field: null, quote: "q", quote_adjusted: false }] }],
        aliases,
        now,
      }),
    ).toThrow(/DM-15/);
    expect(() =>
      toEvidenceLinkRows({
        owner,
        items: [{ itemKey: "x", evidence: [{ source_type: "skill", ref: "SKL-99", field: "name", quote: null, quote_adjusted: false }] }],
        aliases,
        now,
      }),
    ).toThrow();
  });
});

describe("stripEvidence / resolveRefs", () => {
  it("removes evidence arrays at any depth without mutating the input", () => {
    const value = {
      strengths: [{ title: "t", evidence: [{ ref: "DET-2" }], requirement_refs: ["REQ-1"] }],
      strategy: { positioning: "p", positioning_evidence: [{ ref: "ACH-2" }] },
    };
    expect(stripEvidence(value, ["evidence", "positioning_evidence"])).toEqual({
      strengths: [{ title: "t", requirement_refs: ["REQ-1"] }],
      strategy: { positioning: "p" },
    });
    expect(value.strengths[0].evidence).toHaveLength(1);
  });

  it("resolves aliases of the expected type to UUIDs and counts unknown ones", () => {
    expect(resolveRefs(aliases, ["REQ-1", "REQ-1", "REQ-9", "PRJ-2"], "jd_requirement")).toEqual({ ids: ["req-uuid"], unknown: 2 });
    expect(resolveRefs(aliases, ["PRJ-2"], "project")).toEqual({ ids: [IDS.prjPay], unknown: 0 });
  });
});
