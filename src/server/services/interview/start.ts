import type { ReadinessFeature } from "@/lib/contracts/career";
import { AppError } from "@/lib/contracts/errors";
import type {
  DataSufficiency,
  InterviewType,
  RetryInterviewEvaluationResponse,
  RetryInterviewQuestionsResponse,
  StartInterviewSessionResponse,
  SubmitInterviewSessionResponse,
} from "@/lib/contracts/interview";
import { mapDbError } from "@/server/db/errors";
import type { UserSupabaseClient } from "@/server/db/types";
import type { ProviderContextSource } from "@/server/jobs/provider-context";
import type { JobRunner } from "@/server/jobs/runner";
import { assertApplicationProjectOwned } from "@/server/services/application/db";
import { getDataReadiness } from "@/server/services/career";
import { raiseName } from "@/server/services/insight/db";
import {
  EVALUATION_JOB_TYPE,
  INTERVIEW_JOB_COLUMNS,
  INTERVIEW_TARGET_TYPE,
  QUESTIONS_JOB_TYPE,
  resolveSessionRun,
  type InterviewJobRow,
} from "./view";

/**
 * S8 interview routes (plan "계약 — API" 2): start, 남은 질문 다시 만들기,
 * 제출, 다시 채점. Order everywhere: ownership (RLS) → [readiness] →
 * connection gate (active provider, key, consent; 409 — never a job or a
 * session without a usable key) → user RPC → job (`interview_questions` /
 * `interview_evaluation`, target `interview_session`, D-34 one in flight per
 * session and type). Status / cancel stay on `/api/ai-jobs/{id}`.
 */

export type InterviewStartDeps = {
  userId: string;
  user: UserSupabaseClient;
  providerContext: ProviderContextSource;
  runner: Pick<JobRunner, "startJob">;
  promptVersions: { questions: string; evaluation: string };
  getReadiness?: (db: UserSupabaseClient) => Promise<{ features: { job_interview: ReadinessFeature; culture_fit_interview: { ready: boolean; data_sufficiency: DataSufficiency } } }>;
};

export type StartInterviewOutcome =
  | { kind: "started"; data: StartInterviewSessionResponse }
  | { kind: "insufficient_data"; readiness: ReadinessFeature };

export const INTERVIEW_INSUFFICIENT_DATA_MESSAGE = "직무 면접을 시작하려면 완료된 경력과 프로젝트가 1개 이상 필요해요. 컬처핏 면접은 지금 바로 연습할 수 있어요.";

const notConnected = () => new AppError("ai_not_connected", "AI 연결이 필요합니다. 키를 등록한 뒤 다시 시도해 주세요.", { status: 409 });
const keyInvalid = () => new AppError("key_invalid", "AI 키가 유효하지 않습니다. 키를 확인해 다시 연결해 주세요.", { status: 409 });
const sessionNotFound = () => new AppError("not_found", "면접 세션을 찾을 수 없습니다. 새로고침 후 다시 시도해 주세요.", { status: 404 });

/** C-18 / C-20 gate before any session write (startJob repeats it). */
async function assertConnected(deps: Pick<InterviewStartDeps, "providerContext" | "userId">): Promise<void> {
  const context = await deps.providerContext.forUser(deps.userId);
  if (!context) throw notConnected();
  if (context.keyStatus === "invalid") throw keyInvalid();
}

type SessionCore = { id: string; application_project_id: string; status: string; generation_status: string; submitted_at: string | null };

async function loadSessionCore(user: UserSupabaseClient, sessionId: string): Promise<SessionCore> {
  const { data, error } = await user
    .from("interview_sessions")
    .select("id, application_project_id, status, generation_status, submitted_at")
    .eq("id", sessionId)
    .maybeSingle();
  if (error) throw mapDbError(error);
  if (!data) throw sessionNotFound();
  return data;
}

async function loadSessionJobs(user: UserSupabaseClient, sessionId: string): Promise<InterviewJobRow[]> {
  const { data, error } = await user
    .from("ai_jobs")
    .select(INTERVIEW_JOB_COLUMNS)
    .eq("target_type", INTERVIEW_TARGET_TYPE)
    .eq("target_id", sessionId)
    .in("job_type", [QUESTIONS_JOB_TYPE, EVALUATION_JOB_TYPE])
    .order("created_at", { ascending: false })
    .limit(20);
  if (error) throw mapDbError(error);
  return (data ?? []) as InterviewJobRow[];
}

function startQuestionsJob(deps: InterviewStartDeps, session: { id: string; applicationProjectId: string }) {
  return deps.runner.startJob({
    userId: deps.userId,
    jobType: QUESTIONS_JOB_TYPE,
    target: { type: INTERVIEW_TARGET_TYPE, id: session.id },
    applicationProjectId: session.applicationProjectId,
    params: { sessionId: session.id, applicationProjectId: session.applicationProjectId },
    promptVersion: deps.promptVersions.questions,
    regenerate: true,
  });
}

function startEvaluationJob(deps: InterviewStartDeps, session: { id: string; applicationProjectId: string }) {
  return deps.runner.startJob({
    userId: deps.userId,
    jobType: EVALUATION_JOB_TYPE,
    target: { type: INTERVIEW_TARGET_TYPE, id: session.id },
    applicationProjectId: session.applicationProjectId,
    params: { sessionId: session.id, applicationProjectId: session.applicationProjectId },
    promptVersion: deps.promptVersions.evaluation,
    regenerate: true,
  });
}

