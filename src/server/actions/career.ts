"use server";

import {
  AddManualSkillInput,
  AddProjectSkillInput,
  CreateProjectInput,
  DeleteCareerItemInput,
  DeletionImpactInput,
  DeliverableIdInput,
  ProjectIdInput,
  RemoveProjectSkillInput,
  ReorderDeliverablesInput,
  SaveDeliverableInput,
  SaveEducationInput,
  SaveExperienceInput,
  SaveProjectDeliverableInput,
  SaveProjectInput,
  SaveProjectPageInput,
  UpdateSkillInput,
  type CareerListDto,
  type DataReadiness,
  type DeleteCareerItemResponse,
  type DeletionImpact,
  type DeliverableDetailDto,
  type ProjectDetailDto,
  type SaveProjectDeliverableResult,
  type SaveProjectPageResult,
  type SaveResult,
  type SkillDto,
  type StandaloneProjectDetailDto,
} from "@/lib/contracts/career";
import { AppError, invalid, runAction, type ActionResult } from "@/lib/contracts/errors";
import { requireConsentedUser } from "@/server/auth/session";
import * as career from "@/server/services/career";
import type { DeliverableSaveResult } from "@/server/services/career/save";

/**
 * Career Server Actions v4.4 (DM §7 v4.4). Thin: consent-gated user session → zod → service.
 * Every write goes through the user session (RLS, DM-13).
 */

// ---------- reads ----------

/** S-08 career list (DM §2.4 v4.4). Pages may call the service directly instead. */
export async function getCareerList(): Promise<ActionResult<CareerListDto>> {
  return runAction(async () => {
    const { supabase } = await requireConsentedUser();
    return career.getCareerList(supabase);
  });
}

/** S-10 (affiliated project). `not_found` for a standalone id (the screen opens S-43). */
export async function getProjectDetail(input: unknown): Promise<ActionResult<ProjectDetailDto>> {
  const parsed = ProjectIdInput.safeParse(input);
  if (!parsed.success) return invalid(parsed.error);
  return runAction(async () => {
    const { supabase } = await requireConsentedUser();
    const detail = await career.getProjectDetail(supabase, parsed.data.id);
    if (!detail) throw notFound();
    return detail;
  });
}

/** S-43 (standalone project). */
export async function getStandaloneProjectDetail(input: unknown): Promise<ActionResult<StandaloneProjectDetailDto>> {
  const parsed = ProjectIdInput.safeParse(input);
  if (!parsed.success) return invalid(parsed.error);
  return runAction(async () => {
    const { supabase } = await requireConsentedUser();
    const detail = await career.getStandaloneProjectDetail(supabase, parsed.data.id);
    if (!detail) throw notFound();
    return detail;
  });
}

/** S-44. */
export async function getDeliverable(input: unknown): Promise<ActionResult<DeliverableDetailDto>> {
  const parsed = DeliverableIdInput.safeParse(input);
  if (!parsed.success) return invalid(parsed.error);
  return runAction(async () => {
    const { supabase } = await requireConsentedUser();
    const detail = await career.getDeliverable(supabase, parsed.data.id);
    if (!detail) throw notFound();
    return detail;
  });
}

/** C-09 / C-10 data readiness (DM §6 v4.4). */
export async function getDataReadiness(): Promise<ActionResult<DataReadiness>> {
  return runAction(async () => {
    const { supabase } = await requireConsentedUser();
    return career.getDataReadiness(supabase);
  });
}

// ---------- saves (C-24 section saves, F-P1-06) ----------

/** S-09 재직 정보 / 근무 내용. Returns the DB-computed status. */
export async function saveExperience(input: unknown): Promise<ActionResult<SaveResult>> {
  const parsed = SaveExperienceInput.safeParse(input);
  if (!parsed.success) return invalid(parsed.error);
  return runAction(async () => {
    const { supabase } = await requireConsentedUser();
    return career.saveExperience(supabase, parsed.data);
  });
}

