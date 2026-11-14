"use server";

import {
  ApplicationProjectIdInput,
  CreateApplicationProjectInput,
  ListApplicationProjectsInput,
  MoveApplicationStageInput,
  SetApplicationOutcomeInput,
  UpdateApplicationProjectInput,
  UpdateFailedJdRawTextInput,
  type ApplicationBoard,
  type ApplicationHub,
  type ApplicationProjectListItem,
  type CreateApplicationProjectResult,
  type DeleteApplicationProjectResult,
  type JdView,
  type MoveApplicationStageResult,
  type StageChangeResult,
  type UpdateFailedJdRawTextResult,
} from "@/lib/contracts/application";
import type { ApplicationProjectDeletionImpact } from "@/lib/contracts/career";
import { invalid, runAction, type ActionResult } from "@/lib/contracts/errors";
import { getApplicationProjectDeletionImpact as loadApplicationProjectDeletionImpact } from "@/server/services/career";
import { requireConsentedUser } from "@/server/auth/session";
import * as reads from "@/server/services/application/read";
import * as writes from "@/server/services/application/write";

/**
 * S5 application project Server Actions (DM §7 보드 조회·단계 이동·결과 기록,
 * F-AP-01·02·05, F-ST-01~05; UX S-13, S-14, S-31, S-15, S-39, C-12~C-14,
 * FL-06). Thin: consent-gated user session → zod → service. None of these
 * calls an AI provider (R17: the JD is stored and used as raw text; there is
 * no extraction route any more).
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

/**
 * S-15 공고 원문 수정 (Q53-2 / Q53-11, DM 2.6.1): replaces the text and sends the JD back to
 * `pending`. No AI, no key needed. 409 codes in `JD_RAW_TEXT_REFUSAL_CODES`.
 */
export async function updateFailedJdRawText(input: unknown): Promise<ActionResult<UpdateFailedJdRawTextResult>> {
  const parsed = UpdateFailedJdRawTextInput.safeParse(input);
  if (!parsed.success) return invalid(parsed.error);
  return runAction(async () => {
    const { supabase } = await requireConsentedUser();
    return writes.updateFailedJdRawText(supabase, parsed.data);
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

/**
 * C-05 자기소개서 삭제 확인 (DM 2.7.2): `get_deletion_impact('application_project')` — what is deleted
 * with it. No AI, no key needed.
 */
export async function getApplicationProjectDeletionImpact(input: unknown): Promise<ActionResult<ApplicationProjectDeletionImpact>> {
  const parsed = ApplicationProjectIdInput.safeParse(input);
  if (!parsed.success) return invalid(parsed.error);
  return runAction(async () => {
    const { supabase } = await requireConsentedUser();
    return loadApplicationProjectDeletionImpact(supabase, parsed.data.id);
  });
}

/**
 * FL-06: cancel in-flight AI jobs, then delete (usage records stay). Children go with the FK cascade.
 */
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
