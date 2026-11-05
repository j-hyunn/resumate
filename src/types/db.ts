/**
 * Row types: generated Supabase rows (src/server/db/database.types.ts) under the names screens
 * import. W1 wiring: table name -> singular PascalCase (`experiences` -> `Experience`), column
 * names unchanged (snake_case). `Row<table, overrides, hidden>` keeps what generated types can't
 * say: CHECK enums as string-literal unions, jsonb shapes, a few nullability differences, and the
 * internal columns screens don't use. Every override / hidden column is listed in
 * _workspace/backend/spec-gaps.md (2026-11-02 W1). View models stay in this file below as before.
 *
 * Conventions: uuid -> string, timestamptz -> ISO string, date (1st-of-month for months)
 * -> 'YYYY-MM-DD' string, smallint/numeric -> number, jsonb -> typed object.
 * Type-only import: this file stays client-safe.
 */
import type { Database } from "@/server/db/database.types"

type PublicRelations = Database["public"]["Tables"] & Database["public"]["Views"]
type Row<T extends keyof PublicRelations, O = object, Hidden extends string = never> = Omit<
  PublicRelations[T]["Row"],
  keyof O | Hidden
> &
  O


export type Uuid = string
/** timestamptz as ISO 8601 string */
export type Timestamp = string
/** date as 'YYYY-MM-DD' (month columns are fixed to day 1, DM-4) */
export type DateString = string

/** 공통 컬럼: id / user_id / created_at / updated_at */
export interface BaseRow {
  id: Uuid
  user_id: Uuid
  created_at: Timestamp
  updated_at: Timestamp
}

/** AI 출력 공통 메타 (04 §0, v4: provider · model_tier · connection_tier) */
export interface AiOutputMeta {
  ai_job_id: Uuid | null
  schema_version: number | null
  prompt_version: string | null
  provider: AiProviderName | null
  model: string | null
  model_tier: ModelTier | null
  connection_tier: ConnectionTier | null
  input_hash: string | null
  career_snapshot_hash: string | null
  validation_report: Record<string, unknown> | null
  usage: Record<string, unknown> | null
}

// ---------------------------------------------------------------------------
// Enums (text + CHECK)
// ---------------------------------------------------------------------------

/** experiences / educations / projects / project_details / achievements .status */
export type CareerItemStatus = "draft" | "complete"

export type EmploymentType = "full_time" | "contract" | "freelance" | "intern" | "other"
export type EducationType = "degree" | "course"
export type EnrollmentStatus = "enrolled" | "graduated" | "completed" | "dropped_out" | "on_leave"
export type SkillProficiency = "basic" | "practical" | "expert"

export type ConsentType =
  | "terms"
  | "privacy_required"
  | "cross_border_transfer"
  | "service_improvement"
  | "marketing"
export type PolicyType = "terms" | "privacy" | "cross_border_transfer"

export type WritingChatMode = "new_project" | "augment_project"
export type WritingChatStatus = "active" | "saved" | "handed_off" | "abandoned"
export type WritingChatMessageRole = "user" | "assistant"
export type WritingChatMessageStatus = "streaming" | "done" | "failed"

export type NameSource = "user" | "ai" | "default"
export type ApplicationStage =
  | "before_apply"
  | "document"
  | "assignment"
  | "job_interview"
  | "culture_fit_interview"
  | "closed"
export type StageOutcome = "passed" | "failed"
export type StageEventType = "created" | "stage_changed" | "outcome_changed"

export type FieldSource = "user" | "ai"
export type ExtractionStatus = "pending" | "running" | "succeeded" | "failed"
export type JdRequirementCategory = "responsibility" | "required" | "preferred"
export type JdRequirementImportance = "high" | "normal"
export type JdRequirementOrigin = "ai" | "user"

export type InsightStatus = "generating" | "ready" | "failed"
export type DraftType = "career_description" | "cover_letter"
export type DraftStatus = "composing" | "generating" | "ready" | "partially_failed" | "failed"
export type DraftSelectionOrigin = "insight" | "ai_ranking" | "user"
/** drafts.options.tone (04 §2.7 v4.2, A17): 간결 / 상세. null = concise */
export type DraftTone = "concise" | "detailed"
export type DraftSectionKind =
  | "experience"
  | "education"
  | "standalone_projects"
  | "cover_letter_question"
export type CoverLetterTemplateKey = "motivation" | "job_competency" | "future_plan"
export type CountBasis = "with_spaces" | "without_spaces"
export type SourceSelectionMode = "ai" | "user"
export type QuestionClass = "motivation" | "job_competency" | "future_plan" | "experience_story"
export type DraftSectionStatus = "pending" | "generating" | "ready" | "failed"
export type DraftBlockKind = "header" | "summary" | "role_line" | "bullet" | "paragraph"
export type DraftSourceRole = "primary" | "supporting"
export type DraftSourceOrigin = "ai" | "user"

export type InterviewType = "job" | "culture_fit"
export type QuestionCount = 3 | 5 | 7
export type DataSufficiency = "ok" | "thin" | "none"
export type InterviewSessionStatus =
  | "in_progress"
  | "evaluating"
  | "completed"
  | "evaluation_failed"
  | "abandoned"
export type InterviewGenerationStatus = "generating" | "ready" | "failed"
export type SessionScoreStatus = "pending_method" | "scored" | "not_scored"
export type AnswerScoreStatus = "pending_method" | "scored" | "unanswered" | "not_scored"
export type QuestionSourceKind =
  | "project_deep_dive"
  | "requirement_fit"
  | "gap_probe"
  | "collaboration"
  | "conflict"
  | "failure_growth"
  | "values"
  | "org_adaptation"
  | "motivation_career"
export type QuestionAnchor = "experience" | "jd" | "general"
export type InterviewAnswerStatus = "draft" | "submitted" | "unanswered"
export type EvaluationStatus = "pending" | "succeeded" | "failed"

export type EvidenceOwnerType =
  | "insight"
  | "draft_section"
  | "interview_question"
  | "answer_evaluation"
  | "session_feedback"
  | "chat_message"
export type EvidenceSourceType =
  | "profile"
  | "experience"
  | "education"
  | "project"
  | "project_deliverable"
  /** @deprecated R4: no longer stored (DM v4.4); kept for the mock fixtures */
  | "project_detail"
  /** @deprecated R4: no longer stored (DM v4.4); kept for the mock fixtures */
  | "achievement"
  | "skill"
  | "jd_requirement"
  | "jd_sentence"
  | "interview_answer"
  | "user_note"
