import { z } from "zod";
import { RANKING_RELEVANCES, type RankingRelevance } from "@/lib/contracts/enums";
import { AliasMap } from "../context-pack/aliases";
import { buildCareerPack } from "../context-pack/career-pack";
import type { CareerRows } from "../context-pack/career-rows";
import { buildJdContext, type JdRequirementInput } from "../context-pack/jd";
import type { YearMonth } from "../context-pack/months";
import {
  MAX_DRAFT_PROJECTS,
  deriveSelection,
  fallbackSelectionFromAliases,
  packProjects,
  selectionFromPrioritiesWithAliases,
  type DraftSourceSelection,
} from "../context-pack/selection";
import { buildSummaryCareerPack } from "../context-pack/summary-pack";
import { computeInputHash } from "../input-hash";
import type { Llm } from "../llm";
import { silentAiLogger, type AiLogger } from "../log";
import { AI11_PROMPT_VERSION, systemBlocks, userBlocks } from "../prompts/AI-11";
import type { NormalizedUsage, ProviderId } from "../providers/types";
import { AI11_OUTPUT_SCHEMA_VERSION, Ai11OutputSchema, type Ai11Output } from "../schemas/AI-11";
import { generateStructured } from "../structured";
import { literalAliasTokens } from "../validation/alias-text";
import { cleanProse } from "../validation/draft-blocks";
import { buildAllowedNumbers } from "../validation/numbers";

/**
 * AI-11 경력기술서 기본 선택 (F-DOC-01). Synchronous (C-6), light tier, low
 * reasoning, one call. Output: per-project relevance; the server keeps ≤ 8
 * included projects and derives included experiences/educations (card 출력 스키마).
 * Checks: V-1 project refs, requirement refs exist (card 처리 방식).
 */

export const AI11_TIER = "light" as const;
export const AI11_JOB_TYPE = "draft_source_ranking";
export const AI11_CALL_KEY = "draft_source_ranking.rank";
export const AI11_MAX_INCLUDED = MAX_DRAFT_PROJECTS;
/** Output ≈ 0.8k tokens (card 비용); headroom for many projects. */
export const AI11_MAX_OUTPUT_TOKENS = 4096;

export { AI11_PROMPT_VERSION };
export type { DraftSourceSelection };

export type RankingContext = {
  packText: string;
  jdText: string;
  aliases: AliasMap;
  careerSnapshotHash: string;
  requirementsHash: string;
  /** PRJ aliases in pack order. */
  projectRefs: string[];
  allowedNumbers: ReadonlySet<string>;
  literalAliasTokens: ReadonlySet<string>;
};

export function buildRankingContext(input: {
  careerRows: CareerRows;
  asOf?: YearMonth;
  jobDescriptionId: string;
  requirements: readonly JdRequirementInput[];
}): RankingContext {
  const summary = buildSummaryCareerPack(input.careerRows, { asOf: input.asOf });
  const jd = buildJdContext({ jobDescriptionId: input.jobDescriptionId, sentences: [], requirements: input.requirements, includeSentences: "none" });
  const aliases = AliasMap.merge(summary.full.aliases, jd.aliases);
  const texts = [...summary.full.numberSources.factualTexts, ...jd.numberTexts];
  return {
    packText: summary.text,
    jdText: jd.text,
    aliases,
    careerSnapshotHash: summary.full.careerSnapshotHash,
    requirementsHash: jd.requirementsHash,
    projectRefs: packProjects(summary.full.aliases).map((p) => p.alias),
    allowedNumbers: buildAllowedNumbers({ texts, numbers: summary.full.numberSources.computedNumbers }),
    literalAliasTokens: literalAliasTokens(texts),
  };
}

export type RankingItem = {
  project_id: string;
  relevance: RankingRelevance;
  include: boolean;
  requirement_ids: string[];
  reason: string;
};

/** `ai_jobs.output` of a draft_source_ranking job (UUID form; copied into drafts.options.ranking). */
export const DraftSourceRankingOutputSchema = z.object({
  schema_version: z.literal(1),
  prompt_version: z.string(),
  career_snapshot_hash: z.string(),
  requirements_hash: z.string(),
  rankings: z.array(
    z.object({
      project_id: z.string(),
      relevance: z.enum(RANKING_RELEVANCES),
      include: z.boolean(),
      requirement_ids: z.array(z.string()),
      reason: z.string(),
    }),
  ),
});
export type DraftSourceRankingOutput = z.infer<typeof DraftSourceRankingOutputSchema>;

export type DraftSourceRankingResult = DraftSourceSelection & {
  ranking: RankingItem[];
  output: DraftSourceRankingOutput;
  report: Record<string, number>;
  promptVersion: string;
  model: string;
  usage: NormalizedUsage;
  attempts: number;
};

export type Ai11Deps = {
  llm: Llm;
  signal?: AbortSignal;
  logger?: AiLogger;
  jobId?: string | null;
  callKey?: string;
};

const RELEVANCE_RANK: Record<RankingRelevance, number> = { high: 0, medium: 1, low: 2 };

/**
 * One call → validated ranking. No valid project ranking at all counts as a
 * V-6 miss (one retry, then AiError("schema_invalid", retryable: false));
 * the route then falls back to `fallbackSelection` (card 응답 모드).
 */
