import { describe, expect, it } from "vitest";
import { STAR_FIELDS, WRITING_CHAT_SLOTS, CLASSIFICATION_FIELDS, COMPETENCIES, EXPERIENCE_TYPES, PROJECT_TYPES } from "@/lib/contracts/enums";
import {
  ApplyDraftEditInput,
  ApplyProposalInput,
  ApplyProposalRpcResult,
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
    expect(WritingChatTurnInput.parse({ content: " a ", requestedSlot: { slot: "action" } })).toEqual({ content: "a", requestedSlot: { slot: "action" } });
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

  it("apply input / RPC result (DM 3.3)", () => {
    expect(ApplyProposalInput.safeParse({ writingChatId: U1 }).success).toBe(true);
    expect(ApplyProposalInput.safeParse({ writingChatId: U1, fields: ["is_current"] }).success).toBe(false);
    expect(ApplyProposalInput.safeParse({ writingChatId: U1, fields: ["action", "action"] }).success).toBe(false);
    expect(
      ApplyProposalRpcResult.parse({ applied: ["action"], skipped: [{ field: "result", reason: "needs_review" }], project_status: "complete" }),
    ).toMatchObject({ applied: ["action"] });
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
    expect(mapDbError({ code: "P0001", message: "field_too_long", details: "action,learnings" })).toMatchObject({
      code: "field_too_long",
      status: 409,
      details: { fields: ["action", "learnings"] },
    });
    expect(mapDbError({ code: "P0001", message: "invalid_fields" })).toMatchObject({ code: "invalid_input" });
    expect(mapDbError({ code: "P0001", message: "classification_already_set" })).toMatchObject({ code: "classification_already_set", status: 409 });
    expect(mapDbError({ code: "P0001", message: "invalid_ai_job" })).toMatchObject({ code: "internal_error", status: 500 });
  });
});