/** `POST /api/application-projects/{id}/interview-sessions`. */
export async function startInterviewSession(
  deps: InterviewStartDeps,
  applicationProjectId: string,
  input: { interviewType: InterviewType; questionCount: 3 | 5 | 7 },
): Promise<StartInterviewOutcome> {
  const { user } = deps;
  await assertApplicationProjectOwned(user, applicationProjectId);

  // DM §6: job interview needs D-01; culture fit is always allowed and stores its data sufficiency (U-5 [가정]).
  const readiness = await (deps.getReadiness ?? getDataReadiness)(user);
  let dataSufficiency: DataSufficiency;
  if (input.interviewType === "job") {
    if (!readiness.features.job_interview.ready) return { kind: "insufficient_data", readiness: readiness.features.job_interview };
    dataSufficiency = "ok";
  } else {
    dataSufficiency = readiness.features.culture_fit_interview.data_sufficiency;
  }

  await assertConnected(deps);

  const { data, error } = await user.rpc("create_interview_session", {
    p_application_project_id: applicationProjectId,
    p_interview_type: input.interviewType,
    p_question_count: input.questionCount,
    p_data_sufficiency: dataSufficiency,
  });
  if (error) {
    if (raiseName(error) === "interview_in_progress") {
      // [가정 5] one in-progress session per project: continue it (C-14 / S-20 배너).
      const sessionId = typeof error.details === "string" && error.details ? error.details : null;
      throw new AppError("interview_in_progress", "이 기업 JD에 작성 중인 면접이 있어요. 이어서 쓰거나 그만둔 뒤 새로 시작해 주세요.", {
        status: 409,
        details: { sessionId },
      });
    }
    throw mapDbError(error);
  }
  const row = (data ?? {}) as { session_id?: string };
  const sessionId = row.session_id;
  if (!sessionId) throw new AppError("internal_error", undefined, { status: 500 });

  let jobId: string;
  try {
    jobId = (await startQuestionsJob(deps, { id: sessionId, applicationProjectId })).jobId;
  } catch (err) {
    // No job → the empty session would read as a failed generation forever; remove it (no questions yet).
    await user.from("interview_sessions").delete().eq("id", sessionId);
    throw err;
  }
  return { kind: "started", data: { sessionId, jobId, dataSufficiency } };
}

/** `POST /api/interview-sessions/{id}/questions/retry` — only while generation failed (S-33). */
export async function retryInterviewQuestions(deps: InterviewStartDeps, sessionId: string): Promise<RetryInterviewQuestionsResponse> {
  const session = await loadSessionCore(deps.user, sessionId);
  const run = resolveSessionRun(session, await loadSessionJobs(deps.user, sessionId));
  if (run.activeJob?.jobType === QUESTIONS_JOB_TYPE) return { sessionId, jobId: run.activeJob.jobId, inProgress: true };
  if (session.status !== "in_progress" || run.generationStatus !== "failed") {
    throw new AppError("interview_generation_not_failed", "다시 만들 질문이 없어요.", { status: 409 });
  }
  await assertConnected(deps);
  const started = await startQuestionsJob(deps, { id: sessionId, applicationProjectId: session.application_project_id });
  return { sessionId, jobId: started.jobId, inProgress: started.inProgress };
}

/** `POST /api/interview-sessions/{id}/submit` — key needed (v5: 제출 = 채점). */
export async function submitInterviewSession(deps: InterviewStartDeps, sessionId: string): Promise<SubmitInterviewSessionResponse> {
  const session = await loadSessionCore(deps.user, sessionId);
  await assertConnected(deps);
  const { data, error } = await deps.user.rpc("submit_interview_session", { p_session_id: sessionId });
  if (error) throw mapDbError(error);
  const r = (data ?? {}) as { status?: string; answered_count?: number; unanswered_count?: number; evaluation_needed?: boolean };
  const status = r.status === "completed" ? "completed" : "evaluating";
  let jobId: string | null = null;
  if (r.evaluation_needed) {
    // If this fails the session reads `evaluation_failed` (no job) and 다시 채점 starts one.
    jobId = (await startEvaluationJob(deps, { id: sessionId, applicationProjectId: session.application_project_id })).jobId;
  }
  return { sessionId, status, jobId, answeredCount: r.answered_count ?? 0, unansweredCount: r.unanswered_count ?? 0 };
}

/**
 * `POST /api/interview-sessions/{id}/evaluation/retry` (다시 채점): when the
 * session is `evaluation_failed` (effective), or `completed` with `not_scored`
 * answers. begin_interview_evaluation picks the answers without a success.
 */
export async function retryInterviewEvaluation(deps: InterviewStartDeps, sessionId: string): Promise<RetryInterviewEvaluationResponse> {
  const session = await loadSessionCore(deps.user, sessionId);
  const run = resolveSessionRun(session, await loadSessionJobs(deps.user, sessionId));
  if (run.activeJob?.jobType === EVALUATION_JOB_TYPE) return { sessionId, jobId: run.activeJob.jobId, inProgress: true };
  let retryable = run.status === "evaluation_failed";
  if (!retryable && run.status === "completed") {
    const { count, error } = await deps.user
      .from("interview_answers")
      .select("id", { count: "exact", head: true })
      .eq("session_id", sessionId)
      .eq("score_status", "not_scored");
    if (error) throw mapDbError(error);
    retryable = (count ?? 0) > 0;
  }
  if (!retryable) throw new AppError("interview_evaluation_not_retryable", "다시 채점할 답변이 없어요.", { status: 409 });
  await assertConnected(deps);
  const started = await startEvaluationJob(deps, { id: sessionId, applicationProjectId: session.application_project_id });
  return { sessionId, jobId: started.jobId, inProgress: started.inProgress };
}
