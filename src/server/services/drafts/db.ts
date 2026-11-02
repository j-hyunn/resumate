import { AppError } from "@/lib/contracts/errors";
import type { CareerRows } from "@/server/ai/context-pack/career-rows";
import type { JdRequirementInput } from "@/server/ai/context-pack/jd";
import type { Json } from "@/server/db/database.types";
import { mapDbError } from "@/server/db/errors";
import type { AiWriterSupabaseClient, UserSupabaseClient } from "@/server/db/types";
import { loadInsightJd, loadInsightRequirements, raiseName, type InsightJd } from "@/server/services/insight/db";

/**
 * S7 draft persistence (db notes "RPC 시그니처와 반환 형태"). Inputs are read
 * with the client given (user session before the stream, app_ai_writer inside
 * it — both RLS-scoped to the user). begin / complete / fail are app_ai_writer
 * definer RPCs (DM-13); question setup and sources are user-session RPCs.
 */

type Client = AiWriterSupabaseClient | UserSupabaseClient;
type RpcError = Parameters<typeof mapDbError>[0];

export type DraftJd = InsightJd & {
  /** extraction.other_sids — company / role intro sentences (AI-04 input). */
  otherSids: string[];
};

function obj(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}
function arr(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}
function str(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

export async function loadDraftJd(db: Client, applicationProjectId: string): Promise<DraftJd | null> {
  const jd = await loadInsightJd(db, applicationProjectId);
  if (!jd) return null;
  const { data, error } = await db.from("job_descriptions").select("extraction").eq("id", jd.jobDescriptionId).maybeSingle();
  if (error) throw mapDbError(error);
  const otherSids = arr(obj(data?.extraction).other_sids).flatMap((s) => (typeof s === "string" ? [s] : []));
  return { ...jd, otherSids };
}

export async function loadRequirements(db: Client, jobDescriptionId: string): Promise<JdRequirementInput[]> {
  return loadInsightRequirements(db, jobDescriptionId);
}

/** The latest ready insight as the drafts use it (AI-03 / AI-04 / AI-11 "참고 신호"). */
export type InsightSignal = {
  insightId: string;
  positioning: string | null;
  projectPriorities: { project_id: string; rank: number; reason: string }[];
  requirementStatuses: { requirement_id: string; status: "met" | "partial" | "no_evidence" }[];
  strengths: { title: string; description: string }[];
};

export async function loadLatestInsightSignal(db: Client, applicationProjectId: string): Promise<InsightSignal | null> {
  const { data, error } = await db
    .from("insights")
    .select("id, result")
    .eq("application_project_id", applicationProjectId)
    .eq("is_latest", true)
    .eq("status", "ready")
    .limit(1);
  if (error) throw mapDbError(error);
  const row = data?.[0];
  if (!row) return null;
  const r = obj(row.result);
  const strategy = obj(r.strategy);
  const projectPriorities = arr(strategy.project_priorities).flatMap((raw, n) => {
    const p = obj(raw);
    const projectId = str(p.project_id);
    if (!projectId) return [];
    return [{ project_id: projectId, rank: typeof p.rank === "number" ? p.rank : n + 1, reason: str(p.reason) ?? "" }];
  });
  const requirementStatuses = arr(r.requirement_matches).flatMap((raw) => {
    const m = obj(raw);
    const id = str(m.requirement_id);
    const status = str(m.status);
    if (!id || (status !== "met" && status !== "partial" && status !== "no_evidence")) return [];
    return [{ requirement_id: id, status: status as "met" | "partial" | "no_evidence" }];
  });
  const strengths = arr(r.strengths).flatMap((raw) => {
    const s = obj(raw);
    const title = str(s.title);
    return title ? [{ title, description: str(s.description) ?? "" }] : [];
  });
  return { insightId: row.id, positioning: str(strategy.positioning), projectPriorities, requirementStatuses, strengths };
}

/** Career rows through the given client (complete rows only). */
export type LoadCareerRows = (db: Client) => Promise<CareerRows>;

// ---------------- RPCs (app_ai_writer) ----------------

export class DraftRpcError extends Error {
  constructor(
    readonly raise: string | null,
    readonly appError: AppError,
  ) {
    super(`draft rpc failed: ${raise ?? "db_error"}`);
    this.name = "DraftRpcError";
  }
}

function rpcFailure(error: RpcError): DraftRpcError {
  return new DraftRpcError(raiseName(error), mapDbError(error));
}

export type BegunCareerDescription = {
  draftId: string;
  reopened: boolean;
  sections: Array<{ sectionId: string; sortOrder: number; sectionKind: string; experienceId: string | null; educationId: string | null; heading: string | null }>;
};

export type BegunCoverLetterSection = { sectionId: string; draftId: string; generationNo: number; sourceSelectionMode: "ai" | "user"; reopened: boolean };

export type CompleteResult = { applied: boolean };

export interface DraftStore {
  beginCareerDescription(args: {
    applicationProjectId: string;
    jobId: string;
    options: unknown;
    sections: unknown;
    insightId: string | null;
    regeneratedFromId: string | null;
  }): Promise<BegunCareerDescription>;
  completeCareerDescription(args: { draftId: string; jobId: string; runGeneration: number; payload: unknown }): Promise<CompleteResult>;
  failCareerDescription(draftId: string, jobId: string): Promise<boolean>;
  beginCoverLetterSection(sectionId: string, jobId: string): Promise<BegunCoverLetterSection>;
  completeCoverLetterSection(args: { sectionId: string; jobId: string; runGeneration: number; payload: unknown }): Promise<CompleteResult>;
  failDraftSection(sectionId: string, jobId: string): Promise<boolean>;
}

export function createDraftStore(writer: AiWriterSupabaseClient): DraftStore {
  return {
    async beginCareerDescription(a) {
      const { data, error } = await writer.rpc("begin_career_description", {
        p_application_project_id: a.applicationProjectId,
        p_ai_job_id: a.jobId,
        p_options: a.options as Json,
        p_sections: a.sections as Json,
        p_insight_id: a.insightId ?? undefined,
        p_regenerated_from_id: a.regeneratedFromId ?? undefined,
      });
      if (error) throw rpcFailure(error);
      const r = obj(data);
      const draftId = str(r.draft_id);
      if (!draftId) throw new DraftRpcError(null, new AppError("internal_error", undefined, { status: 500 }));
      return {
        draftId,
        reopened: r.reopened === true,
        sections: arr(r.sections).map((raw) => {
          const s = obj(raw);
          return {
            sectionId: str(s.section_id) ?? "",
            sortOrder: typeof s.sort_order === "number" ? s.sort_order : 0,
            sectionKind: str(s.section_kind) ?? "",
            experienceId: str(s.experience_id),
            educationId: str(s.education_id),
            heading: str(s.heading),
          };
        }),
      };
    },
    async completeCareerDescription(a) {
      const { data, error } = await writer.rpc("complete_career_description", {
        p_draft_id: a.draftId,
        p_ai_job_id: a.jobId,
        p_run_generation: a.runGeneration,
        p_payload: a.payload as Json,
      });
      if (error) throw rpcFailure(error);
      return { applied: obj(data).applied === true };
    },
    async failCareerDescription(draftId, jobId) {
      const { data, error } = await writer.rpc("fail_career_description", { p_draft_id: draftId, p_ai_job_id: jobId });
      if (error) throw rpcFailure(error);
      return data === true;
    },
    async beginCoverLetterSection(sectionId, jobId) {
      const { data, error } = await writer.rpc("begin_cover_letter_section", { p_section_id: sectionId, p_ai_job_id: jobId });
      if (error) throw rpcFailure(error);
      const r = obj(data);
      return {
        sectionId: str(r.section_id) ?? sectionId,
        draftId: str(r.draft_id) ?? "",
        generationNo: typeof r.generation_no === "number" ? r.generation_no : 0,
        sourceSelectionMode: r.source_selection_mode === "user" ? "user" : "ai",
        reopened: r.reopened === true,
      };
    },
    async completeCoverLetterSection(a) {
      const { data, error } = await writer.rpc("complete_cover_letter_section", {
        p_section_id: a.sectionId,
        p_ai_job_id: a.jobId,
        p_run_generation: a.runGeneration,
        p_payload: a.payload as Json,
      });
      if (error) throw rpcFailure(error);
      return { applied: obj(data).applied === true };
    },
    async failDraftSection(sectionId, jobId) {
      const { data, error } = await writer.rpc("fail_draft_section", { p_section_id: sectionId, p_ai_job_id: jobId });
      if (error) throw rpcFailure(error);
      return data === true;
    },
  };
}
