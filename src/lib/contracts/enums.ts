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

/** get_deletion_impact / delete_career_item `entity_type` (DM §4.2; `writing_chat` since S4). */
export const DELETABLE_ENTITY_TYPES = ["experience", "education", "project", "project_detail", "achievement", "skill", "writing_chat"] as const;
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
  // S6 [가정, spec-gaps S6 (api) ⑫]: AI-02 first step (D-30 JD extraction first + begin_insight) and the V-5 regeneration call.
  "prepare",
  "match",
  "synthesize",
  "synthesize_regen",
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

// --- S4: AI writing chat (DM §2.5, AI-12) ---

/** writing_chats.mode CHECK. */
export const WRITING_CHAT_MODES = ["new_project", "augment_project"] as const;
export type WritingChatMode = (typeof WRITING_CHAT_MODES)[number];

/** writing_chats.status CHECK: 진행 중 / 저장 완료 / 폼으로 전환 / 그만둠. */
export const WRITING_CHAT_STATUSES = ["active", "saved", "handed_off", "abandoned"] as const;
export type WritingChatStatus = (typeof WRITING_CHAT_STATUSES)[number];

/** writing_chat_messages.role CHECK. */
export const WRITING_CHAT_MESSAGE_ROLES = ["user", "assistant"] as const;
export type WritingChatMessageRole = (typeof WRITING_CHAT_MESSAGE_ROLES)[number];

/** writing_chat_messages.status CHECK. */
export const WRITING_CHAT_MESSAGE_STATUSES = ["streaming", "done", "failed"] as const;
export type WritingChatMessageStatus = (typeof WRITING_CHAT_MESSAGE_STATUSES)[number];

/** structured_draft field object `origin` (DM §2.5). */
export const DRAFT_FIELD_ORIGINS = ["ai", "user_edit"] as const;
export type DraftFieldOrigin = (typeof DRAFT_FIELD_ORIGINS)[number];

/** structured_draft field object `review` (DM §2.5 v3.2, R-27). */
export const DRAFT_FIELD_REVIEWS = ["ok", "needs_review", "accepted"] as const;
export type DraftFieldReview = (typeof DRAFT_FIELD_REVIEWS)[number];

/** structured_draft `clarifications[].kind` (AI-12 output schema). */
export const CLARIFICATION_KINDS = ["actor_ambiguous", "number_vague", "period_unclear", "affiliation_unclear"] as const;
export type ClarificationKind = (typeof CLARIFICATION_KINDS)[number];

/** writing_chats.return_target.feature (DM §2.5 v3.2, U-5). */
export const RETURN_TARGET_FEATURES = ["insight", "career_description", "cover_letter", "job_interview"] as const;
export type ReturnTargetFeature = (typeof RETURN_TARGET_FEATURES)[number];

/** structured_draft.project field keys = projects columns (DM §2.5 v3.1). */
export const DRAFT_PROJECT_FIELDS = ["name", "role", "summary", "start_month", "end_month", "team_size"] as const;
export type DraftProjectField = (typeof DRAFT_PROJECT_FIELDS)[number];

/** structured_draft.details[].fields keys = project_details columns. */
export const DRAFT_DETAIL_FIELDS = ["title", "situation", "task", "action", "result", "learnings"] as const;
export type DraftDetailField = (typeof DRAFT_DETAIL_FIELDS)[number];

/** structured_draft.details[].achievements[] keys = achievements columns (quantitative). */
export const DRAFT_ACHIEVEMENT_FIELDS = ["metric_name", "value_before", "value_after", "unit"] as const;
export type DraftAchievementField = (typeof DRAFT_ACHIEVEMENT_FIELDS)[number];

/** AI-12 slot order (진행 단계 표시, `requested_slot`; ids agreed with ai-pipeline `SlotId`). */
export const WRITING_CHAT_SLOTS = ["basic_info", "situation", "task", "action", "result", "learnings", "next_episode"] as const;
export type WritingChatSlot = (typeof WRITING_CHAT_SLOTS)[number];

// --- S5: application projects & JD (DM §2.6, A.5–A.7, AI-01) ---

/** application_projects.stage CHECK (F-ST-01, board column order). */
export const APPLICATION_STAGES = ["before_apply", "document", "assignment", "job_interview", "culture_fit_interview", "closed"] as const;
export type ApplicationStage = (typeof APPLICATION_STAGES)[number];

/** application_projects.stage_outcome CHECK (null = 결과 미기록; only with stage = closed). */
export const STAGE_OUTCOMES = ["passed", "failed"] as const;
export type StageOutcome = (typeof STAGE_OUTCOMES)[number];

/** Interview columns that open the C-14 popup (F-ST-04). */
export const INTERVIEW_STAGES = ["job_interview", "culture_fit_interview"] as const satisfies readonly ApplicationStage[];

