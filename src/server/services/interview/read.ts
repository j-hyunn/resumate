import type { AiProvider } from "@/lib/contracts/enums";
import { AppError } from "@/lib/contracts/errors";
import type { EvidenceChip } from "@/lib/contracts/evidence";
import {
  EVALUATION_CRITERIA_KEYS,
  EVALUATION_GRADES,
  INTERVIEW_ANCHORS,
  INTERVIEW_ANSWER_STATUSES,
  INTERVIEW_RESULT_STATUSES,
  INTERVIEW_SOURCE_KINDS,
  INTERVIEW_TYPES,
  NEXT_PRACTICE_TYPES,
  type AnswerEvaluationView,
  type AnswerSheetView,
  type EvaluationCriteriaKey,
  type EvaluationGrade,
  type InterviewAnswerView,
  type InterviewPrepView,
  type InterviewQuestionView,
  type InterviewResultItem,
  type InterviewResultView,
  type InterviewSessionList,
  type ListInterviewSessionsInput,
  type SessionFeedbackView,
} from "@/lib/contracts/interview";
import { applicationDisplayName } from "@/lib/contracts/application";
import type { Json } from "@/server/db/database.types";
import { mapDbError } from "@/server/db/errors";
import type { UserSupabaseClient } from "@/server/db/types";
import { getDataReadiness } from "@/server/services/career";
import { loadEvidenceChips } from "@/server/services/evidence";
import {
  EVALUATION_JOB_TYPE,
  executionProvidersOf,
  groupSessions,
  INTERVIEW_JOB_COLUMNS,
  INTERVIEW_TARGET_TYPE,
  jobsOfSession,
  providerOf,
  QUESTIONS_JOB_TYPE,
  resolveSessionRun,
  SESSION_COLUMNS,
  sessionScoreOf,
  answerScoreOf,
  toListItem,
  toSessionHeader,
  type InterviewJobRow,
  type SessionRow,
} from "./view";

/**
 * S8 reads (plan "계약 — API" 4): S-20 getInterviewPrep, S-33 getAnswerSheet,
 * S-22 getInterviewResult, S-37 listInterviewSessions. User session only
 * (RLS = ownership). Questions are read with the user-visible column list —
 * `intent` comes only from `get_interview_question_reveals` after
 * submission, `good_answer_signals` never.
 */

/** interview_questions columns a user may select (db notes; never `*`). */
export const USER_QUESTION_COLUMNS = "id, session_id, sequence, source_kind, anchor, question_text, focus_criteria, target_requirement_ids, target_gap_requirement_ids, created_at";
const ANSWER_COLUMNS = "id, session_id, question_id, answer_text, status, score_status, score_value, score_max, score_method_version, score_rationale, updated_at";

const sessionNotFound = () => new AppError("not_found", "면접 세션을 찾을 수 없습니다. 새로고침 후 다시 시도해 주세요.", { status: 404 });
const projectNotFound = () => new AppError("not_found", "기업 JD를 찾을 수 없습니다. 새로고침 후 다시 시도해 주세요.", { status: 404 });

type Obj = Record<string, unknown>;
const obj = (v: unknown): Obj => (v && typeof v === "object" && !Array.isArray(v) ? (v as Obj) : {});
const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
const str = (v: unknown): string => (typeof v === "string" ? v : "");
const strOrNull = (v: unknown): string | null => (typeof v === "string" ? v : null);
const strs = (v: unknown): string[] => arr(v).filter((x): x is string => typeof x === "string");
const oneOf = <T extends string>(list: readonly T[], v: unknown): T | null => (typeof v === "string" && (list as readonly string[]).includes(v) ? (v as T) : null);
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const criteriaOf = (v: unknown): EvaluationCriteriaKey[] => strs(v).filter((x): x is EvaluationCriteriaKey => (EVALUATION_CRITERIA_KEYS as readonly string[]).includes(x));

// ---------------- shared loaders ----------------

