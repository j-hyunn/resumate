import { describe, expect, it } from "vitest";
import { SaveApplicationDocumentInput, StartDocumentWritingChatInput } from "@/lib/contracts/application-document";
import type { UserSupabaseClient } from "@/server/db/types";
import { fakeSupabase } from "@/test/fake-supabase";
import { markApplicationDocumentCopied, saveApplicationDocument, startDocumentWritingChat } from "./save";

/**
 * A5 (R15): the 자기소개서 정본 save / 서류 대화 start actions. The RPC owns every rule
 * (R5-API-2: zod checks the JSON shape only), so what these tests pin down is the argument
 * mapping, the answer mapping and the refusal mapping — nothing is judged here.
 */

const PROJECT = "00000000-0000-4000-8000-0000000000a1";
const DOC = "00000000-0000-4000-8000-0000000000d1";
const CHAT = "00000000-0000-4000-8000-0000000000c1";
const raised = (message: string, details?: string) => Object.assign(new Error(message), { code: "P0001", details });

const okRow = {
  application_document_id: DOC,
  document_kind: "cover_letter",
  filled_slot_count: 1,
  slot_count: 2,
  name: "에이비씨페이 자기소개서",
  name_source: "user",
  deadline: "2026-12-01",
  updated_at: "2026-11-09T03:14:08.844340+00:00",
  applied: [{ writing_chat_id: CHAT, slot: "q_1" }],
  skipped: [{ writing_chat_id: CHAT, slot: "q_2", reason: "already_applied" }],
};

const body = {
  questions: [
    { slot: "q_1", question_text: "지원 동기", char_limit: 800, count_basis: "with_spaces", body: "지원 동기를 씁니다.", blocks: [] },
    { slot: "q_2", question_text: "직무 역량", char_limit: 1000, body: "" },
  ],
};

describe("saveApplicationDocument", () => {
  it("sends the target as (applicationProjectId, documentKind) with p_body and nothing else", async () => {
    const db = fakeSupabase({}, () => okRow);
    const input = SaveApplicationDocumentInput.parse({ applicationProjectId: PROJECT, documentKind: "cover_letter", body });
    const result = await saveApplicationDocument(db.client as UserSupabaseClient, input);
    expect(db.rpcCalls).toEqual([
      { name: "save_application_document", args: { p_application_project_id: PROJECT, p_document_kind: "cover_letter", p_body: body } },
    ]);
    expect(result).toEqual({
      applicationDocumentId: DOC,
      documentKind: "cover_letter",
      filledSlotCount: 1,
      slotCount: 2,
      name: "에이비씨페이 자기소개서",
      nameSource: "user",
      deadline: "2026-12-01",
      updatedAt: "2026-11-09T03:14:08.844340+00:00",
      applied: [{ writingChatId: CHAT, slot: "q_1" }],
      skipped: [{ writingChatId: CHAT, slot: "q_2", reason: "already_applied" }],
    });
  });

  it("passes meta, the expected version, the applied proposals and the application values", async () => {
    const db = fakeSupabase({}, () => okRow);
    const input = SaveApplicationDocumentInput.parse({
      applicationProjectId: PROJECT,
      documentKind: "cover_letter",
      body,
      meta: { tone: "detailed" },
      expectedUpdatedAt: "2026-11-09T03:00:00.000Z",
      appliedProposals: [{ writingChatId: CHAT, slot: "q_1", rev: 2 }],
      applicationValues: { name: "", deadline: "2026-12-01" },
    });
    await saveApplicationDocument(db.client as UserSupabaseClient, input);
    expect(db.rpcCalls[0]!.args).toMatchObject({
      p_meta: { tone: "detailed" },
      p_expected_updated_at: "2026-11-09T03:00:00.000Z",
      p_applied_proposals: [{ writing_chat_id: CHAT, slot: "q_1", rev: 2 }],
      // An empty name returns to the default "{회사명} 자기소개서" (`private.application_reset_name`).
      p_application_values: { name: "", deadline: "2026-12-01" },
    });
  });

  it("an empty applied-proposal list is not sent (the RPC's default stands)", async () => {
    const db = fakeSupabase({}, () => okRow);
    const input = SaveApplicationDocumentInput.parse({ applicationProjectId: PROJECT, documentKind: "cover_letter", body, appliedProposals: [] });
    await saveApplicationDocument(db.client as UserSupabaseClient, input);
    expect(db.rpcCalls[0]!.args).not.toHaveProperty("p_applied_proposals");
  });

  it("CF-S1: the screen never sends question-level sources — the key is not in the contract", () => {
    const parsed = SaveApplicationDocumentInput.safeParse({
      applicationProjectId: PROJECT,
      documentKind: "cover_letter",
      body: { questions: [{ slot: "q_1", sources: [{ source_type: "project", source_id: PROJECT, role: "primary" }] }] },
    });
    expect(parsed.success).toBe(false);
  });

  it("only `cover_letter` is a document kind (CF-1: 경력기술서 left the service)", () => {
    expect(SaveApplicationDocumentInput.safeParse({ applicationProjectId: PROJECT, documentKind: "career_description", body }).success).toBe(false);
  });

  it("a question list of length 0 is a valid shape (the RPC decides, R5-API-2)", async () => {
    const db = fakeSupabase({}, () => ({ ...okRow, filled_slot_count: 0, slot_count: 0 }));
    const input = SaveApplicationDocumentInput.parse({ applicationProjectId: PROJECT, documentKind: "cover_letter", body: { questions: [] } });
    await expect(saveApplicationDocument(db.client as UserSupabaseClient, input)).resolves.toMatchObject({ slotCount: 0 });
  });

  it("zod does not judge the 5-question cap or char_limit — the RPC does", () => {
    const many = { questions: Array.from({ length: 9 }, (_, i) => ({ slot: `q_${i + 1}`, char_limit: null })) };
    expect(SaveApplicationDocumentInput.safeParse({ applicationProjectId: PROJECT, documentKind: "cover_letter", body: many }).success).toBe(true);
  });

  it.each([
    ["too_many_questions", "5,3", 400],
    ["invalid_slot", "q_1", 400],
    ["invalid_evidence_source", "q_1.blocks.b1", 400],
    ["stale_write", "2026-11-09T03:14:08.844340Z", 409],
    ["application_project_not_found", undefined, 404],
  ])("%s → the mapped AppError", async (code, details, status) => {
    const db = fakeSupabase({}, () => {
      throw raised(code, details);
    });
    const input = SaveApplicationDocumentInput.parse({ applicationProjectId: PROJECT, documentKind: "cover_letter", body });
    await expect(saveApplicationDocument(db.client as UserSupabaseClient, input)).rejects.toMatchObject({ status });
  });

  it("too_many_questions reaches the caller with details {limit, current}", async () => {
    const db = fakeSupabase({}, () => {
      throw raised("too_many_questions", "5,2");
    });
    const input = SaveApplicationDocumentInput.parse({ applicationProjectId: PROJECT, documentKind: "cover_letter", body });
    await expect(saveApplicationDocument(db.client as UserSupabaseClient, input)).rejects.toMatchObject({
      code: "too_many_questions",
      status: 400,
      details: { limit: 5, current: 2 },
    });
  });

  it("an answer that isn't the documented shape is our bug (500), never a user error", async () => {
    const db = fakeSupabase({}, () => ({ application_document_id: DOC }));
    const input = SaveApplicationDocumentInput.parse({ applicationProjectId: PROJECT, documentKind: "cover_letter", body });
    await expect(saveApplicationDocument(db.client as UserSupabaseClient, input)).rejects.toMatchObject({ code: "internal_error", status: 500 });
  });
});

