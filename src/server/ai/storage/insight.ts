import type { AliasMap } from "../context-pack/aliases";
import type { ConnectionTier, ModelTier, NormalizedUsage, ProviderId } from "../providers/types";
import { AI02_OUTPUT_SCHEMA_VERSION, type InsightActionType, type InsightGapKind, type InsightMatchStatus } from "../schemas/AI-02";
import type { ValidatedEvidence } from "../validation/evidence";
import type { Ai02ValidationReport, FinalSynthesis, ValidatedMatch } from "../validation/insight";
import { toEvidenceLinkRows, type EvidenceLinkInsert } from "./evidence-links";

/**
 * AI-02 → `complete_insight(p_payload)` (db-engineer notes S6 "p_payload 모양").
 * C-3 storage mapping:
 * - `result` holds no evidence; each item carries its `item_key`
 *   (`requirement_matches.<요건uuid>`, `strengths.n`, `gaps.n`,
 *   `gaps.n.actions.m`, `strategy.positioning`, `strategy.project_priorities.n`).
 * - alias references become UUIDs and the keys are renamed accordingly
 *   (`requirement_ref` → `requirement_id`, `requirement_refs` → `requirement_ids`,
 *   `project_priorities[].ref` → `project_id`), as C-3 does for
 *   `target_requirement_refs` → `target_requirement_ids`.
 * - evidence → `evidence[]` rows in EvidenceLinkInsert keys (owner keys are
 *   filled by the RPC; a placeholder owner is used and ignored there).
 */

export const INSIGHT_BASIS_NOTE = "입력된 경력 데이터 기준 분석입니다";
export const INSIGHT_ITEM_KEYS = {
  match: (requirementId: string) => `requirement_matches.${requirementId}`,
  strength: (n: number) => `strengths.${n}`,
  gap: (n: number) => `gaps.${n}`,
  action: (n: number, m: number) => `gaps.${n}.actions.${m}`,
  positioning: "strategy.positioning",
  priority: (n: number) => `strategy.project_priorities.${n}`,
} as const;

/** DB limits (db notes [가정]). */
const LABEL_MAX = 300;
const QUOTE_MAX = 2000;

export type InsightDataSufficiency = { level: "ok" | "thin"; hints: string[] };
export type InsightSummaryCounts = Record<InsightMatchStatus, number>;

export type InsightResult = {
  schema_version: number;
  basis_note: string;
  data_sufficiency: InsightDataSufficiency;
  requirement_matches: Array<{
    item_key: string;
    requirement_id: string;
    status: InsightMatchStatus;
    rationale: string;
    missing_aspect: string | null;
  }>;
  summary_counts: InsightSummaryCounts;
  strengths: Array<{ item_key: string; title: string; description: string; requirement_ids: string[] }>;
  gaps: Array<{
    item_key: string;
    requirement_ids: string[];
    gap_kind: InsightGapKind;
    description: string;
    actions: Array<{ item_key: string; type: InsightActionType; text: string }>;
  }>;
  strategy: {
    positioning: string | null;
    positioning_item_key: string;
    project_priorities: Array<{ item_key: string; rank: number; project_id: string; reason: string; requirement_ids: string[] }>;
  };
};

export type InsightMatchStageResult = {
  schema_version: number;
  prompt_version: string;
  batches: number;
  matches: Array<{
    requirement_id: string;
    status: InsightMatchStatus;
    /** The model's verdict before server rules (null = the model skipped it). */
    model_status: InsightMatchStatus | null;
    rationale: string;
    missing_aspect: string | null;
  }>;
};

export type CompleteInsightPayload = {
  result: InsightResult;
  match_stage_result: InsightMatchStageResult;
  hashes: { requirements_hash: string; career_snapshot_hash: string; input_hash: string };
  meta: {
    schema_version: number;
    prompt_version: string;
    provider: ProviderId;
    model: string;
    model_tier: ModelTier;
    connection_tier: ConnectionTier;
    validation_report: Ai02ValidationReport;
    usage: NormalizedUsage;
  };
  evidence: EvidenceLinkInsert[];
};

/** Owner placeholder: complete_insight overwrites owner_type/owner_id/application_project_id. */
const PLACEHOLDER_OWNER = { ownerType: "insight", ownerId: "00000000-0000-0000-0000-000000000000", applicationProjectId: "00000000-0000-0000-0000-000000000000" } as const;

