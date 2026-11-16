import type { AliasMap } from "../context-pack/aliases";
import type { ConnectionTier, ModelTier, NormalizedUsage, ProviderId } from "../providers/types";
import { AI02_OUTPUT_SCHEMA_VERSION, type InsightActionType, type InsightGapKind, type InsightMatchStatus } from "../schemas/AI-02";
import type { ValidatedEvidence } from "../validation/evidence";
import { MATCH_KEY_PATTERN, type Ai02ValidationReport, type FinalSynthesis, type ValidatedMatch } from "../validation/insight";
import { toEvidenceLinkRows, type EvidenceLinkInsert } from "./evidence-links";

/**
 * AI-02 → `complete_insight(p_payload)`, **result schema_version 2**
 * (AI spec v4.16 AI-02 "저장", DM v4.16 2.7.0 — 임시안, 재설계 대기).
 * C-3 storage mapping:
 * - `result` holds no evidence; each item carries its `item_key`
 *   (`requirement_matches.MT-n`, `strengths.n`, `gaps.n`, `gaps.n.actions.m`,
 *   `strategy.positioning`, `strategy.project_priorities.n`).
 * - Requirements are not rows: each element is `{match_key, requirement_text,
 *   sids, status, rationale, missing_aspect, item_key}`. `match_key` (`MT-n`)
 *   is a fixed key inside the row — not converted to a UUID (C-3 exception);
 *   stage-2 `requirement_refs` are stored as `match_keys`.
 * - `project_priorities[].ref` → `project_id` (UUID).
 * - `match_stage_result` = `{prompt_version, items}` (stage-1 original without
 *   evidence; no batches).
 * - evidence → `evidence[]` rows in EvidenceLinkInsert keys (owner keys are
 *   filled by the RPC; a placeholder owner is used and ignored there). A
 *   requirement's rows are its **career** evidence only — its "공고 원문" link
 *   is the `sids` list, not evidence rows (DM 2.8). `jd_sentence` rows come
 *   only from stage-2 items the model cited them on. No `jd_requirement`.
 */

export const INSIGHT_BASIS_NOTE = "입력된 경력 데이터 기준 분석입니다";
export const INSIGHT_ITEM_KEYS = {
  match: (key: string) => `requirement_matches.${key}`,
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

export type InsightRequirementMatch = {
  item_key: string;
  /** `MT-n`. */
  match_key: string;
  requirement_text: string;
  sids: string[];
  status: InsightMatchStatus;
  rationale: string;
  missing_aspect: string | null;
};

export type InsightResult = {
  schema_version: number;
  basis_note: string;
  data_sufficiency: InsightDataSufficiency;
  requirement_matches: InsightRequirementMatch[];
  summary_counts: InsightSummaryCounts;
  strengths: Array<{ item_key: string; title: string; description: string; match_keys: string[] }>;
  gaps: Array<{
    item_key: string;
    match_keys: string[];
    gap_kind: InsightGapKind;
    description: string;
    actions: Array<{ item_key: string; type: InsightActionType; text: string }>;
  }>;
  strategy: {
    positioning: string | null;
    positioning_item_key: string;
    project_priorities: Array<{ item_key: string; rank: number; project_id: string; reason: string; match_keys: string[] }>;
  };
};

export type InsightMatchStageResult = {
  prompt_version: string;
  items: Array<{
    match_key: string;
    requirement_text: string;
    sids: string[];
    status: InsightMatchStatus;
    /** The model's verdict before server rules. */
    model_status: InsightMatchStatus;
    rationale: string;
    missing_aspect: string | null;
  }>;
};

export type CompleteInsightPayload = {
  result: InsightResult;
  match_stage_result: InsightMatchStageResult;
  hashes: { raw_text_hash: string; career_snapshot_hash: string; input_hash: string };
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
  hashes: { rawTextHash: string; careerSnapshotHash: string; inputHash: string };
  meta: {
    promptVersion: string;
    matchPromptVersion: string;
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
  const known = new Set(input.matches.map((m) => m.key));
  const keyOf = (ref: string): string => {
    // Refs were validated against the matches; a miss is a programming error.
    if (!known.has(ref) || !MATCH_KEY_PATTERN.test(ref)) throw new Error("toCompleteInsightPayload: unknown match key");
    return ref;
  };
  const items: Array<{ itemKey: string; evidence: readonly ValidatedEvidence[] }> = [];

  const requirement_matches: InsightRequirementMatch[] = input.matches.map((m) => {
    const item_key = INSIGHT_ITEM_KEYS.match(m.key);
    if (m.evidence.length) items.push({ itemKey: item_key, evidence: m.evidence });
    return {
      item_key,
      match_key: m.key,
      requirement_text: m.requirementText,
      sids: [...m.sids],
      status: m.status,
      rationale: m.rationale,
      missing_aspect: m.missingAspect,
    };
  });

  const summary_counts: InsightSummaryCounts = { met: 0, partial: 0, no_evidence: 0 };
  for (const m of input.matches) summary_counts[m.status]++;

  const strengths = input.synthesis.strengths.map((s, n) => {
    const item_key = INSIGHT_ITEM_KEYS.strength(n);
    items.push({ itemKey: item_key, evidence: s.evidence });
    return { item_key, title: s.title, description: s.description, match_keys: s.requirementRefs.map(keyOf) };
  });

  const gaps = input.synthesis.gaps.map((g, n) => {
    const item_key = INSIGHT_ITEM_KEYS.gap(n);
    if (g.evidence.length) items.push({ itemKey: item_key, evidence: g.evidence });
    const actions = g.actions.map((a, m) => {
      const actionKey = INSIGHT_ITEM_KEYS.action(n, m);
      if (a.evidence.length) items.push({ itemKey: actionKey, evidence: a.evidence });
      return { item_key: actionKey, type: a.type, text: a.text };
    });
    return { item_key, match_keys: g.requirementRefs.map(keyOf), gap_kind: g.gapKind, description: g.description, actions };
  });

  const positioning = input.synthesis.positioning;
  if (positioning) items.push({ itemKey: INSIGHT_ITEM_KEYS.positioning, evidence: positioning.evidence });

  const project_priorities = input.synthesis.priorities.map((p, n) => {
    const projectId = aliases.resolveId(p.ref, "project");
    if (!projectId) throw new Error("toCompleteInsightPayload: unknown project alias");
    return { item_key: INSIGHT_ITEM_KEYS.priority(n), rank: p.rank, project_id: projectId, reason: p.reason, match_keys: p.requirementRefs.map(keyOf) };
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
      prompt_version: input.meta.matchPromptVersion,
      items: input.matches.map((m) => ({
        match_key: m.key,
        requirement_text: m.requirementText,
        sids: [...m.sids],
        status: m.status,
        model_status: m.modelStatus,
        rationale: m.rationale,
        missing_aspect: m.missingAspect,
      })),
    },
    hashes: {
      raw_text_hash: input.hashes.rawTextHash,
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
