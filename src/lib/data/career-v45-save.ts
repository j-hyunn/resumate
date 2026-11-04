/**
 * S-10 / S-44 page save ↔ `save_project_page` / `save_project_deliverable` (DM v4.5 2.5.1) — the pure
 * mapping between the screen's snake_case contract (`./career-v45-shared`) and the service contract
 * (`@/lib/contracts/career`, camelCase). Unit-tested in career-v45-save.test.ts; `career-v45.ts` calls the
 * RPCs through `./page-save-v45`.
 *
 * - `client_id` of a new page is not sent: the RPCs create the row with their own id. A retry after a lost
 *   response can therefore create a second row ([가정] R5 wiring, spec-gaps R5-W-1).
 * - `p_applied_proposals` is recorded by the RPC: `applied` / `skipped` come back as the RPC judged them.
 */
import type { z } from "zod"
import type {
  SaveProjectDeliverableInput as ContractDeliverableInput,
  SaveProjectDeliverableResult as ContractDeliverableResult,
  SaveProjectPageInput as ContractPageInput,
  SaveProjectPageResult as ContractPageResult,
} from "@/lib/contracts/career"
import { isAppError } from "@/lib/contracts/errors"
import type { ProjectProposalField } from "./career-v45-shared"
import type {
  PageSaveError,
  SaveProjectDeliverableInput,
  SaveProjectDeliverableResult,
  SaveProjectPageInput,
  SaveProjectPageResult,
} from "./career-v45-shared"

/** camelCase contract key (zod / old services) → the DM key the screen attaches the message to. */
const FIELD_KEYS: Record<string, string> = {
  startMonth: "start_month",
  endMonth: "end_month",
  isCurrent: "is_current",
  projectType: "project_type",
  experienceType: "experience_type",
  experienceId: "experience_id",
  educationId: "education_id",
}

/** RPC refusal codes the screens have copy for (DM 2.5.1), passed through as is. */
const PASS_THROUGH = new Set<string>([
  "not_found",
  "stale_write",
  "project_name_required",
  "project_affiliation_required",
  "project_not_affiliated",
  "deliverable_title_required",
  "invalid_period",
  "invalid_classification",
  "invalid_fields",
  "field_too_long",
  "project_scope_change_not_allowed",
  "deliverable_limit_reached",
  "deliverable_requires_standalone_project",
])

/** AppError (`mapDbError` details `{field}` / `{current_updated_at}`) → the screen's refusal. Anything else → `save_failed`. */
export function saveErrorOf(err: unknown): PageSaveError {
  if (!isAppError(err)) return { code: "save_failed" }
  const raw = (err.details?.field as string | undefined) ?? null
  const field = raw ? (FIELD_KEYS[raw] ?? raw) : null
  if (err.code === "stale_write" || err.code === "conflict") return { code: "stale_write", current_updated_at: (err.details?.current_updated_at as string | undefined) ?? null }
  if (PASS_THROUGH.has(err.code)) return { code: err.code as PageSaveError["code"], field }
  return { code: "save_failed", field }
}

const ym = (d: string | null) => (d ? d.slice(0, 7) : null)
const text = (s: string | null) => (s == null || s.trim() === "" ? null : s)

/** S-10: the whole page (DM 2.5.1 "화면은 페이지 전체를 보낸다"), months as 'YYYY-MM'. */
export function toSaveProjectPageInput(input: SaveProjectPageInput): z.input<typeof ContractPageInput> {
  const v = input.values
  return {
    projectId: input.project_id,
    values: {
      name: v.name.trim(),
      experienceId: v.experience_id,
      educationId: v.education_id,
      startMonth: ym(v.start_month),
      endMonth: v.is_current ? null : ym(v.end_month),
      isCurrent: v.is_current,
      projectType: v.project_type,
      experienceType: v.experience_type,
      competencies: v.competencies,
      situation: text(v.situation),
      task: text(v.task),
      action: text(v.action),
      result: text(v.result),
      learnings: text(v.learnings),
    },
    ...(input.expected_updated_at ? { expectedUpdatedAt: input.expected_updated_at } : {}),
    appliedProposals: input.applied_proposals.map((p) => ({ writingChatId: p.writing_chat_id, field: p.field, rev: p.rev })),
  }
}

export function fromSaveProjectPageResult(r: ContractPageResult): Extract<SaveProjectPageResult, { ok: true }> {
  return {
    ok: true,
    project_id: r.projectId,
    status: r.status,
    updated_at: r.updatedAt,
    applied: r.applied.map((a) => ({ writing_chat_id: a.writingChatId, field: a.field as ProjectProposalField })),
    // an `invalid_entry` echo may lack the chat id / field: kept with "" so the screen still shows the line
    skipped: r.skipped.map((s) => ({ writing_chat_id: s.writingChatId ?? "", field: (s.field ?? "") as ProjectProposalField, reason: s.reason })),
  }
}

export function toSaveProjectDeliverableInput(input: SaveProjectDeliverableInput): z.input<typeof ContractDeliverableInput> {
  return {
    projectDeliverableId: input.project_deliverable_id,
    projectId: input.project_id,
    title: input.title.trim(),
    body: input.body,
    ...(input.expected_updated_at ? { expectedUpdatedAt: input.expected_updated_at } : {}),
    appliedProposals: input.applied_proposals.map((p) => ({ writingChatId: p.writing_chat_id, rev: p.rev, mode: p.mode })),
  }
}

export function fromSaveProjectDeliverableResult(r: ContractDeliverableResult): Extract<SaveProjectDeliverableResult, { ok: true }> {
  return {
    ok: true,
    project_deliverable_id: r.projectDeliverableId,
    project_id: r.projectId,
    sort_order: r.sortOrder,
    updated_at: r.updatedAt,
    applied: r.applied.map((a) => ({ writing_chat_id: a.writingChatId })),
    skipped: r.skipped.map((s) => ({ writing_chat_id: s.writingChatId ?? "", reason: s.reason })),
  }
}
