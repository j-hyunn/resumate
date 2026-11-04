import { describe, expect, it } from "vitest";
import type { MockDb } from "@/lib/mock/fixtures";
import type { EvidenceLink } from "@/types/db";
import { buildSourceTree } from "./drafts";
import { toEvidenceView } from "./evidence";

/**
 * UI32-2: an education's name in evidence chips (C-01 / C-02 path) and the draft source tree is the trimmed
 * program_name, else institution_name. Both functions serve the real rows and the `?state=` previews.
 */

const EDU = "00000000-0000-4000-8000-0000000000f1";
const BARE = "00000000-0000-4000-8000-0000000000f2";
const PRJ = "00000000-0000-4000-8000-0000000000b1";
const T = "2026-10-01T00:00:00Z";

const education = (id: string, program_name: string | null, institution_name: string | null) => ({
  id, status: "complete", program_name, institution_name, education_type: "course", start_month: "2017-03-01", end_month: "2017-06-01", enrollment_status: "completed", description: null, updated_at: T,
});

const db = {
  profiles: [],
  experiences: [],
  educations: [education(EDU, " 클라우드 백엔드 부트캠프 ", "코드스쿨"), education(BARE, "  ", " 코드스쿨 ")],
  projects: [{ id: PRJ, status: "complete", name: "팀 프로젝트", role: "백엔드", start_month: null, end_month: null, experience_id: null, education_id: EDU, updated_at: T, content_updated_at: T }],
  project_details: [],
  achievements: [],
  skills: [],
  jd_requirements: [],
  interview_answers: [],
  draft_sections: [],
} as unknown as MockDb;

const link = (over: Partial<EvidenceLink>): EvidenceLink =>
  ({ id: "ev", owner_type: "draft_section", owner_id: "s", item_key: "k", sort_order: 0, application_project_id: "ap", source_field: null, source_locator: null, source_label: null, quote: null, quote_adjusted: false, source_snapshot_at: T, source_deleted_at: null, ...over }) as EvidenceLink;

describe("education names (UI32-2)", () => {
  it("evidence chip: the label falls back to the display name; the path shows it for the education and a project under it", () => {
    const edu = toEvidenceView(db, link({ source_type: "education", source_id: EDU, source_field: "program_name" }));
    expect(edu).toMatchObject({ source_label: "클라우드 백엔드 부트캠프", path: ["2017", "클라우드 백엔드 부트캠프"] });
    expect(toEvidenceView(db, link({ source_type: "education", source_id: BARE })).path).toEqual(["2017", "코드스쿨"]);
    // a stored label wins (the DB backfill rewrites it)
    expect(toEvidenceView(db, link({ source_type: "education", source_id: EDU, source_label: "저장된 라벨" })).source_label).toBe("저장된 라벨");
    const project = toEvidenceView(db, link({ source_type: "project", source_id: PRJ, source_field: "action" }));
    expect(project.path).toEqual(["2017", "클라우드 백엔드 부트캠프", "팀 프로젝트"]);
  });

  it("draft source tree: affiliation name and project label use the display name; meta shows the institution beside a program name", () => {
    const tree = buildSourceTree(db);
    const byId = Object.fromEntries(tree.affiliations.map((a) => [a.id, a]));
    expect(byId[EDU]).toMatchObject({ kind: "education", name: "클라우드 백엔드 부트캠프", meta: "코드스쿨 · 2017.03 ~ 2017.06" });
    expect(byId[BARE]!.name).toBe("코드스쿨");
    expect(byId[BARE]!.meta).not.toContain("코드스쿨");
    expect(tree.project_labels[PRJ]).toBe("클라우드 백엔드 부트캠프 › 팀 프로젝트");
  });
});
