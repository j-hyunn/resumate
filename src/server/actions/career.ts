"use server";

import {
  AddManualSkillInput,
  AddProjectSkillInput,
  DeleteCareerItemInput,
  DeletionImpactInput,
  RemoveProjectSkillInput,
  ReorderProjectDetailsInput,
  SaveAchievementInput,
  SaveEducationInput,
  SaveExperienceInput,
  SaveProjectDetailInput,
  SaveProjectInput,
  UpdateSkillInput,
  type CareerTreeDto,
  type DataReadiness,
  type DeleteCareerItemResponse,
  type DeletionImpact,
  type SaveProjectDetailResult,
  type SaveResult,
  type SkillDto,
} from "@/lib/contracts/career";
import { invalid, runAction, type ActionResult } from "@/lib/contracts/errors";
import { requireConsentedUser } from "@/server/auth/session";
import * as career from "@/server/services/career";

/**
 * S2 career Server Actions (DM §7). Thin: consent-gated user session → zod → service.
 * Every write goes through the user session (RLS, DM-13).
 */

// ---------- reads ----------

/** S-08 career tree with the year view (DM §2.4). Pages may call the service directly instead. */
export async function getCareerTree(): Promise<ActionResult<CareerTreeDto>> {
  return runAction(async () => {
    const { supabase } = await requireConsentedUser();
    return career.getCareerTree(supabase);
  });
}

/** C-09 / C-10 data readiness (DM §6). */
export async function getDataReadiness(): Promise<ActionResult<DataReadiness>> {
  return runAction(async () => {
    const { supabase } = await requireConsentedUser();
    return career.getDataReadiness(supabase);
  });
}

// ---------- auto-save (F-P1-06) ----------

/** S-09. Returns the DB-computed status. */
export async function saveExperience(input: unknown): Promise<ActionResult<SaveResult>> {
  const parsed = SaveExperienceInput.safeParse(input);
  if (!parsed.success) return invalid(parsed.error);
  return runAction(async () => {
    const { supabase } = await requireConsentedUser();
    return career.saveExperience(supabase, parsed.data);
  });
}

/** S-34 (F-P1-14). */
export async function saveEducation(input: unknown): Promise<ActionResult<SaveResult>> {
  const parsed = SaveEducationInput.safeParse(input);
  if (!parsed.success) return invalid(parsed.error);
  return runAction(async () => {
    const { supabase } = await requireConsentedUser();
    return career.saveEducation(supabase, parsed.data);
  });
}

/** S-10 (F-P1-03). Affiliation: experience / education / none. */
export async function saveProject(input: unknown): Promise<ActionResult<SaveResult>> {
  const parsed = SaveProjectInput.safeParse(input);
  if (!parsed.success) return invalid(parsed.error);
  return runAction(async () => {
    const { supabase } = await requireConsentedUser();
    return career.saveProject(supabase, parsed.data);
  });
}

/** S-35 (F-P1-15). Also returns the parent project's recalculated status. */
export async function saveProjectDetail(input: unknown): Promise<ActionResult<SaveProjectDetailResult>> {
  const parsed = SaveProjectDetailInput.safeParse(input);
  if (!parsed.success) return invalid(parsed.error);
  return runAction(async () => {
    const { supabase } = await requireConsentedUser();
    return career.saveProjectDetail(supabase, parsed.data);
  });
}

/** S-11 (F-P1-04). Target (project detail / experience) on create only. */
export async function saveAchievement(input: unknown): Promise<ActionResult<SaveResult>> {
  const parsed = SaveAchievementInput.safeParse(input);
  if (!parsed.success) return invalid(parsed.error);
  return runAction(async () => {
    const { supabase } = await requireConsentedUser();
    return career.saveAchievement(supabase, parsed.data);
  });
}

/** S-10 상세 내용 순서 변경 → RPC reorder_project_details. */
export async function reorderProjectDetails(input: unknown): Promise<ActionResult<{ projectId: string; orderedIds: string[] }>> {
  const parsed = ReorderProjectDetailsInput.safeParse(input);
  if (!parsed.success) return invalid(parsed.error);
  return runAction(async () => {
    const { supabase } = await requireConsentedUser();
    return career.reorderProjectDetails(supabase, parsed.data);
  });
}

// ---------- skills (F-P1-05) ----------

export async function addProjectSkill(input: unknown): Promise<ActionResult<{ projectId: string; skill: SkillDto }>> {
  const parsed = AddProjectSkillInput.safeParse(input);
  if (!parsed.success) return invalid(parsed.error);
  return runAction(async () => {
    const { supabase } = await requireConsentedUser();
    return career.addProjectSkill(supabase, parsed.data);
  });
}

export async function removeProjectSkill(input: unknown): Promise<ActionResult<{ removed: boolean; skillDeleted: boolean }>> {
  const parsed = RemoveProjectSkillInput.safeParse(input);
  if (!parsed.success) return invalid(parsed.error);
  return runAction(async () => {
    const { supabase } = await requireConsentedUser();
    return career.removeProjectSkill(supabase, parsed.data);
  });
}

export async function addManualSkill(input: unknown): Promise<ActionResult<SkillDto>> {
  const parsed = AddManualSkillInput.safeParse(input);
  if (!parsed.success) return invalid(parsed.error);
  return runAction(async () => {
    const { supabase } = await requireConsentedUser();
    return career.addManualSkill(supabase, parsed.data);
  });
}

export async function updateSkill(input: unknown): Promise<ActionResult<SkillDto>> {
  const parsed = UpdateSkillInput.safeParse(input);
  if (!parsed.success) return invalid(parsed.error);
  return runAction(async () => {
    const { supabase } = await requireConsentedUser();
    return career.updateSkill(supabase, parsed.data);
  });
}

// ---------- deletion (F-COM-04, C-05) ----------

export async function getDeletionImpact(input: unknown): Promise<ActionResult<DeletionImpact>> {
  const parsed = DeletionImpactInput.safeParse(input);
  if (!parsed.success) return invalid(parsed.error);
  return runAction(async () => {
    const { supabase } = await requireConsentedUser();
    return career.getDeletionImpact(supabase, parsed.data);
  });
}

export async function deleteCareerItem(input: unknown): Promise<ActionResult<DeleteCareerItemResponse>> {
  const parsed = DeleteCareerItemInput.safeParse(input);
  if (!parsed.success) return invalid(parsed.error);
  return runAction(async () => {
    const { supabase } = await requireConsentedUser();
    return career.deleteCareerItem(supabase, parsed.data);
  });
}
