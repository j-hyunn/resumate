import type { z } from "zod";
import {
  applicationDisplayName,
  isValidSourceUrl,
  jdInputWarnings,
  type CreateApplicationProjectInput,
  type CreateApplicationProjectResult,
  type DeleteApplicationProjectResult,
  type MoveApplicationStageInput,
  type MoveApplicationStageResult,
  type SetApplicationOutcomeInput,
  type StageChangeResult,
  type UpdateApplicationProjectInput,
  type UpdateJdRawTextInput,
  type UpdateJdRawTextResult,
} from "@/lib/contracts/application";
import type { ApplicationStage, NameSource, StageOutcome } from "@/lib/contracts/enums";
import { AppError } from "@/lib/contracts/errors";
import { splitJdSentences } from "@/server/ai/context-pack/jd";
import { sha256Hex } from "@/server/ai/hash";
import type { Json } from "@/server/db/database.types";
import { mapDbError } from "@/server/db/errors";
import type { UserSupabaseClient } from "@/server/db/types";
import { requestCancel } from "@/server/services/ai-jobs";
import { normalizeJdRawText } from "./raw-text";

/**
 * S5 writes through the user session (DM §5: career-side writes are the
 * user's; the RPCs are definer with an auth.uid() owner check). No AI call
 * here (F-ST-04: stage moves never call AI). R17: the JD is stored as raw
 * text only and creation needs no AI connection (`create_application_project` has no key /
 * consent gate, 4.24 #9). The automatic insight start after creation (JR-6) is a separate step
 * of the create Server Action (`services/insight/auto-start.ts`), never inside the RPC.
 */

const notFound = () => new AppError("not_found", "자기소개서를 찾을 수 없습니다. 새로고침 후 다시 시도해 주세요.", { status: 404 });

function obj(data: unknown): Record<string, unknown> {
  return data && typeof data === "object" && !Array.isArray(data) ? (data as Record<string, unknown>) : {};
}
function str(v: unknown): string | null {
  return typeof v === "string" ? v : null;
}

// ---------------- create (S-14) ----------------

/** The RPC part of S-14 만들기; the action adds `insightJobId` / `insightSkipReason`. */
export type CreatedApplicationProject = Omit<CreateApplicationProjectResult, "insightJobId" | "insightSkipReason">;

export async function createApplicationProject(
  supabase: UserSupabaseClient,
  input: z.output<typeof CreateApplicationProjectInput>,
): Promise<CreatedApplicationProject> {
  // A3 (R15): one normalized string feeds the split, the hash and the stored raw text (the raw-text
  // edit path uses the same function).
  const rawText = normalizeJdRawText(input.rawText);
  // C-2: deterministic server split; offsets index the raw text exactly as stored (never trimmed).
  const sentences = splitJdSentences(rawText);
  if (input.sourceUrl && !isValidSourceUrl(input.sourceUrl)) {
    // Same rule as `job_descriptions_source_url_check` (scheme any case, ≤ 2,048); caught before the
    // RPC so no row is attempted. Its own code, never `invalid_input` (UQ-759).
    throw new AppError("invalid_source_url", "공고 주소를 확인해 주세요. http 또는 https로 시작하는 주소만 가져올 수 있어요.", { status: 400 });
  }
  const { data, error } = await supabase.rpc("create_application_project", {
    p_id: input.id,
    p_raw_text: rawText,
    p_raw_text_hash: sha256Hex(rawText),
    p_sentences: sentences as unknown as Json,
    ...(input.companyName ? { p_company_name: input.companyName } : {}),
    ...(input.positionTitle ? { p_position_title: input.positionTitle } : {}),
    ...(input.name ? { p_name: input.name } : {}),
    ...(input.deadline ? { p_deadline: input.deadline } : {}),
    ...(input.sourceUrl ? { p_source_url: input.sourceUrl } : {}),
  });
  if (error) throw mapDbError(error);
  const row = obj(data);
  const applicationProjectId = str(row.application_project_id);
  const jobDescriptionId = str(row.job_description_id);
  if (!applicationProjectId || !jobDescriptionId) throw new AppError("internal_error", undefined, { status: 500 });
  const name = str(row.name);
  return {
    applicationProjectId,
    jobDescriptionId,
    name,
    nameSource: str(row.name_source) as NameSource | null,
    displayName: applicationDisplayName(name, input.companyName ?? null, input.positionTitle ?? null),
    created: row.created !== false,
    warnings: jdInputWarnings(rawText),
  };
}

// ---------------- raw text edit (S-15, JR-7) ----------------

/**
 * DM 2.6.1 (v4.16, JR-7): the raw text can be edited at any time except while an insight job is
 * queued / running. Sentences and hash come from the same server code as creation. Refusals:
 * `jd_no_sentences` (400), `jd_job_in_progress` / `jd_raw_text_unchanged` (409), `not_found`
 * (404), `invalid_input` (400). Existing insights and their evidence stay — they read
 * "공고가 바뀌었어요" (`staleReasons.rawText`). No AI call and no key needed.
 */
export async function updateJdRawText(supabase: UserSupabaseClient, input: z.output<typeof UpdateJdRawTextInput>): Promise<UpdateJdRawTextResult> {
  // A3 (R15): the edit path normalizes with the same function as creation.
  const rawText = normalizeJdRawText(input.rawText);
  const { data, error } = await supabase.rpc("update_jd_raw_text", {
    p_application_project_id: input.id,
    p_raw_text: rawText,
    p_raw_text_hash: sha256Hex(rawText),
    p_sentences: splitJdSentences(rawText) as unknown as Json,
  });
  if (error) throw mapDbError(error);
  const row = obj(data);
  const jobDescriptionId = str(row.job_description_id);
  const rawTextEditedAt = str(row.raw_text_edited_at);
  if (!jobDescriptionId || !rawTextEditedAt) throw new AppError("internal_error", undefined, { status: 500 });
  return { applicationProjectId: input.id, jobDescriptionId, rawTextEditedAt, warnings: jdInputWarnings(rawText) };
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
 * delete (cascade: JD, stage events, insights, ai_jobs, evidence_links;
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
  return toStageChange(input.id, row);
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