describe("startDocumentWritingChat", () => {
  it("returns the new chat id and sends no return target", async () => {
    const db = fakeSupabase({}, () => CHAT);
    const input = StartDocumentWritingChatInput.parse({ applicationProjectId: PROJECT, documentKind: "cover_letter" });
    await expect(startDocumentWritingChat(db.client as UserSupabaseClient, input)).resolves.toEqual({ writingChatId: CHAT });
    expect(db.rpcCalls).toEqual([{ name: "start_document_writing_chat", args: { p_application_project_id: PROJECT, p_document_kind: "cover_letter" } }]);
    expect(db.rpcCalls[0]!.args).not.toHaveProperty("p_return_target");
  });

  it("passes the form snapshot (in memory only — the RPC checks lengths and stores nothing)", async () => {
    const db = fakeSupabase({}, () => CHAT);
    const snapshot = { questions: [{ slot: "q_1", question_text: "지원 동기", char_limit: 800, body: "쓰던 내용" }] };
    const input = StartDocumentWritingChatInput.parse({ applicationProjectId: PROJECT, documentKind: "cover_letter", formSnapshot: snapshot });
    await startDocumentWritingChat(db.client as UserSupabaseClient, input);
    expect(db.rpcCalls[0]!.args.p_form_snapshot).toEqual(snapshot);
  });

  it("refuses a form snapshot with more than 20 questions", () => {
    const snapshot = { questions: Array.from({ length: 21 }, (_, i) => ({ slot: `q_${i + 1}` })) };
    expect(StartDocumentWritingChatInput.safeParse({ applicationProjectId: PROJECT, documentKind: "cover_letter", formSnapshot: snapshot }).success).toBe(false);
  });

  it("a missing application project → 404", async () => {
    const db = fakeSupabase({}, () => {
      throw raised("application_project_not_found");
    });
    const input = StartDocumentWritingChatInput.parse({ applicationProjectId: PROJECT, documentKind: "cover_letter" });
    await expect(startDocumentWritingChat(db.client as UserSupabaseClient, input)).rejects.toMatchObject({ code: "not_found", status: 404 });
  });

  it("an answer that isn't a chat id is our bug (500)", async () => {
    const db = fakeSupabase({}, () => null);
    const input = StartDocumentWritingChatInput.parse({ applicationProjectId: PROJECT, documentKind: "cover_letter" });
    await expect(startDocumentWritingChat(db.client as UserSupabaseClient, input)).rejects.toMatchObject({ code: "internal_error", status: 500 });
  });
});

describe("markApplicationDocumentCopied (R15 후속)", () => {
  it("sends the target and answers the stored first_copied_at", async () => {
    const db = fakeSupabase({}, () => "2026-11-09T05:00:00.000Z");
    await expect(markApplicationDocumentCopied(db.client as UserSupabaseClient, PROJECT)).resolves.toEqual({ firstCopiedAt: "2026-11-09T05:00:00.000Z" });
    expect(db.rpcCalls).toEqual([{ name: "mark_application_document_copied", args: { p_application_project_id: PROJECT, p_document_kind: "cover_letter" } }]);
  });

  it("null from the RPC (no row yet / someone else's row) is a null value, not an error", async () => {
    const db = fakeSupabase({}, () => null);
    await expect(markApplicationDocumentCopied(db.client as UserSupabaseClient, PROJECT)).resolves.toEqual({ firstCopiedAt: null });
  });

  it("invalid_fields from the RPC is mapped", async () => {
    const db = fakeSupabase({}, () => {
      throw raised("invalid_fields", "document_kind");
    });
    await expect(markApplicationDocumentCopied(db.client as UserSupabaseClient, PROJECT)).rejects.toMatchObject({ code: "invalid_fields", status: 400 });
  });
});
