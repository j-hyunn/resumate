import type { PostgrestError } from "@supabase/supabase-js";
import { randomUUID } from "node:crypto";
import type {
  CreateProjectInput,
  SaveDeliverablePatch,
  SaveEducationPatch,
  SaveExperiencePatch,
  SaveProjectPatch,
  SaveResult,
} from "@/lib/contracts/career";
import type { CareerStatus } from "@/lib/contracts/enums";
import { AppError } from "@/lib/contracts/errors";
import { mapDbError } from "@/server/db/errors";
import type { UserSupabaseClient } from "@/server/db/types";
import {
  SAVE_RESULT_COLUMNS,
  toDeliverableColumns,
  toEducationColumns,
  toExperienceColumns,
  toProjectColumns,
} from "./mappers";

/**
 * Auto-save (F-P1-06, DM §7 "자동 저장"): `{ id, expectedUpdatedAt?, ...fields }`.
 * - `id` is client-generated and stable per row (QA-S2-03). Without `expectedUpdatedAt`
 *   the save is a create: insert with that id. A primary-key collision means a retried
 *   create; it is applied only if the row was never edited since, else `conflict`
 *   (QA-S2-08, see replayCreate). Never a duplicate row, never a stale overwrite.
 * - With `expectedUpdatedAt` the save is update-only with optimistic concurrency:
 *   the row changed since → `conflict`.
 * - `status` comes back from the DB trigger; the client never sends it (DM §2.2).
 * Ownership: RLS + composite FKs (DM-2). Another user's id — even one that collides on
 * insert — falls to the update path, which RLS hides, so it is `not_found`.
 */

type SaveRow = { id: string; status: string; created_at: string; updated_at: string };
type Res<T> = { data: T | null; error: PostgrestError | null };

export function toSaveResult(row: SaveRow): SaveResult {
  return { id: row.id, status: row.status as CareerStatus, updatedAt: row.updated_at };
}

/** A missing parent in a composite FK (someone else's or a deleted parent). */
const PARENT_MISSING = "연결할 항목을 찾을 수 없습니다. 새로고침 후 다시 시도해 주세요.";

export function mapSaveError(error: PostgrestError): AppError {
  if (error.code === "23503") return new AppError("not_found", PARENT_MISSING, { cause: error });
  return mapDbError(error);
}

/** 23505 on the table's primary key (`<table>_pkey`), as opposed to another unique constraint. */
export function isPrimaryKeyViolation(error: PostgrestError | null): boolean {
  return error?.code === "23505" && /_pkey\b/.test(error.message ?? "");
}

function single<T>(res: Res<T>): T {
  if (res.error) throw mapSaveError(res.error);
  if (!res.data) throw new AppError("not_found");
  return res.data;
}

/** Compares two timestamptz strings as instants (formats may differ). */
export function sameInstant(a: string, b: string): boolean {
  if (a === b) return true;
  const ta = Date.parse(a);
  const tb = Date.parse(b);
  // Millisecond precision is enough here; the update path compares in Postgres at µs precision.
  return !Number.isNaN(ta) && ta === tb;
}

/** Typed per-table queries; the shared flow below stays table-agnostic. */
export type RowOps<R extends SaveRow> = {
  /** Insert with the client id; `null` when the patch can't create (no parent given). */
  insert: (() => PromiseLike<Res<R>>) | null;
  /** Update by id, filtered by updated_at when `expected` is given. */
  update: (id: string, expected: string | undefined) => PromiseLike<Res<R>>;
  current: (id: string) => PromiseLike<Res<R>>;
};

export async function upsertRow<R extends SaveRow>(
  meta: { id: string; expectedUpdatedAt?: string },
  hasChanges: boolean,
  ops: RowOps<R>,
): Promise<R> {
  const { id, expectedUpdatedAt } = meta;

  if (expectedUpdatedAt === undefined && ops.insert) {
    const res = await ops.insert();
    if (res.data && !res.error) return res.data;
    if (!isPrimaryKeyViolation(res.error)) return single(res);
    return replayCreate(id, hasChanges, ops);
  }

  if (!hasChanges) {
    // Nothing to write: don't bump updated_at; still honor the concurrency check.
    const row = single(await ops.current(id));
    if (expectedUpdatedAt !== undefined && !sameInstant(row.updated_at, expectedUpdatedAt)) throw new AppError("conflict");
    return row;
  }
  const res = await ops.update(id, expectedUpdatedAt);
  if (res.error) throw mapSaveError(res.error);
  if (res.data) return res.data;
  if (expectedUpdatedAt === undefined) throw new AppError("not_found");
  single(await ops.current(id)); // throws not_found when it isn't ours / is gone
  throw new AppError("conflict");
}

/**
 * The id already exists: a retried create (QA-S2-03), possibly delayed (QA-S2-08).
 * Apply it only while the row has never been edited since creation
 * (updated_at = created_at — both default to now() on insert, and only updates
 * bump updated_at). The update filters on `updated_at = <created_at>`, so a
 * concurrent edit makes it match 0 rows: compare-and-set, never overwrites newer data.
 * Edited since → `conflict` without writing. Another user's id → not_found (RLS).
 */
async function replayCreate<R extends SaveRow>(id: string, hasChanges: boolean, ops: RowOps<R>): Promise<R> {
  const row = single(await ops.current(id));
  if (row.updated_at !== row.created_at) throw new AppError("conflict");
  if (!hasChanges) return row;
  const res = await ops.update(id, row.created_at);
  if (res.error) throw mapSaveError(res.error);
  if (res.data) return res.data;
  throw new AppError("conflict");
}

const has = (values: object) => Object.keys(values).length > 0;

// ---------- experiences / educations / projects ----------

