import { describe, expect, it } from "vitest";
import { careerRowsFixture, IDS } from "../__fixtures__/career-rows";
import { AliasMap } from "../context-pack/aliases";
import { buildCareerPack } from "../context-pack/career-pack";
import { buildJdContext, splitJdSentences } from "../context-pack/jd";
import { validateItem } from "../validation/evidence";
import { resolveRefs, stripEvidence, toEvidenceLinkRows } from "./evidence-links";

const pack = buildCareerPack(careerRowsFixture(), { asOf: { year: 2026, month: 10 } });
const raw = "결제 API 운영 경험이 필요합니다.";
const jd = buildJdContext({ jobDescriptionId: "jd-uuid", sentences: splitJdSentences(raw), rawTextHash: "h" });
// (R17) No builder emits REQ-n any more; `jd_requirement` stays a storable legacy source type, so the generic mapper is still tested with a hand-made entry.
const legacy = new AliasMap();
legacy.add({ alias: "REQ-1", sourceType: "jd_requirement", id: "req-uuid", fields: { "": "결제 API 운영" }, snapshotAt: "2026-03-01T00:00:00.000Z", label: "결제 API 운영", parents: [] });
const aliases = AliasMap.merge(pack.aliases, jd.aliases, legacy);
const now = new Date("2026-10-26T00:00:00.000Z");
const owner = { ownerType: "insight" as const, ownerId: "insight-uuid", applicationProjectId: "ap-uuid" };

describe("toEvidenceLinkRows (C-3 저장)", () => {
  it("maps aliases to UUIDs, keeps item_key and order, fills snapshot/label/locator, omits user_id", () => {
    const { outcome } = validateItem(
      {
        key: "strengths.0",
        kind: "judgment",
        evidence: [
          { source_type: "project", ref: "PRJ-2", field: "action", quote: "병목 쿼리를 찾아 인덱스를 재설계했다" },
          { source_type: "jd_sentence", ref: "S1" },
          { source_type: "jd_requirement", ref: "REQ-1" },
          // (v4.12, SD-6) `profile` is no longer a source type: V-2 drops it before storage.
          { source_type: "profile" as never, ref: "PROFILE", field: "desired_job_title" },
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
        source_type: "project",
        source_id: IDS.prjPay,
        source_field: "action",
        quote: "병목 쿼리를 찾아 인덱스를 재설계했다",
        quote_adjusted: false,
        // DM 2.8 v4.4: project evidence snapshots projects.content_updated_at (not updated_at).
        source_snapshot_at: "2026-02-01T00:00:00.000Z",
        source_label: "결제 승인 API 개선",
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
    ]);
    // No `profile` row is ever written any more (DM 2.8 insert trigger rejects it).
    expect(rows.some((r) => r.source_type === "profile")).toBe(false);
    for (const row of rows) expect(row).not.toHaveProperty("user_id");
  });

  it("deliverable body: quote checked on the normalized pack text, locator = raw markdown span (C-1.1)", () => {
    const rawBody = careerRowsFixture().deliverables.find((d) => d.id === IDS.dlvSide1)!.body;
    const { outcome } = validateItem(
      {
        key: "strengths.1",
        kind: "judgment",
        evidence: [
          { source_type: "project_deliverable", ref: "DLV-1", field: "body", quote: "은행 문자 10종의 형식을 정규식으로 분류했다" },
          { source_type: "project_deliverable", ref: "DLV-1", field: "title" },
        ],
      },
      { aliases, learnings: "forbidden" },
    );
    expect(outcome.evidence).toHaveLength(2);
    const rows = toEvidenceLinkRows({ owner, items: [{ itemKey: outcome.key, evidence: outcome.evidence }], aliases, now });
    const start = rawBody.indexOf("은행");
    const end = rawBody.indexOf("분류했다") + "분류했다".length;
    expect(rows[0]).toMatchObject({
      source_type: "project_deliverable",
      source_id: IDS.dlvSide1,
      source_field: "body",
      quote: "은행 문자 10종의 형식을 정규식으로 분류했다",
      source_snapshot_at: "2026-02-01T00:00:00.000Z",
      source_label: "문자 파싱 설계",
      source_locator: { start, end },
    });
    // The raw span still carries the markdown the user wrote.
    expect(rawBody.slice(start, end)).toBe("은행 문자 *10종*의 형식을 [정규식](https://example.com/re)으로 분류했다");
    expect(rows[1]).toMatchObject({ source_field: "title", quote: null, source_locator: null });
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
      strengths: [{ title: "t", evidence: [{ ref: "PRJ-2" }], requirement_refs: ["REQ-1"] }],
      strategy: { positioning: "p", positioning_evidence: [{ ref: "DLV-1" }] },
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
