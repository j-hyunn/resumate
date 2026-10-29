import { AppError } from "@/lib/contracts/errors";
import type { ReadinessFeature } from "@/lib/contracts/career";
import type { DraftSourceRankingItem, DraftSourceRankingResponse } from "@/lib/contracts/draft";
import { resolveModel } from "@/server/ai/providers/models";
import { mapDbError } from "@/server/db/errors";
import { assertApplicationProjectOwned } from "@/server/services/application/db";
import { getDataReadiness } from "@/server/services/career";
import { AiRun, openAiJob } from "./ai-run";
import { loadDraftJd, loadLatestInsightSignal, loadRequirements } from "./db";
import type { DraftAiDeps, DraftSourceSelection, RankingItemRow } from "./types";

/**
 * `POST /api/application-projects/{id}/draft-source-ranking` — AI-11 기본 선택
 * (C-6 동기, F-DOC-01; AI-03 트리거 (1)–(3); S7 plan "계약 — API" 1).
 *
 * Order: ownership → readiness `features.draft` (422, never AI) → (1) latest
 * ready insight → `project_priorities` (no call) → D-30 JD extraction when
 * needed → (2) the same career + requirements hash already ranked
 * (ai_jobs.output of a succeeded `draft_source_ranking`, no call) → AI-11
 * (light tier, meter `career_description`) → (3) on ANY failure the newest-
 * first full selection, silently (`fallback: true`, AI-11 "조용히 넘어간다").
 */

export const RANKING_JOB_TYPE = "draft_source_ranking" as const;
export const RANKING_STAGE = "rank";
/** C-6 sync [가정] 30 s: whole route incl. a D-30 extraction stays under maxDuration 60. */
const RANKING_CALL_TIMEOUT_MS = 20_000;
const RANKING_BUDGET_MS = 25_000;

export const DRAFT_INSUFFICIENT_DATA_MESSAGE = "서류 초안을 만들려면 완료된 경력과 프로젝트가 1개 이상 필요해요.";

export type RankingOutcome = { kind: "ok"; data: DraftSourceRankingResponse } | { kind: "insufficient_data"; readiness: ReadinessFeature };

function toItem(r: RankingItemRow): DraftSourceRankingItem {
  return { projectId: r.project_id, relevance: r.relevance, include: r.include, requirementIds: r.requirement_ids, reason: r.reason };
}

function response(
  origin: DraftSourceRankingResponse["origin"],
  selection: DraftSourceSelection,
  extra: Partial<Pick<DraftSourceRankingResponse, "reused" | "jobId" | "insightId" | "fallbackReason">> & { ranking?: RankingItemRow[] | null },
): DraftSourceRankingResponse {
  return {
    origin,
    fallback: origin === "fallback",
    reused: extra.reused ?? false,
    jobId: extra.jobId ?? null,
    insightId: extra.insightId ?? null,
    includedExperienceIds: selection.includedExperienceIds,
    includedEducationIds: selection.includedEducationIds,
    includedProjectIds: selection.includedProjectIds,
    projectOrder: selection.projectOrder,
    ranking: extra.ranking ? extra.ranking.map(toItem) : null,
    fallbackReason: extra.fallbackReason ?? null,
  };
}

/** Latest succeeded ranking job output with this hash (C-6 재사용; `ai_jobs_reuse_idx`). */
async function findReusableOutput(deps: DraftAiDeps, applicationProjectId: string, provider: string, inputHash: string): Promise<{ jobId: string; output: unknown } | null> {
  const { data, error } = await deps.writer
    .from("ai_jobs")
    .select("id, output")
    .eq("application_project_id", applicationProjectId)
    .eq("job_type", RANKING_JOB_TYPE)
    .eq("provider", provider)
    .eq("input_hash", inputHash)
    .eq("status", "succeeded")
    .order("finished_at", { ascending: false })
    .limit(1);
  if (error) throw mapDbError(error);
  const row = data?.[0];
  return row && row.output !== null ? { jobId: row.id, output: row.output } : null;
}

