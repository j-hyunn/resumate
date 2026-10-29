"use server";

import {
  ApplicationProjectIdInput,
  CreateApplicationProjectInput,
  ListApplicationProjectsInput,
  MoveApplicationStageInput,
  SetApplicationOutcomeInput,
  UpdateApplicationProjectInput,
  type ApplicationBoard,
  type ApplicationHub,
  type ApplicationProjectListItem,
  type CreateApplicationProjectResult,
  type DeleteApplicationProjectResult,
  type JdView,
  type MoveApplicationStageResult,
  type StageChangeResult,
} from "@/lib/contracts/application";
import { invalid, runAction, type ActionResult } from "@/lib/contracts/errors";
import { requireConsentedUser } from "@/server/auth/session";
import * as reads from "@/server/services/application/read";
import * as writes from "@/server/services/application/write";

/**
 * S5 application project Server Actions (DM §7 보드 조회·단계 이동·결과 기록,
 * F-AP-01·02·05, F-ST-01~05; UX S-13, S-14, S-31, S-15, S-39, C-12~C-14,
 * FL-06). Thin: consent-gated user session → zod → service. None of these
 * calls an AI provider (requirement extraction is the sync route
 * `POST /api/application-projects/{id}/jd-extraction`).
 */

/** S-14 만들기: project + JD (raw text, server sentence split) + `created` stage event. */
export async function createApplicationProject(input: unknown): Promise<ActionResult<CreateApplicationProjectResult>> {
  const parsed = CreateApplicationProjectInput.safeParse(input);
  if (!parsed.success) return invalid(parsed.error);
  return runAction(async () => {
    const { supabase } = await requireConsentedUser();
    return writes.createApplicationProject(supabase, parsed.data);
  });
}

/** S-31 inline edit: name (≤ 100, not empty) / deadline / memo (≤ 2,000). */
export async function updateApplicationProject(input: unknown): Promise<ActionResult<Awaited<ReturnType<typeof writes.updateApplicationProject>>>> {
  const parsed = UpdateApplicationProjectInput.safeParse(input);
  if (!parsed.success) return invalid(parsed.error);
  return runAction(async () => {
    const { supabase } = await requireConsentedUser();
    return writes.updateApplicationProject(supabase, parsed.data);
  });
}

/** FL-06: cancel in-flight AI jobs, then delete (usage records stay). */
export async function deleteApplicationProject(input: unknown): Promise<ActionResult<DeleteApplicationProjectResult>> {
  const parsed = ApplicationProjectIdInput.safeParse(input);
  if (!parsed.success) return invalid(parsed.error);
  return runAction(async () => {
    const { supabase } = await requireConsentedUser();
    return writes.deleteApplicationProject(supabase, parsed.data.id);
  });
}

/** C-12 / drag (FL-15): RPC move_application_stage. The screen decides C-13 / C-14 from the result. */
export async function moveApplicationStage(input: unknown): Promise<ActionResult<MoveApplicationStageResult>> {
  const parsed = MoveApplicationStageInput.safeParse(input);
  if (!parsed.success) return invalid(parsed.error);
  return runAction(async () => {
    const { supabase } = await requireConsentedUser();
    return writes.moveApplicationStage(supabase, parsed.data);
  });
}

/** C-13: 최종 합격 / 불합격 / null (결과 지우기). */
export async function setApplicationOutcome(input: unknown): Promise<ActionResult<StageChangeResult>> {
  const parsed = SetApplicationOutcomeInput.safeParse(input);
  if (!parsed.success) return invalid(parsed.error);
  return runAction(async () => {
    const { supabase } = await requireConsentedUser();
    return writes.setApplicationOutcome(supabase, parsed.data);
  });
}

// ---- reads (Server Components call the services directly at wiring time; actions for client refresh) ----

/** S-13 list. */
export async function listApplicationProjects(input: unknown = {}): Promise<ActionResult<ApplicationProjectListItem[]>> {
  const parsed = ListApplicationProjectsInput.safeParse(input ?? {});
  if (!parsed.success) return invalid(parsed.error);
  return runAction(async () => {
    const { supabase } = await requireConsentedUser();
    return reads.listApplicationProjects(supabase, parsed.data);
  });
}

/** S-39 board. */
export async function getApplicationBoard(): Promise<ActionResult<ApplicationBoard>> {
  return runAction(async () => {
    const { supabase } = await requireConsentedUser();
    return reads.getBoard(supabase);
  });
}

/** S-31 hub. */
export async function getApplicationHub(input: unknown): Promise<ActionResult<ApplicationHub>> {
  const parsed = ApplicationProjectIdInput.safeParse(input);
  if (!parsed.success) return invalid(parsed.error);
  return runAction(async () => {
    const { supabase } = await requireConsentedUser();
    return reads.getApplicationHub(supabase, parsed.data.id);
  });
}

/** S-15 JD · 요건. */
export async function getJdView(input: unknown): Promise<ActionResult<JdView>> {
  const parsed = ApplicationProjectIdInput.safeParse(input);
  if (!parsed.success) return invalid(parsed.error);
  return runAction(async () => {
    const { supabase } = await requireConsentedUser();
    return reads.getJdView(supabase, parsed.data.id);
  });
}
