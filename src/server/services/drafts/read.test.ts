import { describe, expect, it } from "vitest";
import type { UserSupabaseClient } from "@/server/db/types";
import { fakeSupabase } from "@/test/fake-supabase";
import { countShownChars, parseBlocks, toBlockViews } from "./blocks";
import { markDraftCopied, saveSectionEdit } from "./edit";
import { coverLetterStatus, effectiveSectionStatus, getDraft, listDrafts } from "./read";

const AP = "00000000-0000-4000-8000-0000000000a1";
const D1 = "00000000-0000-4000-8000-0000000000d1";
const D2 = "00000000-0000-4000-8000-0000000000d2";
const S1 = "00000000-0000-4000-8000-0000000000c1";
const S2 = "00000000-0000-4000-8000-0000000000c2";
const EXP = "00000000-0000-4000-8000-0000000000e1";
const PRJ = "00000000-0000-4000-8000-0000000000b1";
const DET = "00000000-0000-4000-8000-0000000000b9";

const aiBlocks = [
  { block_id: "q-p1", block_kind: "paragraph", text: "첫 문단", project_id: PRJ, requirement_ids: ["r1"], placeholders: [{ token: "[수치 입력 필요]", hint: "응답 시간" }], flags: ["number_check_needed"], generated_by: "ai", user_modified: false },
  { block_id: "q-p2", block_kind: "paragraph", text: "둘째 문단", project_id: null, requirement_ids: [], placeholders: [], flags: [], generated_by: "ai", user_modified: false },
];

const draftRow = (over: Record<string, unknown> = {}) => ({
  id: D1,
  application_project_id: AP,
  draft_type: "cover_letter",
  title: "자기소개서 (2026-10-29)",
  status: "generating",
  options: null,
  insight_id: null,
  regenerated_from_id: null,
  created_at: "2026-10-29T00:00:00Z",
  updated_at: "2026-10-29T00:00:00Z",
  edited_at: null,
  first_copied_at: null,
  provider: "gemini",
  model: "gemini-x",
  model_tier: "default",
  connection_tier: "free",
  ai_job_id: null,
  ...over,
});

const sectionRow = (over: Record<string, unknown> = {}) => ({
  id: S1,
  draft_id: D1,
  sort_order: 0,
  section_kind: "cover_letter_question",
  status: "ready",
  experience_id: null,
  education_id: null,
  heading: null,
  question_text: "지원 동기",
  template_key: "motivation",
  char_limit: 1000,
  count_basis: "with_spaces",
  user_note: null,
  source_selection_mode: "ai",
  sources_modified_at: null,
  generation_no: 1,
  question_class: "motivation",
  ai_content: aiBlocks,
  edited_content: null,
  ai_char_count: 9,
  correction_applied: false,
  validation_report: { char_adjust_needed: true, notes_for_user: ["메모가 없어 자리 표시를 넣었어요."] },
  provider: "gemini",
  model: "gemini-x",
  model_tier: "default",
  connection_tier: "free",
  ai_job_id: "job-s1",
  updated_at: "2026-10-29T00:00:00Z",
  ...over,
});

describe("status rules (db notes §4 / 재계산)", () => {
  it("a generating row whose job ended reads failed", () => {
    expect(effectiveSectionStatus("generating", "j1", new Set(["j1"]))).toBe("generating");
    expect(effectiveSectionStatus("generating", "j1", new Set())).toBe("failed");
    expect(effectiveSectionStatus("ready", null, new Set())).toBe("ready");
  });
  it("cover letter draft status from its questions", () => {
    expect(coverLetterStatus(["ready", "generating"])).toBe("generating");
    expect(coverLetterStatus(["ready", "ready"])).toBe("ready");
    expect(coverLetterStatus(["ready", "failed"])).toBe("partially_failed");
    expect(coverLetterStatus(["failed", "pending"])).toBe("failed");
    expect(coverLetterStatus(["pending", "ready"])).toBe("composing");
  });
});

