import { z } from "zod";
import type { AiJobStatus, AiJobType, AiProvider, ConnectionTier } from "./enums";
import {
  ANSWER_SCORE_STATUSES,
  DATA_SUFFICIENCIES,
  EVALUATION_CRITERIA_KEYS,
  EVALUATION_GRADES,
  INTERVIEW_ANCHORS,
  INTERVIEW_ANSWER_STATUSES,
  INTERVIEW_GENERATION_STATUSES,
  INTERVIEW_QUESTION_COUNTS,
  INTERVIEW_RESULT_STATUSES,
  INTERVIEW_SESSION_STATUSES,
  INTERVIEW_SOURCE_KINDS,
  INTERVIEW_TYPES,
  NEXT_PRACTICE_TYPES,
  SESSION_SCORE_STATUSES,
  type AnswerScoreStatus,
  type EvaluationCriteriaKey,
  type EvaluationGrade,
  type InterviewAnchor,
  type InterviewAnswerStatus,
  type InterviewGenerationStatus,
  type InterviewResultStatus,
  type InterviewSessionStatus,
  type InterviewSourceKind,
  type InterviewType,
  type NextPracticeType,
  type SessionScoreStatus,
} from "./enums";
import type { AiFailure } from "./application";
import type { ReadinessAiConnection } from "./ai-connection";
import type { ReadinessFeature } from "./career";
import type { EvidenceChip } from "./evidence";

/**
 * S8 mock interview contracts (AI-05 / AI-06 / AI-07; F-P3-01~04, 06, 07, 13,
 * 15, D-14, D-36; DM A.12–A.13; UX S-20, S-33, S-22 (C-17), S-37, C-14).
 *
 * Hidden columns (`interview_questions.intent`, `good_answer_signals`) never
 * appear in a pre-submit shape: `intent` only in `InterviewResultView` after
 * submission (RPC `get_interview_question_reveals`), `good_answer_signals`
 * never.
 */

export {
  ANSWER_SCORE_STATUSES,
  DATA_SUFFICIENCIES,
  EVALUATION_CRITERIA_KEYS,
  EVALUATION_GRADES,
  INTERVIEW_ANCHORS,
  INTERVIEW_ANSWER_STATUSES,
  INTERVIEW_GENERATION_STATUSES,
  INTERVIEW_QUESTION_COUNTS,
  INTERVIEW_RESULT_STATUSES,
  INTERVIEW_SESSION_STATUSES,
  INTERVIEW_SOURCE_KINDS,
  INTERVIEW_TYPES,
  NEXT_PRACTICE_TYPES,
  SESSION_SCORE_STATUSES,
};
export type {
  AnswerScoreStatus,
  EvaluationCriteriaKey,
  EvaluationGrade,
  InterviewAnchor,
  InterviewAnswerStatus,
  InterviewGenerationStatus,
  InterviewResultStatus,
  InterviewSessionStatus,
  InterviewSourceKind,
  InterviewType,
  NextPracticeType,
  SessionScoreStatus,
};

export type DataSufficiency = (typeof DATA_SUFFICIENCIES)[number];

/** interview_answers.answer_text limit (DM A.13). */
export const INTERVIEW_ANSWER_MAX_CHARS = 5000;

const uuid = z.guid();
export const InterviewTypeSchema = z.enum(INTERVIEW_TYPES);
export const InterviewQuestionCountSchema = z.union([z.literal(3), z.literal(5), z.literal(7)]);

// ---------- routes (async jobs; status / cancel via /api/ai-jobs/{id}) ----------

/**
 * `POST /api/application-projects/{id}/interview-sessions` body (S-20 시작하기).
 * No default type (F-P3-01 v3); question count 3/5/7, default 5.
 */
export const StartInterviewSessionInput = z
  .object({
    interviewType: InterviewTypeSchema,
    questionCount: InterviewQuestionCountSchema.optional().default(5),
  })
  .strict();
export type StartInterviewSessionInput = z.input<typeof StartInterviewSessionInput>;

/**
 * 200 `{ data }`: the new session and its `interview_questions` job → S-33,
 * poll `GET /api/ai-jobs/{jobId}` (`progress {generate, done, total}`; the
 * questions themselves come from `getAnswerSheet`).
 *
 * Errors: 401, 404, 400, 422 `insufficient_data` + `readiness`
 * (`features.job_interview`, job type only — culture fit is always allowed),
 * 409 `interview_in_progress` (`error.details.sessionId` = the session to
 * continue, C-14 / S-20 배너), 409 `ai_not_connected` / `key_invalid` /
 * `ai_consent_required` (C-18 / C-20).
 */
export type StartInterviewSessionResponse = {
  sessionId: string;
  jobId: string;
  dataSufficiency: DataSufficiency;
};