/** project_details STAR fields used as evidence_links.source_field for project_detail */
export type ProjectDetailField = "title" | "situation" | "task" | "action" | "result" | "learnings"

// --- v4 BYOK -------------------------------------------------------------------
/** ai_provider_keys.provider / profiles.active_ai_provider / ai_jobs.provider … (04 §2.11) */
export type AiProviderName = "openai" | "gemini" | "anthropic"
/** model_tier (04 §0): 경량 / 기본 / 고성능 */
export type ModelTier = "light" | "default" | "heavy"
/** connection_tier: 사용자가 고른 키 등급 */
export type ConnectionTier = "free" | "paid"
/** ai_provider_keys.status */
export type ProviderKeyStatus = "valid" | "invalid" | "needs_check"

export type AiJobType =
  | "jd_extraction"
  | "insight"
  | "career_description"
  | "draft_source_ranking"
  | "cover_letter"
  | "interview_questions"
  | "interview_evaluation"
  | "writing_chat_turn"
  | "key_verification"
  | "writing_assist"
  | "chat_reply"
export type AiJobStatus = "queued" | "running" | "succeeded" | "failed" | "canceled"
/** ai_jobs.error_code (04 §2.9.1, v4) */
export type AiErrorCode =
  | "rate_limited"
  | "daily_quota_exhausted"
  | "billing_required"
  | "key_invalid"
  | "key_missing"
  | "model_not_available"
  | "provider_unavailable"
  | "input_too_long"
  | "safety_blocked"
  | "schema_invalid"
  | "timeout"
  | "stalled"
  | "canceled"
  | "insufficient_data"
  | "not_a_jd"
/** ai_jobs.error_category (generated column, v4: 5값) */
export type AiErrorCategory = "provider_limit" | "user_account" | "transient" | "input" | "system"
/** ai_jobs.failure_cause (generated column, F-AI-08 7원인) */
export type AiFailureCause =
  | "rate_limited"
  | "daily_quota_exhausted"
  | "billing_required"
  | "key_invalid"
  | "model_not_available"
  | "provider_unavailable"
  | "input_rejected"
/**
 * ai_jobs.progress.stage keys (02 C-03, 03 C-6 v4.3). v4.3 adds `prepare` (시작 준비·선행 추출),
 * `synthesize_regen` (shown as the `synthesize` row) and `complete` (no copy, last row kept).
 */
export type AiProgressStage =
  | "prepare"
  | "extract"
  | "reply"
  | "match"
  | "synthesize"
  | "validate"
  | "rank"
  | "generate"
  | "adjust_length"
  | "evaluate"
  | "summarize"
  | "score"
  | "synthesize_regen"
  | "complete"

/** ai_usage_records.feature (04 §2.9.2) */
export type AiUsageFeature =
  | "jd_extraction"
  | "insight"
  | "career_description"
  | "cover_letter"
  | "interview_questions"
  | "interview_evaluation"
  | "writing_chat"
  | "key_verification"
  | "writing_assist"
  | "chat_reply"
export type AiUsageSource = "provider_reported" | "unavailable"
export type AiUsageOutcome = "succeeded" | "failed"

// ---------------------------------------------------------------------------
// 2.1 계정·동의
// ---------------------------------------------------------------------------

/** profiles (A.1) — PK id = auth.users.id, no user_id column */
export type Profile = Row<"profiles", {
  active_ai_provider: AiProviderName | null
}>

/** consents (A.2) */
export type Consent = Row<"consents", {
  consent_type: ConsentType
  updated_at: string
}>

/** policy_versions (A.2) — non-user table */
export type PolicyVersion = Row<"policy_versions", {
  policy_type: PolicyType
}, "updated_at">

// ---------------------------------------------------------------------------
// 2.3 커리어
// ---------------------------------------------------------------------------

/** experiences (A.3) */
export type Experience = Row<"experiences", {
  status: CareerItemStatus
  employment_type: EmploymentType | null
}>

/** educations (2.3) */
export type Education = Row<"educations", {
  status: CareerItemStatus
  education_type: EducationType | null
  enrollment_status: EnrollmentStatus | null
}>

/**
 * @deprecated R4 compatibility shim (DM v4.4, CR-2·CR-7·CR-10): the v4.3b `projects` row the current
 * UI screens and mock fixtures still use. The real data layer maps v4.4 rows into it (`summary` =
 * standalone `description`, `team_size` = null). New code uses `CareerProject`. Delete in the UI rework.
 */
export interface Project extends BaseRow {
  status: CareerItemStatus
  experience_id: Uuid | null
  education_id: Uuid | null
  name: string | null
  role: string | null
  summary: string | null
  start_month: DateString | null
  end_month: DateString | null
  team_size: number | null
  source_writing_chat_id: Uuid | null
  /** v4.4 columns the career add modal writes (standalone projects); absent on v4.3b mock rows */
  is_current?: boolean
  link_url?: string | null
  /**
   * DM v4.4 `projects.description` (standalone "프로젝트 내용", S-43). Always set on reads (real = the column,
   * mock = the legacy `summary` until saved); a patch with `description` writes the column. Prefer it over `summary`.
   */
  description?: string | null
}

/**
 * @deprecated R4 shim: `project_details` was dropped in DM v4.4 (CR-2, STAR moved to `projects`).
 * The real data layer always returns an empty list. Delete in the UI rework.
 */
export interface ProjectDetail extends BaseRow {
  project_id: Uuid
  status: CareerItemStatus
  title: string | null
  situation: string | null
  task: string | null
  action: string | null
  result: string | null
  learnings: string | null
  sort_order: number
  source_writing_chat_id: Uuid | null
}

/**
 * @deprecated R4 shim: `achievements` was dropped in DM v4.4 (CR-11). The real data layer always
 * returns an empty list. Delete in the UI rework.
 */
export interface Achievement extends BaseRow {
  status: CareerItemStatus
  project_detail_id: Uuid | null
  experience_id: Uuid | null
  metric_name: string | null
  value_before: number | null
  value_after: number | null
  unit: string | null
  description: string | null
  kind: string | null
  source_writing_chat_id: Uuid | null
}

// --- v4.4 (R4, CR-2·CR-7·CR-8·CR-9·CR-17·CR-22) — 연결 대기: the reworked screens import these ---

/** projects.project_type (DM 2.3 v4.4, CR-17) */
export type ProjectType =
  | "new_build"
  | "improvement"
  | "operation"
  | "research"
  | "marketing"
  | "process_improvement"
  | "migration"
  | "coursework"
  | "other"
