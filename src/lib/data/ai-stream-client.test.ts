import { describe, expect, it } from "vitest"
import { isRealStreamRequest, readSse, realBlockStream, realChatTurn, replaceSectionBlocks } from "./ai-stream-client"

function sse(events: Array<Record<string, unknown>>, chunkSize = 7): Response {
  const text = events.map((e) => `event: ${e.type}\ndata: ${JSON.stringify(e)}\n\n`).join("")
  const encoder = new TextEncoder()
  const body = new ReadableStream<Uint8Array>({
    start(c) {
      for (let i = 0; i < text.length; i += chunkSize) c.enqueue(encoder.encode(text.slice(i, i + chunkSize)))
      c.close()
    },
  })
  return new Response(body, { headers: { "Content-Type": "text/event-stream" } })
}

async function collect<T>(g: AsyncGenerator<T>): Promise<T[]> {
  const out: T[] = []
  for await (const v of g) out.push(v)
  return out
}

function withFetch(response: Response) {
  globalThis.fetch = (async () => response) as typeof fetch
}

describe("readSse", () => {
  it("reassembles frames split across chunks", async () => {
    const out = await collect(readSse(sse([{ type: "a", text: "한글" }, { type: "b" }])))
    expect(out).toEqual([{ type: "a", text: "한글" }, { type: "b" }])
  })
})

describe("realBlockStream", () => {
  const signal = new AbortController().signal

  it("maps contract events to the hook's events", async () => {
    withFetch(
      sse([
        { type: "generation_started", jobId: "j", draftId: "d", sectionId: "s1", provider: "gemini", model: "m", modelTier: "default", connectionTier: "free" },
        { type: "block_started", blockId: "b1", path: "x" },
        { type: "block_delta", blockId: "b1", text: "안녕" },
        { type: "block_completed", blockId: "b1", block: {} },
        { type: "adjusting_length", sectionId: "s1", charCount: 900, charLimit: 800, countBasis: "with_spaces", reasons: ["length"] },
        {
          type: "validated",
          result: {
            sections: [{ blocks: [{ block_id: "x1", text: "확정", flags: ["number_check_needed"] }] }],
            evidence: [{ item_key: "x1" }, { item_key: "x1" }, { item_key: "other" }],
            notes_for_user: ["확인"],
          },
          validationReport: {},
        },
        { type: "done", draftId: "d", reused: false, sectionId: "s1", meta: {} },
      ]),
    )
    const out = await collect(realBlockStream({ endpoint: "/api/x" }, signal))
    expect(out).toEqual([
      { type: "block_started", block_id: "b1" },
      { type: "block_delta", block_id: "b1", delta: "안녕" },
      { type: "block_completed", block_id: "b1" },
      { type: "adjusting_length", section_id: "s1", current_chars: 900, char_limit: 800 },
      {
        type: "validated",
        section_id: "s1",
        blocks: [{ block_id: "x1", text: "확정", flags: ["number_check_needed"], evidence_count: 2 }],
        notes: { omitted: undefined, notes_for_user: ["확인"], char_adjust_needed: undefined },
      },
      { type: "done" },
    ])
  })

  it("keeps AI-03 `omitted` as project id + reason for the editor to name (QA-W5-01)", async () => {
    withFetch(
      sse([
        { type: "generation_started", jobId: "j", draftId: "d", sectionId: null, provider: "openai", model: "m", modelTier: "default", connectionTier: "paid" },
        {
          type: "validated",
          result: {
            sections: [],
            evidence: [],
            // the real AI-03 shape (AI-03.ts `omitted.push({ project_id, reason })`)
            omitted: [{ project_id: "p-1", reason: "low_relevance" }, { project_id: "p-2", reason: "user_excluded" }, { reason: "low_relevance" }, ""],
            notes_for_user: [],
          },
          validationReport: {},
        },
        { type: "done", draftId: "d", reused: false, sectionId: null, meta: {} },
      ]),
    )
    const out = await collect(realBlockStream({ endpoint: "/api/x" }, signal))
    expect(out[0]).toMatchObject({
      type: "validated",
      notes: {
        omitted: [
          { project_id: "p-1", reason: "low_relevance" },
          { project_id: "p-2", reason: "user_excluded" },
        ],
      },
    })
  })

  it("carries the provider and times on a failure", async () => {
    withFetch(
      sse([
        { type: "generation_started", jobId: "j", draftId: "d", sectionId: null, provider: "openai", model: "m", modelTier: "default", connectionTier: "paid" },
        { type: "error", code: "rate_limited", category: "provider_limit", failureCause: "rate_limited", message: "m", retryable: true, retryAfter: "2026-11-02T00:00:00Z", quotaResetsAt: null },
      ]),
    )
    const out = await collect(realBlockStream({ endpoint: "/api/x" }, signal))
    expect(out).toEqual([{ type: "error", error_code: "rate_limited", provider: "openai", retry_after: "2026-11-02T00:00:00Z", quota_resets_at: null }])
  })

  it("a JSON refusal before the stream ends as one failure", async () => {
    withFetch(Response.json({ error: { code: "key_missing", message: "m" } }, { status: 409 }))
    const out = await collect(realBlockStream({ endpoint: "/api/x", body: {} }, signal))
    expect(out).toEqual([{ type: "error", error_code: "key_missing", provider: null, retry_after: null, quota_resets_at: null }])
  })
})

