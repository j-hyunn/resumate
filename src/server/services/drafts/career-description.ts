import { randomUUID } from "node:crypto";
import type { ReadinessFeature } from "@/lib/contracts/career";
import type { CreateCareerDescriptionInput, DraftStreamEvent } from "@/lib/contracts/draft";
import type { AiErrorCode, AiProvider } from "@/lib/contracts/enums";
import { AppError } from "@/lib/contracts/errors";
import type { CareerRows } from "@/server/ai/context-pack/career-rows";
import { resolveModel } from "@/server/ai/providers/models";
import { USAGE_SETTLE_WORST_MS } from "@/server/jobs/constants";
import { mapDbError } from "@/server/db/errors";
import { assertApplicationProjectOwned } from "@/server/services/application/db";
import { getDataReadiness } from "@/server/services/career";
import type { z } from "zod";
import { AiRun, DEAD_RUN_AFTER_MS, asCancelIfStopped, isTargetGone, openAiJob, type CallFailure } from "./ai-run";
import { DraftRpcError, loadDraftJd, loadLatestInsightSignal, loadRequirements, type DraftJd, type InsightSignal } from "./db";
import { loadLatestRanking } from "./ranking";
import type { CareerDescriptionPlan, DraftAiDeps, DraftOptionsRow, PipelineStreamEvent } from "./types";

/**
 * `POST /api/application-projects/{id}/career-descriptions` — AI-03 (SSE; S7
 * plan "계약 — API" 2; F-DOC-01/03; C-6 스트리밍; D-30).
 *
 * prepareCareerDescription (before the stream; plain JSON errors):
 *   ownership → readiness `features.draft` (422) → options → plan (server
 *   section order; empty → 422 `empty_selection`) → JD requirements (R1 A13:
 *   409 `extraction_in_progress` while extracting, 409 `jd_not_extracted`
 *   when not extracted — no provider call, no job; the screen runs the
 *   extraction route first, UX FL-03 / AI C-6) → connection gate (blocked →
 *   one SSE `error`, F-AI-08 lock) → input_hash reuse of an identical ready
 *   draft unless "다시 생성" (C-6).
 *
 * runCareerDescription (inside the stream; never throws):
 *   ai_jobs `career_description` (target = the new draft id; the whole 58 s
 *   budget is generation's, A13) → begin_career_description → `generation_started` →
 *   AI-03 stream (block events) → persist = complete_career_description →
 *   `validated` → complete_ai_job → `done`. Failure → fail_career_description
 *   + job failed + `error` (no partial blocks kept: whole retry, AI-03 MVP 단순화).
 *
 * The client disconnecting does not stop it (spec-gaps S5 ③); the stop button
 * is `POST /api/ai-jobs/{jobId}/cancel`.
 */

export const CAREER_DESCRIPTION_JOB_TYPE = "career_description" as const;
/** Whole request incl. the usage settle stays under maxDuration 60. */
export const REQUEST_BUDGET_MS = 58_000;

type Input = z.output<typeof CreateCareerDescriptionInput>;
type Emit = (event: DraftStreamEvent | { type: "error"; code: AiErrorCode | "internal_error"; retryAfter?: string | null; quotaResetsAt?: string | null }) => void;

export type PreparedCareerDescription =
  | {
      kind: "ready";
      applicationProjectId: string;
      startedAt: number;
      careerRows: CareerRows;
      plan: CareerDescriptionPlan;
      jd: DraftJd;
      insight: InsightSignal | null;
      regeneratedFromId: string | null;
      provider: AiProvider;
      reusedDraftId: string | null;
      /** New draft id = the job's target (null when reused). */
      draftId: string | null;
      /** The opened job's run (QA-S7-01: opened before the stream; null when reused). */
      run: AiRun | null;
    }
  | { kind: "blocked"; code: AiErrorCode }
  | { kind: "insufficient_data"; readiness: ReadinessFeature };

export const emptySelection = () => new AppError("empty_selection", "포함할 경력이나 프로젝트를 하나 이상 골라 주세요.", { status: 422 });
export const extractionInProgress = () => new AppError("extraction_in_progress", "공고를 분석하고 있어요. 잠시 후 다시 확인해 주세요.", { status: 409 });
/** R1 A13 (AI C-6, AI-03): generation never extracts; the screen calls the extraction route first. */
export const jdNotExtracted = () => new AppError("jd_not_extracted", "공고 요건을 먼저 정리해야 해요.", { status: 409 });