/** projects.experience_type (DM 2.3 v4.4, CR-17) */
export type ExperienceType =
  | "impact"
  | "problem_solving"
  | "collaboration"
  | "leadership"
  | "failure_recovery"
  | "new_challenge"
  | "customer_facing"
/** projects.competencies element (DM 2.3 v4.4, CR-17), at most 3, order kept */
export type Competency =
  | "problem_solving"
  | "analysis"
  | "planning"
  | "execution"
  | "communication"
  | "collaboration"
  | "leadership"
  | "technical_expertise"
  | "customer_insight"
  | "learning_agility"

/**
 * projects v4.4 (DM 2.3): affiliated (experience / education: STAR + classification) or standalone
 * (role / description / link_url + deliverables + skills). Scope never changes after create.
 */
export type CareerProject = Row<"projects", {
  status: CareerItemStatus
  project_type: ProjectType | null
  experience_type: ExperienceType | null
  competencies: Competency[]
}>

/** project_deliverables (DM 2.3 v4.4, CR-8) — standalone projects only, ≤ 50 per project [가정] */
export type ProjectDeliverable = Row<"project_deliverables">

/** skills (A.4) — no status column */
export type Skill = Row<"skills", {
  normalized_name: string
  proficiency: SkillProficiency | null
}>

/** project_skills (A.4) — PK (project_id, skill_id) */
export type ProjectSkill = Row<"project_skills">

// ---------------------------------------------------------------------------
// 2.5 AI 작성 대화
// ---------------------------------------------------------------------------

export type StructuredFieldOrigin = "ai" | "user_edit"
export type StructuredFieldReview = "ok" | "needs_review" | "accepted"

/** structured_draft field object */
export interface StructuredField<T = string> {
  value: T | null
  origin: StructuredFieldOrigin
  /** writing_chat_messages.id of role = 'user' messages only */
  source_message_ids: Uuid[]
  source_quotes: string[]
  review: StructuredFieldReview
  reviewed_at: Timestamp | null
}

/** structured_draft.project — keys = projects column names (no affiliation keys) */
export interface StructuredDraftProject {
  name?: StructuredField
  role?: StructuredField
  summary?: StructuredField
  /** 'YYYY-MM' */
  start_month?: StructuredField
  /** 'YYYY-MM' */
  end_month?: StructuredField
  team_size?: StructuredField<number>
}

export interface StructuredDraftDetail {
  detail_key: string
  existing_detail_id: Uuid | null
  fields: Partial<Record<ProjectDetailField, StructuredField>>
  achievements: Array<{
    metric_name?: StructuredField
    value_before?: StructuredField<number>
    value_after?: StructuredField<number>
    unit?: StructuredField
  }>
}

export interface StructuredDraftSkill {
  value: string
  source_message_ids: Uuid[]
  source_quotes: string[]
}

export interface StructuredDraftClarification {
  kind: "actor_ambiguous"
  field: ProjectDetailField | keyof StructuredDraftProject
  detail_key?: string
}

/** writing_chats.structured_draft (2.5) */
export interface StructuredDraft {
  schema_version?: number
  project?: StructuredDraftProject
  affiliation_suggestion?: {
    type: "experience" | "education"
    id: Uuid
    source_message_ids: Uuid[]
  } | null
  details?: StructuredDraftDetail[]
  skills?: StructuredDraftSkill[]
  clarifications?: StructuredDraftClarification[]
  sensitive_flags_count?: number
}

/** writing_chats.return_target.feature */
export type ReturnTargetFeature = "insight" | "career_description" | "cover_letter" | "job_interview"

/** writing_chats.return_target (2.5, v3.2) */
export interface ReturnTarget {
  application_project_id: Uuid
  feature: ReturnTargetFeature
  params: Record<string, unknown>
  created_at: Timestamp
}

/**
 * @deprecated R4 shim: the v4.3b `writing_chats` row (mode, affiliation, saved_at) the current UI
 * screens still use. The real data layer maps v4.4 rows into it (`mode` = augment_project, status
 * `closed` → `saved`, empty legacy draft). New code uses `ProjectWritingChat`. Delete in the UI rework.
 */
export interface WritingChat extends BaseRow {
  mode: WritingChatMode
  project_id: Uuid | null
  experience_id: Uuid | null
  education_id: Uuid | null
  status: WritingChatStatus
  structured_draft: StructuredDraft
  message_count: number
  last_extracted_sequence: number
  return_target: ReturnTarget | null
  last_activity_at: Timestamp
  saved_at: Timestamp | null
}

/** structured_draft v3 (DM 2.5 v4.4) — same shape as `src/lib/contracts/writing-chat` `StructuredDraftV3` */
export type StructuredDraftV3 = import("@/lib/contracts/writing-chat").StructuredDraftV3

/** writing_chats v4.4 (DM 2.5): bound to one affiliated project, many per project, `active` / `closed` */
export type ProjectWritingChat = Row<"writing_chats", {
  status: "active" | "closed"
  structured_draft: StructuredDraftV3
  return_target: ReturnTarget | null
}>

// --- v4.5 (DM 2.5 · 2.5.0 · 2.5.1, PA-1·PA-3) — migrated (R5). The jsonb shapes below are the screen's view
// models (DM keys verbatim); `src/lib/data/writing-chat-turn-v45.ts` normalizes the stored drafts into them.

/** writing_chats v4.5 (DM 2.5): STAR chat (`project_deliverable_id` null) or deliverable chat. */
export type WritingChatV45 = Row<"writing_chats", {
  status: "active" | "closed"
  /** v4.5 신설: the deliverable this chat writes (null = STAR chat of `project_id`). */
  project_deliverable_id: Uuid | null
  structured_draft: ProjectStructuredDraft | DeliverableStructuredDraft
  return_target: ReturnTarget | null
}>

/** structured_draft field object review / origin (DM 2.5, same for both chat targets). */
export type DraftReview = StructuredFieldReview

/** v4.5 field object base: `rev` (slot-monotonic, missing = 1) + `applied_at` (written by the page-save RPC only). */
interface DraftFieldObjectBase {
  origin: StructuredFieldOrigin
  source_message_ids: Uuid[]
  review: DraftReview
  reviewed_at: Timestamp | null
  /** null = not applied (saved) yet. Written by `save_project_page` (v4.5), never by a form fill. */
  applied_at: Timestamp | null
  /** v4.5 (AI DA-8): +1 on every value change of this slot. Absent on old rows → read as 1. */
  rev?: number
}

