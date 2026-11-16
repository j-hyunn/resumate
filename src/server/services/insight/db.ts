import { AppError } from "@/lib/contracts/errors";
import { loadCareerRows, type CareerRows } from "@/server/ai/context-pack/career-rows";
import type { JdSentence } from "@/server/ai/context-pack/jd";
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
  /** The JD part of the AI-02 input hash; stored as `insights.raw_text_hash` (DM 2.7.0). */
  rawTextHash: string;
  /** DM 2.6.1: failures that ended before this belong to the old text. */
  rawTextEditedAt: string | null;
  /** C-2 deterministic split of the raw text (all of it goes to AI-02, R17). */
  sentences: JdSentence[];
  /** User-entered position title. */
  positionTitle: string | null;
};

export type InsightInputs = {
  jd: InsightJd;
  careerRows: CareerRows;
};

type Client = AiWriterSupabaseClient | UserSupabaseClient;

/** The project's JD (null = no project / not the user's). */
export async function loadInsightJd(db: Client, applicationProjectId: string): Promise<InsightJd | null> {
  const { data, error } = await db
    .from("job_descriptions")
    .select("id, updated_at, raw_text_hash, raw_text_edited_at, sentences, position_title")
    .eq("application_project_id", applicationProjectId)
    .maybeSingle();
  if (error) throw mapDbError(error);
  if (!data) return null;
  return {
    jobDescriptionId: data.id,
    updatedAt: data.updated_at,
    rawTextHash: data.raw_text_hash,
    rawTextEditedAt: data.raw_text_edited_at,
    sentences: parseSentences(data.sentences),
    positionTitle: data.position_title,
  };
}

/** Everything AI-02 reads, or null when the project (or its JD) is gone. R17: no extraction gate. */
export async function loadInsightInputs(db: Client, applicationProjectId: string): Promise<InsightInputs | null> {
  const jd = await loadInsightJd(db, applicationProjectId);
  if (!jd) return null;
  const careerRows = await loadCareerRows(db);
  return { jd, careerRows };
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
  /**
   * `complete_insight`. `applied: false` + `reason: 'stale_run'` = a newer generation owns the job,
   * or the JD raw text changed after prepare (DM 2.6.1 narrow-gap defense) — nothing was saved.
   */
  complete(args: { insightId: string; jobId: string; runGeneration: number; payload: unknown }): Promise<{ applied: boolean; reason: string | null; versionNo: number | null }>;
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
      const row = (data ?? {}) as { applied?: unknown; reason?: unknown; version_no?: unknown };
      return {
        applied: row.applied === true,
        reason: typeof row.reason === "string" ? row.reason : null,
        versionNo: typeof row.version_no === "number" ? row.version_no : null,
      };
    },
    async fail(insightId, jobId) {
      const { data, error } = await writer.rpc("fail_insight", { p_insight_id: insightId, p_ai_job_id: jobId });
      if (error) throw rpcFailure(error);
      return data === true;
    },
  };
}
