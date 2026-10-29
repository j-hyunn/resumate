import { describe, expect, it } from "vitest";
import { evidenceKindLabel, toEvidenceChip, type EvidenceLinkRow, type SourceLookup } from "./index";

/** C-01 chip state / label / target rules (shared evidence read, S6). */

const SNAP = "2026-10-01T00:00:00.000Z";

function link(over: Partial<EvidenceLinkRow> = {}): EvidenceLinkRow {
  return {
    id: "l1",
    owner_type: "insight",
    owner_id: "o1",
    item_key: "strengths.0",
    sort_order: 0,
    source_type: "project_detail",
    source_id: "d1",
    source_field: "action",
    source_locator: null,
    source_label: "결제 API 개선",
    quote: "인덱스를 재설계했다",
    quote_adjusted: false,
    source_snapshot_at: SNAP,
    source_deleted_at: null,
    ...over,
  };
}

describe("evidence chips (C-01)", () => {
  it("labels: STAR field for project details, learnings as 회고 및 배운 점", () => {
    expect(evidenceKindLabel("project_detail", "action")).toBe("상세 내용 · 행동");
    expect(evidenceKindLabel("project_detail", "learnings")).toBe("회고 및 배운 점");
    expect(evidenceKindLabel("achievement", "metric")).toBe("정량 성과");
    expect(evidenceKindLabel("jd_sentence", null)).toBe("공고 원문");
  });

  it("current / changed / deleted", () => {
    const sources: SourceLookup = new Map([["project_detail:d1", { updatedAt: SNAP, projectId: "p1" }]]);
    const current = toEvidenceChip(link(), sources)!;
    expect(current).toMatchObject({ state: "current", quote: "인덱스를 재설계했다", target: { type: "project_detail", projectId: "p1", projectDetailId: "d1", field: "action" } });

    const changed = toEvidenceChip(link(), new Map([["project_detail:d1", { updatedAt: "2026-10-02T00:00:00.000Z", projectId: "p1" }]]))!;
    expect(changed.state).toBe("changed");

    const deleted = toEvidenceChip(link({ source_deleted_at: "2026-10-03T00:00:00.000Z", quote: null }), sources)!;
    expect(deleted).toMatchObject({ state: "deleted", quote: null, target: null });

    // Source row gone without a trigger mark → deleted (defensive).
    expect(toEvidenceChip(link(), new Map())!.state).toBe("deleted");
  });

  it("jd_sentence is always current and carries its locator", () => {
    const chip = toEvidenceChip(
      link({ source_type: "jd_sentence", source_id: "jd1", source_field: null, source_locator: { sid: "S3", start: 10, end: 20 } }),
      new Map(),
    )!;
    expect(chip).toMatchObject({ state: "current", kindLabel: "공고 원문", target: { type: "jd_sentence", jobDescriptionId: "jd1", sid: "S3", start: 10, end: 20 } });
  });

  it("reflection flag and achievement navigation parents", () => {
    expect(toEvidenceChip(link({ source_field: "learnings" }), new Map([["project_detail:d1", { updatedAt: SNAP, projectId: "p1" }]]))!.isReflection).toBe(true);
    const ach = toEvidenceChip(
      link({ source_type: "achievement", source_id: "a1", source_field: "metric" }),
      new Map([["achievement:a1", { updatedAt: SNAP, projectDetailId: "d1", projectId: "p1", experienceId: null }]]),
    )!;
    expect(ach.target).toEqual({ type: "achievement", achievementId: "a1", projectDetailId: "d1", projectId: "p1", experienceId: null });
  });

  it("unknown source types are skipped", () => {
    expect(toEvidenceChip(link({ source_type: "writing_chat_message" }), new Map())).toBeNull();
  });
});