/** structured_draft.project.{start_month,end_month} — value 'YYYY-MM' */
export interface DraftPeriodFieldObject extends DraftFieldObjectBase {
  value: string | null
  source_quotes: string[]
}

/** structured_draft.star.{situation,task,action,result,learnings} */
export interface DraftStarFieldObject extends DraftFieldObjectBase {
  value: string | null
  /** set = value for an empty field / append = new sentences only, added after the form value */
  op: "set" | "append"
  source_quotes: string[]
  /**
   * (R8, V-9j / R8-QA-4) why `review = 'needs_review'`: `existing_missing` = a merged `set` may have dropped
   * facts of the existing text; `content_unverified` = V-9e. Optional — older drafts have no key (= null).
   */
  review_reason?: StarReviewReason | null
}

export type StarReviewReason = "existing_missing" | "content_unverified"

/** structured_draft.classification.{project_type,experience_type,competencies} (CR-20, no `op`, no quotes) */
export interface DraftClassificationFieldObject<V = string> extends DraftFieldObjectBase {
  value: V | null
  /** one-line reason (≤ 200 DM / ≤ 100 AI), shown on the card */
  reason: string | null
}

export type ProjectStarField = "situation" | "task" | "action" | "result" | "learnings"
export type DraftPeriodField = "start_month" | "end_month"
export type ProjectClassificationField = "project_type" | "experience_type" | "competencies"
export type DraftClarificationKind = "actor_ambiguous" | "number_vague" | "period_unclear"

/** writing_chats.structured_draft for a STAR chat (DM 2.5 v3 shape + v4.5 `rev`). */
export interface ProjectStructuredDraft {
  schema_version: 3
  project: Partial<Record<DraftPeriodField, DraftPeriodFieldObject>>
  star: Partial<Record<ProjectStarField, DraftStarFieldObject>>
  classification: {
    project_type?: DraftClassificationFieldObject<ProjectType>
    experience_type?: DraftClassificationFieldObject<ExperienceType>
    competencies?: DraftClassificationFieldObject<Competency[]>
  }
  clarifications: Array<{ kind: DraftClarificationKind; field: ProjectStarField | DraftPeriodField | null }>
  sensitive_flags_count: number
}

/** structured_draft.writing_kind (AI-13, in the draft only — not a project_deliverables column, PA-2) */
export type WritingKind = "planning_summary" | "design_doc" | "retrospective" | "presentation" | "other"
export type DeliverableFactActor = "self" | "team" | "unknown"
export type DeliverableBlockType = "heading" | "paragraph" | "bullet_list" | "numbered_list" | "table" | "quote" | "code"
export type DeliverableBlockBasis = "new" | "current_body"
/** `PRJ.*` source fields of a draft block (AI-13 초안 출처) */
export type DeliverableProjectField = "PRJ.description" | "PRJ.role" | "PRJ.skills" | "PRJ.name" | "PRJ.period"
/** deliverable.body.applied_mode / p_applied_proposals[].mode */
export type DeliverableAppliedMode = "replace" | "append"
/** AI-13 slot keys (AI v4.6 AI-13 출력 스키마 `facts[].slot`, 19 keys verbatim; DM 2.5.0 `slot`) */
export type DeliverableSlot =
  | "background"
  | "goal"
  | "contribution"
  | "scope"
  | "outcome"
  | "requirements"
  | "structure"
  | "decisions"
  | "limits"
  | "went_well"
  | "went_wrong"
  | "learnings"
  | "audience"
  | "message"
  | "outline"
  | "reaction"
  | "what"
  | "purpose"
  | "content"

/** structured_draft.facts[] (DM 2.5.0) */
export interface DeliverableFact {
  id: Uuid
  slot: DeliverableSlot | string
  text: string
  actor: DeliverableFactActor
  source_message_ids: Uuid[]
  source_quotes: string[]
  review: DraftReview
  reviewed_at: Timestamp | null
  origin: StructuredFieldOrigin
}

/** structured_draft.deliverable.body.blocks[] (DM 2.5.0) */
export interface DeliverableDraftBlock {
  block_id: string
  type: DeliverableBlockType
  /** heading / paragraph / quote / code text */
  text?: string
  /** bullet_list / numbered_list */
  items?: string[]
  /** table */
  rows?: string[][]
  /** heading depth 2–3 ([가정] default 2) */
  level?: number
  basis: DeliverableBlockBasis
  source_fact_ids: Uuid[]
  source_body_quotes: string[]
  source_project_fields: DeliverableProjectField[]
  review: DraftReview
}

/** structured_draft.deliverable.body (DM 2.5.0) — one draft per chat, no history */
export interface DeliverableDraftBody {
  value: string
  blocks: DeliverableDraftBlock[]
  rev: number
  generated_at: Timestamp
  base_body_hash: string
  replace_allowed: boolean
  missing_slots: Array<DeliverableSlot | string>
  dropped_block_count: number
  applied_at: Timestamp | null
  applied_mode: DeliverableAppliedMode | null
  applied_rev: number | null
}

/** writing_chats.structured_draft for a deliverable chat (DM 2.5.0). `deliverable = {}` before the first draft. */
export interface DeliverableStructuredDraft {
  schema_version: 1
  target: "project_deliverable"
  writing_kind: WritingKind | null
  facts: DeliverableFact[]
  deliverable: { body?: DeliverableDraftBody }
  clarifications: Array<{ kind: "actor_ambiguous" | "number_vague"; slot: DeliverableSlot | string | null; note: string | null }>
  sensitive_flags_count: number
  /** 0–6 drafts made in this chat; 6 → `writing_chat_draft_limit_reached` (409) */
  draft_count: number
}

/** DM 2.5.1 `skipped[].reason`, judged in this order. */
export type PageSaveSkipReason = "not_found" | "already_applied" | "proposal_changed" | "needs_review" | "invalid_entry" | "mark_failed"

/** DM 2.5.1 / 2.5.0 refusal codes the page save and the panel can get (v4.5 new + reused). */
export type PageSaveErrorCode =
  | "stale_write"
  | "project_name_required"
  | "project_affiliation_required"
  | "project_not_affiliated"
  | "deliverable_title_required"
  | "invalid_period"
  | "invalid_classification"
  | "invalid_fields"
  | "field_too_long"
  | "not_found"
  | "project_scope_change_not_allowed"
  | "deliverable_limit_reached"
  | "deliverable_requires_standalone_project"