describe("realChatTurn", () => {
  it("maps a turn", async () => {
    withFetch(
      sse([
        { type: "turn_started", jobId: "j", provider: "anthropic", connectionTier: "paid" },
        { type: "reply_delta", text: "네" },
        { type: "reply_done", message: {} },
        {
          type: "draft_patch",
          structuredDraft: {
            details: [
              { detail_key: "D1", existing_detail_id: null, achievements: [] },
              { detail_key: null, existing_detail_id: "e-1", achievements: [{ achievement_key: "A2" }] },
            ],
          },
          changed: [
            { section: "project", field: "name" },
            { section: "detail", detail: { detailKey: "D1" }, field: "action" },
            { section: "detail", detail: { existingDetailId: "e-1" }, field: "result" },
            { section: "achievement", achievementKey: "A2", field: "unit" },
            { section: "detail", detail: { detailKey: "D9" }, field: "task" },
          ],
        },
        { type: "draft_flags", needsReview: [{ section: "detail", detail: { detailKey: "D1" }, field: "action" }], clarifications: [], sensitiveAdded: 1, sensitiveFlagsCount: 1 },
        { type: "turn_done", jobId: "j" },
      ]),
    )
    const out = await collect(realChatTurn({ endpoint: "/api/x" }, new AbortController().signal))
    expect(out.map((e) => e.type)).toEqual(["reply_delta", "reply_done", "draft_patch", "draft_flags", "turn_done"])
    expect(out[2]).toEqual({
      type: "draft_patch",
      paths: ["project.name", "details.0.fields.action", "details.1.fields.result", "details.1.achievements.0.unit"],
    })
    expect(out[3]).toMatchObject({ type: "draft_flags", needs_review: ["details.0.fields.action"], sensitive: 1 })
  })
})

describe("replaceSectionBlocks", () => {
  const b = (block_id: string, state: string, section_id?: string) => ({ block_id, state, section_id })
  const ids = (blocks: Array<{ block_id: string }>) => blocks.map((x) => x.block_id)

  it("a real stream's provisional blocks, with no section_id, go when their section is confirmed", () => {
    expect(ids(replaceSectionBlocks([b("p1", "completed"), b("p2", "streaming")], "s1", [b("v1", "validated", "s1")]))).toEqual(["v1"])
  })
  it("the career description (no section) replaces all of its blocks in place", () => {
    expect(ids(replaceSectionBlocks([b("p1", "completed")], "", [b("v1", "validated")]))).toEqual(["v1"])
  })
  it("another section's blocks stay, confirmed or provisional, in order", () => {
    const prev = [b("a1", "validated", "a"), b("s1", "completed", "s"), b("c1", "streaming", "c")]
    expect(ids(replaceSectionBlocks(prev, "s", [b("v", "validated", "s")]))).toEqual(["a1", "v", "c1"])
  })
  it("a confirmed block with no section isn't mistaken for this section's", () => {
    expect(ids(replaceSectionBlocks([b("cd", "validated")], "s", [b("v", "validated", "s")]))).toEqual(["cd", "v"])
  })
})

describe("isRealStreamRequest", () => {
  it("tells a real request from a mock one", () => {
    expect(isRealStreamRequest({ endpoint: "/x" })).toBe(true)
    expect(isRealStreamRequest({ blocks: [] })).toBe(false)
  })
})