/** 422 body of the start route (C-09 / C-10 banner for 직무 면접). */
export type InterviewInsufficientDataResponse = {
  error: { code: "insufficient_data"; message: string };
  readiness: ReadinessFeature;
};

/**
 * `POST /api/interview-sessions/{id}/questions/retry` (남은 질문 다시 만들기,
 * S-33). Only while `generationStatus = failed`; keeps the saved questions and
 * generates the remaining count. 200 `{ data }`; 409
 * `interview_generation_not_failed` / `ai_not_connected` / `key_invalid` /
 * `ai_consent_required`; 404.
 */
export type RetryInterviewQuestionsResponse = { sessionId: string; jobId: string; inProgress: boolean };

/**
 * `POST /api/interview-sessions/{id}/submit` (1회 제출, S-33). Needs a usable
 * key (v5: 제출 = 채점). Blank answers become `unanswered`. With ≥ 1 answer
 * an `interview_evaluation` job starts (`jobId`); with none the session is
 * `completed` + `not_scored` right away (`jobId: null`, no AI).
 * 409 `interview_already_submitted` / `interview_generation_not_ready` /
 * `interview_not_in_progress` / connection codes; 404.
 */
export type SubmitInterviewSessionResponse = {
  sessionId: string;
  status: InterviewSessionStatus;
  jobId: string | null;
  answeredCount: number;
  unansweredCount: number;
};

/**
 * `POST /api/interview-sessions/{id}/evaluation/retry` (다시 채점, S-22).
 * Only when the session is `evaluation_failed`, or `completed` with
 * `not_scored` answers; re-evaluates only the failed answers and the summary.
 * 409 `interview_evaluation_not_retryable` / connection codes; 404.
 */
export type RetryInterviewEvaluationResponse = { sessionId: string; jobId: string; inProgress: boolean };

// ---------- Server Actions (no key needed) ----------

/** S-33 자동 저장. Only while the answer is `draft`, the session not submitted, and generation `ready`. */
export const SaveInterviewAnswerInput = z
  .object({
    answerId: uuid,
    answerText: z.string().max(INTERVIEW_ANSWER_MAX_CHARS),
  })
  .strict();
export type SaveInterviewAnswerInput = z.input<typeof SaveInterviewAnswerInput>;

export type SaveInterviewAnswerResult = {
  answerId: string;
  sessionId: string;
  updatedAt: string;
  /** Session counters after the save (트리거가 유지). */
  answeredCount: number;
  lastActivityAt: string | null;
};

/** abandon / delete / mark viewed / reads by session. */
export const InterviewSessionIdInput = z.object({ sessionId: uuid }).strict();
export type InterviewSessionIdInput = z.input<typeof InterviewSessionIdInput>;

export type AbandonInterviewSessionResult = { sessionId: string; status: InterviewSessionStatus; abandonedAt: string | null };
export type DeleteInterviewSessionResult = { sessionId: string; deleted: true };
export type MarkInterviewResultViewedResult = { sessionId: string; resultViewedAt: string | null };

// ---------- shared view pieces ----------

/** C-17 score slot (AI 4.3). `status: null` = before submission (show nothing). */
export type InterviewScoreView<S extends string> = {
  status: S | null;
  value: number | null;
  max: number | null;
  methodVersion: string | null;
  rationale: string | null;
};
export type SessionScoreView = InterviewScoreView<SessionScoreStatus> & {
  countedCount: number | null;
  /** C-17: `not_scored` with `unansweredCount = questionCount` → "답변이 없어 평가할 내용이 없어요". */
  noAnswers: boolean;
};
export type AnswerScoreView = InterviewScoreView<AnswerScoreStatus>;

export type ProviderModel = { provider: AiProvider; model: string | null };

/**
 * S-37 / S-20 "실행 공급자" (DM 2.7 v4.1, C-19): evaluation started →
 * `evaluation_*`, else `question_*`; both shown when the providers differ.
 * Null when neither is recorded yet (generation still running).
 */
export type ExecutionProviderView =
  | { kind: "single"; role: "question" | "evaluation"; provider: AiProvider; model: string | null }
  | { kind: "split"; question: ProviderModel; evaluation: ProviderModel };

/** The interview job in flight for a session (C-03 progress; poll `/api/ai-jobs/{jobId}`). */
export type InterviewActiveJob = {
  jobId: string;
  jobType: Extract<AiJobType, "interview_questions" | "interview_evaluation">;
  status: Extract<AiJobStatus, "queued" | "running">;
  progress: { stage: string; done: number; total: number };
  provider: AiProvider;
  connectionTier: ConnectionTier;
};

/** Last failed interview job of the session (C-20; retry via the session's retry route). */
export type InterviewJobFailure = AiFailure & {
  jobId: string | null;
  jobType: Extract<AiJobType, "interview_questions" | "interview_evaluation">;
  failedAt: string | null;
};