type ProjectNameRow = { id: string; name: string | null; job_descriptions: { company_name: string | null; position_title: string | null } | Array<{ company_name: string | null; position_title: string | null }> | null };

async function loadProjectNames(user: UserSupabaseClient, ids: readonly string[]): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  if (ids.length === 0) return out;
  const { data, error } = await user.from("application_projects").select("id, name, job_descriptions(company_name, position_title)").in("id", [...new Set(ids)]);
  if (error) throw mapDbError(error);
  for (const row of (data ?? []) as unknown as ProjectNameRow[]) {
    const jd = Array.isArray(row.job_descriptions) ? (row.job_descriptions[0] ?? null) : row.job_descriptions;
    out.set(row.id, applicationDisplayName(row.name, jd?.company_name ?? null, jd?.position_title ?? null));
  }
  return out;
}

async function loadJobsFor(user: UserSupabaseClient, sessionIds: readonly string[]): Promise<InterviewJobRow[]> {
  if (sessionIds.length === 0) return [];
  const { data, error } = await user
    .from("ai_jobs")
    .select(INTERVIEW_JOB_COLUMNS)
    .eq("target_type", INTERVIEW_TARGET_TYPE)
    .in("target_id", [...new Set(sessionIds)])
    .in("job_type", [QUESTIONS_JOB_TYPE, EVALUATION_JOB_TYPE])
    .order("created_at", { ascending: false });
  if (error) throw mapDbError(error);
  return (data ?? []) as InterviewJobRow[];
}

async function loadSession(user: UserSupabaseClient, sessionId: string): Promise<SessionRow> {
  const { data, error } = await user.from("interview_sessions").select(SESSION_COLUMNS).eq("id", sessionId).maybeSingle();
  if (error) throw mapDbError(error);
  if (!data) throw sessionNotFound();
  return data as unknown as SessionRow;
}

type QuestionRow = {
  id: string;
  sequence: number;
  source_kind: string;
  anchor: string;
  question_text: string;
  focus_criteria: string[] | null;
  target_requirement_ids: string[] | null;
  target_gap_requirement_ids: string[] | null;
};
type AnswerRow = {
  id: string;
  question_id: string;
  answer_text: string | null;
  status: string;
  score_status: string | null;
  score_value: number | null;
  score_max: number | null;
  score_method_version: string | null;
  score_rationale: string | null;
  updated_at: string;
};

async function loadQuestionsAndAnswers(user: UserSupabaseClient, sessionId: string): Promise<{ questions: QuestionRow[]; answers: AnswerRow[] }> {
  const [q, a] = await Promise.all([
    user.from("interview_questions").select(USER_QUESTION_COLUMNS).eq("session_id", sessionId).order("sequence", { ascending: true }),
    user.from("interview_answers").select(ANSWER_COLUMNS).eq("session_id", sessionId),
  ]);
  if (q.error) throw mapDbError(q.error);
  if (a.error) throw mapDbError(a.error);
  return { questions: (q.data ?? []) as unknown as QuestionRow[], answers: (a.data ?? []) as unknown as AnswerRow[] };
}

function toQuestionView(row: QuestionRow, chips: Map<string, EvidenceChip[]> | undefined): InterviewQuestionView {
  return {
    id: row.id,
    sequence: row.sequence,
    sourceKind: oneOf(INTERVIEW_SOURCE_KINDS, row.source_kind) ?? "project_deep_dive",
    anchor: oneOf(INTERVIEW_ANCHORS, row.anchor) ?? "general",
    questionText: row.question_text,
    focusCriteria: criteriaOf(row.focus_criteria),
    targetRequirementIds: row.target_requirement_ids ?? [],
    targetGapRequirementIds: row.target_gap_requirement_ids ?? [],
    // All of a question's evidence (item keys are free-form, AI-05 uses "question").
    evidence: chips ? [...chips.values()].flat() : [],
  };
}

