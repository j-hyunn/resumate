import type { z } from "zod";
import {
  applicationDisplayName,
  jdInputWarnings,
  type CreateApplicationProjectInput,
  type CreateApplicationProjectResult,
  type DeleteApplicationProjectResult,
  type InterviewPrompt,
  type MoveApplicationStageInput,
  type MoveApplicationStageResult,
  type SetApplicationOutcomeInput,
  type StageChangeResult,
  type UpdateApplicationProjectInput,
} from "@/lib/contracts/application";
import type { ApplicationStage, JdExtractionStatus, NameSource, StageOutcome } from "@/lib/contracts/enums";
import { AppError } from "@/lib/contracts/errors";
import { splitJdSentences } from "@/server/ai/context-pack/jd";
import { sha256Hex } from "@/server/ai/hash";
import type { Json } from "@/server/db/database.types";
import { mapDbError } from "@/server/db/errors";
import type { UserSupabaseClient } from "@/server/db/types";
import { requestCancel } from "@/server/services/ai-jobs";

/**
 * S5 writes through the user session (DM §5: career-side writes are the
 * user's; the RPCs are definer with an auth.uid() owner check). No AI call
 * here (F-ST-04: stage moves never call AI). Creation is separate from
 * extraction, so saving the raw JD always succeeds (PRD "원문 저장은 성공,
 * 추출은 실패 안내"); `shouldExtract` tells the screen to call the sync route.
 */

const notFound = () => new AppError("not_found", "기업 JD를 찾을 수 없습니다. 새로고침 후 다시 시도해 주세요.", { status: 404 });

function obj(data: unknown): Record<string, unknown> {
  return data && typeof data === "object" && !Array.isArray(data) ? (data as Record<string, unknown>) : {};
}
function str(v: unknown): string | null {
  return typeof v === "string" ? v : null;
}

// ---------------- create (S-14) ----------------

export async function createApplicationProject(
  supabase: UserSupabaseClient,
  input: z.output<typeof CreateApplicationProjectInput>,
): Promise<CreateApplicationProjectResult> {
  // C-2: deterministic server split; offsets index the raw text exactly as stored (never trimmed).
  const sentences = splitJdSentences(input.rawText);
  const { data, error } = await supabase.rpc("create_application_project", {
    p_id: input.id,
    p_raw_text: input.rawText,
    p_raw_text_hash: sha256Hex(input.rawText),
    p_sentences: sentences as unknown as Json,
    ...(input.companyName ? { p_company_name: input.companyName } : {}),
    ...(input.positionTitle ? { p_position_title: input.positionTitle } : {}),
    ...(input.name ? { p_name: input.name } : {}),
    ...(input.deadline ? { p_deadline: input.deadline } : {}),
  });
  if (error) throw mapDbError(error);
  const row = obj(data);
  const applicationProjectId = str(row.application_project_id);
  const jobDescriptionId = str(row.job_description_id);
  if (!applicationProjectId || !jobDescriptionId) throw new AppError("internal_error", undefined, { status: 500 });
  const name = str(row.name);
  const extractionStatus = (str(row.extraction_status) ?? "pending") as JdExtractionStatus;
  return {
    applicationProjectId,
    jobDescriptionId,
    name,
    nameSource: str(row.name_source) as NameSource | null,
    displayName: applicationDisplayName(name, input.companyName ?? null, input.positionTitle ?? null),
    extractionStatus,
    // The DB applies the same rule as check_ai_run_allowed (active provider, key not invalid, consent).
    shouldExtract: row.ai_run_allowed === true && (extractionStatus === "pending" || extractionStatus === "failed"),
    created: row.created !== false,
    warnings: jdInputWarnings(input.rawText),
  };
}

// ---------------- update (S-31 inline edit) ----------------

export async function updateApplicationProject(
  supabase: UserSupabaseClient,
  input: z.output<typeof UpdateApplicationProjectInput>,
): Promise<{ id: string; name: string | null; nameSource: NameSource | null; deadline: string | null; memo: string | null; lastActivityAt: string }> {
  const patch: { name?: string; deadline?: string | null; memo?: string | null } = {};
  if (input.name !== undefined) patch.name = input.name;
  if (input.deadline !== undefined) patch.deadline = input.deadline;
  if (input.memo !== undefined) patch.memo = input.memo;
  const { data, error } = await supabase
    .from("application_projects")
    .update(patch)
    .eq("id", input.id)
    .select("id, name, name_source, deadline, memo, last_activity_at")
    .maybeSingle();
  if (error) throw mapDbError(error);
  if (!data) throw notFound();
  return {
    id: data.id,
    name: data.name,
    nameSource: data.name_source as NameSource | null,
    deadline: data.deadline,
    memo: data.memo,
    lastActivityAt: data.last_activity_at,
  };
}