/** A13: requirements must already exist before any generation request (no provider call otherwise). */
export function assertJdExtracted(jd: DraftJd): void {
  if (jd.extractionStatus === "running") throw extractionInProgress();
  if (jd.extractionStatus !== "succeeded") throw jdNotExtracted();
}

function nowMs(deps: DraftAiDeps): number {
  return (deps.now ?? (() => new Date()))().getTime();
}

async function findReusableDraft(deps: DraftAiDeps, applicationProjectId: string, inputHash: string): Promise<string | null> {
  const { data, error } = await deps.user
    .from("drafts")
    .select("id")
    .eq("application_project_id", applicationProjectId)
    .eq("draft_type", CAREER_DESCRIPTION_JOB_TYPE)
    .eq("status", "ready")
    .eq("input_hash", inputHash)
    .order("created_at", { ascending: false })
    .limit(1);
  if (error) throw mapDbError(error);
  return data?.[0]?.id ?? null;
}

export function insightSignalForAi03(insight: InsightSignal | null) {
  return insight ? { positioning: insight.positioning, projectPriorities: insight.projectPriorities, requirementStatuses: insight.requirementStatuses } : null;
}

export async function prepareCareerDescription(deps: DraftAiDeps, applicationProjectId: string, input: Input): Promise<PreparedCareerDescription> {
  const startedAt = nowMs(deps);
  const { user } = deps;
  await assertApplicationProjectOwned(user, applicationProjectId);
  // QA-S7-08: "다시 생성" must name a career description of this project (404 before any job / stream).
  if (input.regeneratedFromId) {
    const { data, error } = await user
      .from("drafts")
      .select("id")
      .eq("id", input.regeneratedFromId)
      .eq("application_project_id", applicationProjectId)
      .eq("draft_type", CAREER_DESCRIPTION_JOB_TYPE)
      .maybeSingle();
    if (error) throw mapDbError(error);
    if (!data) throw new AppError("not_found", "다시 생성할 경력기술서를 찾을 수 없습니다. 새로고침 후 다시 시도해 주세요.", { status: 404 });
  }
  const readiness = await (deps.getReadiness ?? getDataReadiness)(user);
  if (!readiness.features.draft.ready) return { kind: "insufficient_data", readiness: readiness.features.draft };

  const careerRows = await deps.loadCareerRows(user);
  const ranking = input.selectionOrigin === "ai_ranking" ? await loadLatestRanking(deps, applicationProjectId, careerRows) : null;
  const options: DraftOptionsRow = {
    included_experience_ids: input.includedExperienceIds,
    included_education_ids: input.includedEducationIds,
    included_project_ids: input.includedProjectIds,
    project_order: input.projectOrder,
    selection_origin: input.selectionOrigin,
    ranking,
    tone: input.tone ?? null,
  };
  const pipeline = deps.pipelines.careerDescription;
  const plan = pipeline.plan({ careerRows, options });
  if (plan.sections.length === 0) throw emptySelection();

  const jd = await loadDraftJd(user, applicationProjectId);
  if (!jd) throw new AppError("not_found", "기업 JD를 찾을 수 없습니다. 새로고침 후 다시 시도해 주세요.", { status: 404 });
  assertJdExtracted(jd);

  const context = await deps.providerContext.forUser(deps.userId).catch((err: unknown) => {
    if (err instanceof AppError) return null;
    throw err;
  });
  if (!context) return { kind: "blocked", code: "key_missing" };
  if (context.keyStatus === "invalid") return { kind: "blocked", code: "key_invalid" };

  const insight = await loadLatestInsightSignal(user, applicationProjectId);

  let reusedDraftId: string | null = null;
  if (!input.regeneratedFromId) {
    const requirements = await loadRequirements(user, jd.jobDescriptionId);
    const ctx = pipeline.buildContext({ careerRows, plan, jobDescriptionId: jd.jobDescriptionId, requirements, insightSignal: insightSignalForAi03(insight) });
    const inputHash = pipeline.inputHash({
      provider: context.provider,
      model: resolveModel(context.provider, pipeline.tier),
      careerSnapshotHash: ctx.careerSnapshotHash,
      requirementsHash: ctx.requirementsHash,
      options: plan.options,
    });
    reusedDraftId = await findReusableDraft(deps, applicationProjectId, inputHash);
  }

  const base = {
    kind: "ready" as const,
    applicationProjectId,
    startedAt,
    careerRows,
    plan,
    jd,
    insight,
    regeneratedFromId: input.regeneratedFromId ?? null,
    provider: context.provider,
    reusedDraftId,
  };
  if (reusedDraftId) return { ...base, draftId: null, run: null };

  // QA-S7-01 (D-34): one career description in flight per application project → 409 with its job id.
  await closeDeadOrRefuse(deps, applicationProjectId);
  const draftId = (deps.newId ?? randomUUID)();
  const opened = await openAiJob(
    deps,
    {
      jobType: CAREER_DESCRIPTION_JOB_TYPE,
      targetType: "draft",
      targetId: draftId,
      applicationProjectId,
      modelTier: pipeline.tier,
      params: { regenerated_from_id: input.regeneratedFromId ?? null, selection_origin: plan.options.selection_origin },
      inputHash: null,
      promptVersion: pipeline.promptVersion,
      progress: { stage: "generate", done: 0, total: 1 },
    },
    () => inProgressError(null),
  ).catch(async (err: unknown) => {
    // The DB partial unique index won a race with another request: name that job.
    if (err instanceof AppError && err.code === CAREER_DESCRIPTION_IN_PROGRESS) throw inProgressError(await inFlightJobId(deps, applicationProjectId));
    throw err;
  });
  if (opened.kind === "blocked") return { kind: "blocked", code: opened.code };
  const budgetMs = startedAt + REQUEST_BUDGET_MS - USAGE_SETTLE_WORST_MS - nowMs(deps);
  return { ...base, draftId, run: new AiRun(deps, opened.job, { budgetMs }) };
}