function toAnswerView(row: AnswerRow): InterviewAnswerView {
  return {
    id: row.id,
    questionId: row.question_id,
    answerText: row.answer_text ?? "",
    status: oneOf(INTERVIEW_ANSWER_STATUSES, row.status) ?? "draft",
    updatedAt: row.updated_at,
  };
}

// ---------------- S-37 / S-20 lists ----------------

async function listItems(user: UserSupabaseClient, rows: SessionRow[]) {
  const [names, jobs] = await Promise.all([loadProjectNames(user, rows.map((r) => r.application_project_id)), loadJobsFor(user, rows.map((r) => r.id))]);
  return rows.map((r) => toListItem(r, names.get(r.application_project_id) ?? "기업 JD", jobs));
}

/** S-37 모의 면접 — 전체 세션 (F-P3-15). Filters by project / type / effective status / execution provider. */
export async function listInterviewSessions(user: UserSupabaseClient, input: ListInterviewSessionsInput = {}): Promise<InterviewSessionList> {
  let q = user.from("interview_sessions").select(SESSION_COLUMNS);
  if (input.applicationProjectId) q = q.eq("application_project_id", input.applicationProjectId);
  if (input.interviewType) q = q.eq("interview_type", input.interviewType);
  const [sessions, projects] = await Promise.all([q.order("created_at", { ascending: false }).limit(500), user.from("application_projects").select("id", { count: "exact", head: true })]);
  if (sessions.error) throw mapDbError(sessions.error);
  if (projects.error) throw mapDbError(projects.error);
  let items = await listItems(user, (sessions.data ?? []) as unknown as SessionRow[]);
  // Status filters on the EFFECTIVE status (a leftover `evaluating` row reads `evaluation_failed`).
  if (input.status) items = items.filter((s) => s.status === input.status);
  if (input.provider) {
    const provider: AiProvider = input.provider;
    items = items.filter((s) => executionProvidersOf(s.executionProvider).includes(provider));
  }
  return { ...groupSessions(items), hasApplicationProjects: (projects.count ?? 0) > 0 };
}

/** S-20 면접 준비: readiness, connection, 작성 중 세션 배너, this project's sessions. */
export async function getInterviewPrep(user: UserSupabaseClient, input: { applicationProjectId: string }): Promise<InterviewPrepView> {
  const { applicationProjectId } = input;
  const [names, readiness, sessions] = await Promise.all([
    loadProjectNames(user, [applicationProjectId]),
    getDataReadiness(user),
    user.from("interview_sessions").select(SESSION_COLUMNS).eq("application_project_id", applicationProjectId).order("created_at", { ascending: false }),
  ]);
  const name = names.get(applicationProjectId);
  if (!name) throw projectNotFound();
  if (sessions.error) throw mapDbError(sessions.error);
  const items = await listItems(user, (sessions.data ?? []) as unknown as SessionRow[]);
  const grouped = groupSessions(items);
  return {
    applicationProjectId,
    applicationProjectName: name,
    readiness: {
      jobInterview: readiness.features.job_interview,
      cultureFit: { ready: readiness.features.culture_fit_interview.ready, dataSufficiency: readiness.features.culture_fit_interview.data_sufficiency },
    },
    aiConnection: readiness.ai_connection,
    inProgressSession: grouped.inProgress[0] ?? null,
    sessions: [...grouped.inProgress, ...grouped.sessions, ...grouped.abandoned],
  };
}

// ---------------- S-33 답변지 ----------------

