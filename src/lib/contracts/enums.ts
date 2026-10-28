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

// --- S3 / S3a: AI infrastructure v4 BYOK (DM §2.8–2.9, A.14–A.16, AI C-6, C-10–C-13) ---

/** ai_jobs.job_type CHECK (DM §2.9.1 v4: + key_verification). */
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
  "key_verification",
] as const;
export type AiJobType = (typeof AI_JOB_TYPES)[number];

/** ai_jobs.status CHECK (DM A.15). */
export const AI_JOB_STATUSES = ["queued", "running", "succeeded", "failed", "canceled"] as const;
export type AiJobStatus = (typeof AI_JOB_STATUSES)[number];

/** Terminal job statuses: nothing runs after these. */
export const AI_JOB_TERMINAL_STATUSES = ["succeeded", "failed", "canceled"] as const satisfies readonly AiJobStatus[];

/** ai_jobs.provider / ai_usage_records.provider / ai_price_tables.provider CHECK (D-28, C-10). */
export const AI_PROVIDERS = ["openai", "gemini", "anthropic"] as const;
export type AiProvider = (typeof AI_PROVIDERS)[number];

/** ai_jobs.model_tier / ai_usage_records.model_tier CHECK (C-10.1). */
export const MODEL_TIERS = ["light", "default", "heavy"] as const;
export type ModelTier = (typeof MODEL_TIERS)[number];

/** ai_jobs.connection_tier / ai_usage_records.connection_tier CHECK (F-AI-04, C-12). */
export const CONNECTION_TIERS = ["free", "paid"] as const;
export type ConnectionTier = (typeof CONNECTION_TIERS)[number];

/** ai_provider_keys.status CHECK (DM §2.11.1): 유효 / 무효(401·403) / 확인 필요(검증 중 한도·일시 오류). */
export const KEY_STATUSES = ["valid", "invalid", "needs_check"] as const;
export type KeyStatus = (typeof KEY_STATUSES)[number];

/** ai_jobs.error_code CHECK — same list as AI_ERROR_CODES in errors.ts (AI C-11.1). */
export { AI_ERROR_CODES, type AiErrorCode } from "./errors";

/** ai_jobs.error_category (generated column) values (C-11.1). Screens pick ST-AI-FAILED copy by this. */
export const ERROR_CATEGORIES = ["provider_limit", "user_account", "transient", "input", "system"] as const;
export type ErrorCategory = (typeof ERROR_CATEGORIES)[number];

/** ai_jobs.failure_cause (generated column) values — F-AI-08 7 causes; null for other codes (C-11.1). */
export const FAILURE_CAUSES = [
  "rate_limited",
  "daily_quota_exhausted",
  "billing_required",
  "key_invalid",
  "model_not_available",
  "provider_unavailable",
  "input_rejected",
] as const;
export type FailureCause = (typeof FAILURE_CAUSES)[number];

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

/** ai_usage_records.feature CHECK (DM §2.9.2, C-13). */
export const USAGE_FEATURES = [
  "jd_extraction",
  "insight",
  "career_description",
  "cover_letter",
  "interview_questions",
  "interview_evaluation",
  "writing_chat",
  "key_verification",
  "writing_assist",
  "chat_reply",
] as const;
export type UsageFeature = (typeof USAGE_FEATURES)[number];

/** ai_usage_records.usage_source CHECK. */
export const USAGE_SOURCES = ["provider_reported", "unavailable"] as const;
export type UsageSource = (typeof USAGE_SOURCES)[number];

/** ai_usage_records.outcome CHECK. */
export const USAGE_OUTCOMES = ["succeeded", "failed"] as const;
export type UsageOutcome = (typeof USAGE_OUTCOMES)[number];

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