/** Panel refusals (DM 2.5 / 2.5.0 / 2.5.1, turn request). */
export type WritingChatErrorCode =
  | "invalid_patch"
  | "invalid_form_snapshot"
  | "writing_chat_draft_limit_reached"
  | "writing_chat_closed"
  | "writing_chat_requires_affiliated_project"
  | "field_already_applied"
  | "not_found"

/** writing_chat_messages (2.5) */
export type WritingChatMessage = Row<"writing_chat_messages", {
  role: WritingChatMessageRole
  status: WritingChatMessageStatus
  provider: AiProviderName | null
  model_tier: ModelTier | null
  connection_tier: ConnectionTier | null
}>

// ---------------------------------------------------------------------------
// 2.6 지원 프로젝트 (AP + ST)
// ---------------------------------------------------------------------------

/** application_projects (A.5) */
export type ApplicationProject = Row<"application_projects", {
  name_source: NameSource | null
  stage: ApplicationStage
  stage_outcome: StageOutcome | null
}>

/** application_stage_events (2.6) — immutable, no updated_at */
export type ApplicationStageEvent = Row<"application_stage_events", {
  event_type: StageEventType
  from_stage: ApplicationStage | null
  to_stage: ApplicationStage
  from_outcome: StageOutcome | null
  to_outcome: StageOutcome | null
}>

/** AI-01 seniority (03 AI-01 output): e.g. { min_years: 5, max_years: null, label: "5년 이상", source_sids: ["S3"] } */
export interface JdSeniority {
  min_years: number | null
  max_years: number | null
  label: string
  source_sids: string[]
}

/** job_descriptions.extraction (AI-01 output kept on the row) */
export interface JdExtraction {
  is_likely_jd?: boolean
  seniority?: JdSeniority | null
  [key: string]: unknown
}

export interface JdSentence {
  sid: string
  text: string
  start: number
  end: number
}

/** job_descriptions (A.6) */
export type JobDescription = Row<"job_descriptions", {
  sentences: JdSentence[]
  company_name_source: FieldSource | null
  position_title_source: FieldSource | null
  extraction_status: ExtractionStatus
  extraction: JdExtraction | null
  extraction_provider: AiProviderName | null
  tech_keywords: { keyword: string; source_sids: string[]; }[]
}>

/** jd_requirements (A.7) */
export type JdRequirement = Row<"jd_requirements", {
  category: JdRequirementCategory
  importance: JdRequirementImportance
  origin: JdRequirementOrigin
}>

// ---------------------------------------------------------------------------
// 2.7 인사이트·서류·면접
// ---------------------------------------------------------------------------

export type RequirementMatchStatus = "met" | "partial" | "no_evidence"
export type GapActionType = "add_data" | "reframe" | "prepare_answer"

/** insights.result stored form (03 AI-02; evidence moved to evidence_links, item_key only) */
export interface InsightResult {
  schema_version: number
  basis_note: string
  data_sufficiency: { level: "ok" | "thin"; hints: string[] }
  requirement_matches: Array<{
    item_key: string
    requirement_id: Uuid
    status: RequirementMatchStatus
    rationale: string
    missing_aspect: string | null
  }>
  summary_counts: { met: number; partial: number; no_evidence: number }
  strengths: Array<{ item_key: string; title: string; description: string; requirement_ids: Uuid[] }>
  gaps: Array<{
    item_key: string
    requirement_ids: Uuid[]
    gap_kind: RequirementMatchStatus
    description: string
    actions: Array<{ item_key: string; type: GapActionType; text: string }>
  }>
  strategy: {
    /** evidence item_key is the fixed path "strategy.positioning" */
    positioning: string
    project_priorities: Array<{
      item_key: string
      rank: number
      project_id: Uuid
      reason: string
      requirement_ids: Uuid[]
    }>
  }
}

/**
 * insights.match_stage_result — AI-02 stage 1 (요건 매칭) stored form: the merged batch
 * matches, evidence removed (item_key only). Filled as soon as stage 1 finishes so S-16
 * can show the 판정 표 before stage 2 (C-03 부분 결과, A3 UQ-65).
 */
export interface InsightMatchStageResult {
  schema_version: number
  /** batches finished so far / total batches */
  batches_done: number
  batches_total: number
  requirement_matches: InsightResult["requirement_matches"]
}

/** insights (A.8) */
export type Insight = Row<"insights", {
  status: InsightStatus
  result: InsightResult | null
  match_stage_result: InsightMatchStageResult | null
  provider: AiProviderName | null
  model_tier: ModelTier | null
  connection_tier: ConnectionTier | null
  validation_report: Record<string, unknown> | null
  usage: Record<string, unknown> | null
}, "run_generation">

export interface DraftOptions {
  included_experience_ids?: Uuid[]
  included_education_ids?: Uuid[]
  included_project_ids?: Uuid[]
  project_order?: Uuid[]
  selection_origin?: DraftSelectionOrigin
  ranking?: unknown
  /** v4.2 A17: concise / detailed; null (or missing) = concise */
  tone?: DraftTone | null
}

/** drafts (A.9) */
export type Draft = Row<"drafts", {
  draft_type: DraftType
  title: string | null
  status: DraftStatus
  options: DraftOptions
  provider: AiProviderName | null
  model_tier: ModelTier | null
  connection_tier: ConnectionTier | null
  validation_report: Record<string, unknown> | null
  usage: Record<string, unknown> | null
}, "run_generation">

/** C-05 placeholder tokens (03 C-5) */
export type PlaceholderToken =
  | "[수치 입력 필요]"
  | "[기간 입력 필요]"
  | "[내용 확인 필요]"
  | "[지원 동기 입력 필요]"
  | "[계획 입력 필요]"
  | "[사례 입력 필요]"

export type DraftBlockFlag = "evidence_check_needed" | "number_check_needed"

/** draft_sections.ai_content / edited_content block (A.10) */
export interface DraftBlock {
  block_id: string
  block_kind: DraftBlockKind
  project_id: Uuid | null
  text: string
  requirement_ids: Uuid[]
  placeholders: Array<{ token: PlaceholderToken; hint: string }>
  flags: DraftBlockFlag[]
  generated_by: string | null
  user_modified: boolean
}

