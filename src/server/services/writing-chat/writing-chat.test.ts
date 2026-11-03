import { describe, expect, it } from "vitest";
import { STAR_FIELDS, WRITING_CHAT_SLOTS, CLASSIFICATION_FIELDS, COMPETENCIES, EXPERIENCE_TYPES, PROJECT_TYPES } from "@/lib/contracts/enums";
import {
  ApplyDraftEditInput,
  DeliverableDraftEditInput,
  DeliverableFormSnapshotSchema,
  DeliverableTurnEventSchema,
  ProjectFormSnapshotSchema,
  StartDeliverableWritingChatInput,
  parseStructuredDraft,
  StartWritingChatInput,
  WRITING_CHAT_TURN_TERMINAL_EVENTS,
  WritingChatTurnEventSchema,
  WritingChatTurnInput,
} from "@/lib/contracts/writing-chat";
import * as aiClassification from "@/server/ai/classification";
import { SLOT_IDS } from "@/server/ai/context-pack/focus-slots";
import { STAR_FIELDS as AI_STAR_FIELDS } from "@/server/ai/schemas/structured-draft";
import { mapDbError } from "@/server/db/errors";
import { createSseResponse, type SseEvent } from "@/server/sse";
import { toPatchTarget } from "./chat";
import { SaveProjectDeliverableInput, SaveProjectDeliverableRpcResult, SaveProjectPageInput, SaveProjectPageRpcResult } from "@/lib/contracts/career";
import { toPageValues } from "@/server/services/career/page-save";
import { applicableFields, chipsFor, diffDrafts, needsReviewCount } from "./draft";
import { toMessageDtos } from "./mappers";

const U1 = "00000000-0000-4000-8000-000000000101";
const star = (value: string, review: "ok" | "needs_review" | "accepted" = "ok", extra: Record<string, unknown> = {}) => ({
  value,
  op: "set",
  origin: "ai",
  source_message_ids: [U1],
  source_quotes: ["q"],
  review,
  reviewed_at: null,
  applied_at: null,
  ...extra,
});
const emptyProject = { star: { situation: null, task: null, action: null, result: null, learnings: null }, startMonth: null };

describe("structured_draft v3 helpers (DM 2.5 v4.4)", () => {
  it("parses the empty column default", () => {
    expect(parseStructuredDraft({})).toMatchObject({ schema_version: 3, project: {}, star: {}, classification: {}, clarifications: [], sensitive_flags_count: 0 });
  });

  it("diff: changed paths across project / star / classification", () => {
    const before = parseStructuredDraft({ star: { action: star("a") } });
    const after = parseStructuredDraft({
      project: { start_month: { value: "2023-03", source_message_ids: [U1], source_quotes: ["23년 3월"] } },
      star: { action: star("a"), result: star("r", "needs_review") },
      classification: { competencies: { value: ["analysis"], reason: "분석" } },
    });
    const d = diffDrafts(before, after);
    expect(d.changed).toEqual([
      { section: "project", field: "start_month" },
      { section: "star", field: "result" },
      { section: "classification", field: "competencies" },
    ]);
    expect(diffDrafts(after, after).any).toBe(false);
    expect(diffDrafts(before, parseStructuredDraft({ star: { action: star("a") }, sensitive_flags_count: 1 })).any).toBe(true);
  });

  it("[모두 반영] fields skip needs_review and applied ones; needs_review is counted", () => {
    const draft = parseStructuredDraft({
      star: {
        situation: star("s"),
        action: star("a", "needs_review"),
        result: star("r", "accepted"),
        learnings: star("l", "ok", { applied_at: "2026-11-01T00:00:00Z" }),
      },
      classification: { project_type: { value: "improvement" } },
    });
    expect(applicableFields(draft)).toEqual(["situation", "result", "project_type"]);
    expect(needsReviewCount(draft)).toBe(1);
  });

  it("quick chips come from AI-12 (3, camelCase), hidden from 36 messages on or when the chat can't take a turn", () => {
    const chips = chipsFor(emptyProject, parseStructuredDraft({}), 0, true);
    expect(chips).toHaveLength(3);
    expect(chips[0]).toEqual({ label: "비어 있는 항목부터 물어봐 줘", requestedSlot: "situation" });
    expect(chipsFor(emptyProject, parseStructuredDraft({}), 36, true)).toEqual([]);
    expect(chipsFor(emptyProject, parseStructuredDraft({}), 2, false)).toEqual([]);
  });

  it("maps contract paths to the v3 patch target", () => {
    expect(toPatchTarget({ section: "star", field: "result" })).toEqual({ section: "star", field: "result" });
    expect(toPatchTarget({ section: "classification", field: "competencies" })).toEqual({ section: "classification", field: "competencies" });
  });
});

