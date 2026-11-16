import type { InsightGapKind } from "../schemas/AI-02";
import { readInsightResultV2, requirementTextsOf } from "./insight-result";

/**
 * AI-12 게이트 진입의 인사이트 보완점 (AI spec v4.16 AI-12 입력 "인사이트 보완점",
 * R-31, JR-5 `[가정: 귀결]`; DM v4.16 2.7.0 "AI-12 게이트 진입").
 *
 * The gate turn no longer reads the JD (raw text or requirement list): it reads
 * the gap the user came from — `writing_chats.return_target.params.insight_id`
 * + `insight_item_key` (`gaps.{n}`) — or, without a key, every gap of that
 * insight (≤ 5). Reply call only; **never a source** (extract and V-9 never see
 * it — a tech name that is only in a gap does not pass V-9d).
 */

export type GateGap = {
  /** Requirement texts of the gap's `match_keys` (MT-n → requirement_text). */
  requirementTexts: string[];
  gapKind: InsightGapKind;
  description: string;
};

/** Card: "키가 없으면 gaps[] 전부(최대 5개)". */
export const GATE_GAPS_MAX = 5;
/** DM 2.7.0: `insight_item_key` `^gaps\.[0-9]{1,2}$`. */
export const GATE_GAP_ITEM_KEY_PATTERN = /^gaps\.[0-9]{1,2}$/;

/**
 * `insights.schema_version` + `insights.result` (the insight the service picked:
 * `return_target.params.insight_id`, else the latest ready schema-2 one) →
 * gate gaps. A matching `insightItemKey` → that gap only; a key that is absent,
 * malformed, or not found → the first GATE_GAPS_MAX gaps. Schema ≠ 2 or an
 * unreadable result → [] (no block).
 */
export function selectGateGaps(input: { schemaVersion: number; result: unknown; insightItemKey?: string | null }): GateGap[] {
  const insight = readInsightResultV2(input.schemaVersion, input.result);
  if (!insight) return [];
  const toGap = (g: (typeof insight.gaps)[number]): GateGap => ({
    requirementTexts: requirementTextsOf(insight, g.match_keys),
    gapKind: g.gap_kind,
    description: g.description,
  });
  const key = input.insightItemKey?.trim();
  if (key && GATE_GAP_ITEM_KEY_PATTERN.test(key)) {
    const hit = insight.gaps.find((g) => g.item_key === key);
    if (hit) return [toGap(hit)];
  }
  return insight.gaps.slice(0, GATE_GAPS_MAX).map(toGap);
}