export const CAREER_DESCRIPTION_IN_PROGRESS = "career_description_in_progress";

function inProgressError(jobId: string | null): AppError {
  return new AppError(CAREER_DESCRIPTION_IN_PROGRESS, "이 기업 JD의 경력기술서를 만들고 있어요. 끝난 뒤 다시 시도해 주세요.", {
    status: 409,
    details: { jobId },
  });
}

async function inFlightJobId(deps: DraftAiDeps, applicationProjectId: string): Promise<string | null> {
  const { data, error } = await deps.user
    .from("ai_jobs")
    .select("id")
    .eq("application_project_id", applicationProjectId)
    .eq("job_type", CAREER_DESCRIPTION_JOB_TYPE)
    .in("status", ["queued", "running"])
    .limit(1);
  if (error) throw mapDbError(error);
  return data?.[0]?.id ?? null;
}

/** A live in-flight job → 409; one without a heartbeat for DEAD_RUN_AFTER_MS (killed function) is closed `stalled`. */
async function closeDeadOrRefuse(deps: DraftAiDeps, applicationProjectId: string): Promise<void> {
  const id = await inFlightJobId(deps, applicationProjectId);
  if (!id) return;
  const job = await deps.store.get(id);
  if (!job) return;
  const lastBeat = Date.parse(job.heartbeatAt ?? job.createdAt);
  if (!(nowMs(deps) - lastBeat > DEAD_RUN_AFTER_MS)) throw inProgressError(id);
  (deps.log ?? (() => {}))("career_description.dead_run_closed", { jobId: id });
  await deps.store.finish(id, job.runGeneration, { status: "failed", errorCode: "stalled", finishedAt: new Date(nowMs(deps)).toISOString(), nextRunAt: null });
}

function errorEvent(f: CallFailure | { code: AiErrorCode | "internal_error"; retryAfter?: string | null; quotaResetsAt?: string | null }) {
  return { type: "error" as const, code: f.code, retryAfter: f.retryAfter ?? null, quotaResetsAt: f.quotaResetsAt ?? null };
}