export async function rankDraftSourcesForProject(deps: DraftAiDeps, applicationProjectId: string, input: { refresh: boolean }): Promise<RankingOutcome> {
  const log = deps.log ?? (() => {});
  const { user } = deps;
  await assertApplicationProjectOwned(user, applicationProjectId);

  const readiness = await (deps.getReadiness ?? getDataReadiness)(user);
  if (!readiness.features.draft.ready) return { kind: "insufficient_data", readiness: readiness.features.draft };

  const careerRows = await deps.loadCareerRows(user);
  const pipeline = deps.pipelines.ranking;
  const fallback = (reason: string, jobId: string | null = null): RankingOutcome => {
    log("draft_ranking.fallback", { applicationProjectId, reason, jobId });
    return { kind: "ok", data: response("fallback", pipeline.fallback(careerRows), { fallbackReason: reason, jobId }) };
  };

  // (1) Latest insight → its priorities (no call).
  const insight = await loadLatestInsightSignal(user, applicationProjectId);
  if (insight && insight.projectPriorities.length > 0) {
    const selection = pipeline.fromInsight(insight.projectPriorities, careerRows);
    if (selection.includedProjectIds.length > 0) return { kind: "ok", data: response("insight", selection, { insightId: insight.insightId }) };
  }
  if (careerRows.projects.length === 0) return fallback("no_rankable_projects");

  // D-30: requirements first.
  let jd = await loadDraftJd(user, applicationProjectId);
  if (!jd) throw new AppError("not_found", "기업 JD를 찾을 수 없습니다. 새로고침 후 다시 시도해 주세요.", { status: 404 });
  if (jd.extractionStatus !== "succeeded") {
    let extracted;
    try {
      extracted = await deps.ensureJd(applicationProjectId);
    } catch (err) {
      if (err instanceof AppError && err.code === "extraction_in_progress") return fallback("extraction_in_progress");
      throw err;
    }
    if (extracted.status === "failed") return fallback(extracted.code, extracted.jobId);
    jd = await loadDraftJd(user, applicationProjectId);
    if (!jd || jd.extractionStatus !== "succeeded") return fallback("jd_not_extracted");
  }
  const requirements = await loadRequirements(user, jd.jobDescriptionId);

  const context = await deps.providerContext.forUser(deps.userId).catch(() => null);
  if (!context) return fallback("key_missing");
  if (context.keyStatus === "invalid") return fallback("key_invalid");
  const model = resolveModel(context.provider, pipeline.tier);
  const ctx = pipeline.buildContext({ careerRows, jobDescriptionId: jd.jobDescriptionId, requirements });
  const inputHash = pipeline.inputHash({ provider: context.provider, model, careerSnapshotHash: ctx.careerSnapshotHash, requirementsHash: ctx.requirementsHash });

  // (2) Same hash already ranked → reuse (no call, no usage record).
  if (!input.refresh) {
    const reusable = await findReusableOutput(deps, applicationProjectId, context.provider, inputHash);
    const fromOutput = reusable ? pipeline.fromOutput(reusable.output, careerRows) : null;
    if (reusable && fromOutput && fromOutput.includedProjectIds.length > 0) {
      return { kind: "ok", data: response("ai_ranking", fromOutput, { reused: true, jobId: reusable.jobId, ranking: fromOutput.ranking }) };
    }
  }

  // (3) AI-11.
  let opened;
  try {
    opened = await openAiJob(
      deps,
      {
        jobType: RANKING_JOB_TYPE,
        targetType: "application_project",
        targetId: applicationProjectId,
        applicationProjectId,
        modelTier: pipeline.tier,
        params: { refresh: input.refresh },
        inputHash,
        promptVersion: pipeline.promptVersion,
        progress: { stage: RANKING_STAGE, done: 0, total: 1 },
      },
      () => new AppError("ranking_in_progress", "기본 선택을 만들고 있어요.", { status: 409 }),
    );
  } catch (err) {
    if (err instanceof AppError && err.code === "ranking_in_progress") return fallback("ranking_in_progress");
    throw err;
  }
  if (opened.kind === "blocked") return fallback(opened.code, opened.jobId);

  const run = new AiRun(deps, opened.job, { budgetMs: RANKING_BUDGET_MS });
  try {
    const result = await run.call({
      tier: pipeline.tier,
      timeoutMs: RANKING_CALL_TIMEOUT_MS,
      callKey: `${RANKING_JOB_TYPE}.${RANKING_STAGE}`,
      run: ({ llm, signal, callKey }) => pipeline.rank(ctx, { llm, signal, callKey, jobId: opened.job.id }),
    });
    if (!result.ok) {
      await run.fail(result.failure);
      return fallback(result.failure.code, opened.job.id);
    }
    const value = result.value;
    await run.succeed({ stage: RANKING_STAGE, done: 1, total: 1 }, { output: value.output, promptVersion: value.promptVersion, model: value.model });
    if (value.includedProjectIds.length === 0) return fallback("no_rankable_projects", opened.job.id);
    return { kind: "ok", data: response("ai_ranking", value, { jobId: opened.job.id, ranking: value.ranking }) };
  } finally {
    await run.close();
  }
}

/**
 * The ranking to copy into drafts.options.ranking at generation (AI-11 저장):
 * the newest succeeded ranking job of the project. Null when none.
 */
export async function loadLatestRanking(deps: Pick<DraftAiDeps, "writer" | "pipelines">, applicationProjectId: string, careerRows: Parameters<DraftAiDeps["pipelines"]["ranking"]["fromOutput"]>[1]): Promise<RankingItemRow[] | null> {
  const { data, error } = await deps.writer
    .from("ai_jobs")
    .select("output")
    .eq("application_project_id", applicationProjectId)
    .eq("job_type", RANKING_JOB_TYPE)
    .eq("status", "succeeded")
    .order("finished_at", { ascending: false })
    .limit(1);
  if (error) throw mapDbError(error);
  const output = data?.[0]?.output;
  if (output === undefined || output === null) return null;
  return deps.pipelines.ranking.fromOutput(output, careerRows)?.ranking ?? null;
}
