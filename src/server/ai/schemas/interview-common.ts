/**
 * Shared enums of the S8 mock-interview features (AI spec 4.1–4.3, AI-05 …
 * AI-07; DM A.12/A.13 CHECK lists). Order follows the DM CHECK lists so QA can
 * compare them with `src/lib/contracts/enums.ts` once api/db add them there.
 */

export const INTERVIEW_TYPES = ["job", "culture_fit"] as const;
export type InterviewType = (typeof INTERVIEW_TYPES)[number];

export const JOB_SOURCE_KINDS = ["project_deep_dive", "requirement_fit", "gap_probe"] as const;
export const CULTURE_SOURCE_KINDS = ["collaboration", "conflict", "failure_growth", "values", "org_adaptation", "motivation_career"] as const;
/** DM A.13 interview_questions.source_kind CHECK. */
export const INTERVIEW_SOURCE_KINDS = [...JOB_SOURCE_KINDS, ...CULTURE_SOURCE_KINDS] as const;
export type JobSourceKind = (typeof JOB_SOURCE_KINDS)[number];
export type CultureSourceKind = (typeof CULTURE_SOURCE_KINDS)[number];
export type InterviewSourceKind = (typeof INTERVIEW_SOURCE_KINDS)[number];

export const INTERVIEW_ANCHORS = ["experience", "jd", "general"] as const;
export type InterviewAnchor = (typeof INTERVIEW_ANCHORS)[number];

/** C-1 data_sufficiency (server-computed). */
export const DATA_SUFFICIENCY_LEVELS = ["ok", "thin", "none"] as const;
export type DataSufficiencyLevel = (typeof DATA_SUFFICIENCY_LEVELS)[number];

export const QUESTION_COUNTS = [3, 5, 7] as const;
export type QuestionCount = (typeof QUESTION_COUNTS)[number];

/** 4.2 rubric keys, in display order. */
export const CRITERIA_KEYS = ["specificity", "intent_fit", "structure", "job_relevance"] as const;
export type CriteriaKey = (typeof CRITERIA_KEYS)[number];

/** `not_applicable` is valid for `job_relevance` only (AI-06 card). */
export const CRITERIA_GRADES = ["excellent", "good", "fair", "poor", "not_applicable"] as const;
export type CriteriaGrade = (typeof CRITERIA_GRADES)[number];

export const NEXT_PRACTICE_TYPES = ["retry_question", "focus_session", "add_data"] as const;
export type NextPracticeType = (typeof NEXT_PRACTICE_TYPES)[number];

/** 4.3 score slot. Before D-14 every score is `pending_method` with null values. */
export type ScoreSlot = {
  status: "pending_method";
  value: null;
  max: null;
  method_version: null;
  rationale: null;
};

export function pendingScore(): ScoreSlot {
  return { status: "pending_method", value: null, max: null, method_version: null, rationale: null };
}

/** AI-06/AI-07 question alias: `Q-<sequence>` (call-scoped, like other aliases). */
export function questionRef(sequence: number): string {
  return `Q-${sequence}`;
}

export const QUESTION_REF_PATTERN = /\bQ-(\d+)\b/g;

export function isJobSourceKind(v: string): v is JobSourceKind {
  return (JOB_SOURCE_KINDS as readonly string[]).includes(v);
}

export function isCultureSourceKind(v: string): v is CultureSourceKind {
  return (CULTURE_SOURCE_KINDS as readonly string[]).includes(v);
}