/** One row of S-37 / S-20 session lists. */
export type InterviewSessionListItem = {
  id: string;
  applicationProjectId: string;
  /** application_projects display name ("회사명 – 포지션명" fallback). */
  applicationProjectName: string;
  interviewType: InterviewType;
  questionCount: number;
  dataSufficiency: DataSufficiency;
  /** Effective status: `evaluating` whose job ended without success reads `evaluation_failed`. */
  status: InterviewSessionStatus;
  /** Effective: `generating` whose job ended without success reads `failed`. */
  generationStatus: InterviewGenerationStatus;
  answeredCount: number;
  unansweredCount: number;
  createdAt: string;
  lastActivityAt: string | null;
  submittedAt: string | null;
  completedAt: string | null;
  abandonedAt: string | null;
  score: SessionScoreView;
  /** 새 결과 표식: a finished result not opened yet. */
  isNewResult: boolean;
  executionProvider: ExecutionProviderView | null;
  activeJob: InterviewActiveJob | null;
};

// ---------- S-20 면접 준비 ----------

export const GetInterviewPrepInput = z.object({ applicationProjectId: uuid }).strict();
export type GetInterviewPrepInput = z.input<typeof GetInterviewPrepInput>;

export type InterviewPrepView = {
  applicationProjectId: string;
  applicationProjectName: string;
  readiness: {
    /** C-09 when not ready (대안: 컬처핏). */
    jobInterview: ReadinessFeature;
    /** Culture fit is always allowed; `thin` / `none` → "일반 질문 비중이 높아요". */
    cultureFit: { ready: boolean; dataSufficiency: DataSufficiency };
  };
  /** C-18 / C-19 (v4 `get_data_readiness().ai_connection`). */
  aiConnection: ReadinessAiConnection;
  /** 작성 중 세션 배너 (one per project). */
  inProgressSession: InterviewSessionListItem | null;
  /** This project's sessions, newest first; abandoned ones at the end. */
  sessions: InterviewSessionListItem[];
};

// ---------- S-33 면접 답변지 ----------

export const GetAnswerSheetInput = InterviewSessionIdInput;

/** A question as shown before submission: no `intent`, no `good_answer_signals`. */
export type InterviewQuestionView = {
  id: string;
  sequence: number;
  sourceKind: InterviewSourceKind;
  anchor: InterviewAnchor;
  questionText: string;
  focusCriteria: EvaluationCriteriaKey[];
  targetRequirementIds: string[];
  targetGapRequirementIds: string[];
  /** Question evidence (C-01, owner `interview_question`, item `question`). */
  evidence: EvidenceChip[];
};

export type InterviewAnswerView = {
  id: string;
  questionId: string;
  answerText: string;
  status: InterviewAnswerStatus;
  updatedAt: string;
};

export type InterviewSessionHeader = {
  id: string;
  applicationProjectId: string;
  applicationProjectName: string;
  interviewType: InterviewType;
  questionCount: number;
  dataSufficiency: DataSufficiency;
  status: InterviewSessionStatus;
  generationStatus: InterviewGenerationStatus;
  answeredCount: number;
  unansweredCount: number;
  createdAt: string;
  lastActivityAt: string | null;
  submittedAt: string | null;
  completedAt: string | null;
  abandonedAt: string | null;
  resultViewedAt: string | null;
  questionProvider: ProviderModel | null;
  evaluationProvider: ProviderModel | null;
};

export type AnswerSheetView = {
  session: InterviewSessionHeader;
  /** Saved questions in `sequence` order, each with its answer row. */
  items: Array<{ question: InterviewQuestionView; answer: InterviewAnswerView | null }>;
  /** S-33 편집 가능 조건: generation ready AND not submitted (and the answer `draft`). */
  editable: boolean;
  /** Generation progress / failure (C-03 / C-20); saved questions stay (D-36). */
  generation: {
    status: InterviewGenerationStatus;
    savedCount: number;
    remainingCount: number;
    activeJob: InterviewActiveJob | null;
    failure: InterviewJobFailure | null;
    /** "남은 질문 다시 만들기" (key needed). */
    canRetry: boolean;
  };
  /** Submit allowed now (generation ready, not submitted, in progress). The key is checked by the route. */
  canSubmit: boolean;
};

// ---------- S-22 면접 결과 ----------

export const GetInterviewResultInput = InterviewSessionIdInput;

export type CriterionView = {
  key: EvaluationCriteriaKey;
  grade: EvaluationGrade;
  reason: string;
  answerQuotes: string[];
  missing: string | null;
  evidence: EvidenceChip[];
};

