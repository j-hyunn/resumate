"use server";

import { invalid, runAction, type ActionResult } from "@/lib/contracts/errors";
import {
  GetAnswerSheetInput,
  GetInterviewPrepInput,
  GetInterviewResultInput,
  InterviewSessionIdInput,
  ListInterviewSessionsInput,
  SaveInterviewAnswerInput,
  type AbandonInterviewSessionResult,
  type AnswerSheetView,
  type DeleteInterviewSessionResult,
  type InterviewPrepView,
  type InterviewResultView,
  type InterviewSessionList,
  type MarkInterviewResultViewedResult,
  type SaveInterviewAnswerResult,
} from "@/lib/contracts/interview";
import { requireConsentedUser } from "@/server/auth/session";
import * as reads from "@/server/services/interview/read";
import * as writes from "@/server/services/interview/write";

/**
 * S8 interview Server Actions (no key needed; plan "계약 — API" 3–4). Starting,
 * retrying and submitting call AI and are Route Handlers under
 * `/api/application-projects/{id}/interview-sessions` and `/api/interview-sessions/{id}/…`.
 * The reads are the same services Server Components call at wiring time.
 */

/** S-33 자동 저장 (answer_text only; RLS enforces the edit condition). */
export async function saveInterviewAnswer(input: unknown): Promise<ActionResult<SaveInterviewAnswerResult>> {
  const parsed = SaveInterviewAnswerInput.safeParse(input);
  if (!parsed.success) return invalid(parsed.error);
  return runAction(async () => {
    const { supabase } = await requireConsentedUser();
    return writes.saveInterviewAnswer(supabase, parsed.data);
  });
}

/** S-20 / S-33 그만두기 (cancels a running generation). */
export async function abandonInterviewSession(input: unknown): Promise<ActionResult<AbandonInterviewSessionResult>> {
  const parsed = InterviewSessionIdInput.safeParse(input);
  if (!parsed.success) return invalid(parsed.error);
  return runAction(async () => {
    const { supabase } = await requireConsentedUser();
    return writes.abandonInterviewSession(supabase, parsed.data);
  });
}

/** S-20 / S-37 삭제 (any status, F-P3-15). */
export async function deleteInterviewSession(input: unknown): Promise<ActionResult<DeleteInterviewSessionResult>> {
  const parsed = InterviewSessionIdInput.safeParse(input);
  if (!parsed.success) return invalid(parsed.error);
  return runAction(async () => {
    const { supabase } = await requireConsentedUser();
    return writes.deleteInterviewSession(supabase, parsed.data);
  });
}

/** S-22 결과 열람 기록 (getInterviewResult also marks it on the first open). */
export async function markInterviewResultViewed(input: unknown): Promise<ActionResult<MarkInterviewResultViewedResult>> {
  const parsed = InterviewSessionIdInput.safeParse(input);
  if (!parsed.success) return invalid(parsed.error);
  return runAction(async () => {
    const { supabase } = await requireConsentedUser();
    return writes.markInterviewResultViewed(supabase, parsed.data);
  });
}

export async function getInterviewPrep(input: unknown): Promise<ActionResult<InterviewPrepView>> {
  const parsed = GetInterviewPrepInput.safeParse(input);
  if (!parsed.success) return invalid(parsed.error);
  return runAction(async () => {
    const { supabase } = await requireConsentedUser();
    return reads.getInterviewPrep(supabase, parsed.data);
  });
}

export async function getAnswerSheet(input: unknown): Promise<ActionResult<AnswerSheetView>> {
  const parsed = GetAnswerSheetInput.safeParse(input);
  if (!parsed.success) return invalid(parsed.error);
  return runAction(async () => {
    const { supabase } = await requireConsentedUser();
    return reads.getAnswerSheet(supabase, parsed.data);
  });
}

export async function getInterviewResult(input: unknown): Promise<ActionResult<InterviewResultView>> {
  const parsed = GetInterviewResultInput.safeParse(input);
  if (!parsed.success) return invalid(parsed.error);
  return runAction(async () => {
    const { supabase } = await requireConsentedUser();
    return reads.getInterviewResult(supabase, parsed.data);
  });
}

export async function listInterviewSessions(input: unknown): Promise<ActionResult<InterviewSessionList>> {
  const parsed = ListInterviewSessionsInput.safeParse(input ?? {});
  if (!parsed.success) return invalid(parsed.error);
  return runAction(async () => {
    const { supabase } = await requireConsentedUser();
    return reads.listInterviewSessions(supabase, parsed.data);
  });
}
