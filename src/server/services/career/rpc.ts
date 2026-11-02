import type { z } from "zod";
import {
  CareerDeletionImpact,
  DataReadiness,
  DeleteCareerItemResult,
  WritingChatDeletionImpact,
  type DeleteCareerItemResponse,
} from "@/lib/contracts/career";
import type { AffiliationMode, DeletableEntityType, ResultMode } from "@/lib/contracts/enums";
import { AppError } from "@/lib/contracts/errors";
import { mapDbError } from "@/server/db/errors";
import type { AiWriterSupabaseClient, UserSupabaseClient } from "@/server/db/types";
import { SAVE_RESULT_COLUMNS } from "./mappers";
import { toSaveResult } from "./save";

/**
 * Career RPC wrappers (DM §4.2, §6, §7). Argument names match the migrations
 * (db-engineer notes); jsonb results are validated with zod so a DB/contract
 * drift fails loudly as internal_error instead of reaching the screen.
 */

function parseRpc<S extends z.ZodType>(schema: S, data: unknown): z.infer<S> {
  const parsed = schema.safeParse(data);
  if (!parsed.success) throw new AppError("internal_error", undefined, { status: 500, cause: parsed.error });
  return parsed.data;
}

/** DM §6. Callable as the user (C-09/C-10) or as app_ai_writer (AI handlers re-check). */
export async function getDataReadiness(supabase: UserSupabaseClient | AiWriterSupabaseClient): Promise<DataReadiness> {
  const { data, error } = await supabase.rpc("get_data_readiness");
  if (error) throw mapDbError(error);
  return parseRpc(DataReadiness, data);
}

/** Impact shape by entity type: `writing_chat` → `{ message_count, linked_saved_rows }` (S4, DM §4.2). */
export type DeletionImpactFor<T extends DeletableEntityType> = T extends "writing_chat" ? WritingChatDeletionImpact : CareerDeletionImpact;

export async function getDeletionImpact<T extends DeletableEntityType>(
  supabase: UserSupabaseClient,
  input: { entityType: T; entityId: string; affiliationMode: AffiliationMode },
): Promise<DeletionImpactFor<T>> {
  const { data, error } = await supabase.rpc("get_deletion_impact", {
    p_entity_type: input.entityType,
    p_entity_id: input.entityId,
    p_affiliation_mode: input.affiliationMode,
  });
  if (error) throw mapDbError(error);
  const schema = input.entityType === "writing_chat" ? WritingChatDeletionImpact : CareerDeletionImpact;
  return parseRpc(schema, data) as DeletionImpactFor<T>;
}

/**
 * C-05 delete. Also returns the current state of projects the delete touched
 * (QA-S2-04): the parent of a deleted detail (its status may flip), or the
 * projects a kept-projects experience/education delete turned standalone.
 */
export async function deleteCareerItem(
  supabase: UserSupabaseClient,
  input: { entityType: DeletableEntityType; entityId: string; affiliationMode: AffiliationMode; resultMode: ResultMode },
): Promise<DeleteCareerItemResponse> {
  const touched = await projectsTouchedBy(supabase, input);
  const { data, error } = await supabase.rpc("delete_career_item", {
    p_entity_type: input.entityType,
    p_entity_id: input.entityId,
    p_affiliation_mode: input.affiliationMode,
    p_result_mode: input.resultMode,
  });
  if (error) throw mapDbError(error);
  const result = parseRpc(DeleteCareerItemResult, data);
  if (touched.length === 0) return { ...result, updatedProjects: [] };
  const after = await supabase.from("projects").select(SAVE_RESULT_COLUMNS).in("id", touched).order("id");
  if (after.error) throw mapDbError(after.error);
  return { ...result, updatedProjects: (after.data ?? []).map(toSaveResult) };
}

async function projectsTouchedBy(
  supabase: UserSupabaseClient,
  input: { entityType: DeletableEntityType; entityId: string; affiliationMode: AffiliationMode },
): Promise<string[]> {
  if (input.entityType === "project_detail") {
    const res = await supabase.from("project_details").select("project_id").eq("id", input.entityId).maybeSingle();
    if (res.error) throw mapDbError(res.error);
    return res.data ? [res.data.project_id] : [];
  }
  if ((input.entityType === "experience" || input.entityType === "education") && input.affiliationMode === "keep_projects") {
    const column = input.entityType === "experience" ? "experience_id" : "education_id";
    const res = await supabase.from("projects").select("id").eq(column, input.entityId);
    if (res.error) throw mapDbError(res.error);
    return (res.data ?? []).map((r) => r.id);
  }
  return [];
}

/** S-10 reorder. The list must be every detail of the project (else `invalid_detail_order`, 409). */
export async function reorderProjectDetails(
  supabase: UserSupabaseClient,
  input: { projectId: string; orderedIds: string[] },
): Promise<{ projectId: string; orderedIds: string[] }> {
  const { error } = await supabase.rpc("reorder_project_details", {
    p_project_id: input.projectId,
    p_ordered_ids: input.orderedIds,
  });
  if (error) throw mapDbError(error);
  return { projectId: input.projectId, orderedIds: input.orderedIds };
}