export async function getAnswerSheet(user: UserSupabaseClient, input: { sessionId: string }): Promise<AnswerSheetView> {
  const row = await loadSession(user, input.sessionId);
  const [{ questions, answers }, jobs, names] = await Promise.all([
    loadQuestionsAndAnswers(user, row.id),
    loadJobsFor(user, [row.id]),
    loadProjectNames(user, [row.application_project_id]),
  ]);
  const chips = await loadEvidenceChips(user, { ownerType: "interview_question", ownerIds: questions.map((q) => q.id) });
  const run = resolveSessionRun(row, jobsOfSession(jobs, row.id));
  const answerByQuestion = new Map(answers.map((a) => [a.question_id, a]));
  const submitted = row.submitted_at !== null;
  const ready = run.generationStatus === "ready";
  const inProgress = run.status === "in_progress";
  const questionJobActive = run.activeJob?.jobType === QUESTIONS_JOB_TYPE;
  return {
    session: toSessionHeader(row, names.get(row.application_project_id) ?? "기업 JD", run),
    items: questions.map((q) => {
      const a = answerByQuestion.get(q.id);
      return { question: toQuestionView(q, chips.get(q.id)), answer: a ? toAnswerView(a) : null };
    }),
    editable: inProgress && ready && !submitted,
    generation: {
      status: run.generationStatus,
      savedCount: questions.length,
      remainingCount: Math.max(0, row.question_count - questions.length),
      activeJob: questionJobActive ? run.activeJob : null,
      failure: run.generationStatus === "failed" ? run.failure : null,
      canRetry: inProgress && !submitted && run.generationStatus === "failed",
    },
    canSubmit: inProgress && ready && !submitted,
  };
}

// ---------------- S-22 결과 ----------------

type EvaluationRow = { answer_id: string; status: string; result: Json | null; provider: string | null; model: string | null; id: string };
type FeedbackRow = { id: string; status: string; result: Json | null; provider: string | null; model: string | null };

function toEvaluationView(row: EvaluationRow, chips: Map<string, EvidenceChip[]>): AnswerEvaluationView {
  const r = obj(row.result);
  const chipsOf = (key: string) => chips.get(key) ?? [];
  const ma = r.model_answer ? obj(r.model_answer) : null;
  return {
    status: oneOf(INTERVIEW_RESULT_STATUSES, row.status) ?? "pending",
    criteria: arr(r.criteria).flatMap((raw) => {
      const c = obj(raw);
      const key = oneOf(EVALUATION_CRITERIA_KEYS, c.key);
      const grade = oneOf<EvaluationGrade>(EVALUATION_GRADES, c.grade);
      if (!key || !grade) return [];
      return [{ key, grade, reason: str(c.reason), answerQuotes: strs(c.answer_quotes), missing: strOrNull(c.missing), evidence: chipsOf(`criteria.${key}`) }];
    }),
    strengths: arr(r.strengths).map((raw) => {
      const s = obj(raw);
      return { text: str(s.text), answerQuotes: strs(s.answer_quotes) };
    }),
    improvements: arr(r.improvements).map((raw, n) => {
      const i = obj(raw);
      return { text: str(i.text), how: str(i.how), relatedCriteria: criteriaOf(i.related_criteria), evidence: chipsOf(`improvements.${n}`) };
    }),
    intentReveal: strOrNull(r.intent_reveal),
    modelAnswer: ma
      ? {
          text: str(ma.text),
          placeholders: arr(ma.placeholders).flatMap((p) => {
            const token = typeof p === "string" ? p : str(obj(p).token);
            return token ? [{ token, hint: typeof p === "string" ? "" : str(obj(p).hint) }] : [];
          }),
          suggestionsIfTrue: strs(ma.suggestions_if_true),
          evidence: chipsOf("model_answer"),
        }
      : null,
    consistencyNotes: arr(r.consistency_notes).map((raw, n) => {
      const c = obj(raw);
      return { text: typeof raw === "string" ? raw : str(c.text), answerQuotes: strs(c.answer_quotes), evidence: chipsOf(`consistency_notes.${n}`) };
    }),
    provider: providerOf(row.provider),
    model: row.model,
  };
}

