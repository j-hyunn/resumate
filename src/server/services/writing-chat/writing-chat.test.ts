import { describe, expect, it } from "vitest";
import {
  ApplyDraftEditInput,
  parseStructuredDraft,
  StartWritingChatInput,
  WRITING_CHAT_TURN_TERMINAL_EVENTS,
  WritingChatTurnEventSchema,
  WritingChatTurnInput,
} from "@/lib/contracts/writing-chat";
import { mapDbError } from "@/server/db/errors";
import { createSseResponse, type SseEvent } from "@/server/sse";
import { toPatchTarget } from "./chat";
import { diffDrafts, draftProgress } from "./draft";
import { daysUntilAutoDelete, toMessageDtos } from "./mappers";

const U1 = "00000000-0000-4000-8000-000000000101";
const field = (value: string | number | null, review: "ok" | "needs_review" | "accepted" = "ok") => ({
  value,
  origin: "ai" as const,
  source_message_ids: [U1],
  source_quotes: ["q"],
  review,
  reviewed_at: null,
});

describe("structured_draft helpers", () => {
  it("parses the empty column default and the RPC skeleton", () => {
    expect(parseStructuredDraft({})).toMatchObject({ project: {}, details: [], skills: [], clarifications: [], sensitive_flags_count: 0, affiliation_suggestion: null });
  });

  it("diff: changed paths, needs_review paths, sensitive delta (achievements by key)", () => {
    const before = parseStructuredDraft({ project: { name: field("a") } });
    const after = parseStructuredDraft({
      project: { name: field("a"), role: field("r", "needs_review") },
      details: [{ detail_key: "D1", existing_detail_id: null, fields: { action: field("x") }, achievements: [{ achievement_key: "A1", value_after: field(3) }] }],
      sensitive_flags_count: 2,
    });
    const d = diffDrafts(before, after);
    expect(d.changed).toEqual([
      { section: "project", field: "role" },
      { section: "detail", detail: { detailKey: "D1" }, field: "action" },
      { section: "achievement", achievementKey: "A1", field: "value_after" },
    ]);
    expect(d.needsReview).toEqual([{ section: "project", field: "role" }]);
    expect(d.sensitiveAdded).toBe(2);
    expect(diffDrafts(after, after).any).toBe(false);
  });

  it("progress: basic info needs name + role (augment counts as filled); needs_review counted", () => {
    const draft = parseStructuredDraft({
      project: { name: field("a"), role: field("b", "needs_review") },
      details: [{ detail_key: "D1", fields: { situation: field("s") } }],
    });
    const p = draftProgress(draft);
    expect(p.slots.filter((s) => s.filled).map((s) => s.slot)).toEqual(["basic_info", "situation"]);
    expect(p.current).toBe("task");
    expect(p.needsReviewCount).toBe(1);
    expect(draftProgress(parseStructuredDraft({}), { augment: true }).current).toBe("situation");
  });

  it("maps contract paths to the db patch target", () => {
    expect(toPatchTarget({ section: "project", field: "team_size" })).toEqual({ section: "project", field: "team_size" });
    expect(toPatchTarget({ section: "detail", detail: { existingDetailId: U1 }, field: "result" })).toEqual({ section: "detail", existing_detail_id: U1, field: "result" });
    expect(toPatchTarget({ section: "achievement", achievementKey: "A2", field: "unit" })).toEqual({ section: "achievement", achievement_key: "A2", field: "unit" });
  });
});