/** draft_sections (A.10) */
/** draft_sections (A.10) — v4: AI 출력 공통 메타 (문항 단위 재생성이 다른 공급자일 수 있음) */
export type DraftSection = Row<"draft_sections", {
  section_kind: DraftSectionKind
  template_key: CoverLetterTemplateKey | null
  count_basis: CountBasis | null
  source_selection_mode: SourceSelectionMode
  question_class: QuestionClass | null
  status: DraftSectionStatus
  ai_content: { blocks: DraftBlock[]; } | null
  edited_content: { blocks: DraftBlock[]; } | null
  validation_report: Record<string, unknown> | null
  provider: AiProviderName | null
  model_tier: ModelTier | null
  connection_tier: ConnectionTier | null
  usage: Record<string, unknown> | null
}, "completed_at" | "run_generation">

/** draft_section_sources (A.11, DM v4.4: no `project_detail_ids`) */
export type DraftSectionSourceRow = Row<"draft_section_sources", {
  role: DraftSourceRole
  origin: DraftSourceOrigin
}>

/**
 * @deprecated R4 shim: the current UI reads `project_detail_ids` (dropped in DM v4.4). The real data
 * layer fills it with `[]`. Use `DraftSectionSourceRow`. Delete in the UI rework.
 */
export type DraftSectionSource = DraftSectionSourceRow & { project_detail_ids: Uuid[] }

/** interview_sessions (A.12) */
export type InterviewSession = Row<"interview_sessions", {
  interview_type: InterviewType
  question_count: QuestionCount
  data_sufficiency: DataSufficiency | null
  status: InterviewSessionStatus
  generation_status: InterviewGenerationStatus
  score_status: SessionScoreStatus | null
  question_provider: AiProviderName | null
  evaluation_provider: AiProviderName | null
  question_validation_report: Record<string, unknown> | null
  question_usage: Record<string, unknown> | null
}, "evaluation_job_id" | "evaluation_run_generation" | "question_job_id" | "question_run_generation">

/** interview_questions (A.13) — public columns only are granted to the client */
export type InterviewQuestion = Row<"interview_questions", {
  source_kind: QuestionSourceKind
  anchor: QuestionAnchor
  intent: string | null
  good_answer_signals: unknown
  provider: AiProviderName | null
  model_tier: ModelTier | null
  connection_tier: ConnectionTier | null
  validation_report: Record<string, unknown> | null
  usage: Record<string, unknown> | null
}, "run_generation">

/** interview_answers (A.13) */
export type InterviewAnswer = Row<"interview_answers", {
  status: InterviewAnswerStatus
  score_status: AnswerScoreStatus | null
}>

export type CriterionKey = "specificity" | "intent_fit" | "structure" | "job_relevance"
export type CriterionGrade = "excellent" | "good" | "fair" | "poor" | "not_applicable"

/** answer_evaluations.result stored form (03 AI-06) */
export interface AnswerEvaluationResult {
  schema_version: number
  criteria: Array<{
    key: CriterionKey
    grade: CriterionGrade
    reason: string
    answer_quotes: string[]
    missing: string | null
  }>
  strengths: Array<{ text: string; answer_quotes: string[] }>
  improvements: Array<{ item_key?: string; text: string; how: string; related_criteria: CriterionKey[] }>
  intent_reveal: string
  model_answer: {
    text: string
    placeholders: Array<{ token: PlaceholderToken; hint: string }>
    suggestions_if_true: string[]
  }
  /** AI-06 stored form (`[가정]`). Chips: evidence with item_key `consistency_notes.<n>` */
  consistency_notes: Array<{ text: string; answer_quotes: string[] }>
  answer_quotes?: string[]
  score?: {
    status: AnswerScoreStatus
    value: number | null
    max: number | null
    method_version: string | null
    rationale: string | null
  }
}

/** answer_evaluations (A.13) */
export type AnswerEvaluation = Row<"answer_evaluations", {
  status: EvaluationStatus
  result: AnswerEvaluationResult | null
  error_code: AiErrorCode | null
  provider: AiProviderName | null
  model_tier: ModelTier | null
  connection_tier: ConnectionTier | null
  validation_report: Record<string, unknown> | null
  usage: Record<string, unknown> | null
}, "completed_at" | "run_generation">

/** session_feedbacks.result stored form (03 AI-07) */
export interface SessionFeedbackResult {
  schema_version: number
  headline: string
  overall_strengths: Array<{ text: string; question_ids?: Uuid[]; related_criteria: CriterionKey[] }>
  overall_weaknesses: Array<{ text: string; question_ids?: Uuid[]; related_criteria: CriterionKey[] }>
  next_practice: Array<{
    type: "retry_question" | "focus_session" | "add_data"
    text: string
    requirement_ids?: Uuid[]
    interview_type?: InterviewType
    question_id?: Uuid
  }>
  criteria_summary?: Array<{ key: CriterionKey; distribution: Partial<Record<CriterionGrade, number>> }>
  unanswered_note: string | null
}

/** session_feedbacks (A.13) */
export type SessionFeedback = Row<"session_feedbacks", {
  status: EvaluationStatus
  result: SessionFeedbackResult | null
  provider: AiProviderName | null
  model_tier: ModelTier | null
  connection_tier: ConnectionTier | null
  validation_report: Record<string, unknown> | null
  usage: Record<string, unknown> | null
}, "completed_at" | "run_generation">

// ---------------------------------------------------------------------------
// 2.8 근거
// ---------------------------------------------------------------------------

/** evidence_links (A.14) */
export type EvidenceLink = Row<"evidence_links", {
  owner_type: EvidenceOwnerType
  source_type: EvidenceSourceType
  source_id: string | null
  source_locator: Record<string, unknown> | null
  source_snapshot_at: string
}>

// ---------------------------------------------------------------------------
// 2.9 AI 작업·사용량
// ---------------------------------------------------------------------------

export interface AiJobProgress {
  stage: AiProgressStage
  done?: number
  total?: number
  /** v4: 분당 한도 자동 재시도 대기 끝 시각 (화면 "한도 대기 중 n초") */
  waiting_retry_until?: Timestamp | null
}

/** ai_jobs (A.15) */
export type AiJob = Row<"ai_jobs", {
  job_type: AiJobType
  status: AiJobStatus
  progress: AiJobProgress | null
  params: Record<string, unknown> | null
  provider: AiProviderName
  model_tier: ModelTier | null
  connection_tier: ConnectionTier | null
  error_code: AiErrorCode | null
  error_category: AiErrorCategory | null
  failure_cause: AiFailureCause | null
  usage: Record<string, unknown> | null
  output: Record<string, unknown> | null
  step_outputs: Record<string, unknown>
}>