/** Question refs in the stored AI-07 result: ids (storage form) or `Q-n` aliases mapped by sequence (defensive). */
function questionIdsOf(v: unknown, bySequence: Map<number, string>): string[] {
  return strs(v).flatMap((ref) => {
    if (UUID_RE.test(ref)) return [ref];
    const m = /^Q-(\d+)$/.exec(ref);
    const id = m ? bySequence.get(Number(m[1])) : undefined;
    return id ? [id] : [];
  });
}

function toFeedbackView(row: FeedbackRow, chips: Map<string, EvidenceChip[]>, bySequence: Map<number, string>): SessionFeedbackView {
  const r = obj(row.result);
  const point = (raw: unknown) => {
    const p = obj(raw);
    return { text: str(p.text), questionIds: questionIdsOf(p.question_ids ?? p.question_refs, bySequence), relatedCriteria: criteriaOf(p.related_criteria) };
  };
  return {
    status: oneOf(INTERVIEW_RESULT_STATUSES, row.status) ?? "pending",
    headline: str(r.headline),
    overallStrengths: arr(r.overall_strengths).map(point),
    overallWeaknesses: arr(r.overall_weaknesses).map(point),
    unansweredNote: strOrNull(r.unanswered_note),
    nextPractice: arr(r.next_practice).flatMap((raw) => {
      const n = obj(raw);
      const type = oneOf(NEXT_PRACTICE_TYPES, n.type);
      if (!type) return [];
      const questionRef = n.question_id ?? n.question_ref;
      return [
        {
          type,
          text: str(n.text),
          requirementIds: strs(n.requirement_ids ?? n.requirement_refs).filter((id) => UUID_RE.test(id)),
          questionId: typeof questionRef === "string" ? (questionIdsOf([questionRef], bySequence)[0] ?? null) : null,
          interviewType: oneOf(INTERVIEW_TYPES, n.interview_type),
        },
      ];
    }),
    criteriaSummary: arr(r.criteria_summary).flatMap((raw) => {
      const c = obj(raw);
      const key = oneOf(EVALUATION_CRITERIA_KEYS, c.key);
      if (!key) return [];
      const distribution: Partial<Record<EvaluationGrade, number>> = {};
      for (const [g, n] of Object.entries(obj(c.distribution))) {
        const grade = oneOf<EvaluationGrade>(EVALUATION_GRADES, g);
        if (grade && typeof n === "number") distribution[grade] = n;
      }
      return [{ key, distribution }];
    }),
    evidence: Object.fromEntries(chips),
    provider: providerOf(row.provider),
    model: row.model,
  };
}

export type GetInterviewResultOptions = {
  /** Marks the result viewed on the first open (default true; S-22 opens it). */
  markViewed?: boolean;
};

