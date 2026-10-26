/**
 * TS mirrors of DB `text + CHECK` enums (DM-3). One `as const` array per CHECK
 * list; backend-qa compares these against the migrations.
 */

// --- S1: consents / policy_versions (DM A.2) ---

/** consents.consent_type CHECK. */
export const CONSENT_TYPES = [
  "terms",
  "privacy_required",
  "cross_border_transfer",
  "service_improvement",
  "marketing",
] as const;
export type ConsentType = (typeof CONSENT_TYPES)[number];

/** Required at sign-up (F-COM-02). `record_consents` rejects a submit without all three agreed. */
export const REQUIRED_CONSENT_TYPES = ["terms", "privacy_required", "cross_border_transfer"] as const satisfies readonly ConsentType[];

/** Optional; the only ones whose `withdrawn_at` the user may set (DM A.2). */
export const OPTIONAL_CONSENT_TYPES = ["service_improvement", "marketing"] as const satisfies readonly ConsentType[];

/** policy_versions.policy_type CHECK. */
export const POLICY_TYPES = ["terms", "privacy", "cross_border_transfer"] as const;
export type PolicyType = (typeof POLICY_TYPES)[number];

export function isRequiredConsentType(type: ConsentType): boolean {
  return (REQUIRED_CONSENT_TYPES as readonly string[]).includes(type);
}

// --- S2: career tables (DM §2.2–2.3, A.3, A.4, §4.2) ---

/** status of experiences / educations / projects / project_details / achievements (DM §2.2). Computed by the DB. */
export const CAREER_STATUSES = ["draft", "complete"] as const;
export type CareerStatus = (typeof CAREER_STATUSES)[number];

/** experiences.employment_type CHECK (DM A.3). */
export const EMPLOYMENT_TYPES = ["full_time", "contract", "freelance", "intern", "other"] as const;
export type EmploymentType = (typeof EMPLOYMENT_TYPES)[number];

/** educations.education_type CHECK (DM §2.3): 학위 과정 / 교육 과정. */
export const EDUCATION_TYPES = ["degree", "course"] as const;
export type EducationType = (typeof EDUCATION_TYPES)[number];

/** educations.enrollment_status CHECK (DM §2.3). `enrolled` requires end_month null. */
export const ENROLLMENT_STATUSES = ["enrolled", "graduated", "completed", "dropped_out", "on_leave"] as const;
export type EnrollmentStatus = (typeof ENROLLMENT_STATUSES)[number];

/** skills.proficiency CHECK (DM A.4, Could). */
export const SKILL_PROFICIENCIES = ["basic", "practical", "expert"] as const;
export type SkillProficiency = (typeof SKILL_PROFICIENCIES)[number];

/** achievements.kind (generated column) values — [가정] spec-gaps 2026-10-25. */
export const ACHIEVEMENT_KINDS = ["quantitative", "qualitative"] as const;
export type AchievementKind = (typeof ACHIEVEMENT_KINDS)[number];

/** get_deletion_impact / delete_career_item `entity_type` (DM §4.2). `writing_chat` arrives in S4. */
export const DELETABLE_ENTITY_TYPES = ["experience", "education", "project", "project_detail", "achievement", "skill"] as const;
export type DeletableEntityType = (typeof DELETABLE_ENTITY_TYPES)[number];

/** What happens to projects of a deleted experience/education (DM §4.1). [가정] value names. */
export const AFFILIATION_MODES = ["keep_projects", "delete_projects"] as const;
export type AffiliationMode = (typeof AFFILIATION_MODES)[number];

/** What happens to AI results that cite the deleted rows (DM §4.2). [가정] value names (UX C-05 wording). */
export const RESULT_MODES = ["keep_results", "delete_results"] as const;
export type ResultMode = (typeof RESULT_MODES)[number];