describe("mappers", () => {
  it("numbers user messages among themselves (내 답변 #n)", () => {
    const base = { content: "", status: "done" as const, aiJobId: null, provider: null, model: null, modelTier: null, connectionTier: null, createdAt: "" };
    const dtos = toMessageDtos([
      { ...base, id: U1, sequence: 1, role: "assistant" },
      { ...base, id: U1, sequence: 2, role: "user" },
      { ...base, id: U1, sequence: 3, role: "assistant" },
      { ...base, id: U1, sequence: 4, role: "user" },
    ]);
    expect(dtos.map((d) => d.userNumber)).toEqual([null, 1, null, 2]);
  });

  it("90-day auto delete only for unbound active/abandoned chats (DM §3.4 [가정])", () => {
    const now = new Date("2026-10-30T00:00:00Z");
    expect(daysUntilAutoDelete({ projectId: null, status: "active", lastActivityAt: "2026-10-30T00:00:00Z" }, now)).toBe(90);
    expect(daysUntilAutoDelete({ projectId: null, status: "abandoned", lastActivityAt: "2026-08-01T00:00:00Z" }, now)).toBe(0);
    expect(daysUntilAutoDelete({ projectId: U1, status: "active", lastActivityAt: "2026-10-30T00:00:00Z" }, now)).toBeNull();
    expect(daysUntilAutoDelete({ projectId: null, status: "saved", lastActivityAt: "2026-10-30T00:00:00Z" }, now)).toBeNull();
  });
});

describe("contracts", () => {
  it("turn input: trimmed content 1..4000, requested slot ids", () => {
    expect(WritingChatTurnInput.safeParse({ content: "  " }).success).toBe(false);
    expect(WritingChatTurnInput.safeParse({ content: "x".repeat(4001) }).success).toBe(false);
    expect(WritingChatTurnInput.parse({ content: " a ", requestedSlot: { slot: "action" } })).toEqual({
      content: "a",
      requestedSlot: { slot: "action", detailKey: null, existingDetailId: null },
    });
    expect(WritingChatTurnInput.safeParse({ content: "a", requestedSlot: { slot: "basic" } }).success).toBe(false);
  });

  it("start input: augment needs a project id; edit value '' clears", () => {
    expect(StartWritingChatInput.safeParse({ mode: "augment_project" }).success).toBe(false);
    expect(StartWritingChatInput.safeParse({ mode: "new_project", returnTarget: { applicationProjectId: U1, feature: "insight" } }).success).toBe(true);
    expect(ApplyDraftEditInput.parse({ writingChatId: U1, path: { section: "project", field: "name" }, value: "" }).value).toBeNull();
    expect(ApplyDraftEditInput.safeParse({ writingChatId: U1, path: { section: "detail", detail: { detailKey: "X1" }, field: "title" }, value: "t" }).success).toBe(false);
  });

  it("SSE: a gate-blocked turn is one normalized error event (F-AI-08 lock)", async () => {
    const res = createSseResponse(async ({ emit }) => emit({ type: "error", code: "key_missing" } as SseEvent), { terminalEvents: WRITING_CHAT_TURN_TERMINAL_EVENTS });
    const text = await res.text();
    const data = JSON.parse(text.split("data: ")[1]!.split("\n")[0]!);
    const event = WritingChatTurnEventSchema.parse({ type: "error", ...data });
    expect(event).toMatchObject({ code: "key_missing", category: "user_account", failureCause: null, retryable: true });
  });

  it("maps S4 RPC raise names", () => {
    expect(mapDbError({ code: "P0001", message: "message_limit_reached" })).toMatchObject({ code: "message_limit_reached", status: 409 });
    expect(mapDbError({ code: "P0001", message: "writing_chat_not_found" })).toMatchObject({ code: "not_found", status: 404 });
    expect(mapDbError({ code: "P0001", message: "no_pending_user_message" })).toMatchObject({ code: "nothing_to_retry", status: 409 });
    expect(mapDbError({ code: "P0001", message: "field_already_filled" })).toMatchObject({ code: "field_already_filled", status: 409 });
    expect(mapDbError({ code: "P0001", message: "invalid_ai_job" })).toMatchObject({ code: "internal_error", status: 500 });
    expect(mapDbError({ code: "P0001", message: "invalid_writing_chat_transition" })).toMatchObject({ code: "writing_chat_not_active" });
  });
});
