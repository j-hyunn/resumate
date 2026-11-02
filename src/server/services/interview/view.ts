import { aiErrorEvent } from "@/lib/contracts/ai";
import { toAiFailure } from "@/lib/contracts/application";
import { AI_ERROR_CODES, AI_PROVIDERS, CONNECTION_TIERS, DATA_SUFFICIENCIES, type AiErrorCode, type AiProvider, type ConnectionTier } from "@/lib/contracts/enums";
import {
  ANSWER_SCORE_STATUSES,
  INTERVIEW_GENERATION_STATUSES,
  INTERVIEW_SESSION_STATUSES,
  INTERVIEW_TYPES,
  SESSION_SCORE_STATUSES,
  type AnswerScoreView,
  type DataSufficiency,
  type ExecutionProviderView,
  type InterviewActiveJob,
  type InterviewGenerationStatus,
  type InterviewJobFailure,
  type InterviewSessionHeader,
  type InterviewSessionListItem,
  type InterviewSessionStatus,
  type InterviewType,
  type ProviderModel,
  type SessionScoreView,
} from "@/lib/contracts/interview";

/**
 * Pure S8 view helpers shared by the four reads (S-20 / S-33 / S-22 / S-37).
 *
 * "Leftover" rule (S6 / S7, db notes): the job-end triggers skip locked rows,
 * so a session can rarely stay `generating` / `evaluating` after its job
 * ended. Such a row reads as failed (`generation_status = failed` /
 * `status = evaluation_failed`) with that job's failure (`stalled` when the
 * job ended `succeeded` without completing the session, or is gone).
 */

export const QUESTIONS_JOB_TYPE = "interview_questions" as const;
export const EVALUATION_JOB_TYPE = "interview_evaluation" as const;
export const INTERVIEW_TARGET_TYPE = "interview_session" as const;
export type InterviewJobType = typeof QUESTIONS_JOB_TYPE | typeof EVALUATION_JOB_TYPE;

/** interview_sessions columns every read selects (never hidden question columns). */
export const SESSION_COLUMNS =
  "id, application_project_id, interview_type, question_count, data_sufficiency, weak_requirement_ids, status, generation_status, answered_count, unanswered_count, submitted_at, completed_at, result_viewed_at, abandoned_at, last_activity_at, created_at, score_status, score_value, score_max, score_method_version, score_rationale, score_counted_count, question_provider, question_model, evaluation_provider, evaluation_model";

export type SessionRow = {
  id: string;
  application_project_id: string;
  interview_type: string;
  question_count: number;
  data_sufficiency: string;
  weak_requirement_ids: string[] | null;
  status: string;
  generation_status: string;
  answered_count: number;
  unanswered_count: number;
  submitted_at: string | null;
  completed_at: string | null;
  result_viewed_at: string | null;
  abandoned_at: string | null;
  last_activity_at: string | null;
  created_at: string;
  score_status: string | null;
  score_value: number | null;
  score_max: number | null;
  score_method_version: string | null;
  score_rationale: string | null;
  score_counted_count: number | null;
  question_provider: string | null;
  question_model: string | null;
  evaluation_provider: string | null;
  evaluation_model: string | null;
};

/** ai_jobs columns the reads need (user session can read its own jobs). */
export const INTERVIEW_JOB_COLUMNS = "id, job_type, target_id, status, progress, provider, connection_tier, error_code, retry_after, quota_resets_at, finished_at, created_at";

export type InterviewJobRow = {
  id: string;
  job_type: string;
  target_id: string | null;
  status: string;
  progress: unknown;
  provider: string;
  connection_tier: string;
  error_code: string | null;
  retry_after: string | null;
  quota_resets_at: string | null;
  finished_at: string | null;
  created_at: string;
};

const oneOf = <T extends string>(list: readonly T[], v: unknown): T | null => (typeof v === "string" && (list as readonly string[]).includes(v) ? (v as T) : null);
const obj = (v: unknown): Record<string, unknown> => (v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {});

export function providerOf(v: unknown): AiProvider | null {
  return oneOf(AI_PROVIDERS, v);
}

function providerModel(provider: string | null, model: string | null): ProviderModel | null {
  const p = providerOf(provider);
  return p ? { provider: p, model } : null;
}

/**
 * DM 2.7 v4.1 "실행 공급자": evaluation started (evaluation_provider set) →
 * evaluation, else question; both when the providers differ.
 */
