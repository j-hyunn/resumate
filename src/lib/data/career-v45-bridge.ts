/**
 * v4.5 page saves on the v4.4 backend — the real-path bridge of `saveProjectPage` / `saveProjectDeliverable`
 * (`career-v45.ts`). Pure apart from the injected v4.4 calls, so it is unit-tested (career-v45-bridge.test.ts).
 * 연결 대기 (DM v4.5 11.3): replaced by the `save_project_page` / `save_project_deliverable` RPCs.
 *
 * // [UI-가정] (leader ruling UQ-PA-3) idempotent new-row saves:
 * - the screen sends one `client_id` per new page, reused on every retry → `createProject` / `saveDeliverable`
 *   with that id returns the same row instead of a second one (v4.4 retry-safe create, QA-S2-03);
 * - S-10 is two calls (create, then the whole page as one section save). If the create succeeded and the second
 *   call failed, the refusal carries `created` so the screen keeps the new id — the next "저장하기" updates it.
 * // [UI-가정] (QA UQ-PA-11) v4.4 can't record `p_applied_proposals`: every entry comes back in `skipped` with
 * `mark_failed` ("일부 반영 기록을 남기지 못했어요. 저장한 내용은 그대로예요") — never a "반영됨" that isn't stored.
 */
import { isAppError } from "@/lib/contracts/errors"
import type {
  PageSaveError,
  SaveProjectDeliverableInput,
  SaveProjectDeliverableResult,
  SaveProjectPageInput,
  SaveProjectPageResult,
} from "./career-v45-shared"

type V44SaveResult = { id: string; status: "draft" | "complete"; updatedAt: string }

export interface ProjectBridgeDeps {
  createProject: (input: { id: string; name: string; affiliation: { type: "experience" | "education"; id: string } }) => Promise<V44SaveResult>
  saveProjectSection: (input: Record<string, unknown> & { id: string }) => Promise<V44SaveResult>
  newId?: () => string
}

export interface DeliverableBridgeDeps {
  saveDeliverable: (input: { id: string; expectedUpdatedAt?: string; projectId?: string; title: string; body: string }) => Promise<{ id: string; updatedAt: string }>
  newId?: () => string
}

/** v4.4 camelCase `details.field` → the v4.5 key the screen attaches the message to. */
const FIELD_KEYS: Record<string, string> = {
  name: "name",
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
  title: "title",
  body: "body",
  affiliation: "experience_id",
}

/** Codes the v4.4 services / DB may raise under the v4.5 names (passed through as is). */
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

/** AppError (v4.4) → the v4.5 refusal (QA UQ-PA-12). Anything else → `save_failed` (ST-SAVE-FAILED). */
export function saveErrorOf(err: unknown): PageSaveError {
  if (!isAppError(err)) return { code: "save_failed" }
  const raw = (err.details?.field as string | undefined) ?? null
  const field = raw ? (FIELD_KEYS[raw] ?? raw) : null
  if (err.code === "conflict") return { code: "stale_write", current_updated_at: (err.details?.current_updated_at as string | undefined) ?? null }
  if (PASS_THROUGH.has(err.code)) return { code: err.code as PageSaveError["code"], field }
  // zod refinements of SaveProjectInput (end_before_start / current_with_end) arrive as invalid_input
  if (err.code === "invalid_input" && (field === "end_month" || field === "start_month")) return { code: "invalid_period", field }
  return { code: "save_failed", field }
}

const ym = (d: string | null) => (d ? d.slice(0, 7) : null)
const uuid = () => crypto.randomUUID()

export async function bridgeSaveProjectPage(input: SaveProjectPageInput, deps: ProjectBridgeDeps): Promise<SaveProjectPageResult> {
  const v = input.values
  const name = v.name.trim()
  if (!name) return { ok: false, error: { code: "project_name_required", field: "name" } }
  let id = input.project_id
  let expected = input.expected_updated_at ?? undefined
  let created: { project_id: string; updated_at: string } | undefined
  if (!id) {
    const affiliation = v.experience_id ? { type: "experience" as const, id: v.experience_id } : v.education_id ? { type: "education" as const, id: v.education_id } : null
    if (!affiliation) return { ok: false, error: { code: "project_affiliation_required" } }
    try {
      const row = await deps.createProject({ id: input.client_id ?? (deps.newId ?? uuid)(), name, affiliation })
      id = row.id
      expected = row.updatedAt
      created = { project_id: row.id, updated_at: row.updatedAt }
    } catch (err) {
      return { ok: false, error: saveErrorOf(err) }
    }
  }
  const affiliationMove = input.project_id
    ? v.experience_id
      ? { type: "experience" as const, id: v.experience_id }
      : v.education_id
        ? { type: "education" as const, id: v.education_id }
        : undefined
    : undefined
  try {
    const saved = await deps.saveProjectSection({
      id,
      expectedUpdatedAt: expected,
      affiliation: affiliationMove,
      name,
      startMonth: ym(v.start_month),
      endMonth: v.is_current ? null : ym(v.end_month),
      isCurrent: v.is_current,
      projectType: v.project_type,
      experienceType: v.experience_type,
      competencies: v.competencies,
      situation: v.situation,
      task: v.task,
      action: v.action,
      result: v.result,
      learnings: v.learnings,
    })
    return {
      ok: true,
      project_id: saved.id,
      status: saved.status,
      updated_at: saved.updatedAt,
      applied: [],
      skipped: input.applied_proposals.map(({ writing_chat_id, field }) => ({ writing_chat_id, field, reason: "mark_failed" as const })),
    }
  } catch (err) {
    // the row exists now: hand its id back so a retry updates it (no second project)
    return { ok: false, error: { ...saveErrorOf(err), ...(created ? { created } : {}) } }
  }
}

export async function bridgeSaveProjectDeliverable(input: SaveProjectDeliverableInput, deps: DeliverableBridgeDeps): Promise<SaveProjectDeliverableResult> {
  const title = input.title.trim()
  if (!title) return { ok: false, error: { code: "deliverable_title_required", field: "title" } }
  const creating = !input.project_deliverable_id
  try {
    const saved = await deps.saveDeliverable({
      id: input.project_deliverable_id ?? input.client_id ?? (deps.newId ?? uuid)(),
      expectedUpdatedAt: creating ? undefined : (input.expected_updated_at ?? undefined),
      projectId: creating ? input.project_id : undefined,
      title,
      body: input.body,
    })
    return {
      ok: true,
      project_deliverable_id: saved.id,
      project_id: input.project_id,
      // 연결 대기 (DM v4.5 11.3): v4.4 doesn't return sort_order
      sort_order: 0,
      updated_at: saved.updatedAt,
      applied: [],
      skipped: input.applied_proposals.map(({ writing_chat_id }) => ({ writing_chat_id, reason: "mark_failed" as const })),
    }
  } catch (err) {
    return { ok: false, error: saveErrorOf(err) }
  }
}