/** S-34 교육 정보 / 교육 내용 (F-P1-14). */
export async function saveEducation(input: unknown): Promise<ActionResult<SaveResult>> {
  const parsed = SaveEducationInput.safeParse(input);
  if (!parsed.success) return invalid(parsed.error);
  return runAction(async () => {
    const { supabase } = await requireConsentedUser();
    return career.saveEducation(supabase, parsed.data);
  });
}

/** C-23 "프로젝트 추가" (CR-6): name + affiliation → draft project; the screen opens S-10 / S-43. */
export async function createProject(input: unknown): Promise<ActionResult<SaveResult>> {
  const parsed = CreateProjectInput.safeParse(input);
  if (!parsed.success) return invalid(parsed.error);
  return runAction(async () => {
    const { supabase } = await requireConsentedUser();
    return career.createProject(supabase, parsed.data);
  });
}

/** S-10 머리 / STAR 섹션, S-43 프로젝트 정보 / 내용 (section saves, update only). */
export async function saveProject(input: unknown): Promise<ActionResult<SaveResult>> {
  const parsed = SaveProjectInput.safeParse(input);
  if (!parsed.success) return invalid(parsed.error);
  return runAction(async () => {
    const { supabase } = await requireConsentedUser();
    return career.saveProject(supabase, parsed.data);
  });
}

/** S-44 산출물 저장 (create with projectId + title, then updates). */
export async function saveDeliverable(input: unknown): Promise<ActionResult<DeliverableSaveResult>> {
  const parsed = SaveDeliverableInput.safeParse(input);
  if (!parsed.success) return invalid(parsed.error);
  return runAction(async () => {
    const { supabase } = await requireConsentedUser();
    return career.saveDeliverable(supabase, parsed.data);
  });
}

// ---------- page saves (DM 2.5.1 v4.5 ★, PA-3) ----------

/**
 * S-10 상단 바 "저장하기" → `save_project_page` (create when `projectId` is null). Records the
 * proposals filled into the form this visit (`applied` / `skipped`). No AI, no key. Errors:
 * `stale_write` {current_updated_at}, `project_name_required`, `project_affiliation_required`,
 * `project_not_affiliated`, `field_too_long` / `invalid_period` / `invalid_classification` {field},
 * `project_scope_change_not_allowed`, `not_found`.
 */
export async function saveProjectPage(input: unknown): Promise<ActionResult<SaveProjectPageResult>> {
  const parsed = SaveProjectPageInput.safeParse(input);
  if (!parsed.success) return invalid(parsed.error);
  return runAction(async () => {
    const { supabase } = await requireConsentedUser();
    return career.saveProjectPage(supabase, parsed.data);
  });
}

/**
 * S-44 상단 바 "저장하기" → `save_project_deliverable` (create when `projectDeliverableId` is null).
 * Errors: `stale_write`, `deliverable_title_required`, `field_too_long` {field},
 * `deliverable_limit_reached`, `deliverable_requires_standalone_project`, `not_found`.
 */
export async function saveProjectDeliverable(input: unknown): Promise<ActionResult<SaveProjectDeliverableResult>> {
  const parsed = SaveProjectDeliverableInput.safeParse(input);
  if (!parsed.success) return invalid(parsed.error);
  return runAction(async () => {
    const { supabase } = await requireConsentedUser();
    return career.saveProjectDeliverable(supabase, parsed.data);
  });
}

/** S-43 산출물 순서 변경 → RPC reorder_project_deliverables ([가정]). */
export async function reorderDeliverables(input: unknown): Promise<ActionResult<{ projectId: string; orderedIds: string[] }>> {
  const parsed = ReorderDeliverablesInput.safeParse(input);
  if (!parsed.success) return invalid(parsed.error);
  return runAction(async () => {
    const { supabase } = await requireConsentedUser();
    return career.reorderProjectDeliverables(supabase, parsed.data);
  });
}

// ---------- skills (F-P1-05: standalone projects only) ----------

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

function notFound(): AppError {
  return new AppError("not_found");
}