export async function saveExperience(supabase: UserSupabaseClient, patch: SaveExperiencePatch): Promise<SaveResult> {
  const values = toExperienceColumns(patch);
  const table = () => supabase.from("experiences");
  const row = await upsertRow(patch, has(values), {
    insert: () => table().insert({ ...values, id: patch.id }).select(SAVE_RESULT_COLUMNS).single(),
    update: (id, expected) => {
      let q = table().update(values).eq("id", id);
      if (expected !== undefined) q = q.eq("updated_at", expected);
      return q.select(SAVE_RESULT_COLUMNS).maybeSingle();
    },
    current: (id) => table().select(SAVE_RESULT_COLUMNS).eq("id", id).maybeSingle(),
  });
  return toSaveResult(row);
}

export async function saveEducation(supabase: UserSupabaseClient, patch: SaveEducationPatch): Promise<SaveResult> {
  const values = toEducationColumns(patch);
  const table = () => supabase.from("educations");
  const row = await upsertRow(patch, has(values), {
    insert: () => table().insert({ ...values, id: patch.id }).select(SAVE_RESULT_COLUMNS).single(),
    update: (id, expected) => {
      let q = table().update(values).eq("id", id);
      if (expected !== undefined) q = q.eq("updated_at", expected);
      return q.select(SAVE_RESULT_COLUMNS).maybeSingle();
    },
    current: (id) => table().select(SAVE_RESULT_COLUMNS).eq("id", id).maybeSingle(),
  });
  return toSaveResult(row);
}

/**
 * C-23 "프로젝트 추가" (CR-6, DM §7 v4.4): a draft project from its name and affiliation only, then
 * the screen opens it (S-10 affiliated / S-43 standalone). Retry-safe with a client id: an
 * existing never-edited row with that id is returned as is (QA-S2-03).
 */
export async function createProject(
  supabase: UserSupabaseClient,
  input: { id?: string; name: string; affiliation: CreateProjectInput["affiliation"] },
): Promise<SaveResult> {
  const id = input.id ?? randomUUID();
  const a = input.affiliation;
  const res = await supabase
    .from("projects")
    .insert({
      id,
      name: input.name,
      experience_id: a.type === "experience" ? a.id : null,
      education_id: a.type === "education" ? a.id : null,
    })
    .select(SAVE_RESULT_COLUMNS)
    .single();
  if (res.data && !res.error) return toSaveResult(res.data);
  if (!isPrimaryKeyViolation(res.error)) throw res.error ? mapSaveError(res.error) : new AppError("internal_error", undefined, { status: 500 });
  const row = single(await projectState(supabase, id));
  if (row.updated_at !== row.created_at) throw new AppError("conflict");
  return toSaveResult(row);
}

/**
 * Section save (C-24, DM §7 v4.4 "섹션 저장"): update only, the given columns only. Status and
 * content_updated_at come from DB triggers. Scope change (affiliated ↔ standalone) →
 * `project_scope_change_not_allowed`; a column of the other scope → DM-20 CHECK (`invalid_input`).
 */
export async function saveProject(supabase: UserSupabaseClient, patch: SaveProjectPatch): Promise<SaveResult> {
  const values = toProjectColumns(patch);
  const row = await upsertRow(patch, has(values), {
    insert: null,
    update: (id, expected) => {
      let q = supabase.from("projects").update(values).eq("id", id);
      if (expected !== undefined) q = q.eq("updated_at", expected);
      return q.select(SAVE_RESULT_COLUMNS).maybeSingle();
    },
    current: (id) => projectState(supabase, id),
  });
  return toSaveResult(row);
}

export function projectState(supabase: UserSupabaseClient, id: string) {
  return supabase.from("projects").select(SAVE_RESULT_COLUMNS).eq("id", id).maybeSingle();
}

// ---------- project_deliverables (S-44, CR-8) ----------

const DELIVERABLE_RESULT_COLUMNS = "id, created_at, updated_at" as const;

export type DeliverableSaveResult = { id: string; updatedAt: string };

/**
 * S-44 save. Create (no expectedUpdatedAt) needs projectId + title; sort_order comes from the DB
 * trigger (max + 1). The parent must be a standalone project (`deliverable_requires_standalone_project`)
 * with fewer than 50 deliverables (`deliverable_limit_reached`, [가정]). Deliverables have no status.
 */
export async function saveDeliverable(supabase: UserSupabaseClient, patch: SaveDeliverablePatch): Promise<DeliverableSaveResult> {
  const values = toDeliverableColumns(patch);
  const table = () => supabase.from("project_deliverables");
  const projectId = patch.projectId;
  const title = patch.title;
  type Row = { id: string; status: string; created_at: string; updated_at: string };
  const withStatus = <T extends { data: { id: string; created_at: string; updated_at: string } | null; error: PostgrestError | null }>(res: T) =>
    ({ data: res.data ? { ...res.data, status: "complete" } : null, error: res.error }) as Res<Row>;
  const row = await upsertRow<Row>(patch, has(values), {
    insert:
      projectId && title !== undefined
        ? async () =>
            withStatus(
              await table()
                // sort_order omitted: the column defaults to 0 and the insert trigger appends (max + 1).
                .insert({ id: patch.id, project_id: projectId, title, body: patch.body ?? "" })
                .select(DELIVERABLE_RESULT_COLUMNS)
                .single(),
            )
        : null,
    update: async (id, expected) => {
      let q = table().update(values).eq("id", id);
      if (expected !== undefined) q = q.eq("updated_at", expected);
      return withStatus(await q.select(DELIVERABLE_RESULT_COLUMNS).maybeSingle());
    },
    current: async (id) => withStatus(await table().select(DELIVERABLE_RESULT_COLUMNS).eq("id", id).maybeSingle()),
  });
  return { id: row.id, updatedAt: row.updated_at };
}
