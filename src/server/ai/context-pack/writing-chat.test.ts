import { describe, expect, it } from "vitest";
import { augmentTarget, baseInput, DETAIL_DONE_ID, DETAIL_DRAFT_ID, GREETING, msgId, rows } from "../__fixtures__/AI-12/conversations";
import { buildWritingChatContext, renderDraftForExtract, toMonth } from "./writing-chat";

describe("buildWritingChatContext", () => {
  it("aliases messages by sequence and keeps only status = done", () => {
    const ctx = buildWritingChatContext(
      baseInput({
        messages: rows([["assistant", GREETING], ["user", "a"], ["assistant", "실패"], ["user", "b"]], [3]),
        lastExtractedSequence: 0,
      }),
    );
    expect([...ctx.v9.messages.keys()]).toEqual(["M1", "M2", "M4"]);
    expect(ctx.pendingUserSequences).toEqual([2, 4]);
    expect(ctx.processThroughSequence).toBe(4);
    expect(ctx.messageAliasById.get(msgId(4))).toBe("M4");
  });

  it("augment: PRJ-1 / DET-n aliases with filled columns (V-9h input) and reflection tags", () => {
    const target = augmentTarget();
    target.details[1].learnings = "다음엔 먼저 측정";
    const ctx = buildWritingChatContext(baseInput({ mode: "augment_project", augmentTarget: target }));
    expect(ctx.v9.existingProject?.filled).toEqual(new Set(["name", "role", "start_month"]));
    expect(ctx.v9.existingDetails.get("DET-1")).toEqual({ id: DETAIL_DRAFT_ID, filled: new Set(["title"]) });
    expect(ctx.v9.existingDetails.get("DET-2")?.id).toBe(DETAIL_DONE_ID);
    const text = ctx.sharedBlocks[0].text;
    expect(text).toContain("DET-1 (기존 상세 내용, 작성 중)");
    expect(text).toContain("    situation: (비어 있음)");
    expect(text).toContain("<reflection>다음엔 먼저 측정</reflection>");
    expect(text).toContain("start_month: 2022-01");
    expect(text).not.toContain(DETAIL_DRAFT_ID);
  });

  it("renders the draft for extract with aliases instead of UUIDs", () => {
    const ctx = buildWritingChatContext(
      baseInput({
        messages: rows([["assistant", GREETING], ["user", "결제 프로젝트"]]),
        mode: "augment_project",
        augmentTarget: augmentTarget(),
        structuredDraft: {
          project: { summary: { value: "요약", origin: "ai", source_message_ids: [msgId(2)], source_quotes: ["결제"], review: "ok", reviewed_at: null } },
          details: [{ detail_key: null, existing_detail_id: DETAIL_DRAFT_ID, fields: { task: { value: "과제", origin: "user_edit", source_message_ids: [], source_quotes: [], review: "ok", reviewed_at: null } } }],
        },
      }),
    );
    const text = renderDraftForExtract(ctx);
    expect(text).toContain("summary [ai/ok]: 요약 (출처 M2)");
    expect(text).toContain("DET-1 (기존 상세 내용 보강):");
    expect(text).toContain("task [user_edit/ok]: 과제");
    expect(text).not.toContain(msgId(2));
  });

  it("flags the last message from begin_assistant_message is_final", () => {
    expect(buildWritingChatContext(baseInput({ isFinalReply: false })).lastMessage).toBe(false);
    expect(buildWritingChatContext(baseInput({ isFinalReply: true })).lastMessage).toBe(true);
  });

  it("toMonth accepts date and month strings", () => {
    expect(toMonth("2023-03-01")).toBe("2023-03");
    expect(toMonth("2023-03")).toBe("2023-03");
    expect(toMonth(null)).toBeNull();
  });
});
