import { describe, expect, it } from "vitest";
import { baseInput, cooperative } from "../__fixtures__/AI-12/conversations";
import { insightResultV2 } from "../__fixtures__/S7/cover-letter-chat";
import { GATE_GAPS_MAX, selectGateGaps } from "../context-pack/gate-gaps";
import { buildWritingChatContext, type WritingChatTurnInput } from "../context-pack/writing-chat";
import { createFakeLlm } from "../fake-llm";
import { extractUserBlocks, renderGateGaps, replyUserBlocks } from "../prompts/AI-12";
import { extract, reply } from "./AI-12";

/**
 * AI-12 gate entry (R-31) after AI spec v4.16 JR-5: the reply call reads the
 * insight gap(s) the user came from (`<gate_gaps>`), not the JD. Never a source.
 */

function ctxOf(extra: Partial<WritingChatTurnInput> = {}) {
  return buildWritingChatContext(baseInput({ messages: cooperative.messages, ...extra }));
}

const GATE = { feature: "cover_letter" as const, missing: ["complete_project" as const] };

describe("selectGateGaps (insight result schema 2)", () => {
  it("insight_item_key gaps.{n} → that gap only, with its requirement texts (match_keys → requirement_text)", () => {
    expect(selectGateGaps({ schemaVersion: 2, result: insightResultV2(), insightItemKey: "gaps.1" })).toEqual([
      { requirementTexts: ["백엔드 개발 경력 11년 이상"], gapKind: "partial", description: "등록된 경력 기간이 요건보다 짧습니다." },
    ]);
  });

  it("no key, an unknown key, or a malformed key → every gap (≤ 5)", () => {
    const all = selectGateGaps({ schemaVersion: 2, result: insightResultV2() });
    expect(all.map((g) => g.gapKind)).toEqual(["no_evidence", "partial"]);
    expect(all[0].requirementTexts).toEqual(["Kafka 등 메시지 큐 운영 경험"]);
    expect(selectGateGaps({ schemaVersion: 2, result: insightResultV2(), insightItemKey: "gaps.9" })).toEqual(all);
    expect(selectGateGaps({ schemaVersion: 2, result: insightResultV2(), insightItemKey: "strengths.0" })).toEqual(all);
    const many = { ...insightResultV2(), gaps: Array.from({ length: 8 }, (_, i) => ({ item_key: `gaps.${i}`, match_keys: [], gap_kind: "partial", description: `보완점 ${i}`, actions: [] })) };
    expect(selectGateGaps({ schemaVersion: 2, result: many })).toHaveLength(GATE_GAPS_MAX);
  });

  it("schema 1 (old insight), a broken result, or a malformed gap → [] / skipped", () => {
    expect(selectGateGaps({ schemaVersion: 1, result: insightResultV2() })).toEqual([]);
    expect(selectGateGaps({ schemaVersion: 2, result: null })).toEqual([]);
    const mixed = { ...insightResultV2(), gaps: [{ item_key: "gaps.0", gap_kind: "weird", description: "x" }, insightResultV2().gaps[1]] };
    expect(selectGateGaps({ schemaVersion: 2, result: mixed }).map((g) => g.description)).toEqual(["등록된 경력 기간이 요건보다 짧습니다."]);
  });
});

describe("<gate_gaps> block (reply only, gate turns only)", () => {
  const gaps = selectGateGaps({ schemaVersion: 2, result: insightResultV2() });

  it("reply: shared blocks → <gate_gaps> → <project_state> → <turn>; content only (no keys, no sids)", async () => {
    const ctx = ctxOf({ gate: GATE, gateGaps: gaps });
    const blocks = replyUserBlocks(ctx);
    const text = renderGateGaps(ctx)!;
    expect(blocks.at(-3)!.text).toBe(text);
    expect(text).toBe(
      [
        "<gate_gaps>",
        "1) [근거 없음] Kafka 등 메시지 큐 운영 경험 — 메시지 큐 운영 경험이 데이터에 없습니다.",
        "2) [부분 충족] 백엔드 개발 경력 11년 이상 — 등록된 경력 기간이 요건보다 짧습니다.",
        "</gate_gaps>",
      ].join("\n"),
    );
    expect(text).not.toMatch(/MT-\d|\bS\d+\b|gaps\.\d/);
    const llm = createFakeLlm([{ text: "결제 쪽 이야기가 있었나요?" }]);
    for await (const _ of reply(ctx, { llm })) void _;
    expect(llm.requests[0].userBlocks.some((b) => b.text.startsWith("<gate_gaps>"))).toBe(true);
  });

  it("no gate → no block even when gaps are passed; empty list → no block", () => {
    expect(renderGateGaps(ctxOf({ gate: null, gateGaps: gaps }))).toBeNull();
    expect(renderGateGaps(ctxOf({ gate: GATE, gateGaps: [] }))).toBeNull();
    expect(renderGateGaps(ctxOf({ gate: GATE }))).toBeNull();
  });

  it("is never a source: extract never sees it, and a tech name only in a gap does not pass V-9", async () => {
    const ctx = ctxOf({ gate: GATE, gateGaps: gaps });
    expect(extractUserBlocks(ctx).some((b) => b.text.includes("gate_gaps") || b.text.includes("Kafka"))).toBe(false);
    const llm = createFakeLlm([{ json: cooperative.output }]);
    await extract(ctx, { llm });
    expect(JSON.stringify(llm.requests[0].userBlocks)).not.toContain("메시지 큐 운영 경험이 데이터에 없습니다");
  });
});
