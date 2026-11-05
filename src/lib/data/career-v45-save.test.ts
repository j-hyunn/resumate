import { describe, expect, it } from "vitest"
import { AppError } from "@/lib/contracts/errors"
import {
  fromSaveProjectDeliverableResult,
  fromSaveProjectPageResult,
  saveErrorOf,
  toSaveProjectDeliverableInput,
  toSaveProjectPageInput,
} from "./career-v45-save"
import { blankProjectValues } from "./career-v45-shared"

const EXP = "00000000-0000-4e01-8000-000000000001"
const CHAT = "00000000-0000-4e01-8000-0000000000c1"

describe("saveErrorOf (mapDbError details → screen refusal)", () => {
  it("stale_write keeps current_updated_at", () => {
    expect(saveErrorOf(new AppError("stale_write", undefined, { details: { current_updated_at: "t9" } }))).toEqual({ code: "stale_write", current_updated_at: "t9" })
  })
  it("RPC codes pass through with the DM field key", () => {
    expect(saveErrorOf(new AppError("field_too_long", undefined, { details: { field: "situation" } }))).toEqual({ code: "field_too_long", field: "situation" })
    expect(saveErrorOf(new AppError("invalid_period", undefined, { details: { field: "endMonth" } }))).toEqual({ code: "invalid_period", field: "end_month" })
    expect(saveErrorOf(new AppError("deliverable_limit_reached")).code).toBe("deliverable_limit_reached")
  })
  it("anything else → save_failed", () => {
    expect(saveErrorOf(new AppError("invalid_input")).code).toBe("save_failed")
    expect(saveErrorOf(new Error("network")).code).toBe("save_failed")
  })
})

describe("save_project_page mapping", () => {
  it("sends the whole page as 'YYYY-MM', blank STAR as null, applied proposals with rev", () => {
    const values = { ...blankProjectValues({ experience_id: EXP }), name: "  결제 개선 ", start_month: "2024-03-01", end_month: "2024-09-01", is_current: true, situation: "  ", action: "주도" }
    const out = toSaveProjectPageInput({ project_id: null, client_id: "c1", values, expected_updated_at: null, applied_proposals: [{ writing_chat_id: CHAT, field: "action", rev: 2 }] })
    expect(out).toEqual({
      projectId: null,
      clientId: "c1", // R11 OD-C6: a new page sends its id as p_client_id
      values: expect.objectContaining({ name: "결제 개선", experienceId: EXP, educationId: null, startMonth: "2024-03", endMonth: null, isCurrent: true, situation: null, action: "주도" }),
      appliedProposals: [{ writingChatId: CHAT, field: "action", rev: 2 }],
    })
    expect(out).not.toHaveProperty("expectedUpdatedAt")
    // OD-C6: the idempotency key is create-only — an existing row never sends it
    expect(toSaveProjectPageInput({ project_id: "p", client_id: "c1", values, expected_updated_at: null, applied_proposals: [] })).not.toHaveProperty("clientId")
    expect(toSaveProjectPageInput({ project_id: "p", values, expected_updated_at: "t1", applied_proposals: [] }).expectedUpdatedAt).toBe("t1")
  })
  it("maps the answer back, keeping skipped echoes without a chat id", () => {
    expect(
      fromSaveProjectPageResult({
        projectId: "p",
        status: "draft",
        updatedAt: "t2",
        applied: [{ writingChatId: CHAT, field: "action" }],
        skipped: [
          { writingChatId: CHAT, field: "result", reason: "proposal_changed" },
          { writingChatId: null, field: null, reason: "invalid_entry" },
        ],
      }),
    ).toEqual({
      ok: true,
      project_id: "p",
      status: "draft",
      updated_at: "t2",
      applied: [{ writing_chat_id: CHAT, field: "action" }],
      skipped: [
        { writing_chat_id: CHAT, field: "result", reason: "proposal_changed" },
        { writing_chat_id: "", field: "", reason: "invalid_entry" },
      ],
    })
  })
})

describe("save_project_deliverable mapping", () => {
  it("round-trips with mode and sort_order", () => {
    expect(
      toSaveProjectDeliverableInput({ project_deliverable_id: null, project_id: "p", title: " 회고 ", body: "본문", expected_updated_at: null, applied_proposals: [{ writing_chat_id: CHAT, rev: 1, mode: "replace" }] }),
    ).toEqual({ projectDeliverableId: null, projectId: "p", title: "회고", body: "본문", appliedProposals: [{ writingChatId: CHAT, rev: 1, mode: "replace" }] })
    expect(
      fromSaveProjectDeliverableResult({ projectDeliverableId: "d", projectId: "p", sortOrder: 3, updatedAt: "t", applied: [{ writingChatId: CHAT }], skipped: [] }),
    ).toEqual({ ok: true, project_deliverable_id: "d", project_id: "p", sort_order: 3, updated_at: "t", applied: [{ writing_chat_id: CHAT }], skipped: [] })
  })
})
