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

/** Impact shape by entity type: `writing_chat` → `{ message_count, last_applied_at }` (DM §4.2 v4.4). */
export type DeletionImpactFor<T extends DeletableEntityType> = T extends "writing_chat" ? WritingChatDeletionImpact : CareerDeletionImpact;

export async function getDeletionImpact<T extends DeletableEntityType>(
  supabase: UserSupabaseClient,
  input: { entityType: T; entityId: string; affiliationMode?: AffiliationMode },
): Promise<DeletionImpactFor<T>> {
  const { data, error } = await supabase.rpc("get_deletion_impact", {
    p_entity_type: input.entityType,
    p_entity_id: input.entityId,
    p_affiliation_mode: input.affiliationMode ?? "delete_projects",
  });
  if (error) throw mapDbError(error);
  const schema = input.entityType === "writing_chat" ? WritingChatDeletionImpact : CareerDeletionImpact;
  return parseRpc(schema, data) as DeletionImpactFor<T>;
}

/**
 * C-05 delete (DM §4.1–4.2 v4.4). An experience / education takes its projects (→ chats) with it
 * (FK cascade, CR-15); a project its deliverables / skill links / chats. A chat's in-flight turn
 * job gets a cancel request (DB trigger).
 */
export async function deleteCareerItem(
  supabase: UserSupabaseClient,
  input: { entityType: DeletableEntityType; entityId: string; affiliationMode?: AffiliationMode; resultMode: ResultMode },
): Promise<DeleteCareerItemResponse> {
  const { data, error } = await supabase.rpc("delete_career_item", {
    p_entity_type: input.entityType,
    p_entity_id: input.entityId,
    p_affiliation_mode: input.affiliationMode ?? "delete_projects",
    p_result_mode: input.resultMode,
  });
  if (error) throw mapDbError(error);
  return parseRpc(DeleteCareerItemResult, data);
}

/** S-43 deliverable order ([가정] DM 2.3). The list must be every deliverable of the project (`invalid_deliverable_order`). */
export async function reorderProjectDeliverables(
  supabase: UserSupabaseClient,
  input: { projectId: string; orderedIds: string[] },
): Promise<{ projectId: string; orderedIds: string[] }> {
  const { error } = await supabase.rpc("reorder_project_deliverables", {
    p_project_id: input.projectId,
    p_ordered_ids: input.orderedIds,
  });
  if (error) throw mapDbError(error);
  return { projectId: input.projectId, orderedIds: input.orderedIds };
}