// ---------------- delete (FL-06) ----------------

/**
 * F-AP-05 / FL-06: request cancel on the project's in-flight AI jobs, then
 * delete (cascade: JD, requirements, stage events, ai_jobs, evidence_links;
 * ai_usage_records keep their rows with application_project_id null). A runner
 * still holding a deleted job sees zero-row writes and stops as canceled.
 */
export async function deleteApplicationProject(supabase: UserSupabaseClient, id: string): Promise<DeleteApplicationProjectResult> {
  const { data: jobs, error: jobsError } = await supabase
    .from("ai_jobs")
    .select("id")
    .eq("application_project_id", id)
    .in("status", ["queued", "running"]);
  if (jobsError) throw mapDbError(jobsError);
  let canceledJobs = 0;
  for (const job of jobs ?? []) {
    try {
      await requestCancel(supabase, job.id);
      canceledJobs++;
    } catch (err) {
      // Finished meanwhile: nothing to cancel. Anything else still lets the delete proceed (cascade).
      if (!(err instanceof AppError)) throw err;
    }
  }
  const { data, error } = await supabase.from("application_projects").delete().eq("id", id).select("id");
  if (error) throw mapDbError(error);
  if (!data || data.length === 0) throw notFound();
  return { applicationProjectId: id, canceledJobs };
}

// ---------------- stage (C-12 / C-13 / C-14) ----------------

function toStageChange(id: string, row: Record<string, unknown>): StageChangeResult {
  const stage = str(row.stage);
  const changedAt = str(row.stage_changed_at);
  if (!stage || !changedAt) throw new AppError("internal_error", undefined, { status: 500 });
  return {
    applicationProjectId: id,
    stage: stage as ApplicationStage,
    stageOutcome: str(row.stage_outcome) as StageOutcome | null,
    stageChangedAt: changedAt,
    changed: row.changed === true,
  };
}

function toInterviewPrompt(value: unknown): InterviewPrompt | null {
  const p = obj(value);
  const type = str(p.interview_type);
  if (type !== "job" && type !== "culture_fit") return null;
  const session = obj(p.in_progress_session);
  const sessionId = str(session.session_id);
  const sessionType = str(session.interview_type);
  const generation = str(session.generation_status);
  return {
    interviewType: type,
    inProgressSessionId: str(p.in_progress_session_id),
    inProgressSession:
      sessionId && (sessionType === "job" || sessionType === "culture_fit")
        ? {
            sessionId,
            interviewType: sessionType,
            answeredCount: typeof session.answered_count === "number" ? session.answered_count : 0,
            questionCount: typeof session.question_count === "number" ? session.question_count : 0,
            generationStatus: generation === "ready" || generation === "failed" ? generation : "generating",
            lastActivityAt: str(session.last_activity_at),
          }
        : null,
  };
}

export async function moveApplicationStage(
  supabase: UserSupabaseClient,
  input: z.output<typeof MoveApplicationStageInput>,
): Promise<MoveApplicationStageResult> {
  const { data, error } = await supabase.rpc("move_application_stage", {
    p_application_project_id: input.id,
    p_to_stage: input.toStage,
    ...(input.outcome ? { p_outcome: input.outcome } : {}),
  });
  if (error) throw mapDbError(error);
  const row = obj(data);
  return { ...toStageChange(input.id, row), interviewPrompt: toInterviewPrompt(row.interview_prompt) };
}

export async function setApplicationOutcome(
  supabase: UserSupabaseClient,
  input: z.output<typeof SetApplicationOutcomeInput>,
): Promise<StageChangeResult> {
  const { data, error } = await supabase.rpc("set_application_outcome", {
    p_application_project_id: input.id,
    // null clears the result (C-13 닫기 → 결과 미기록).
    p_outcome: input.outcome as string,
  });
  if (error) throw mapDbError(error);
  return toStageChange(input.id, obj(data));
}

