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
    source_type: "project",
    source_id: "p1",
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
  it("labels (DM v4.4): STAR field on projects, learnings as 배운 점, deliverables", () => {
    expect(evidenceKindLabel("project", "action")).toBe("프로젝트 · 행동");
    expect(evidenceKindLabel("project", "task")).toBe("프로젝트 · 역할");
    expect(evidenceKindLabel("project", "learnings")).toBe("배운 점");
    expect(evidenceKindLabel("project", "name")).toBe("프로젝트");
    expect(evidenceKindLabel("project_deliverable", "body")).toBe("산출물");
    expect(evidenceKindLabel("jd_sentence", null)).toBe("공고 원문");
  });

  it("current / changed (content_updated_at) / deleted", () => {
    const sources: SourceLookup = new Map([["project:p1", { updatedAt: SNAP, standalone: false }]]);
    const current = toEvidenceChip(link(), sources)!;
    expect(current).toMatchObject({ state: "current", quote: "인덱스를 재설계했다", target: { type: "project", projectId: "p1", field: "action", standalone: false } });

    const changed = toEvidenceChip(link(), new Map([["project:p1", { updatedAt: "2026-10-02T00:00:00.000Z", standalone: false }]]))!;
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

  it("reflection flag (project.learnings, V-8) and deliverable navigation parent", () => {
    expect(toEvidenceChip(link({ source_field: "learnings" }), new Map([["project:p1", { updatedAt: SNAP }]]))!.isReflection).toBe(true);
    const dlv = toEvidenceChip(
      link({ source_type: "project_deliverable", source_id: "v1", source_field: "body", source_locator: { start: 0, end: 4 } }),
      new Map([["project_deliverable:v1", { updatedAt: SNAP, projectId: "p2" }]]),
    )!;
    expect(dlv).toMatchObject({ state: "current", kindLabel: "산출물", target: { type: "project_deliverable", deliverableId: "v1", projectId: "p2" } });
  });

  it("v4.3 source types are skipped", () => {
    expect(toEvidenceChip(link({ source_type: "project_detail" }), new Map())).toBeNull();
  });

  it("unknown source types are skipped", () => {
    expect(toEvidenceChip(link({ source_type: "writing_chat_message" }), new Map())).toBeNull();
  });
});
