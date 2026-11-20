import { describe, expect, it } from "vitest";
import { koInput, koMatchOutput, koSynthesis, KO_JD_HASH } from "../__fixtures__/AI-02/insight";
import { IDS } from "../__fixtures__/career-rows";
import { coverLetterContext } from "../__fixtures__/S7/cover-letter-chat";
import { selectGateGaps } from "../context-pack/gate-gaps";
import { readInsightResultV2 } from "../context-pack/insight-result";
import { createFakeLlm } from "../fake-llm";
import { buildInsightContext, finalizeInsight, matchRequirements, synthesizeOnce } from "./AI-02";

/**
 * QA-08 (R17 정렬 라운드 1): the readers of a stored insight (AI-04 <insight>,
 * AI-12 gate gaps) are fed the result the real writer produced
 * (finalizeInsight → toCompleteInsightPayload), JSON round-tripped like jsonb —
 * so a key-shape drift between writer and readers fails here.
 */
async function storedResult() {
  const ctx = buildInsightContext(koInput());
  const match = await matchRequirements({ context: ctx }, { llm: createFakeLlm([{ json: koMatchOutput(ctx) }]) });
  const first = await synthesizeOnce({ context: ctx, match }, { llm: createFakeLlm([{ json: koSynthesis(ctx) }]) });
  const final = finalizeInsight({
    context: ctx,
    match,
    first,
    regen: null,
    snapshot: { careerSnapshotHash: ctx.careerSnapshotHash, rawTextHash: ctx.rawTextHash },
    provider: "anthropic",
    modelTier: "default",
    connectionTier: "paid",
    now: new Date("2026-11-01T00:00:00.000Z"),
  });
  const result = JSON.parse(JSON.stringify(final.payload.result)) as unknown;
  return { ctx, result, written: final.payload.result };
}

describe("stored AI-02 result → readers (writer ↔ reader key shape)", () => {
  it("readInsightResultV2 reads every element the writer stored (nothing silently skipped)", async () => {
    const { result, written } = await storedResult();
    const read = readInsightResultV2(written.schema_version, result);
    expect(read).not.toBeNull();
    expect(read!.requirement_matches.map((m) => [m.match_key, m.requirement_text, m.status])).toEqual(
      written.requirement_matches.map((m) => [m.match_key, m.requirement_text, m.status]),
    );
    expect(read!.strengths.map((s) => s.title)).toEqual(written.strengths.map((s) => s.title));
    expect(read!.gaps.map((g) => [g.item_key, g.match_keys, g.gap_kind])).toEqual(written.gaps.map((g) => [g.item_key, g.match_keys, g.gap_kind]));
    expect(read!.strategy.positioning).toBe(written.strategy.positioning);
    expect(read!.strategy.project_priorities.map((p) => p.project_id)).toEqual(written.strategy.project_priorities.map((p) => p.project_id));
  });

  it("AI-04 <insight> block from the stored result: verdicts, strengths, gaps with requirement text, 지원 방향, priorities", async () => {
    const { ctx, result, written } = await storedResult();
    const cl = coverLetterContext({
      insight: { insightId: "i-1", schemaVersion: written.schema_version, result, careerSnapshotHash: ctx.careerSnapshotHash, rawTextHash: KO_JD_HASH, currentRawTextHash: KO_JD_HASH },
    });
    expect(cl.insightState).toBe("ready");
    const text = cl.insightText!;
    expect(text).toContain("- [충족] 결제 승인 API 설계 및 운영");
    expect(text).toContain("- [근거 없음] 쿠버네티스 운영 경험");
    expect(text).toContain(`- ${written.strengths[0].title} — `);
    expect(text).toContain(`- [근거 없음] Kafka 등 메시지 큐 운영 경험: ${written.gaps[0].description}`);
    expect(written.strategy.positioning).toBeTruthy();
    expect(text).toContain(`지원 방향: ${written.strategy.positioning}`);
    const prj = cl.pack.aliases.aliasOf("project", IDS.prjPay)!;
    expect(text).toContain(`1. ${prj} '`);
  });

  it("AI-12 selectGateGaps from the stored result: by item_key and all gaps", async () => {
    const { result, written } = await storedResult();
    expect(selectGateGaps({ schemaVersion: written.schema_version, result, insightItemKey: "gaps.1" })).toEqual([
      { requirementTexts: ["Kotlin 사용 경험"], gapKind: "partial", description: written.gaps[1].description },
    ]);
    const all = selectGateGaps({ schemaVersion: written.schema_version, result });
    expect(all).toHaveLength(written.gaps.length);
    expect(all[0]).toEqual({ requirementTexts: ["Kafka 등 메시지 큐 운영 경험"], gapKind: "no_evidence", description: written.gaps[0].description });
  });
});