/** application_stage_events.event_type CHECK (F-ST-05). */
export const STAGE_EVENT_TYPES = ["created", "stage_changed", "outcome_changed"] as const;
export type StageEventType = (typeof STAGE_EVENT_TYPES)[number];

/** application_projects.name_source CHECK (null = 추출 대기). */
export const NAME_SOURCES = ["user", "ai", "default"] as const;
export type NameSource = (typeof NAME_SOURCES)[number];

/** job_descriptions.company_name_source / position_title_source CHECK. */
export const JD_FIELD_SOURCES = ["user", "ai"] as const;
export type JdFieldSource = (typeof JD_FIELD_SOURCES)[number];

/** job_descriptions.extraction_status CHECK (pending = 추출 전, 키 없음 포함; D-30). */
export const JD_EXTRACTION_STATUSES = ["pending", "running", "succeeded", "failed"] as const;
export type JdExtractionStatus = (typeof JD_EXTRACTION_STATUSES)[number];

/** jd_requirements.category CHECK (주요 업무 / 자격요건 / 우대사항). */
export const REQUIREMENT_CATEGORIES = ["responsibility", "required", "preferred"] as const;
export type RequirementCategory = (typeof REQUIREMENT_CATEGORIES)[number];

/** jd_requirements.importance CHECK. */
export const REQUIREMENT_IMPORTANCES = ["high", "normal"] as const;
export type RequirementImportance = (typeof REQUIREMENT_IMPORTANCES)[number];

/** jd_requirements.origin CHECK. */
export const REQUIREMENT_ORIGINS = ["ai", "user"] as const;
export type RequirementOrigin = (typeof REQUIREMENT_ORIGINS)[number];

// --- S7: drafts (DM A.9–A.11, AI-03 / AI-04 / AI-11) ---

/** drafts.draft_type CHECK. */
export const DRAFT_TYPES = ["career_description", "cover_letter"] as const;
export type DraftType = (typeof DRAFT_TYPES)[number];

/** drafts.status CHECK: 문항 입력 중 / 생성 중 / 완료 / 일부 실패 / 실패. */
export const DRAFT_STATUSES = ["composing", "generating", "ready", "partially_failed", "failed"] as const;
export type DraftStatus = (typeof DRAFT_STATUSES)[number];

/** draft_sections.section_kind CHECK (v3: + education). */
export const DRAFT_SECTION_KINDS = ["experience", "education", "standalone_projects", "cover_letter_question"] as const;
export type DraftSectionKind = (typeof DRAFT_SECTION_KINDS)[number];

/** draft_sections.status CHECK. */
export const DRAFT_SECTION_STATUSES = ["pending", "generating", "ready", "failed"] as const;
export type DraftSectionStatus = (typeof DRAFT_SECTION_STATUSES)[number];

/** draft_sections.template_key CHECK (기본 3문항 시드; null = 사용자 추가 문항). */
export const COVER_LETTER_TEMPLATE_KEYS = ["motivation", "job_competency", "future_plan"] as const;
export type CoverLetterTemplateKey = (typeof COVER_LETTER_TEMPLATE_KEYS)[number];

/** draft_sections.count_basis CHECK: 공백 포함 / 공백 제외. */
export const COUNT_BASES = ["with_spaces", "without_spaces"] as const;
export type CountBasis = (typeof COUNT_BASES)[number];

/** draft_sections.source_selection_mode CHECK. */
export const SOURCE_SELECTION_MODES = ["ai", "user"] as const;
export type SourceSelectionMode = (typeof SOURCE_SELECTION_MODES)[number];

/** draft_sections.question_class CHECK (AI-04 `question_class`). */
export const QUESTION_CLASSES = ["motivation", "job_competency", "future_plan", "experience_story"] as const;
export type QuestionClass = (typeof QUESTION_CLASSES)[number];

/** draft_sections.ai_content[].block_kind (A.10). */
export const DRAFT_BLOCK_KINDS = ["header", "summary", "role_line", "bullet", "paragraph"] as const;
export type DraftBlockKind = (typeof DRAFT_BLOCK_KINDS)[number];

/** draft_section_sources.role CHECK. */
export const DRAFT_SOURCE_ROLES = ["primary", "supporting"] as const;
export type DraftSourceRole = (typeof DRAFT_SOURCE_ROLES)[number];

/** draft_section_sources.origin CHECK. */
export const DRAFT_SOURCE_ORIGINS = ["ai", "user"] as const;
export type DraftSourceOrigin = (typeof DRAFT_SOURCE_ORIGINS)[number];

/** drafts.options.selection_origin (C-11 출처 표시: 인사이트 우선순위 / AI가 고름 / 직접 고름). */
export const SELECTION_ORIGINS = ["insight", "ai_ranking", "user"] as const;
export type SelectionOrigin = (typeof SELECTION_ORIGINS)[number];

/** AI-11 `rankings[].relevance`. */
export const RANKING_RELEVANCES = ["high", "medium", "low"] as const;
export type RankingRelevance = (typeof RANKING_RELEVANCES)[number];