export type AnswerEvaluationView = {
  status: InterviewResultStatus;
  criteria: CriterionView[];
  strengths: Array<{ text: string; answerQuotes: string[] }>;
  improvements: Array<{ text: string; how: string; relatedCriteria: EvaluationCriteriaKey[]; evidence: EvidenceChip[] }>;
  intentReveal: string | null;
  /** Placeholders (`[사례 입력 필요]` etc.) stay in `text`; `hint` says what to fill. */
  modelAnswer: { text: string; placeholders: Array<{ token: string; hint: string }>; suggestionsIfTrue: string[]; evidence: EvidenceChip[] } | null;
  consistencyNotes: Array<{ text: string; answerQuotes: string[]; evidence: EvidenceChip[] }>;
  /** C-19 per-evaluation (normally the session's evaluation provider). */
  provider: AiProvider | null;
  model: string | null;
};

export type InterviewResultItem = {
  question: InterviewQuestionView & {
    /** Revealed after submission (F-P3-06). */
    intent: string | null;
  };
  answer: { id: string; answerText: string; status: InterviewAnswerStatus; score: AnswerScoreView } | null;
  /** null for unanswered questions (no evaluation row). */
  evaluation: AnswerEvaluationView | null;
  /** "채점 실패" + 다시 채점 (C-17 `not_scored`). */
  evaluationFailed: boolean;
};

export type SessionFeedbackView = {
  status: InterviewResultStatus;
  headline: string;
  overallStrengths: Array<{ text: string; questionIds: string[]; relatedCriteria: EvaluationCriteriaKey[] }>;
  overallWeaknesses: Array<{ text: string; questionIds: string[]; relatedCriteria: EvaluationCriteriaKey[] }>;
  unansweredNote: string | null;
  nextPractice: Array<{
    type: NextPracticeType;
    text: string;
    requirementIds: string[];
    questionId: string | null;
    interviewType: InterviewType | null;
  }>;
  criteriaSummary: Array<{ key: EvaluationCriteriaKey; distribution: Partial<Record<EvaluationGrade, number>> }>;
  /** Evidence chips by `item_key` (owner `session_feedback`). */
  evidence: Record<string, EvidenceChip[]>;
  provider: AiProvider | null;
  model: string | null;
};

export type InterviewResultView = {
  session: InterviewSessionHeader;
  score: SessionScoreView;
  /** "다룬 보완 요건": current requirement content (null content = deleted requirement). */
  weakRequirements: Array<{ id: string; content: string | null }>;
  items: InterviewResultItem[];
  feedback: SessionFeedbackView | null;
  /** C-19 result badge (채점 공급자·모델). */
  evaluationProvider: ProviderModel | null;
  activeJob: InterviewActiveJob | null;
  lastFailure: InterviewJobFailure | null;
  /** 다시 채점 available (evaluation_failed, or completed with not_scored answers). Key checked by the route. */
  canRetryEvaluation: boolean;
  /** True on the read that marked the result viewed (the first open). */
  firstView: boolean;
};

// ---------- S-37 모의 면접 전체 세션 ----------

export const ListInterviewSessionsInput = z
  .object({
    applicationProjectId: uuid.optional(),
    interviewType: InterviewTypeSchema.optional(),
    status: z.enum(INTERVIEW_SESSION_STATUSES).optional(),
    /** 실행 공급자 필터 [가정]: matches either shown provider. */
    provider: z.enum(["openai", "gemini", "anthropic"]).optional(),
  })
  .strict();
export type ListInterviewSessionsInput = z.input<typeof ListInterviewSessionsInput>;

export type InterviewSessionList = {
  /** 맨 위 고정 (작성 중). */
  inProgress: InterviewSessionListItem[];
  /** Newest first: evaluating / completed / evaluation_failed. */
  sessions: InterviewSessionListItem[];
  /** "그만둔 면접" 묶음 (아래쪽). */
  abandoned: InterviewSessionListItem[];
  /** Empty-state choice: the user has no application projects at all. */
  hasApplicationProjects: boolean;
};

/** Enum schemas used to parse DB rows. */
export const InterviewEnumSchemas = {
  answerScoreStatus: z.enum(ANSWER_SCORE_STATUSES),
  sessionScoreStatus: z.enum(SESSION_SCORE_STATUSES),
  grade: z.enum(EVALUATION_GRADES),
  criteria: z.enum(EVALUATION_CRITERIA_KEYS),
  sourceKind: z.enum(INTERVIEW_SOURCE_KINDS),
  anchor: z.enum(INTERVIEW_ANCHORS),
  answerStatus: z.enum(INTERVIEW_ANSWER_STATUSES),
  generationStatus: z.enum(INTERVIEW_GENERATION_STATUSES),
  resultStatus: z.enum(INTERVIEW_RESULT_STATUSES),
  sessionStatus: z.enum(INTERVIEW_SESSION_STATUSES),
  nextPracticeType: z.enum(NEXT_PRACTICE_TYPES),
} as const;
