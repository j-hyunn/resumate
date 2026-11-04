import { afterEach, describe, expect, it, vi } from "vitest"
import { normalizeDeliverableDraft, streamTurn, type PanelTurnEvent } from "./writing-chat-turn-v45"

const MSG = { id: "00000000-0000-4e01-8000-0000000000a1", sequence: 1, role: "user", content: "안녕", status: "done", userNumber: 1, provider: null, aiJobId: null, createdAt: "2026-11-04T00:00:00Z" }

const storedBlock = {
  block_id: "b1",
  type: "bullet_list",
  level: null,
  text: null,
  items: [{ text: "첫째", source_fact_ids: ["f1"] }, { text: "둘째" }],
  rows: null,
  basis: null,
  source_fact_ids: ["f1"],
  source_body_quotes: [],
  source_project_fields: ["PRJ.role"],
  review: "ok",
}
const storedDraft = {
  schema_version: 1,
  target: "project_deliverable",
  writing_kind: "retrospective",
  facts: [{ id: "f1", slot: "went_well", text: "배포 자동화", actor: "self", source_message_ids: [MSG.id], source_quotes: ["자동화"], review: "needs_review", reviewed_at: null, origin: "ai" }],
  deliverable: {
    body: {
      value: "- 첫째\n- 둘째",
      blocks: [storedBlock, { block_id: "b2", type: "table", rows: [{ cells: ["a", "b"] }, { cells: ["1", "2"] }], review: "ok" }],
      rev: 2,
      generated_at: "2026-11-04T00:00:00Z",
      base_body_hash: "sha256:00",
      replace_allowed: true,
      missing_slots: [],
      dropped_block_count: 0,
      applied_at: null,
      applied_mode: null,
      applied_rev: null,
    },
  },
  clarifications: [],
  sensitive_flags_count: 0,
  draft_count: 2,
}

describe("normalizeDeliverableDraft (stored DM 2.5.0 → panel view)", () => {
  it("flattens list items / table rows and drops nulls", () => {
    const d = normalizeDeliverableDraft(storedDraft)
    expect(d.facts[0]).toMatchObject({ id: "f1", review: "needs_review", actor: "self" })
    const [list, table] = d.deliverable.body!.blocks
    expect(list).toMatchObject({ block_id: "b1", type: "bullet_list", items: ["첫째", "둘째"], basis: "new", source_project_fields: ["PRJ.role"] })
    expect(list).not.toHaveProperty("text")
    expect(table.rows).toEqual([["a", "b"], ["1", "2"]])
    expect(d.draft_count).toBe(2)
  })
  it("reads the empty start shape", () => {
    expect(normalizeDeliverableDraft({})).toEqual({ schema_version: 1, target: "project_deliverable", writing_kind: null, facts: [], deliverable: {}, clarifications: [], sensitive_flags_count: 0, draft_count: 0 })
  })
})

function sse(events: object[]): Response {
  const body = events.map((e) => `event: ${(e as { type: string }).type}\ndata: ${JSON.stringify(e)}\n\n`).join("")
  return new Response(body, { headers: { "content-type": "text/event-stream" } })
}

async function collect(target: "project" | "deliverable", response: Response): Promise<PanelTurnEvent[]> {
  vi.stubGlobal("fetch", vi.fn(async () => response))
  const out: PanelTurnEvent[] = []
  for await (const ev of streamTurn({ kind: "real", target, endpoint: "/api/writing-chats/x/turns", body: {} }, new AbortController().signal)) out.push(ev)
  return out
}

describe("streamTurn real AI-13 events", () => {
  afterEach(() => vi.unstubAllGlobals())

  it("maps a draft turn: facts_patch → draft_flags → draft_started → draft_block → draft_done → reply_done → turn_done", async () => {
    const events = await collect(
      "deliverable",
      sse([
        { type: "turn_started", jobId: MSG.id, userMessage: MSG, assistantMessageId: MSG.id, provider: "openai", connectionTier: "paid", messageCount: 3, retry: false },
        { type: "facts_patch", structuredDraft: storedDraft, added: ["f1"] },
        { type: "draft_flags", needsReview: ["f1"], actorAmbiguous: true, numberVague: false, sensitiveAdded: 0, sensitiveFlagsCount: 0, clarifications: [] },
        { type: "draft_started", attempt: 1, reason: "initial" },
        { type: "draft_block", attempt: 1, block: storedBlock },
        { type: "draft_done", body: storedDraft.deliverable.body, rev: 2, draftCount: 2, droppedBlockCount: 0, needsReviewBlockIds: [], missingSlots: [], replaceAllowed: true },
        { type: "reply_done", message: { ...MSG, role: "assistant", sequence: 4, aiJobId: MSG.id } },
        { type: "turn_done", jobId: MSG.id, messageCount: 4, remainingMessages: 36, limitReached: false, closed: false, draftStatus: "updated", draftCount: 2, readyToReturn: false, needsReviewCount: 1 },
      ]),
    )
    expect(events.map((e) => e.type)).toEqual(["turn_started", "facts_patch", "draft_flags", "draft_started", "draft_block", "draft_done", "reply_done", "turn_done"])
    expect(events[1]).toMatchObject({ type: "facts_patch", writing_kind: "retrospective", facts: [{ id: "f1" }] })
    expect(events[2]).toMatchObject({ needs_review: ["f1"], actor_ambiguous: ["actor"] })
    expect(events[4]).toMatchObject({ block: { items: ["첫째", "둘째"] } })
    expect(events[5]).toMatchObject({ type: "draft_done", draft_count: 2, body: { rev: 2 } })
    expect(events[7]).toMatchObject({ type: "turn_done", draft_count: 2, message_count: 4 })
  })

  it("a refusal before the stream (409 draft limit) is a before_stream error", async () => {
    const events = await collect("deliverable", new Response(JSON.stringify({ error: { code: "writing_chat_draft_limit_reached" } }), { status: 409, headers: { "content-type": "application/json" } }))
    expect(events).toEqual([expect.objectContaining({ type: "error", error_code: "writing_chat_draft_limit_reached", before_stream: true })])
  })
})
