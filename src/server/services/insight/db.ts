import { AppError } from "@/lib/contracts/errors";
import { loadCareerRows, type CareerRows } from "@/server/ai/context-pack/career-rows";
import type { JdRequirementInput, JdSentence } from "@/server/ai/context-pack/jd";
import type { Json } from "@/server/db/database.types";
import { mapDbError } from "@/server/db/errors";
import type { AiWriterSupabaseClient, UserSupabaseClient } from "@/server/db/types";
import { parseSentences } from "@/server/services/application/db";

/**
 * S6 insight persistence (db notes "RPC 시그니처"): inputs are read with the
 * client given (app_ai_writer in job steps, the user session for reads — both
 * RLS-scoped to the user); begin / complete / fail are app_ai_writer definer
 * RPCs (DM-13).
 */

export type InsightJd = {
  jobDescriptionId: string;
  updatedAt: string | null;
  extractionStatus: "pending" | "running" | "succeeded" | "failed";
  extractionJobId: string | null;
  sentences: JdSentence[];
  positionTitle: string | null;
  /** job_descriptions.extraction.seniority.label */
  seniorityLabel: string | null;
};

export type InsightInputs = {
  jd: InsightJd;
  requirements: JdRequirementInput[];
  careerRows: CareerRows;
};

type Client = AiWriterSupabaseClient | UserSupabaseClient;

function seniorityLabelOf(extraction: Json | null): string | null {
  if (!extraction || typeof extraction !== "object" || Array.isArray(extraction)) return null;
  const seniority = (extraction as Record<string, unknown>).seniority;
  if (!seniority || typeof seniority !== "object" || Array.isArray(seniority)) return null;
  const label = (seniority as Record<string, unknown>).label;
  return typeof label === "string" && label.trim() ? label : null;
}

/** The project's JD (null = no project / not the user's). */
export async function loadInsightJd(db: Client, applicationProjectId: string): Promise<InsightJd | null> {
  const { data, error } = await db
    .from("job_descriptions")
    .select("id, updated_at, extraction_status, extraction_job_id, sentences, position_title, extraction")
    .eq("application_project_id", applicationProjectId)
    .maybeSingle();
  if (error) throw mapDbError(error);
  if (!data) return null;
  return {
    jobDescriptionId: data.id,
    updatedAt: data.updated_at,
    extractionStatus: data.extraction_status as InsightJd["extractionStatus"],
    extractionJobId: data.extraction_job_id,
    sentences: parseSentences(data.sentences),
    positionTitle: data.position_title,
    seniorityLabel: seniorityLabelOf(data.extraction),
  };
}

/** jd_requirements of the JD, sort_order order (DM A.7). */
export async function loadInsightRequirements(db: Client, jobDescriptionId: string): Promise<JdRequirementInput[]> {
  const { data, error } = await db
    .from("jd_requirements")
    .select("id, category, content, importance, source_sids, sort_order, updated_at")
    .eq("job_description_id", jobDescriptionId)
    .order("sort_order", { ascending: true })
    .order("id", { ascending: true });
  if (error) throw mapDbError(error);
  return (data ?? []).map((r) => ({
    id: r.id,
    category: r.category as JdRequirementInput["category"],
    content: r.content,
    importance: r.importance as JdRequirementInput["importance"],
    source_sids: r.source_sids ?? [],
    sort_order: r.sort_order,
    updated_at: r.updated_at,
  }));
}

/** Everything AI-02 reads, or null when the JD isn't extracted (or the project is gone). */
export async function loadInsightInputs(db: Client, applicationProjectId: string): Promise<InsightInputs | null> {
  const jd = await loadInsightJd(db, applicationProjectId);
  if (!jd || jd.extractionStatus !== "succeeded") return null;
  const [requirements, careerRows] = await Promise.all([loadInsightRequirements(db, jd.jobDescriptionId), loadCareerRows(db)]);
  return { jd, requirements, careerRows };
}

// ---------------- RPCs (app_ai_writer) ----------------

type RpcError = Parameters<typeof mapDbError>[0];

/** The raw RPC raise name (P0001 message), for callers that branch on it. */
export function raiseName(error: RpcError | null | undefined): string | null {
  return error && error.code === "P0001" && error.message ? error.message : null;
}

export class InsightRpcError extends Error {
  constructor(
    readonly raise: string | null,
    readonly appError: AppError,
  ) {
    super(`insight rpc failed: ${raise ?? "db_error"}`);
    this.name = "InsightRpcError";
  }
}

function rpcFailure(error: RpcError): InsightRpcError {
  return new InsightRpcError(raiseName(error), mapDbError(error));
}

export interface InsightStore {
  /** `begin_insight` → insights.id (idempotent per job). */
  begin(applicationProjectId: string, jobId: string): Promise<string>;
  /** `complete_insight`. `applied: false` = stale run. */
  complete(args: { insightId: string; jobId: string; runGeneration: number; payload: unknown }): Promise<{ applied: boolean; versionNo: number | null }>;
  /** `fail_insight` (only the job's own generating row). */
  fail(insightId: string, jobId: string): Promise<boolean>;
}

export function createInsightStore(writer: AiWriterSupabaseClient): InsightStore {
  return {
    async begin(applicationProjectId, jobId) {
      const { data, error } = await writer.rpc("begin_insight", { p_application_project_id: applicationProjectId, p_ai_job_id: jobId });
      if (error) throw rpcFailure(error);
      if (typeof data !== "string") throw new InsightRpcError(null, new AppError("internal_error", undefined, { status: 500 }));
      return data;
    },
    async complete({ insightId, jobId, runGeneration, payload }) {
      const { data, error } = await writer.rpc("complete_insight", {
        p_insight_id: insightId,
        p_ai_job_id: jobId,
        p_run_generation: runGeneration,
        p_payload: payload as Json,
      });
      if (error) throw rpcFailure(error);
      const row = (data ?? {}) as { applied?: unknown; version_no?: unknown };
      return { applied: row.applied === true, versionNo: typeof row.version_no === "number" ? row.version_no : null };
    },
    async fail(insightId, jobId) {
      const { data, error } = await writer.rpc("fail_insight", { p_insight_id: insightId, p_ai_job_id: jobId });
      if (error) throw rpcFailure(error);
      return data === true;
    },
  };
}
