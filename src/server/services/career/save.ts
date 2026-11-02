import type { PostgrestError } from "@supabase/supabase-js";
import type {
  SaveAchievementPatch,
  SaveEducationPatch,
  SaveExperiencePatch,
  SaveProjectDetailPatch,
  SaveProjectDetailResult,
  SaveProjectPatch,
  SaveResult,
} from "@/lib/contracts/career";
import type { CareerStatus } from "@/lib/contracts/enums";
import { AppError } from "@/lib/contracts/errors";
import { mapDbError } from "@/server/db/errors";
import type { UserSupabaseClient } from "@/server/db/types";
import {
  SAVE_RESULT_COLUMNS,
  toAchievementColumns,
  toEducationColumns,
  toExperienceColumns,
  toProjectColumns,
  toProjectDetailColumns,
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

export async function saveProject(supabase: UserSupabaseClient, patch: SaveProjectPatch): Promise<SaveResult> {
  const values = toProjectColumns(patch);
  const row = await upsertRow(patch, has(values), {
    insert: () =>
      supabase
        .from("projects")
        .insert({ ...values, id: patch.id })
        .select(SAVE_RESULT_COLUMNS)
        .single(),
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

// ---------- project_details ----------

const DETAIL_RESULT_COLUMNS = "id, status, created_at, updated_at, sort_order, project_id" as const;

/**
 * Create appends at the end (sort_order = last + 1). The (project_id, sort_order)
 * unique is deferred, so two concurrent appends collide at commit (23505 on that
 * constraint, not the pkey): retry once with a fresh number.
 * The parent project's status is recalculated by the DB trigger and read back here
 * (a detail save can flip it, DM §2.2; QA-S2-04).
 */
export async function saveProjectDetail(
  supabase: UserSupabaseClient,
  patch: SaveProjectDetailPatch,
): Promise<SaveProjectDetailResult> {
  const values = toProjectDetailColumns(patch);
  const table = () => supabase.from("project_details");
  const projectId = patch.projectId;
  const detail = await upsertRow(patch, has(values), {
    insert: projectId
      ? async () => {
          for (let attempt = 0; ; attempt += 1) {
            const last = await table()
              .select("sort_order")
              .eq("project_id", projectId)
              .order("sort_order", { ascending: false })
              .limit(1)
              .maybeSingle();
            if (last.error) return { data: null, error: last.error };
            const res = await table()
              .insert({ ...values, id: patch.id, project_id: projectId, sort_order: (last.data?.sort_order ?? 0) + 1 })
              .select(DETAIL_RESULT_COLUMNS)
              .single();
            if (res.error?.code === "23505" && !isPrimaryKeyViolation(res.error) && attempt === 0) continue;
            return res;
          }
        }
      : null,
    update: (id, expected) => {
      let q = table().update(values).eq("id", id);
      if (expected !== undefined) q = q.eq("updated_at", expected);
      return q.select(DETAIL_RESULT_COLUMNS).maybeSingle();
    },
    current: (id) => table().select(DETAIL_RESULT_COLUMNS).eq("id", id).maybeSingle(),
  });
  const project = single(await projectState(supabase, detail.project_id));
  return { ...toSaveResult(detail), sortOrder: detail.sort_order, project: toSaveResult(project) };
}

// ---------- achievements ----------

/** The owner (project detail or experience) is set on create and fixed afterwards (DM §2.3, S-11). */
export async function saveAchievement(supabase: UserSupabaseClient, patch: SaveAchievementPatch): Promise<SaveResult> {
  const values = toAchievementColumns(patch);
  const table = () => supabase.from("achievements");
  const target = patch.target;
  const row = await upsertRow(patch, has(values), {
    insert: target
      ? () => {
          const owner =
            target.type === "project_detail"
              ? { project_detail_id: target.id, experience_id: null }
              : { project_detail_id: null, experience_id: target.id };
          return table()
            .insert({ ...values, ...owner, id: patch.id })
            .select(SAVE_RESULT_COLUMNS)
            .single();
        }
      : null,
    update: (id, expected) => {
      let q = table().update(values).eq("id", id);
      if (expected !== undefined) q = q.eq("updated_at", expected);
      return q.select(SAVE_RESULT_COLUMNS).maybeSingle();
    },
    current: (id) => table().select(SAVE_RESULT_COLUMNS).eq("id", id).maybeSingle(),
  });
  return toSaveResult(row);
}