// ---------------------------------------------------------------------------
// 2.9.2 ~ 2.11 AI 사용량 미터 · AI 연결 (v4 BYOK). usage_events / usage_limits는 v4 삭제 (D-34)
// ---------------------------------------------------------------------------

/** ai_usage_records (04 §2.9.2) — 호출 1회 = 1행, 불변 (updated_at 없음) */
export type AiUsageRecord = Row<"ai_usage_records", {
  feature: AiUsageFeature
  job_type: AiJobType
  provider: AiProviderName
  model_tier: ModelTier
  connection_tier: ConnectionTier
  usage_source: AiUsageSource
  outcome: AiUsageOutcome
  error_code: AiErrorCode | null
}>

/** ai_price_tables (04 §2.9.3) — non-user */
export type AiPriceTable = Row<"ai_price_tables", {
  provider: AiProviderName
}, "created_at" | "long_context_cache_write_usd_per_mtok" | "long_context_cached_input_usd_per_mtok">

/**
 * ai_provider_keys (04 §2.11.1). The 4 cipher columns have no client grant; screens read
 * AiProviderKeyPublic (view ai_provider_keys_public). Kept here only to mirror the table.
 */
export type AiProviderKey = Row<"ai_provider_keys", {
  provider: AiProviderName
  connection_tier: ConnectionTier
  status: ProviderKeyStatus
  last_failure_cause: AiFailureCause | null
}>

/** view ai_provider_keys_public (security invoker, meta columns only) */
export type AiProviderKeyPublic = Row<"ai_provider_keys_public", {
  provider: AiProviderName
  connection_tier: ConnectionTier
  status: ProviderKeyStatus
  last_failure_cause: AiFailureCause | null
}>

/** ai_data_use_consents (04 §2.11.5) */
export type AiDataUseConsent = Row<"ai_data_use_consents", {
  provider: AiProviderName
  connection_tier: ConnectionTier
  updated_at: string
}>

/** ai_disclosures (04 §2.11.6) — non-user */
export type AiDisclosure = Row<"ai_disclosures", {
  provider: AiProviderName
  connection_tier: ConnectionTier
  terms_checked_at: string
}, "created_at">

/**
 * ai_providers (04 §2.11.6) — non-user. `status_url` / `key_issue_url` are not table columns
 * yet: leader decision Q-6 keeps them next to the mock rows (src/lib/mock/ai-providers.ts)
 * until the backend provides them. // [UI-가정]
 */
export type AiProvider = Row<"ai_providers", {
  provider: AiProviderName
  dashboard_url: string
  billing_url: string
  key_guide_version: string
  key_guide_checked_at: string
}, "created_at" | "updated_at">

// ---------------------------------------------------------------------------
// RPC return shapes
// ---------------------------------------------------------------------------

export type ReadinessMissing = "complete_experience" | "complete_project"
/**
 * DM §6 v4.4: `project_star` = an affiliated draft project lacks 상황·행동; `project_fields` = a standalone draft
 * project lacks 프로젝트 내용 (`description`). `complete_project_detail` = @deprecated v4.2 name (never produced now).
 */
export type ReadinessHint = "project_star" | "project_fields" | "profile" | "complete_project_detail"
export type ReadinessFeatureKey = "insight" | "draft" | "job_interview" | "culture_fit_interview"

export interface ReadinessFeature {
  ready: boolean
  missing?: ReadinessMissing[]
  hints?: ReadinessHint[]
  /**
   * only when ready = false (DM §6 v4.4 order): `form` (no experience / project_fields / AI unusable),
   * `writing_chat` + suggested_project_id (STAR 미완 소속 프로젝트), `create_project` (채울 프로젝트 없음 → C-23)
   */
  next_action?: "writing_chat" | "form" | "create_project"
  /** @deprecated v4.2 (DM v4.4 removed it). Still set to 'augment_project' with writing_chat for old readers */
  suggested_mode?: WritingChatMode
  /** writing_chat / form + project_star → that affiliated project; form + project_fields → that standalone project */
  suggested_project_id?: Uuid
  data_sufficiency?: DataSufficiency
}

/** RPC get_data_readiness() (04 §6) */
export interface DataReadiness {
  counts: {
    complete_experiences: number
    complete_educations: number
    complete_projects: number
    /** DM §6 v4.4 */
    projects_without_complete_star: number
    /** DM §6 v4.4 */
    standalone_projects_without_description: number
    /** @deprecated v4.2 name = projects_without_complete_star */
    projects_without_complete_detail: number
    complete_project_details: number
    draft_project_details: number
    draft_experiences: number
    draft_educations: number
    draft_projects: number
    profile_filled: boolean
  }
  draft_item_ids: {
    experiences: Uuid[]
    educations: Uuid[]
    projects: Uuid[]
    project_details: Uuid[]
  }
  features: Record<ReadinessFeatureKey, ReadinessFeature>
  /** v4: AI 연결 상태 (C-18 잠금 판정 원천) */
  ai_connection: AiConnection
}

/** get_data_readiness().ai_connection (04 §6 v4) */
export interface AiConnection {
  active_provider: AiProviderName | null
  key_status: ProviderKeyStatus | null
  connection_tier: ConnectionTier | null
  /**
   * v4.2 (R-67): the active provider × key tier needs (re)consent (2.11.5 rule). true → every AI
   * run opens C-21 first. null when no provider is active.
   */
  consent_required: boolean | null
}

/**
 * AI 연결 게이트 거부 코드 (04 §2.11.7). API response codes — not ai_jobs.error_code values.
 * ① new job start (HTTP 409): ai_not_connected / ai_consent_required / key_invalid
 * ② same-row retry (HTTP 409): ai_job_not_retryable / key_missing / key_invalid /
 *    ai_consent_required / ai_connection_changed (checked in this order)
 * ③④⑤ end inside the job / stream / response as error_code key_missing / key_invalid.
 */
export type AiStartRefusalCode = "ai_not_connected" | "ai_consent_required" | "key_invalid"
export type AiRetryRefusalCode =
  | "ai_job_not_retryable"
  | "key_missing"
  | "key_invalid"
  | "ai_consent_required"
  | "ai_connection_changed"
export type AiGateRefusalCode = AiStartRefusalCode | AiRetryRefusalCode
/** ⑥ create_application_project (Q53-1, 04 §2.11.7): HTTP 409 before the insert, no row */
export type ApplicationCreateRefusalCode = "ai_consent_required" | "key_invalid"
/**
 * 다시 채점 route (Q53-3, 04 §2.7.1): HTTP 409. RPC variant of not_retryable: interview_evaluation_not_needed.
 * (R11 OD-I6, DM 2.7.2) `interview_session_read_only`: the session's 자기소개서 was deleted (contracts INTERVIEW_EVALUATION_REFUSAL_CODES).
 */