describe("blocks", () => {
  it("edited text first, AI original kept, user_modified by comparison, chips by block id", () => {
    const ai = parseBlocks(aiBlocks);
    const edited = parseBlocks([{ ...aiBlocks[1], text: "둘째 문단" }, { ...aiBlocks[0], text: "고친 첫 문단" }]);
    const views = toBlockViews(ai, edited, new Map([["q-p1", [{ itemKey: "q-p1" } as never]]]));
    expect(views.map((v) => [v.blockId, v.text, v.aiText, v.userModified])).toEqual([
      ["q-p2", "둘째 문단", "둘째 문단", false],
      ["q-p1", "고친 첫 문단", "첫 문단", true],
    ]);
    // QA-S7-05: the stored placeholder token is no longer in the edited text → not shown.
    expect(views[1]).toMatchObject({ projectId: PRJ, requirementIds: ["r1"], flags: ["number_check_needed"], placeholders: [] });
    const kept = toBlockViews(ai, parseBlocks([{ ...aiBlocks[0], text: "응답 [수치 입력 필요] 단축" }]), undefined);
    expect(kept[0]!.placeholders).toEqual([{ token: "[수치 입력 필요]", hint: "응답 시간" }]);
    // QA-S7-06: an empty saved edit stays empty (null = no edit).
    expect(toBlockViews(ai, [], undefined)).toEqual([]);
    expect(toBlockViews(ai, null, undefined)).toHaveLength(2);
    expect(views[1]!.evidence).toHaveLength(1);
    expect(parseBlocks([{ block_id: 1 }, null, { block_id: "x", text: "t", block_kind: "nope" }])).toEqual([]);
  });
  it("counts like AI-04 (paragraphs joined by a newline)", () => {
    expect(countShownChars(["ab c", "de"], "with_spaces")).toBe(7);
    expect(countShownChars(["ab c", "de"], "without_spaces")).toBe(5);
  });
});

describe("getDraft / listDrafts", () => {
  const tables = () => ({
    application_projects: [{ id: AP }],
    drafts: [draftRow(), draftRow({ id: D2, draft_type: "career_description", status: "ready", created_at: "2026-10-28T00:00:00Z", options: { selection_origin: "ai_ranking", included_project_ids: [PRJ], ranking: [{ project_id: PRJ, relevance: "high", include: true, requirement_ids: [], reason: "r" }] } })],
    draft_sections: [
      sectionRow(),
      sectionRow({ id: S2, sort_order: 1, status: "generating", ai_content: null, ai_job_id: "job-s2", question_text: "직무 역량", template_key: "job_competency" }),
    ],
    draft_section_sources: [
      { id: "src-1", draft_section_id: S1, experience_id: EXP, education_id: null, project_id: PRJ, project_detail_ids: [DET], role: "primary", origin: "ai", rationale: "이유", requirement_ids: [], reuse_reason: null, sort_order: 0, source_label: null, source_deleted_at: null },
    ],
    evidence_links: [
      { id: "ev-1", owner_type: "draft_section", owner_id: S1, item_key: "q-p1", sort_order: 0, source_type: "project", source_id: PRJ, source_field: "role", source_locator: null, source_label: "결제", quote: null, quote_adjusted: false, source_snapshot_at: "2026-10-29T00:00:00Z", source_deleted_at: null },
      { id: "ev-2", owner_type: "draft_section", owner_id: S1, item_key: "sources.0", sort_order: 0, source_type: "project", source_id: PRJ, source_field: "name", source_locator: null, source_label: "결제", quote: null, quote_adjusted: false, source_snapshot_at: "2026-10-29T00:00:00Z", source_deleted_at: null },
    ],
    experiences: [{ id: EXP, company_name: "가나다", updated_at: "2026-10-01T00:00:00Z" }],
    projects: [{ id: PRJ, name: "결제 플랫폼", updated_at: "2026-10-30T00:00:00Z" }],
    project_details: [{ id: DET, title: "정산 배치" }],
    ai_jobs: [{ id: "job-s2", job_type: "cover_letter", target_id: S2, status: "failed", provider: "gemini", connection_tier: "free", error_code: "rate_limited", retry_after: "2026-10-29T00:02:00Z", quota_resets_at: null, finished_at: "2026-10-29T00:01:00Z", application_project_id: AP }],
  });

  it("editor view: blocks + chips (state changed), C-11 sources with names, ended generating question → failed with its job's failure", async () => {
    const db = fakeSupabase(tables());
    const view = await getDraft(db.client as UserSupabaseClient, D1);
    expect(view.status).toBe("partially_failed");
    const [q1, q2] = view.sections;
    expect(q1!.blocks).toHaveLength(2);
    expect(q1!.blocks[0]!.evidence[0]).toMatchObject({ state: "changed", kindLabel: "프로젝트" });
    expect(q1!.sources[0]).toMatchObject({ affiliationName: "가나다", projectName: "결제 플랫폼", detailTitles: ["정산 배치"], role: "primary", origin: "ai", rationale: "이유" });
    expect(q1!.sources[0]!.evidence).toHaveLength(1);
    expect(q1).toMatchObject({ flags: ["char_adjust_needed"], notesForUser: ["메모가 없어 자리 표시를 넣었어요."], currentCharCount: 10, badge: { provider: "gemini", connectionTier: "free" } });
    expect(q2!.status).toBe("failed");
    expect(view.failures).toEqual([expect.objectContaining({ code: "rate_limited", sectionId: S2, jobId: "job-s2", retryAfter: "2026-10-29T00:02:00Z", failureCause: "rate_limited" })]);
    expect(view.activeJobs).toEqual([]);
  });

  it("list: newest first, counts, selection origin, generating flag from live jobs", async () => {
    const t = tables();
    t.ai_jobs[0]!.status = "running";
    const db = fakeSupabase(t);
    const list = await listDrafts(db.client as UserSupabaseClient, AP);
    expect(list.drafts.map((d) => d.id)).toEqual([D1, D2]);
    expect(list.drafts[0]).toMatchObject({ draftType: "cover_letter", sectionCount: 2, readySectionCount: 1, status: "generating", generating: true });
    expect(list.drafts[1]).toMatchObject({ draftType: "career_description", selectionOrigin: "ai_ranking", status: "ready", generating: false });
  });

  it("missing draft → 404", async () => {
    await expect(getDraft(fakeSupabase(tables()).client as UserSupabaseClient, "00000000-0000-4000-8000-00000000ffff")).rejects.toMatchObject({ code: "not_found" });
  });
});

