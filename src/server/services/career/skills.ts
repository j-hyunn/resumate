import { normalizeSkillName, type SkillDto } from "@/lib/contracts/career";
import type { SkillProficiency } from "@/lib/contracts/enums";
import { AppError } from "@/lib/contracts/errors";
import type { UserSupabaseClient } from "@/server/db/types";
import { SKILL_COLUMNS, toSkillDto, type SkillSelect } from "./mappers";
import { mapSaveError } from "./save";

/**
 * skills / project_skills (DM A.4, F-P1-05, S-10 tags, S-12 list).
 * - A project tag reuses the user's skill with the same normalized_name, or creates
 *   one with is_manual = false.
 * - Removing the last link of a tag-created skill deletes it (DB trigger).
 * - Deleting a skill goes through delete_career_item('skill').
 */

const DUPLICATE_NAME = "이미 같은 이름의 스킬이 있습니다.";

async function findByName(supabase: UserSupabaseClient, name: string): Promise<SkillSelect | null> {
  const res = await supabase.from("skills").select(SKILL_COLUMNS).eq("normalized_name", normalizeSkillName(name)).maybeSingle();
  if (res.error) throw mapSaveError(res.error);
  return res.data;
}

async function projectCount(supabase: UserSupabaseClient, skillId: string): Promise<number> {
  const res = await supabase.from("project_skills").select("skill_id", { count: "exact", head: true }).eq("skill_id", skillId);
  if (res.error) throw mapSaveError(res.error);
  return res.count ?? 0;
}

async function withCount(supabase: UserSupabaseClient, row: SkillSelect): Promise<SkillDto> {
  return toSkillDto(row, await projectCount(supabase, row.id));
}

/** Find-or-create by normalized name; a concurrent create (23505) falls back to the existing row. */
async function findOrCreate(
  supabase: UserSupabaseClient,
  name: string,
  fields: { is_manual: boolean; proficiency?: SkillProficiency | null },
): Promise<{ row: SkillSelect; created: boolean }> {
  const existing = await findByName(supabase, name);
  if (existing) return { row: existing, created: false };
  const res = await supabase.from("skills").insert({ name, ...fields }).select(SKILL_COLUMNS).single();
  if (res.error?.code === "23505") {
    const raced = await findByName(supabase, name);
    if (raced) return { row: raced, created: false };
  }
  if (res.error) throw mapSaveError(res.error);
  return { row: res.data, created: true };
}

/** S-10 "사용 기술" tag. Idempotent: linking an already linked skill is fine. */
export async function addProjectSkill(
  supabase: UserSupabaseClient,
  input: { projectId: string; name: string },
): Promise<{ projectId: string; skill: SkillDto }> {
  const project = await supabase.from("projects").select("id").eq("id", input.projectId).maybeSingle();
  if (project.error) throw mapSaveError(project.error);
  if (!project.data) throw new AppError("not_found");

  const { row, created } = await findOrCreate(supabase, input.name, { is_manual: false });
  const link = await supabase.from("project_skills").insert({ project_id: input.projectId, skill_id: row.id });
  if (link.error && link.error.code !== "23505") {
    // Don't leave a tag skill with no link behind (the orphan trigger only runs on link delete).
    if (created) await supabase.from("skills").delete().eq("id", row.id);
    throw mapSaveError(link.error);
  }
  return { projectId: input.projectId, skill: await withCount(supabase, row) };
}

export async function removeProjectSkill(
  supabase: UserSupabaseClient,
  input: { projectId: string; skillId: string },
): Promise<{ removed: boolean; skillDeleted: boolean }> {
  const res = await supabase
    .from("project_skills")
    .delete()
    .eq("project_id", input.projectId)
    .eq("skill_id", input.skillId)
    .select("skill_id");
  if (res.error) throw mapSaveError(res.error);
  const removed = (res.data?.length ?? 0) > 0;
  const still = await supabase.from("skills").select("id").eq("id", input.skillId).maybeSingle();
  if (still.error) throw mapSaveError(still.error);
  return { removed, skillDeleted: removed && !still.data };
}

/** S-12 add. An existing tag skill with the same name becomes manual (kept even without projects). */
export async function addManualSkill(
  supabase: UserSupabaseClient,
  input: { name: string; proficiency?: SkillProficiency | null },
): Promise<SkillDto> {
  const { row, created } = await findOrCreate(supabase, input.name, { is_manual: true, proficiency: input.proficiency });
  if (created) return withCount(supabase, row);
  const patch: { is_manual?: boolean; proficiency?: SkillProficiency | null } = {};
  if (!row.is_manual) patch.is_manual = true;
  if (input.proficiency !== undefined) patch.proficiency = input.proficiency;
  if (Object.keys(patch).length === 0) return withCount(supabase, row);
  const res = await supabase.from("skills").update(patch).eq("id", row.id).select(SKILL_COLUMNS).single();
  if (res.error) throw mapSaveError(res.error);
  return withCount(supabase, res.data);
}

/** S-12 edit: rename (unique per normalized name) and proficiency. */
export async function updateSkill(
  supabase: UserSupabaseClient,
  input: { id: string; name?: string; proficiency?: SkillProficiency | null },
): Promise<SkillDto> {
  const patch: { name?: string; proficiency?: SkillProficiency | null } = {};
  if (input.name !== undefined) patch.name = input.name;
  if (input.proficiency !== undefined) patch.proficiency = input.proficiency;
  if (Object.keys(patch).length === 0) throw new AppError("invalid_input");
  const res = await supabase.from("skills").update(patch).eq("id", input.id).select(SKILL_COLUMNS).maybeSingle();
  if (res.error?.code === "23505") throw new AppError("conflict", DUPLICATE_NAME, { cause: res.error });
  if (res.error) throw mapSaveError(res.error);
  if (!res.data) throw new AppError("not_found");
  return withCount(supabase, res.data);
}
