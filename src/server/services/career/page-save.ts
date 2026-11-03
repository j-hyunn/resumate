import type { z } from "zod";
import {
  SaveProjectDeliverableRpcResult,
  SaveProjectPageRpcResult,
  type ProjectPageValues,
  type SaveProjectDeliverableInput,
  type SaveProjectDeliverableResult,
  type SaveProjectPageInput,
  type SaveProjectPageResult,
} from "@/lib/contracts/career";
import { AppError } from "@/lib/contracts/errors";
import type { Json } from "@/server/db/database.types";
import { mapDbError } from "@/server/db/errors";
import type { UserSupabaseClient } from "@/server/db/types";

/**
 * Page save (DM 2.5.1 v4.5 ★, PA-3): S-10 / S-44 "저장하기" = one RPC call (security invoker, user
 * session, no AI / key / consent). The RPC writes the career row and, in the same transaction, the
 * "반영됨" record of every proposal the screen filled into the form this visit; a record that fails
 * comes back in `skipped` and never blocks the save. Rule violations come back as field-specific
 * codes (`mapDbError`: `field_too_long` / `invalid_period` / `invalid_classification` → `{field}`,
 * `stale_write` → `{current_updated_at}`). Nothing here logs the values (NFR-PRV-09).
 */

function internal(cause: unknown): AppError {
  return new AppError("internal_error", undefined, { status: 500, cause });
}

/** Contract camelCase → `p_values` keys. Omitted keys stay omitted (= keep the stored value). */
const PAGE_VALUE_KEYS = {
  name: "name",
  experienceId: "experience_id",
  educationId: "education_id",
  startMonth: "start_month",
  endMonth: "end_month",
  isCurrent: "is_current",
  projectType: "project_type",
  experienceType: "experience_type",
  competencies: "competencies",
  situation: "situation",
  task: "task",
  action: "action",
  result: "result",
  learnings: "learnings",
} as const satisfies Record<keyof z.output<typeof ProjectPageValues>, string>;

export function toPageValues(values: z.output<typeof ProjectPageValues>): Record<string, Json> {
  const out: Record<string, Json> = {};
  for (const [key, column] of Object.entries(PAGE_VALUE_KEYS)) {
    const v = values[key as keyof typeof PAGE_VALUE_KEYS];
    if (v !== undefined) out[column] = v as Json;
  }
  return out;
}

/**
 * Generated types mark every RPC argument as required non-null; these ids are nullable on create
 * (db notes "생성 타입 주의"), so the null goes through this one cast.
 */
const nullableArg = (v: string | null): string => v as string;

/** S-10 "저장하기" (create when `projectId` is null). */
export async function saveProjectPage(supabase: UserSupabaseClient, input: z.output<typeof SaveProjectPageInput>): Promise<SaveProjectPageResult> {
  const applied = input.appliedProposals?.map((p) => ({ writing_chat_id: p.writingChatId, field: p.field, rev: p.rev }));
  const { data, error } = await supabase.rpc("save_project_page", {
    p_project_id: nullableArg(input.projectId),
    p_values: toPageValues(input.values),
    ...(input.expectedUpdatedAt ? { p_expected_updated_at: input.expectedUpdatedAt } : {}),
    ...(applied && applied.length > 0 ? { p_applied_proposals: applied } : {}),
  });
  if (error) throw mapDbError(error);
  const parsed = SaveProjectPageRpcResult.safeParse(data);
  if (!parsed.success) throw internal(parsed.error);
  const r = parsed.data;
  return {
    projectId: r.project_id,
    status: r.status,
    updatedAt: r.updated_at,
    applied: r.applied.map((a) => ({ writingChatId: a.writing_chat_id, field: a.field })),
    skipped: r.skipped.map((s) => ({ writingChatId: s.writing_chat_id, field: s.field, reason: s.reason })),
  };
}

/** S-44 "저장하기" (create when `projectDeliverableId` is null; `projectId` = the standalone parent). */
export async function saveProjectDeliverable(
  supabase: UserSupabaseClient,
  input: z.output<typeof SaveProjectDeliverableInput>,
): Promise<SaveProjectDeliverableResult> {
  const applied = input.appliedProposals?.map((p) => ({ writing_chat_id: p.writingChatId, rev: p.rev, mode: p.mode }));
  const { data, error } = await supabase.rpc("save_project_deliverable", {
    p_project_deliverable_id: nullableArg(input.projectDeliverableId),
    p_project_id: nullableArg(input.projectId),
    p_title: input.title,
    p_body: nullableArg(input.body),
    ...(input.expectedUpdatedAt ? { p_expected_updated_at: input.expectedUpdatedAt } : {}),
    ...(applied && applied.length > 0 ? { p_applied_proposals: applied } : {}),
  });
  if (error) throw mapDbError(error);
  const parsed = SaveProjectDeliverableRpcResult.safeParse(data);
  if (!parsed.success) throw internal(parsed.error);
  const r = parsed.data;
  return {
    projectDeliverableId: r.project_deliverable_id,
    projectId: r.project_id,
    sortOrder: r.sort_order,
    updatedAt: r.updated_at,
    applied: r.applied.map((a) => ({ writingChatId: a.writing_chat_id })),
    skipped: r.skipped.map((s) => ({ writingChatId: s.writing_chat_id, reason: s.reason })),
  };
}