export async function rankDraftSources(input: { context: RankingContext }, deps: Ai11Deps): Promise<DraftSourceRankingResult> {
  const { context } = input;
  if (context.projectRefs.length === 0) throw new Error("rankDraftSources: no complete project in the pack");
  const structured = await generateStructured(
    deps.llm,
    {
      feature: "AI-11.rank",
      promptVersion: AI11_PROMPT_VERSION,
      callKey: deps.callKey ?? AI11_CALL_KEY,
      tier: AI11_TIER,
      systemBlocks: systemBlocks(),
      userBlocks: userBlocks({ packText: context.packText, jdText: context.jdText, projectRefs: context.projectRefs }),
      maxOutputTokens: AI11_MAX_OUTPUT_TOKENS,
      reasoningLevel: "low",
      signal: deps.signal,
    },
    Ai11OutputSchema,
    { accept: (value) => validateRanking(value, context).ranking.length > 0 },
  );
  const { ranking, report } = validateRanking(structured.value, context);
  const selection = selectionFromRanking(ranking, context.aliases);
  (deps.logger ?? silentAiLogger)({ event: "ai_validation", jobId: deps.jobId ?? null, feature: "AI-11", promptVersion: AI11_PROMPT_VERSION, stats: { ...report } });
  return {
    ...selection,
    ranking,
    output: {
      schema_version: 1,
      prompt_version: AI11_PROMPT_VERSION,
      career_snapshot_hash: context.careerSnapshotHash,
      requirements_hash: context.requirementsHash,
      rankings: ranking,
    },
    report,
    promptVersion: AI11_PROMPT_VERSION,
    model: structured.meta.model,
    usage: structured.meta.usage,
    attempts: structured.attempts,
  };
}

/**
 * V-1 on project refs (unknown / non-project / duplicate → dropped),
 * requirement refs resolved (unknown dropped), reasons cleaned (V-5 numbers,
 * aliases → names), ≤ 8 included in relevance order. Order: included by
 * relevance (model order within a level), then the rest the same way.
 */
export function validateRanking(output: Ai11Output, context: RankingContext): { ranking: RankingItem[]; report: Record<string, number> } {
  const report: Record<string, number> = { rankings_total: output.rankings.length, rankings_dropped_unknown_ref: 0, rankings_dropped_duplicate: 0, requirement_refs_dropped: 0, included_truncated: 0 };
  const seen = new Set<string>();
  const rows: Array<RankingItem & { at: number }> = [];
  output.rankings.forEach((r, at) => {
    const projectId = context.aliases.resolveId(r.project_ref.trim(), "project");
    if (!projectId) return void report.rankings_dropped_unknown_ref++;
    if (seen.has(projectId)) return void report.rankings_dropped_duplicate++;
    seen.add(projectId);
    const requirementIds: string[] = [];
    for (const ref of r.requirement_refs) {
      const id = context.aliases.resolveId(ref.trim(), "jd_requirement");
      if (!id) report.requirement_refs_dropped++;
      else if (!requirementIds.includes(id)) requirementIds.push(id);
    }
    const reason = cleanProse(r.reason, context, report).slice(0, 300);
    rows.push({ project_id: projectId, relevance: r.relevance, include: r.include, requirement_ids: requirementIds, reason, at });
  });
  const ordered = rows.sort((a, b) => Number(b.include) - Number(a.include) || RELEVANCE_RANK[a.relevance] - RELEVANCE_RANK[b.relevance] || a.at - b.at);
  let included = 0;
  const ranking = ordered.map(({ at: _at, ...item }) => {
    void _at;
    if (item.include && ++included > AI11_MAX_INCLUDED) {
      report.included_truncated++;
      return { ...item, include: false };
    }
    return item;
  });
  return { ranking, report };
}

function selectionFromRanking(ranking: readonly RankingItem[], aliases: AliasMap): DraftSourceSelection {
  return deriveSelection(
    aliases,
    ranking.filter((r) => r.include).map((r) => r.project_id),
    ranking.filter((r) => !r.include).map((r) => r.project_id),
  );
}

/** Reuse path: a stored `ai_jobs.output` against today's rows (projects gone from the pack drop out). */
export function selectionFromRankingOutput(
  output: DraftSourceRankingOutput,
  careerRows: CareerRows,
  asOf?: YearMonth,
): DraftSourceSelection & { ranking: RankingItem[] } {
  const aliases = buildCareerPack(careerRows, { asOf }).aliases;
  const present = new Set(packProjects(aliases).map((p) => p.id));
  const ranking = output.rankings.filter((r) => present.has(r.project_id));
  return { ...selectionFromRanking(ranking, aliases), ranking };
}

/** AI-03 기본 선택 (1): the latest insight's `strategy.project_priorities` (no call). */
export function selectionFromInsightPriorities(
  priorities: ReadonlyArray<{ project_id: string; rank: number }>,
  careerRows: CareerRows,
  asOf?: YearMonth,
): DraftSourceSelection {
  return selectionFromPrioritiesWithAliases(buildCareerPack(careerRows, { asOf }).aliases, priorities);
}

/** AI-03 기본 선택 (3) / AI-11 실패: "최신 경력순 전체 선택" (pack order, ≤ 8). */
export function fallbackSelection(careerRows: CareerRows, asOf?: YearMonth): DraftSourceSelection {
  return fallbackSelectionFromAliases(buildCareerPack(careerRows, { asOf }).aliases);
}

/** C-6 input_hash: career_snapshot_hash + requirements_hash (+ feature, prompt, provider, model). */
export function computeDraftSourceRankingInputHash(parts: {
  provider: ProviderId;
  model: string;
  careerSnapshotHash: string;
  requirementsHash: string;
}): string {
  return computeInputHash({
    feature: AI11_JOB_TYPE,
    promptVersion: AI11_PROMPT_VERSION,
    provider: parts.provider,
    model: parts.model,
    careerSnapshotHash: parts.careerSnapshotHash,
    requirementsHash: parts.requirementsHash,
  });
}

export { AI11_OUTPUT_SCHEMA_VERSION };
