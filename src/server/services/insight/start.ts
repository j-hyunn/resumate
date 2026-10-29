import { AppError } from "@/lib/contracts/errors";
import type { ReadinessFeature } from "@/lib/contracts/career";
import type { StartInsightResponse } from "@/lib/contracts/insight";
import { resolveModel } from "@/server/ai/providers/models";
import { mapDbError } from "@/server/db/errors";
import type { UserSupabaseClient } from "@/server/db/types";
import type { ProviderContextSource } from "@/server/jobs/provider-context";
import type { JobRunner } from "@/server/jobs/runner";
import { assertApplicationProjectOwned } from "@/server/services/application/db";
import { getDataReadiness } from "@/server/services/career";
import { loadInsightInputs, type InsightInputs } from "./db";
import { INSIGHT_JOB_TYPE, INSIGHT_TARGET_TYPE, type InsightPipeline } from "./job";

/**
 * `POST /api/application-projects/{id}/insights` (S6 plan "계약 — API" 2;
 * AI-02 트리거 D-18, C-6 재사용, D-34 동시 실행 1개, F-AP-06).
 *
 * Order: ownership (RLS) → readiness `features.insight` (422 + readiness, no
 * AI) → connection gate (active provider, key, consent; 409) → input_hash
 * reuse against ready insights unless `regenerate` (no job, no call, no usage)
 * → start the `insight` job (or follow the one in flight).
 *
 * input_hash can only be computed once the JD has requirements; a JD that is
 * not extracted yet has no insight to reuse, and the job extracts it first (D-30).
 */

export type StartInsightDeps = {
  userId: string;
  /** User session (RLS): ownership, readiness, hash inputs, ready insights. */
  user: UserSupabaseClient;
  providerContext: ProviderContextSource;
  runner: Pick<JobRunner, "startJob">;
  pipeline: Pick<InsightPipeline, "buildContext" | "hashes" | "inputHash" | "promptVersion" | "tier">;
  /** Override for tests. */
  loadInputs?: (db: UserSupabaseClient, applicationProjectId: string) => Promise<InsightInputs | null>;
  getReadiness?: (db: UserSupabaseClient) => Promise<{ features: { insight: ReadinessFeature } }>;
};

export type StartInsightOutcome =
  | { kind: "started"; data: StartInsightResponse }
  | { kind: "insufficient_data"; readiness: ReadinessFeature };

export const INSUFFICIENT_DATA_MESSAGE = "인사이트를 만들려면 완료된 경력과 프로젝트가 1개 이상 필요해요.";

const notConnected = () => new AppError("ai_not_connected", "AI 연결이 필요합니다. 키를 등록한 뒤 다시 시도해 주세요.", { status: 409 });
const keyInvalid = () => new AppError("key_invalid", "AI 키가 유효하지 않습니다. 키를 확인해 다시 연결해 주세요.", { status: 409 });

/**
 * QA-S6-06: reuse only the CURRENT latest insight when its input_hash matches
 * (an older ready version with the same hash is not reused: S-16 shows the
 * latest, so "reused" must point at what the screen shows). Otherwise a new job.
 */
export async function findReusableInsight(user: UserSupabaseClient, applicationProjectId: string, inputHash: string): Promise<string | null> {
  const { data, error } = await user
    .from("insights")
    .select("id, input_hash")
    .eq("application_project_id", applicationProjectId)
    .eq("is_latest", true)
    .eq("status", "ready")
    .limit(1);
  if (error) throw mapDbError(error);
  const latest = data?.[0];
  return latest && latest.input_hash === inputHash ? latest.id : null;
}

export async function startInsight(deps: StartInsightDeps, applicationProjectId: string, input: { regenerate: boolean }): Promise<StartInsightOutcome> {
  const { user, userId, pipeline } = deps;
  await assertApplicationProjectOwned(user, applicationProjectId);

  // AI route re-checks D-01 (DM §6): insufficient data never calls AI.
  const readiness = await (deps.getReadiness ?? getDataReadiness)(user);
  if (!readiness.features.insight.ready) return { kind: "insufficient_data", readiness: readiness.features.insight };

  // Connection gate here too (startJob repeats it) so reuse is keyed on the provider that would run.
  const context = await deps.providerContext.forUser(userId);
  if (!context) throw notConnected();
  if (context.keyStatus === "invalid") throw keyInvalid();
  const model = resolveModel(context.provider, pipeline.tier);

  const inputs = await (deps.loadInputs ?? loadInsightInputs)(user, applicationProjectId);
  const hashes = inputs ? pipeline.hashes(pipeline.buildContext(inputs)) : null;

  if (hashes && !input.regenerate) {
    const inputHash = pipeline.inputHash({ provider: context.provider, model, ...hashes });
    const reusable = await findReusableInsight(user, applicationProjectId, inputHash);
    if (reusable) return { kind: "started", data: { reused: true, insightId: reusable, jobId: null, inProgress: false } };
  }

  const started = await deps.runner.startJob({
    userId,
    jobType: INSIGHT_JOB_TYPE,
    target: { type: INSIGHT_TARGET_TYPE, id: applicationProjectId },
    applicationProjectId,
    params: { applicationProjectId },
    // Recorded on the job for tracing; reuse is decided above against insights (a reused job could
    // point at an insight deleted by a career deletion with delete_results).
    inputHash: hashes ? (ctx) => pipeline.inputHash({ provider: ctx.provider, model: ctx.model, ...hashes }) : null,
    promptVersion: pipeline.promptVersion,
    regenerate: true,
  });
  return { kind: "started", data: { reused: false, insightId: null, jobId: started.jobId, inProgress: started.inProgress } };
}