export async function runCareerDescription(deps: DraftAiDeps, prepared: Extract<PreparedCareerDescription, { kind: "ready" }>, emit: Emit): Promise<void> {
  const log = deps.log ?? (() => {});
  const pipeline = deps.pipelines.careerDescription;
  const apId = prepared.applicationProjectId;
  const safeEmit: Emit = (e) => {
    try {
      emit(e);
    } catch {
      // stream closed (client gone): keep running and saving
    }
  };

  if (prepared.reusedDraftId) {
    safeEmit({ type: "done", draftId: prepared.reusedDraftId, sectionId: null, reused: true, meta: { promptVersion: pipeline.promptVersion, model: "", resultId: prepared.reusedDraftId } });
    return;
  }

  const run = prepared.run!;
  const job = run.job;
  try {
    const jd = prepared.jd;
    const requirements = await loadRequirements(deps.writer, jd.jobDescriptionId);
    const ctx = pipeline.buildContext({
      careerRows: prepared.careerRows,
      plan: prepared.plan,
      jobDescriptionId: jd.jobDescriptionId,
      requirements,
      insightSignal: insightSignalForAi03(prepared.insight),
    });
    const model = resolveModel(job.provider, pipeline.tier);
    const inputHash = pipeline.inputHash({ provider: job.provider, model, careerSnapshotHash: ctx.careerSnapshotHash, requirementsHash: ctx.requirementsHash, options: prepared.plan.options });
    {
      let begun;
      try {
        begun = await deps.drafts.beginCareerDescription({
          applicationProjectId: apId,
          jobId: job.id,
          options: prepared.plan.options,
          sections: prepared.plan.sections.map((s) => ({ section_kind: s.section_kind, experience_id: s.experience_id, education_id: s.education_id, heading: s.heading })),
          insightId: prepared.insight?.insightId ?? null,
          regeneratedFromId: prepared.regeneratedFromId,
        });
      } catch (err) {
        const gone = err instanceof DraftRpcError && err.appError.code === "not_found";
        log("career_description.begin_failed", { jobId: job.id, raise: err instanceof DraftRpcError ? err.raise : "unknown" });
        await run.fail({ code: gone ? "canceled" : "stalled", retryAfter: null, quotaResetsAt: null });
        safeEmit(errorEvent({ code: gone ? "canceled" : "stalled" }));
        return;
      }
      const sections = begun.sections.map((s) => ({ section_id: s.sectionId, sort_order: s.sortOrder }));
      safeEmit({
        type: "generation_started",
        jobId: job.id,
        draftId: begun.draftId,
        sectionId: null,
        provider: job.provider,
        model,
        modelTier: job.modelTier,
        connectionTier: job.connectionTier,
      });

      let targetGone = false;
      const result = await run.stream<PipelineStreamEvent>({
        tier: pipeline.tier,
        timeoutMs: Math.max(run.remaining(), 1),
        callKey: `${CAREER_DESCRIPTION_JOB_TYPE}.generate`,
        run: ({ llm, signal, callKey }) =>
          pipeline.stream(
            { context: ctx, sections },
            {
              llm,
              signal,
              callKey,
              jobId: job.id,
              persist: async (payload) => {
                const done = await deps.drafts.completeCareerDescription({ draftId: begun.draftId, jobId: job.id, runGeneration: job.runGeneration, payload: withHash(payload, inputHash) }).catch((err: unknown) => {
                  if (isTargetGone(err)) targetGone = true;
                  throw err;
                });
                if (!done.applied) {
                  // QA-S7-09: reset (delete_results) or taken over by a newer run → this run is stopped, not broken.
                  targetGone = true;
                  throw new Error("stale_run");
                }
                return { resultId: begun.draftId };
              },
            },
          ),
        onEvent: (e) => safeEmit(e as unknown as DraftStreamEvent),
      });

      if (!result.ok) {
        const failure = await asCancelIfStopped(run, result.failure, targetGone);
        await deps.drafts.failCareerDescription(begun.draftId, job.id).catch(() => false);
        await run.fail(failure);
        safeEmit(errorEvent(failure));
        return;
      }
      const validated = result.held.find((e) => e.type === "validated");
      const done = result.held.find((e) => e.type === "done") as (PipelineStreamEvent & { meta?: { promptVersion?: string; model?: string } }) | undefined;
      if (validated) safeEmit(validated as unknown as DraftStreamEvent);
      await run.succeed({ stage: "validate", done: 1, total: 1 }, { model: done?.meta?.model ?? model, promptVersion: done?.meta?.promptVersion ?? pipeline.promptVersion });
      safeEmit({
        type: "done",
        draftId: begun.draftId,
        sectionId: null,
        reused: false,
        meta: { promptVersion: done?.meta?.promptVersion ?? pipeline.promptVersion, model: done?.meta?.model ?? model, resultId: begun.draftId },
      });
    }
  } catch (err) {
    // Never leave the job running (the job-end trigger then fails a generating draft).
    log("career_description.crashed", { jobId: job.id, code: err instanceof AppError ? String(err.code) : "unknown" });
    await run.fail({ code: "stalled", retryAfter: null, quotaResetsAt: null });
    safeEmit(errorEvent({ code: "stalled" }));
  } finally {
    await run.close();
  }
}

/**
 * `hashes.input_hash` is the api's reuse key (provider + job model + options, C-6), so the
 * lookup in prepare and the stored value always agree.
 */
export function withHash(payload: unknown, inputHash: string): unknown {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return payload;
  const p = payload as Record<string, unknown>;
  const hashes = (p.hashes && typeof p.hashes === "object" ? p.hashes : {}) as Record<string, unknown>;
  return { ...p, hashes: { ...hashes, input_hash: inputHash } };
}
