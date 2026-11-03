import { describe, expect, it } from "vitest"
import type { DeliverableDraftBlock } from "@/types/db"
import { appendableCount, blocksToFill, fillBody, fillButtons, hasFillableContent, unreviewedCount } from "./draft-fill"

const blk = (id: string, over: Partial<DeliverableDraftBlock> = {}): DeliverableDraftBlock => ({
  block_id: id,
  type: "paragraph",
  text: id,
  basis: "new",
  source_fact_ids: [],
  source_body_quotes: [],
  source_project_fields: [],
  review: "ok",
  ...over,
})
const h = (id: string, level = 2) => blk(id, { type: "heading", level })

describe("blocksToFill", () => {
  it("drops unaccepted needs_review blocks and headings left without content", () => {
    const blocks = [h("H1"), blk("p1"), h("H2"), blk("p2", { review: "needs_review" })]
    expect(blocksToFill(blocks, "replace").map((b) => b.block_id)).toEqual(["H1", "p1"])
  })
  it("keeps accepted needs_review blocks", () => {
    const blocks = [h("H1"), blk("p1", { review: "accepted" })]
    expect(blocksToFill(blocks, "replace").map((b) => b.block_id)).toEqual(["H1", "p1"])
  })
  it("replace keeps nested headings above a content block", () => {
    const blocks = [h("A", 2), h("B", 3), blk("p")]
    expect(blocksToFill(blocks, "replace").map((b) => b.block_id)).toEqual(["A", "B", "p"])
  })
  it("append keeps new blocks and only the heading right before them", () => {
    const blocks = [h("A", 2), blk("c1", { basis: "current_body" }), h("B", 2), blk("n1"), blk("n2")]
    expect(blocksToFill(blocks, "append").map((b) => b.block_id)).toEqual(["B", "n1", "n2"])
  })
  it("append with nested headings takes the nearest one only", () => {
    const blocks = [h("A", 2), h("B", 3), blk("n1")]
    expect(blocksToFill(blocks, "append").map((b) => b.block_id)).toEqual(["B", "n1"])
  })
})

describe("counts and buttons", () => {
  const blocks = [h("H"), blk("c", { basis: "current_body" }), blk("r", { review: "needs_review" })]
  it("counts", () => {
    expect(unreviewedCount(blocks)).toBe(1)
    expect(appendableCount(blocks)).toBe(0)
    expect(hasFillableContent(blocks)).toBe(true)
    expect(hasFillableContent([blk("x", { review: "needs_review" })])).toBe(false)
  })
  it("empty body → insert only", () => {
    expect(fillButtons("  \n", blocks, true)).toEqual({ kind: "insert" })
  })
  it("body → replace (hidden when not allowed) + append (disabled without new blocks)", () => {
    expect(fillButtons("본문", blocks, false)).toEqual({ kind: "replace_append", showReplace: false, appendDisabled: true })
    expect(fillButtons("본문", [blk("n")], true)).toEqual({ kind: "replace_append", showReplace: true, appendDisabled: false })
  })
})

describe("fillBody", () => {
  it("append adds one blank line + new blocks after the form body", () => {
    const r = fillBody("기존 본문\n\n", [blk("c", { basis: "current_body" }), h("H"), blk("n")], "append")
    expect(r).toEqual({ ok: true, body: "기존 본문\n\n## H\n\nn", mode: "append" })
  })
  it("insert = replace mode", () => {
    expect(fillBody("", [blk("p")], "insert")).toEqual({ ok: true, body: "p", mode: "replace" })
  })
  it("refuses when nothing to fill or the result is over 20,000 chars", () => {
    expect(fillBody("", [blk("p", { review: "needs_review" })], "replace")).toEqual({ ok: false, reason: "nothing_to_fill" })
    expect(fillBody("x".repeat(19_999), [blk("long")], "append")).toEqual({ ok: false, reason: "too_long" })
  })
})