export function toCompleteInsightPayload(input: {
  matches: readonly ValidatedMatch[];
  synthesis: FinalSynthesis;
  aliases: AliasMap;
  dataSufficiency: InsightDataSufficiency;
  hashes: { requirementsHash: string; careerSnapshotHash: string; inputHash: string };
  meta: {
    promptVersion: string;
    matchPromptVersion: string;
    batches: number;
    provider: ProviderId;
    model: string;
    modelTier: ModelTier;
    connectionTier: ConnectionTier;
    report: Ai02ValidationReport;
    usage: NormalizedUsage;
  };
  now: Date;
}): CompleteInsightPayload {
  const { aliases } = input;
  const reqId = (ref: string): string => {
    const id = aliases.resolveId(ref, "jd_requirement");
    // Refs were validated against this map; a miss is a programming error.
    if (!id) throw new Error("toCompleteInsightPayload: unknown requirement alias");
    return id;
  };
  const items: Array<{ itemKey: string; evidence: readonly ValidatedEvidence[] }> = [];

  const requirement_matches = input.matches.map((m) => {
    const item_key = INSIGHT_ITEM_KEYS.match(m.requirementId);
    if (m.evidence.length) items.push({ itemKey: item_key, evidence: m.evidence });
    return { item_key, requirement_id: m.requirementId, status: m.status, rationale: m.rationale, missing_aspect: m.missingAspect };
  });

  const summary_counts: InsightSummaryCounts = { met: 0, partial: 0, no_evidence: 0 };
  for (const m of input.matches) summary_counts[m.status]++;

  const strengths = input.synthesis.strengths.map((s, n) => {
    const item_key = INSIGHT_ITEM_KEYS.strength(n);
    items.push({ itemKey: item_key, evidence: s.evidence });
    return { item_key, title: s.title, description: s.description, requirement_ids: s.requirementRefs.map(reqId) };
  });

  const gaps = input.synthesis.gaps.map((g, n) => {
    const item_key = INSIGHT_ITEM_KEYS.gap(n);
    if (g.evidence.length) items.push({ itemKey: item_key, evidence: g.evidence });
    const actions = g.actions.map((a, m) => {
      const actionKey = INSIGHT_ITEM_KEYS.action(n, m);
      if (a.evidence.length) items.push({ itemKey: actionKey, evidence: a.evidence });
      return { item_key: actionKey, type: a.type, text: a.text };
    });
    return { item_key, requirement_ids: g.requirementRefs.map(reqId), gap_kind: g.gapKind, description: g.description, actions };
  });

  const positioning = input.synthesis.positioning;
  if (positioning) items.push({ itemKey: INSIGHT_ITEM_KEYS.positioning, evidence: positioning.evidence });

  const project_priorities = input.synthesis.priorities.map((p, n) => {
    const projectId = aliases.resolveId(p.ref, "project");
    if (!projectId) throw new Error("toCompleteInsightPayload: unknown project alias");
    return { item_key: INSIGHT_ITEM_KEYS.priority(n), rank: p.rank, project_id: projectId, reason: p.reason, requirement_ids: p.requirementRefs.map(reqId) };
  });

  const evidence = toEvidenceLinkRows({ owner: PLACEHOLDER_OWNER, items, aliases, now: input.now }).map((row) => ({
    ...row,
    quote: row.quote && row.quote.length > QUOTE_MAX ? row.quote.slice(0, QUOTE_MAX) : row.quote,
    source_label: row.source_label && row.source_label.length > LABEL_MAX ? `${row.source_label.slice(0, LABEL_MAX - 1)}…` : row.source_label,
  }));

  return {
    result: {
      schema_version: AI02_OUTPUT_SCHEMA_VERSION,
      basis_note: INSIGHT_BASIS_NOTE,
      data_sufficiency: input.dataSufficiency,
      requirement_matches,
      summary_counts,
      strengths,
      gaps,
      strategy: { positioning: positioning?.text ?? null, positioning_item_key: INSIGHT_ITEM_KEYS.positioning, project_priorities },
    },
    match_stage_result: {
      schema_version: AI02_OUTPUT_SCHEMA_VERSION,
      prompt_version: input.meta.matchPromptVersion,
      batches: input.meta.batches,
      matches: input.matches.map((m) => ({
        requirement_id: m.requirementId,
        status: m.status,
        model_status: m.modelStatus,
        rationale: m.rationale,
        missing_aspect: m.missingAspect,
      })),
    },
    hashes: {
      requirements_hash: input.hashes.requirementsHash,
      career_snapshot_hash: input.hashes.careerSnapshotHash,
      input_hash: input.hashes.inputHash,
    },
    meta: {
      schema_version: AI02_OUTPUT_SCHEMA_VERSION,
      prompt_version: input.meta.promptVersion,
      provider: input.meta.provider,
      model: input.meta.model,
      model_tier: input.meta.modelTier,
      connection_tier: input.meta.connectionTier,
      validation_report: input.meta.report,
      usage: input.meta.usage,
    },
    evidence,
  };
}
