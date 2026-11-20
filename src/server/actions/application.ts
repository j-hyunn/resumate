"use server";

import {
  ApplicationProjectIdInput,
  CreateApplicationProjectInput,
  ListApplicationProjectsInput,
  MoveApplicationStageInput,
  SetApplicationOutcomeInput,
  UpdateApplicationProjectInput,
  UpdateJdRawTextInput,
  type ApplicationBoard,
  type ApplicationHub,
  type ApplicationProjectListItem,
  type CreateApplicationProjectResult,
  type DeleteApplicationProjectResult,
  type JdView,
  type MoveApplicationStageResult,
  type StageChangeResult,
  type UpdateJdRawTextResult,
} from "@/lib/contracts/application";
import type { ApplicationProjectDeletionImpact } from "@/lib/contracts/career";
import { invalid, runAction, type ActionResult } from "@/lib/contracts/errors";
import { getApplicationProjectDeletionImpact as loadApplicationProjectDeletionImpact } from "@/server/services/career";
import { getSiteOrigin } from "@/server/auth/site-url";
import { requireConsentedUser } from "@/server/auth/session";
import { createAppJobRunner } from "@/server/jobs/app-runner";
import { connections } from "@/server/jobs/connections";
import { productionInsightPipeline } from "@/server/jobs/insight";
import { logJobEvent } from "@/server/jobs/log";
import { autoStartInsight } from "@/server/services/insight/auto-start";
import * as reads from "@/server/services/application/read";
import * as writes from "@/server/services/application/write";

/**
 * S5 application project Server Actions (DM §7 보드 조회·단계 이동·결과 기록,
 * F-AP-01·02·05, F-ST-01~05; UX S-13, S-14, S-31, S-15, S-39, C-12~C-14,
 * FL-06). Thin: consent-gated user session → zod → service. Only the create action may
 * start AI work — the automatic insight start (JR-6) after a new row; everything else here is
 * AI-free (R17: the JD is stored and used as raw text).
 */

/**
 * S-14 만들기: project + JD (raw text, server sentence split) + `created` stage event, then — for a
 * NEW row only, never a same-id replay — the automatic insight start (JR-6, DM 2.6.2): same
 * service as the manual start, skipped silently when AI isn't connected / D-01 fails / a run is in
 * flight, and any start error is swallowed (creation already succeeded).
 */
export async function createApplicationProject(input: unknown): Promise<ActionResult<CreateApplicationProjectResult>> {
  const parsed = CreateApplicationProjectInput.safeParse(input);
  if (!parsed.success) return invalid(parsed.error);
  return runAction(async () => {
    const { supabase, user } = await requireConsentedUser();
    const created = await writes.createApplicationProject(supabase, parsed.data);
    if (!created.created) return { ...created, insightJobId: null, insightSkipReason: null };
    const auto = await autoStartInsight(
      {
        userId: user.id,
        user: supabase,
        providerContext: connections().context,
        runner: { startJob: async (job) => createAppJobRunner(await getSiteOrigin()).startJob(job) },
        pipeline: productionInsightPipeline,
        log: logJobEvent,
      },
      created.applicationProjectId,
    );
    return { ...created, ...auto };
  });
}

/**
 * S-15 공고 내용 수정 (JR-7, DM 2.6.1): RPC `update_jd_raw_text` — any time except while an
 * insight runs. Existing insights stay (stale). No AI, no key needed. Own codes in
 * `JD_RAW_TEXT_REFUSAL_CODES`.
 */
export async function updateJdRawText(input: unknown): Promise<ActionResult<UpdateJdRawTextResult>> {
  const parsed = UpdateJdRawTextInput.safeParse(input);
  if (!parsed.success) return invalid(parsed.error);
  return runAction(async () => {
    const { supabase } = await requireConsentedUser();
    return writes.updateJdRawText(supabase, parsed.data);
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

/** S-15 채용 공고 (원문 + 문장, `rawTextEditable` / `rawTextLockedReason`). */
export async function getJdView(input: unknown): Promise<ActionResult<JdView>> {
  const parsed = ApplicationProjectIdInput.safeParse(input);
  if (!parsed.success) return invalid(parsed.error);
  return runAction(async () => {
    const { supabase } = await requireConsentedUser();
    return reads.getJdView(supabase, parsed.data.id);
  });
}
