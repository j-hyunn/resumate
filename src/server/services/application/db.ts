import type { AiProvider } from "@/lib/contracts/enums";
import { AppError } from "@/lib/contracts/errors";
import type { JdSentence } from "@/server/ai/context-pack/jd";
import type { Json } from "@/server/db/database.types";
import { mapDbError } from "@/server/db/errors";
import type { AiWriterSupabaseClient, UserSupabaseClient } from "@/server/db/types";
import type { JdExtractionDb, JdForExtraction } from "./extraction";

/**
 * Supabase implementation of `JdExtractionDb` (db notes S5): the JD is read
 * through the user session (RLS = ownership); begin / apply / fail are
 * app_ai_writer RPCs (DM-13: AI writes only through app_ai_writer).
 */

/** jsonb `sentences` → typed list (the DB checks the structure; malformed members are dropped). */
export function parseSentences(value: Json | null | undefined): JdSentence[] {
  if (!Array.isArray(value)) return [];
  const out: JdSentence[] = [];
  for (const item of value) {
    if (!item || typeof item !== "object" || Array.isArray(item)) continue;
    const s = item as Record<string, unknown>;
    if (typeof s.sid === "string" && typeof s.text === "string" && typeof s.start === "number" && typeof s.end === "number") {
      out.push({ sid: s.sid, text: s.text, start: s.start, end: s.end });
    }
  }
  return out;
}

const JD_EXTRACTION_COLUMNS =
  "id, application_project_id, extraction_status, sentences, company_name, company_name_source, position_title, position_title_source";

export function createJdExtractionDb(user: UserSupabaseClient, writer: AiWriterSupabaseClient): JdExtractionDb {
  return {
    async load(applicationProjectId): Promise<JdForExtraction | null> {
      const { data, error } = await user.from("job_descriptions").select(JD_EXTRACTION_COLUMNS).eq("application_project_id", applicationProjectId).maybeSingle();
      if (error) throw mapDbError(error);
      if (!data) return null;
      return {
        applicationProjectId: data.application_project_id,
        jobDescriptionId: data.id,
        extractionStatus: data.extraction_status as JdForExtraction["extractionStatus"],
        sentences: parseSentences(data.sentences),
        companyName: data.company_name,
        companyNameSource: data.company_name_source as JdForExtraction["companyNameSource"],
        positionTitle: data.position_title,
        positionTitleSource: data.position_title_source as JdForExtraction["positionTitleSource"],
      };
    },

    async begin(jobDescriptionId, jobId) {
      const { error } = await writer.rpc("begin_jd_extraction", { p_job_description_id: jobDescriptionId, p_ai_job_id: jobId });
      if (error) throw mapDbError(error);
    },

    async apply(args: { jobDescriptionId: string; jobId: string; runGeneration: number; payload: unknown; provider: AiProvider; model: string }) {
      const { data, error } = await writer.rpc("apply_jd_extraction", {
        p_job_description_id: args.jobDescriptionId,
        p_ai_job_id: args.jobId,
        p_run_generation: args.runGeneration,
        p_result: args.payload as Json,
        p_provider: args.provider,
        p_model: args.model,
      });
      if (error) throw mapDbError(error);
      const row = (data ?? {}) as { applied?: unknown };
      return { applied: row.applied === true };
    },

    async fail(jobDescriptionId, jobId) {
      const { data, error } = await writer.rpc("fail_jd_extraction", { p_job_description_id: jobDescriptionId, p_ai_job_id: jobId });
      if (error) throw mapDbError(error);
      return data === true;
    },
  };
}

/** Throws `not_found` unless the project exists for this user (RLS). */
export async function assertApplicationProjectOwned(user: UserSupabaseClient, applicationProjectId: string): Promise<void> {
  const { data, error } = await user.from("application_projects").select("id").eq("id", applicationProjectId).maybeSingle();
  if (error) throw mapDbError(error);
  if (!data) throw new AppError("not_found", "기업 JD를 찾을 수 없습니다. 새로고침 후 다시 시도해 주세요.", { status: 404 });
}