/** get_data_readiness `missing` / `hints` / `next_action` / `suggested_mode` values (DM §6). */
export const READINESS_MISSING = ["complete_experience", "complete_project"] as const;
export const READINESS_HINTS = ["complete_project_detail", "profile"] as const;
export const READINESS_NEXT_ACTIONS = ["writing_chat", "form"] as const;
export const READINESS_SUGGESTED_MODES = ["new_project", "augment_project"] as const;
export const DATA_SUFFICIENCIES = ["ok", "thin", "none"] as const;
export type DataSufficiency = (typeof DATA_SUFFICIENCIES)[number];

// --- S3: AI infrastructure (DM §2.8–2.9, A.14–A.16, AI C-6) ---

/** ai_jobs.job_type CHECK (DM A.15). */
export const AI_JOB_TYPES = [
  "jd_extraction",
  "insight",
  "career_description",
  "draft_source_ranking",
  "cover_letter",
  "interview_questions",
  "interview_evaluation",
  "writing_assist",
  "chat_reply",
  "writing_chat_turn",
] as const;
export type AiJobType = (typeof AI_JOB_TYPES)[number];

/** ai_jobs.status CHECK (DM A.15). */
export const AI_JOB_STATUSES = ["queued", "running", "succeeded", "failed", "canceled"] as const;
export type AiJobStatus = (typeof AI_JOB_STATUSES)[number];

/** Terminal job statuses: nothing runs after these. */
export const AI_JOB_TERMINAL_STATUSES = ["succeeded", "failed", "canceled"] as const satisfies readonly AiJobStatus[];

/** ai_jobs.error_code CHECK — same list as AI_ERROR_CODES in errors.ts (AI C-6). */
export { AI_ERROR_CODES, type AiErrorCode } from "./errors";

/** ai_jobs.error_category (generated column) values. Screens pick ST-AI-FAILED copy by this. */
export const ERROR_CATEGORIES = ["transient", "input", "timeout", "canceled"] as const;
export type ErrorCategory = (typeof ERROR_CATEGORIES)[number];

/** ai_jobs.progress.stage values (AI C-6 "진행 단계 값"). */
export const AI_PROGRESS_STAGES = [
  "match",
  "synthesize",
  "validate",
  "rank",
  "generate",
  "adjust_length",
  "extract",
  "reply",
  "evaluate",
  "summarize",
  "score",
] as const;
export type AiProgressStage = (typeof AI_PROGRESS_STAGES)[number];

/** usage_events.feature CHECK (DM §2.9, A.16). */
export const USAGE_FEATURES = ["insight", "draft", "interview_session", "writing_chat", "chat_message"] as const;
export type UsageFeature = (typeof USAGE_FEATURES)[number];

/** usage_events.status CHECK. A reservation ends as exactly one of charged / released. */
export const USAGE_STATUSES = ["reserved", "charged", "released"] as const;
export type UsageStatus = (typeof USAGE_STATUSES)[number];

/** usage_events.reason CHECK. */
export const USAGE_REASONS = ["initial", "explicit_regenerate", "source_change_regenerate", "retake"] as const;
export type UsageReason = (typeof USAGE_REASONS)[number];

/** evidence_links.owner_type CHECK (DM A.14). */
export const EVIDENCE_OWNER_TYPES = [
  "insight",
  "draft_section",
  "interview_question",
  "answer_evaluation",
  "session_feedback",
  "chat_message",
] as const;
export type EvidenceOwnerType = (typeof EVIDENCE_OWNER_TYPES)[number];

/** evidence_links.source_type CHECK (DM §2.8). */
export const EVIDENCE_SOURCE_TYPES = [
  "profile",
  "experience",
  "education",
  "project",
  "project_detail",
  "achievement",
  "skill",
  "jd_requirement",
  "jd_sentence",
  "interview_answer",
  "user_note",
] as const;
export type EvidenceSourceType = (typeof EVIDENCE_SOURCE_TYPES)[number];