export type InterviewEvaluationRefusalCode = "interview_evaluation_not_retryable" | "interview_evaluation_input_only" | "interview_session_read_only"
/** RPC update_failed_jd_raw_text (Q53-2, 04 §2.6.1), in check order */
export type JdRawTextRefusalCode =
  | "invalid_raw_text"
  | "invalid_raw_text_hash"
  | "invalid_sentences"
  | "job_description_not_found"
  | "jd_job_in_progress"
  | "jd_raw_text_locked"
  | "jd_failure_not_input"
  | "jd_has_results"
  | "jd_raw_text_unchanged"

export type DeletionEntityType =
  | "experience"
  | "education"
  | "project"
  | "project_detail"
  | "achievement"
  | "skill"
  | "writing_chat"
  /** v5.5 S-44 산출물 (DM v4.4 `delete_career_item('project_deliverable', …)`, v4.5 cascades its chats) */
  | "project_deliverable"
export type AffiliationMode = "keep_projects" | "delete_projects"
export type ResultMode = "keep_results" | "delete_results"

/** RPC get_deletion_impact(entity_type, entity_id, affiliation_mode) (04 §4.2) */
export interface DeletionImpact {
  cascade: {
    projects: number
    project_details: number
    achievements: number
    project_skills: number
    writing_chats: number
    /** DM v4.4 §4.2: a standalone project's deliverables (0 for other targets) */
    project_deliverables: number
  }
  affected_results: {
    // [UI-가정] 04 says "v2 형식: 이름, insights, drafts, draft_sections, interview_sessions"; key names follow that list.
    by_application_project: Array<{
      application_project_id: Uuid
      name: string | null
      insights: number
      drafts: number
      draft_sections: number
      interview_sessions: number
    }>
    /**
     * OD-I6 / R-OD-5 (DM v4.11): completed sessions whose 자기소개서 was already deleted and that cite this item.
     * R11: always returned by get_deletion_impact (contracts CareerDeletionImpact); 0 for writing_chat.
     */
    detached_interview_sessions: number
  }
  /** entity_type = 'writing_chat' only */
  writing_chat?: { message_count: number; linked_saved_rows: number }
}

/**
 * RPC get_account_deletion_summary() (04 §4.3)
 * // [UI-가정] 04 lists the counted categories but not the JSON keys; keys follow table names.
 */
export interface AccountDeletionSummary {
  career: {
    experiences: number
    educations: number
    projects: number
    project_details: number
    achievements: number
    skills: number
    writing_chats: number
  }
  applications: {
    application_projects: number
    insights: number
    drafts: number
    interview_sessions: number
    application_stage_events: number
  }
  /** v4: 등록 키 수, 데이터 사용 동의 수, 토큰 사용 기록 수 — // [UI-가정] key names */
  ai: {
    provider_keys: number
    data_use_consents: number
    usage_records: number
  }
}

/** RPC get_ai_usage_summary(period_month, include_previous) (04 §2.9.5) */
export interface AiUsageSummary {
  period_month: DateString
  as_of: Timestamp
  totals: {
    input_tokens: number
    cached_input_tokens: number
    cache_write_tokens: number
    output_tokens: number
    estimated_cost_usd: number
    calls: number
    failed_calls: number
  }
  by_feature: Array<{ feature: AiUsageFeature; input_tokens: number; output_tokens: number; estimated_cost_usd: number; calls: number }>
  by_provider: Array<{
    provider: AiProviderName
    connection_tier: ConnectionTier
    input_tokens: number
    output_tokens: number
    estimated_cost_usd: number
    calls: number
  }>
  price_table_versions: Array<{ version: string; source_checked_at: DateString }>
  /** only when include_previous = true */
  previous_month?: { period_month: DateString; estimated_cost_usd: number; input_tokens: number; output_tokens: number }
}

/** save_provider_key verification_result (04 §2.11.3) */
export type ProviderKeyVerificationResult = "valid" | "limited"

/** move_application_stage interview_prompt.in_progress_session (04 §2.6 v4.2) */
export interface InterviewPromptSession {
  session_id: Uuid
  interview_type: InterviewType
  answered_count: number
  question_count: QuestionCount
  generation_status: InterviewGenerationStatus
  last_activity_at: Timestamp
}

/**
 * RPC move_application_stage(...) return (04 §2.6: "새 상태 + interview_prompt")
 * // [UI-가정] the "새 상태" key name is not specified; returned as application_project.
 */
export interface MoveApplicationStageResult {
  application_project: ApplicationProject
  interview_prompt: {
    interview_type: InterviewType
    in_progress_session_id: Uuid | null
    /** v4.2: details of the in-progress session (any type — one per application project) */
    in_progress_session: InterviewPromptSession | null
  } | null
}

/** RPC get_account_deletion_state(p_user_id) (04 §6.1 v4.2 [가정]) */
export type AccountDeletionState = "active" | "deletion_incomplete" | "profile_missing"

/** delete_account error codes surfaced by S-25 (02 S-25 v5.3) */
export type AccountDeletionErrorCode = "account_deletion_busy" | "account_deletion_incomplete"

// ---------------------------------------------------------------------------
// R4 (DM v4.4) RPC shapes — 연결 대기: the reworked screens use these; the legacy names above
// (DataReadiness, DeletionImpact, AccountDeletionSummary, ReadinessHint, DeletionEntityType,
// AffiliationMode, WritingChatMode / WritingChatStatus, StructuredDraft*) are @deprecated shims.
// ---------------------------------------------------------------------------

/** RPC get_data_readiness() v4.4 (DM §6) */
export type DataReadinessV44 = import("@/lib/contracts/career").DataReadiness
/** RPC get_deletion_impact v4.4 (DM §4.2): career rows */
export type CareerDeletionImpactV44 = import("@/lib/contracts/career").CareerDeletionImpact
/** RPC get_deletion_impact v4.4: writing_chat → { message_count, last_applied_at } */
export type WritingChatDeletionImpactV44 = import("@/lib/contracts/career").WritingChatDeletionImpact
/** get_deletion_impact / delete_career_item entity_type v4.4 */
export type DeletionEntityTypeV44 = import("@/lib/contracts/enums").DeletableEntityType