describe("mappers", () => {
  it("numbers user messages among themselves (#n)", () => {
    const base = { content: "", status: "done" as const, aiJobId: null, provider: null, model: null, modelTier: null, connectionTier: null, createdAt: "" };
    const dtos = toMessageDtos([
      { ...base, id: U1, sequence: 1, role: "assistant" },
      { ...base, id: U1, sequence: 2, role: "user" },
      { ...base, id: U1, sequence: 3, role: "assistant" },
      { ...base, id: U1, sequence: 4, role: "user" },
    ]);
    expect(dtos.map((d) => d.userNumber)).toEqual([null, 1, null, 2]);
  });
});

describe("contracts", () => {
  it("enum lists match the AI pipeline (QA compares DB ↔ TS)", () => {
    expect([...PROJECT_TYPES]).toEqual([...aiClassification.PROJECT_TYPES]);
    expect([...EXPERIENCE_TYPES]).toEqual([...aiClassification.EXPERIENCE_TYPES]);
    expect([...COMPETENCIES]).toEqual([...aiClassification.COMPETENCIES]);
    expect([...CLASSIFICATION_FIELDS]).toEqual([...aiClassification.CLASSIFICATION_FIELDS]);
    expect([...WRITING_CHAT_SLOTS]).toEqual([...SLOT_IDS]);
    expect([...STAR_FIELDS]).toEqual([...AI_STAR_FIELDS]);
  });

  it("turn input: trimmed content 1..4000, requested slot = AI-12 v4.5 slot ids", () => {
    expect(WritingChatTurnInput.safeParse({ content: "  " }).success).toBe(false);
    expect(WritingChatTurnInput.safeParse({ content: "x".repeat(4001) }).success).toBe(false);
    expect(WritingChatTurnInput.parse({ content: " a ", requestedSlot: { slot: "action" } })).toEqual({ content: "a", requestedSlot: { slot: "action" }, requestedAction: null, style: null });
    expect(WritingChatTurnInput.safeParse({ content: "a", requestedSlot: { slot: "basic_info" } }).success).toBe(false);
  });

  it("start input: a project id is required (no mode); edit values are checked per section", () => {
    expect(StartWritingChatInput.safeParse({}).success).toBe(false);
    expect(StartWritingChatInput.safeParse({ projectId: U1, returnTarget: { applicationProjectId: U1, feature: "insight" } }).success).toBe(true);
    expect(ApplyDraftEditInput.parse({ writingChatId: U1, path: { section: "star", field: "action" }, value: "  " }).value).toBeNull();
    expect(ApplyDraftEditInput.safeParse({ writingChatId: U1, path: { section: "project", field: "start_month" }, value: "2023-3" }).success).toBe(false);
    expect(ApplyDraftEditInput.safeParse({ writingChatId: U1, path: { section: "classification", field: "project_type" }, value: "nope" }).success).toBe(false);
    expect(ApplyDraftEditInput.safeParse({ writingChatId: U1, path: { section: "classification", field: "competencies" }, value: ["analysis", "analysis"] }).success).toBe(false);
    expect(ApplyDraftEditInput.safeParse({ writingChatId: U1, path: { section: "classification", field: "competencies" }, value: ["analysis", "execution"] }).success).toBe(true);
    expect(ApplyDraftEditInput.safeParse({ writingChatId: U1, path: { section: "project", field: "is_current" }, value: "x" }).success).toBe(false);
  });

  it("page save inputs / RPC results (DM 2.5.1)", () => {
    // Create: projectId null; shape only (the RPC owns the rules and their codes).
    const create = SaveProjectPageInput.parse({ projectId: null, values: { name: "결제 개선", experienceId: U1, situation: null } });
    expect(toPageValues(create.values)).toEqual({ name: "결제 개선", experience_id: U1, situation: null });
    // Omitted keys stay omitted (= keep the stored value).
    expect(Object.keys(toPageValues(SaveProjectPageInput.parse({ projectId: U1, values: {} }).values))).toEqual([]);
    expect(SaveProjectPageInput.safeParse({ projectId: U1, values: { summary: "x" } }).success).toBe(false);
    expect(SaveProjectPageInput.safeParse({ projectId: U1, values: {}, appliedProposals: [{ writingChatId: U1, field: "is_current", rev: 1 }] }).success).toBe(false);
    expect(SaveProjectPageInput.safeParse({ projectId: U1, values: {}, appliedProposals: [{ writingChatId: U1, field: "action", rev: 2 }] }).success).toBe(true);
    expect(SaveProjectDeliverableInput.safeParse({ projectDeliverableId: null, projectId: U1, title: "회고", body: null, appliedProposals: [{ writingChatId: U1, rev: 1, mode: "append" }] }).success).toBe(true);
    expect(SaveProjectDeliverableInput.safeParse({ projectDeliverableId: U1, projectId: null, title: "회고", body: "", appliedProposals: [{ writingChatId: U1, rev: 1, mode: "merge" }] }).success).toBe(false);
    expect(
      SaveProjectPageRpcResult.parse({
        project_id: U1,
        status: "complete",
        updated_at: "2026-11-03T00:00:00Z",
        applied: [{ writing_chat_id: U1, field: "action" }],
        skipped: [{ writing_chat_id: null, field: null, reason: "invalid_entry" }, { writing_chat_id: U1, field: "task", reason: "proposal_changed" }],
      }).skipped,
    ).toHaveLength(2);
    expect(
      SaveProjectDeliverableRpcResult.parse({ project_deliverable_id: U1, project_id: U1, sort_order: 3, updated_at: "x", applied: [], skipped: [{ writing_chat_id: U1, reason: "needs_review" }] }).sort_order,
    ).toBe(3);
  });

  it("form snapshot contracts (DM 2.5.1: DB length limits, unknown keys dropped)", () => {
    expect(ProjectFormSnapshotSchema.parse({ name: "x", star: { action: "y" }, secret: "dropped" })).toEqual({ name: "x", star: { action: "y" } });
    expect(ProjectFormSnapshotSchema.safeParse({ name: "가".repeat(101) }).success).toBe(false);
    expect(ProjectFormSnapshotSchema.safeParse({ star: { result: "가".repeat(2001) } }).success).toBe(false);
    expect(ProjectFormSnapshotSchema.safeParse({ start_month: "2023-13" }).success).toBe(false);
    expect(ProjectFormSnapshotSchema.safeParse({ competencies: ["analysis", "analysis"] }).success).toBe(false);
    expect(DeliverableFormSnapshotSchema.safeParse({ title: "t", body: "가".repeat(20000) }).success).toBe(true);
    expect(DeliverableFormSnapshotSchema.safeParse({ body: "가".repeat(20001) }).success).toBe(false);
    // QA-R5-07: code points like the DB char_length — 100 emoji (200 UTF-16 units) still fit a 100-char title.
    expect(DeliverableFormSnapshotSchema.safeParse({ title: "😀".repeat(100) }).success).toBe(true);
    expect(DeliverableFormSnapshotSchema.safeParse({ title: "😀".repeat(101) }).success).toBe(false);
    expect(ProjectFormSnapshotSchema.safeParse({ star: { action: "😀".repeat(2000) } }).success).toBe(true);
    expect(StartDeliverableWritingChatInput.safeParse({ projectDeliverableId: U1, formSnapshot: { title: "회고" } }).success).toBe(true);
    // AI-13 turn options ride on the same body; the turn service checks them against the chat's target.
    expect(WritingChatTurnInput.parse({ content: "초안 만들어 줘", requestedAction: "compose_draft", requestedSlot: { slot: "contribution" } })).toMatchObject({
      requestedAction: "compose_draft",
      style: null,
    });
    expect(WritingChatTurnInput.safeParse({ content: "x", requestedAction: "delete_all" }).success).toBe(false);
    expect(DeliverableDraftEditInput.safeParse({ writingChatId: U1, op: "remove_block", blockId: "b2" }).success).toBe(true);
    expect(DeliverableDraftEditInput.safeParse({ writingChatId: U1, op: "reject_draft" }).success).toBe(false);
  });

  it("deliverable SSE events parse (AI-13 order names)", () => {
    expect(DeliverableTurnEventSchema.safeParse({ type: "draft_started", attempt: 1, reason: "initial" }).success).toBe(true);
    expect(DeliverableTurnEventSchema.safeParse({ type: "draft_block", attempt: 1, block: { block_id: "b1", type: "paragraph", text: "x" } }).success).toBe(true);
  });

  it("SSE: a gate-blocked turn is one normalized error event (F-AI-08 lock)", async () => {
    const res = createSseResponse(async ({ emit }) => emit({ type: "error", code: "key_missing" } as SseEvent), { terminalEvents: WRITING_CHAT_TURN_TERMINAL_EVENTS });
    const text = await res.text();
    const data = JSON.parse(text.split("data: ")[1]!.split("\n")[0]!);
    const event = WritingChatTurnEventSchema.parse({ type: "error", ...data });
    expect(event).toMatchObject({ code: "key_missing", category: "user_account", failureCause: null, retryable: true });
  });

  it("maps R4 RPC raise names", () => {
    expect(mapDbError({ code: "P0001", message: "message_limit_reached" })).toMatchObject({ code: "message_limit_reached", status: 409 });
    expect(mapDbError({ code: "P0001", message: "writing_chat_not_found" })).toMatchObject({ code: "not_found", status: 404 });
    expect(mapDbError({ code: "P0001", message: "writing_chat_closed" })).toMatchObject({ code: "writing_chat_closed", status: 409 });
    expect(mapDbError({ code: "P0001", message: "invalid_writing_chat_transition" })).toMatchObject({ code: "writing_chat_closed" });
    expect(mapDbError({ code: "P0001", message: "writing_chat_requires_affiliated_project" })).toMatchObject({ status: 409 });
    expect(mapDbError({ code: "P0001", message: "invalid_ai_job" })).toMatchObject({ code: "internal_error", status: 500 });
  });

  it("maps R5 page save / start / draft raise names (DM 2.5.1, details from the RPC detail)", () => {
    expect(mapDbError({ code: "P0001", message: "field_too_long", details: "action,learnings" })).toMatchObject({
      code: "field_too_long",
      status: 400,
      details: { field: "action", fields: ["action", "learnings"] },
    });
    expect(mapDbError({ code: "P0001", message: "stale_write", details: "2026-11-03T01:02:03.456789Z" })).toMatchObject({
      code: "stale_write",
      status: 409,
      details: { current_updated_at: "2026-11-03T01:02:03.456789Z" },
    });
    expect(mapDbError({ code: "P0001", message: "invalid_period", details: "end_month" })).toMatchObject({ code: "invalid_period", status: 400, details: { field: "end_month" } });
    expect(mapDbError({ code: "P0001", message: "invalid_classification", details: "competencies" })).toMatchObject({ code: "invalid_classification", details: { field: "competencies" } });
    expect(mapDbError({ code: "P0001", message: "invalid_fields", details: "summary" })).toMatchObject({ code: "invalid_fields", status: 400, details: { field: "summary" } });
    expect(mapDbError({ code: "P0001", message: "not_found", details: "experience_id" })).toMatchObject({ code: "not_found", status: 404, details: { field: "experience_id" } });
    expect(mapDbError({ code: "P0001", message: "not_found" })).toMatchObject({ code: "not_found", status: 404 });
    for (const code of ["project_name_required", "project_affiliation_required", "project_not_affiliated", "deliverable_title_required", "invalid_form_snapshot"]) {
      expect(mapDbError({ code: "P0001", message: code })).toMatchObject({ code, status: 400 });
    }
    expect(mapDbError({ code: "P0001", message: "project_deliverable_not_found" })).toMatchObject({ code: "not_found", status: 404 });
    expect(mapDbError({ code: "P0001", message: "writing_chat_draft_limit_reached" })).toMatchObject({ code: "writing_chat_draft_limit_reached", status: 409 });
    // Removed from the DB in R5 (V-9h / classification DB refusals dropped): unknown → internal.
    expect(mapDbError({ code: "P0001", message: "classification_already_set" })).toMatchObject({ code: "internal_error" });
    expect(mapDbError({ code: "P0001", message: "invalid_ai_job" })).toMatchObject({ code: "internal_error", status: 500 });
  });
});