export async function getInterviewResult(user: UserSupabaseClient, input: { sessionId: string }, options: GetInterviewResultOptions = {}): Promise<InterviewResultView> {
  let row = await loadSession(user, input.sessionId);
  if (!row.submitted_at) throw new AppError("interview_not_submitted", "제출한 뒤에 볼 수 있어요.", { status: 409 });

  let firstView = false;
  if ((options.markViewed ?? true) && row.status === "completed" && row.result_viewed_at === null) {
    const { data, error } = await user.rpc("mark_interview_result_viewed", { p_session_id: row.id });
    if (error) throw mapDbError(error);
    const r = obj(data);
    if (r.changed === true) {
      firstView = true;
      row = { ...row, result_viewed_at: strOrNull(r.result_viewed_at) };
    }
  }

  const [{ questions, answers }, jobs, names, reveals, evaluations, feedbacks] = await Promise.all([
    loadQuestionsAndAnswers(user, row.id),
    loadJobsFor(user, [row.id]),
    loadProjectNames(user, [row.application_project_id]),
    user.rpc("get_interview_question_reveals", { p_session_id: row.id }),
    user.from("answer_evaluations").select("id, answer_id, status, result, provider, model").eq("session_id", row.id),
    user.from("session_feedbacks").select("id, status, result, provider, model").eq("session_id", row.id).limit(1),
  ]);
  if (reveals.error) throw mapDbError(reveals.error);
  if (evaluations.error) throw mapDbError(evaluations.error);
  if (feedbacks.error) throw mapDbError(feedbacks.error);
  const evalRows = (evaluations.data ?? []) as unknown as EvaluationRow[];
  const feedbackRow = ((feedbacks.data ?? [])[0] ?? null) as unknown as FeedbackRow | null;

  const [questionChips, evaluationChips, feedbackChips, weakRequirements] = await Promise.all([
    loadEvidenceChips(user, { ownerType: "interview_question", ownerIds: questions.map((q) => q.id) }),
    loadEvidenceChips(user, { ownerType: "answer_evaluation", ownerIds: evalRows.map((e) => e.id) }),
    loadEvidenceChips(user, { ownerType: "session_feedback", ownerIds: feedbackRow ? [feedbackRow.id] : [] }),
    loadRequirementContents(user, row.weak_requirement_ids ?? []),
  ]);

  const intents = new Map(((reveals.data ?? []) as Array<{ question_id: string; intent: string | null }>).map((r) => [r.question_id, r.intent]));
  const answerByQuestion = new Map(answers.map((a) => [a.question_id, a]));
  const evalByAnswer = new Map(evalRows.map((e) => [e.answer_id, e]));
  const bySequence = new Map(questions.map((q) => [q.sequence, q.id]));
  const run = resolveSessionRun(row, jobsOfSession(jobs, row.id));

  const items: InterviewResultItem[] = questions.map((q) => {
    const a = answerByQuestion.get(q.id) ?? null;
    const e = a ? (evalByAnswer.get(a.id) ?? null) : null;
    const evaluation = e && e.status === "succeeded" ? toEvaluationView(e, evaluationChips.get(e.id) ?? new Map()) : null;
    const answerScore = a ? answerScoreOf(a) : null;
    return {
      question: { ...toQuestionView(q, questionChips.get(q.id)), intent: intents.get(q.id) ?? null },
      answer: a ? { id: a.id, answerText: a.answer_text ?? "", status: oneOf(INTERVIEW_ANSWER_STATUSES, a.status) ?? "submitted", score: answerScore! } : null,
      evaluation,
      // "채점 실패": submitted, no success, and no evaluation running for it now.
      evaluationFailed: a?.status === "submitted" && !evaluation && (answerScore?.status === "not_scored" || (run.activeJob === null && run.status !== "evaluating")),
    };
  });

  const header = toSessionHeader(row, names.get(row.application_project_id) ?? "기업 JD", run);
  const evaluationActive = run.activeJob?.jobType === EVALUATION_JOB_TYPE;
  return {
    session: header,
    score: sessionScoreOf(row),
    weakRequirements,
    items,
    feedback: feedbackRow && feedbackRow.status === "succeeded" ? toFeedbackView(feedbackRow, feedbackChips.get(feedbackRow.id) ?? new Map(), bySequence) : null,
    evaluationProvider: header.evaluationProvider,
    activeJob: evaluationActive ? run.activeJob : null,
    lastFailure: run.status === "evaluation_failed" ? run.failure : null,
    canRetryEvaluation: !evaluationActive && (run.status === "evaluation_failed" || (run.status === "completed" && items.some((i) => i.evaluationFailed))),
    firstView,
  };
}

/** "다룬 보완 요건": current requirement contents (null = requirement deleted since). */
async function loadRequirementContents(user: UserSupabaseClient, ids: readonly string[]): Promise<Array<{ id: string; content: string | null }>> {
  if (ids.length === 0) return [];
  const { data, error } = await user.from("jd_requirements").select("id, content").in("id", [...ids]);
  if (error) throw mapDbError(error);
  const byId = new Map((data ?? []).map((r) => [r.id, r.content]));
  return ids.map((id) => ({ id, content: byId.get(id) ?? null }));
}