export function executionProviderOf(row: Pick<SessionRow, "question_provider" | "question_model" | "evaluation_provider" | "evaluation_model">): ExecutionProviderView | null {
  const question = providerModel(row.question_provider, row.question_model);
  const evaluation = providerModel(row.evaluation_provider, row.evaluation_model);
  if (evaluation) {
    if (question && question.provider !== evaluation.provider) return { kind: "split", question, evaluation };
    return { kind: "single", role: "evaluation", ...evaluation };
  }
  if (question) return { kind: "single", role: "question", ...question };
  return null;
}

/** Providers a session "runs on" for the S-37 filter [가정: either shown provider matches]. */
export function executionProvidersOf(view: ExecutionProviderView | null): AiProvider[] {
  if (!view) return [];
  return view.kind === "single" ? [view.provider] : [view.question.provider, view.evaluation.provider];
}

/** Jobs of one session, newest first. */
export function jobsOfSession(jobs: readonly InterviewJobRow[], sessionId: string, jobType?: InterviewJobType): InterviewJobRow[] {
  return jobs
    .filter((j) => j.target_id === sessionId && (!jobType || j.job_type === jobType))
    .sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at));
}

const isActive = (j: InterviewJobRow) => j.status === "queued" || j.status === "running";

export function toActiveJob(row: InterviewJobRow): InterviewActiveJob | null {
  if (!isActive(row)) return null;
  const jobType = row.job_type === QUESTIONS_JOB_TYPE || row.job_type === EVALUATION_JOB_TYPE ? row.job_type : null;
  if (!jobType) return null;
  const p = obj(row.progress);
  return {
    jobId: row.id,
    jobType,
    status: row.status as "queued" | "running",
    progress: {
      stage: typeof p.stage === "string" && p.stage ? p.stage : "prepare",
      done: typeof p.done === "number" ? p.done : 0,
      total: typeof p.total === "number" ? p.total : 1,
    },
    provider: providerOf(row.provider) ?? "anthropic",
    connectionTier: (oneOf<ConnectionTier>(CONNECTION_TIERS, row.connection_tier) ?? "paid") as ConnectionTier,
  };
}

/** C-20 failure of an ended interview job; `stalled` for a job that ended without completing the session. */
export function toJobFailure(row: InterviewJobRow | null, jobType: InterviewJobType, fallbackJobId: string | null = null): InterviewJobFailure {
  if (!row || row.status !== "failed") {
    return { ...toAiFailure(aiErrorEvent("stalled")), jobId: row?.id ?? fallbackJobId, jobType, failedAt: row?.finished_at ?? null };
  }
  const code = oneOf<AiErrorCode>(AI_ERROR_CODES, row.error_code) ?? "stalled";
  return {
    ...toAiFailure(aiErrorEvent(code, { retryAfter: row.retry_after, quotaResetsAt: row.quota_resets_at })),
    jobId: row.id,
    jobType,
    failedAt: row.finished_at,
  };
}

export type ResolvedRun = {
  status: InterviewSessionStatus;
  generationStatus: InterviewGenerationStatus;
  activeJob: InterviewActiveJob | null;
  /** The failure behind a failed generation / evaluation (null otherwise, and after a user cancel of generation [가정]). */
  failure: InterviewJobFailure | null;
};

/**
 * Effective session status from the row + its jobs (newest first).
 * - An active job of the session is the progress shown (C-03).
 * - `generating` with no active questions job → `failed` (leftover rule).
 * - `evaluating` with no active evaluation job → `evaluation_failed`.
 * - `failed` generation / `evaluation_failed` → the newest job of that type's failure.
 */
export function resolveSessionRun(row: Pick<SessionRow, "status" | "generation_status">, jobs: readonly InterviewJobRow[]): ResolvedRun {
  let status = oneOf(INTERVIEW_SESSION_STATUSES, row.status) ?? "in_progress";
  let generationStatus = oneOf(INTERVIEW_GENERATION_STATUSES, row.generation_status) ?? "generating";
  const questionJobs = jobs.filter((j) => j.job_type === QUESTIONS_JOB_TYPE);
  const evaluationJobs = jobs.filter((j) => j.job_type === EVALUATION_JOB_TYPE);
  const activeQuestions = questionJobs.find(isActive) ?? null;
  const activeEvaluation = evaluationJobs.find(isActive) ?? null;

  if (generationStatus === "generating" && !activeQuestions) generationStatus = "failed";
  if (status === "evaluating" && !activeEvaluation) status = "evaluation_failed";
  // An abandoned session shows no job progress (its generation was canceled).
  const activeRow = status === "abandoned" ? null : (activeEvaluation ?? activeQuestions);
  const activeJob = activeRow ? toActiveJob(activeRow) : null;

  let failure: InterviewJobFailure | null = null;
  if (!activeJob) {
    if (status === "evaluation_failed") failure = toJobFailure(evaluationJobs[0] ?? null, EVALUATION_JOB_TYPE);
    else if (generationStatus === "failed" && status === "in_progress") {
      const newest = questionJobs[0] ?? null;
      // A canceled generation (user cancel) still needs "남은 질문 다시 만들기", shown as a failure [가정].
      failure = toJobFailure(newest, QUESTIONS_JOB_TYPE);
    }
  }
  return { status, generationStatus, activeJob, failure };
}