describe("edit / copy", () => {
  const now = () => new Date("2026-10-29T03:00:00.000Z");
  it("saves edited blocks (ids kept, user_modified), stamps drafts.edited_at", async () => {
    const db = fakeSupabase({ draft_sections: [sectionRow()], drafts: [draftRow({ status: "ready" })], evidence_links: [] });
    const out = await saveSectionEdit(db.client as UserSupabaseClient, { sectionId: S1, blocks: [{ blockId: "q-p1", text: "고침" }, { blockId: "q-p2", text: "둘째 문단" }] }, now);
    expect(out.blocks.map((b) => b.userModified)).toEqual([true, false]);
    const stored = db.tables.draft_sections![0]!.edited_content as Array<{ block_id: string; user_modified: boolean; flags: string[] }>;
    expect(stored.map((b) => [b.block_id, b.user_modified])).toEqual([["q-p1", true], ["q-p2", false]]);
    expect(stored[0]!.flags).toEqual(["number_check_needed"]);
    expect(db.tables.drafts![0]!.edited_at).toBe("2026-10-29T03:00:00.000Z");
  });
  it("rejects unknown / duplicate block ids and edits while generating", async () => {
    const db = fakeSupabase({ draft_sections: [sectionRow()], drafts: [draftRow()] });
    await expect(saveSectionEdit(db.client as UserSupabaseClient, { sectionId: S1, blocks: [{ blockId: "zz", text: "x" }] })).rejects.toMatchObject({ code: "invalid_input" });
    await expect(saveSectionEdit(db.client as UserSupabaseClient, { sectionId: S1, blocks: [{ blockId: "q-p1", text: "x" }, { blockId: "q-p1", text: "y" }] })).rejects.toMatchObject({ code: "invalid_input" });
    // QA-S7-07: "생성 중" = a queued / running job on the question (row status alone doesn't decide).
    const gen = fakeSupabase({ draft_sections: [sectionRow({ status: "pending" })], ai_jobs: [{ id: "j", job_type: "cover_letter", target_id: S1, status: "queued" }] });
    await expect(saveSectionEdit(gen.client as UserSupabaseClient, { sectionId: S1, blocks: [] })).rejects.toMatchObject({ code: "section_generating", status: 409 });
  });
  it("a leftover generating row whose job ended doesn't block; an empty save keeps an empty edit; placeholders follow the text", async () => {
    const db = fakeSupabase({
      draft_sections: [sectionRow({ status: "generating" })],
      drafts: [draftRow()],
      evidence_links: [],
      ai_jobs: [{ id: "j", job_type: "cover_letter", target_id: S1, status: "failed" }],
    });
    const out = await saveSectionEdit(db.client as UserSupabaseClient, { sectionId: S1, blocks: [] });
    expect(out.blocks).toEqual([]);
    expect(db.tables.draft_sections![0]!.edited_content).toEqual([]);
    const again = await saveSectionEdit(db.client as UserSupabaseClient, { sectionId: S1, blocks: [{ blockId: "q-p1", text: "응답 200ms로 단축" }] });
    expect(again.blocks[0]!.placeholders).toEqual([]);
    expect((db.tables.draft_sections![0]!.edited_content as Array<{ placeholders: unknown[] }>)[0]!.placeholders).toEqual([]);
  });
  it("first copy only", async () => {
    const db = fakeSupabase({ drafts: [draftRow({ first_copied_at: "2026-10-01T00:00:00.000Z" })] });
    expect(await markDraftCopied(db.client as UserSupabaseClient, D1, now)).toEqual({ draftId: D1, firstCopiedAt: "2026-10-01T00:00:00.000Z" });
    const fresh = fakeSupabase({ drafts: [draftRow()] });
    expect((await markDraftCopied(fresh.client as UserSupabaseClient, D1, now)).firstCopiedAt).toBe("2026-10-29T03:00:00.000Z");
  });
});