/** C-17 session score; `status: null` before submission. */
export function sessionScoreOf(row: Pick<SessionRow, "score_status" | "score_value" | "score_max" | "score_method_version" | "score_rationale" | "score_counted_count" | "unanswered_count" | "question_count">): SessionScoreView {
  const status = oneOf(SESSION_SCORE_STATUSES, row.score_status);
  return {
    status,
    value: row.score_value,
    max: row.score_max,
    methodVersion: row.score_method_version,
    rationale: row.score_rationale,
    countedCount: row.score_counted_count,
    noAnswers: status === "not_scored" && row.question_count > 0 && row.unanswered_count === row.question_count,
  };
}

export function answerScoreOf(row: { score_status: string | null; score_value: number | null; score_max: number | null; score_method_version: string | null; score_rationale: string | null }): AnswerScoreView {
  return {
    status: oneOf(ANSWER_SCORE_STATUSES, row.score_status),
    value: row.score_value,
    max: row.score_max,
    methodVersion: row.score_method_version,
    rationale: row.score_rationale,
  };
}

export function interviewTypeOf(v: unknown): InterviewType {
  return oneOf(INTERVIEW_TYPES, v) ?? "job";
}

export function dataSufficiencyOf(v: unknown): DataSufficiency {
  return oneOf(DATA_SUFFICIENCIES, v) ?? "none";
}

export function toSessionHeader(row: SessionRow, projectName: string, run: ResolvedRun): InterviewSessionHeader {
  return {
    id: row.id,
    applicationProjectId: row.application_project_id,
    applicationProjectName: projectName,
    interviewType: interviewTypeOf(row.interview_type),
    questionCount: row.question_count,
    dataSufficiency: dataSufficiencyOf(row.data_sufficiency),
    status: run.status,
    generationStatus: run.generationStatus,
    answeredCount: row.answered_count,
    unansweredCount: row.unanswered_count,
    createdAt: row.created_at,
    lastActivityAt: row.last_activity_at,
    submittedAt: row.submitted_at,
    completedAt: row.completed_at,
    abandonedAt: row.abandoned_at,
    resultViewedAt: row.result_viewed_at,
    questionProvider: providerModel(row.question_provider, row.question_model),
    evaluationProvider: providerModel(row.evaluation_provider, row.evaluation_model),
  };
}

export function toListItem(row: SessionRow, projectName: string, jobs: readonly InterviewJobRow[]): InterviewSessionListItem {
  const run = resolveSessionRun(row, jobsOfSession(jobs, row.id));
  const finished = run.status === "completed" || run.status === "evaluation_failed";
  return {
    id: row.id,
    applicationProjectId: row.application_project_id,
    applicationProjectName: projectName,
    interviewType: interviewTypeOf(row.interview_type),
    questionCount: row.question_count,
    dataSufficiency: dataSufficiencyOf(row.data_sufficiency),
    status: run.status,
    generationStatus: run.generationStatus,
    answeredCount: row.answered_count,
    unansweredCount: row.unanswered_count,
    createdAt: row.created_at,
    lastActivityAt: row.last_activity_at,
    submittedAt: row.submitted_at,
    completedAt: row.completed_at,
    abandonedAt: row.abandoned_at,
    score: sessionScoreOf(row),
    isNewResult: finished && row.submitted_at !== null && row.result_viewed_at === null,
    executionProvider: executionProviderOf(row),
    activeJob: run.activeJob,
  };
}

/** S-37 order: in progress on top, abandoned at the bottom, newest first inside each group. */
export function groupSessions(items: readonly InterviewSessionListItem[]): {
  inProgress: InterviewSessionListItem[];
  sessions: InterviewSessionListItem[];
  abandoned: InterviewSessionListItem[];
} {
  const byNewest = [...items].sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt) || (a.id < b.id ? 1 : -1));
  return {
    inProgress: byNewest.filter((s) => s.status === "in_progress"),
    sessions: byNewest.filter((s) => s.status !== "in_progress" && s.status !== "abandoned"),
    abandoned: byNewest.filter((s) => s.status === "abandoned"),
  };
}
