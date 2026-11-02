/**
 * AI spec C-3 근거 형식 table as typed constants (V-2 and the quote-required rule).
 * `writing_chat_message` is AI-12 only and never stored in evidence_links (DM-15).
 */

export const EVIDENCE_SOURCE_TYPES = [
  "profile",
  "experience",
  "education",
  "project",
  "project_detail",
  "achievement",
  "skill",
  "jd_sentence",
  "jd_requirement",
  "interview_answer",
  "user_note",
  "writing_chat_message",
] as const;
export type EvidenceSourceType = (typeof EVIDENCE_SOURCE_TYPES)[number];

/** Source types that may be written to `evidence_links.source_type` (DM §2.8). */
export const STORABLE_SOURCE_TYPES = EVIDENCE_SOURCE_TYPES.filter(
  (t): t is Exclude<EvidenceSourceType, "writing_chat_message"> => t !== "writing_chat_message",
);

type Rule = {
  /** Alias pattern for `ref`. */
  ref: RegExp;
  /** Allowed `field` values; empty = the source has no fields (field must be absent). */
  fields: readonly string[];
  /** Fields whose evidence must carry a quote. `"*"` = always (field-less sources). */
  quoteRequired: readonly string[];
};

export const EVIDENCE_RULES: Readonly<Record<EvidenceSourceType, Rule>> = {
  profile: {
    ref: /^PROFILE$/,
    fields: ["desired_job_title", "total_years_of_experience", "interested_industries"],
    quoteRequired: [],
  },
  experience: { ref: /^EXP-\d+$/, fields: ["job_rank", "job_position", "department", "summary", "period"], quoteRequired: ["summary"] },
  education: {
    ref: /^EDU-\d+$/,
    fields: ["institution_name", "program_name", "education_type", "enrollment_status", "period", "description"],
    quoteRequired: ["description"],
  },
  project: { ref: /^PRJ-\d+$/, fields: ["name", "role", "team_size", "summary", "period"], quoteRequired: ["summary"] },
  project_detail: {
    ref: /^DET-\d+$/,
    fields: ["title", "situation", "task", "action", "result", "learnings"],
    quoteRequired: ["situation", "task", "action", "result", "learnings"],
  },
  achievement: { ref: /^ACH-\d+$/, fields: ["metric", "description"], quoteRequired: ["description"] },
  skill: { ref: /^SKL-\d+$/, fields: ["name"], quoteRequired: [] },
  jd_sentence: { ref: /^S\d+$/, fields: [], quoteRequired: [] },
  jd_requirement: { ref: /^REQ-\d+$/, fields: [], quoteRequired: [] },
  interview_answer: { ref: /^ANS-\d+$/, fields: [], quoteRequired: ["*"] },
  user_note: { ref: /^NOTE-\d+$/, fields: [], quoteRequired: ["*"] },
  writing_chat_message: { ref: /^M-\d+$/, fields: [], quoteRequired: ["*"] },
};

/** Key used in alias entries for sources without fields (JD sentence, answer, note, …). */
export const WHOLE_SOURCE_FIELD = "";

export function isEvidenceSourceType(value: unknown): value is EvidenceSourceType {
  return typeof value === "string" && (EVIDENCE_SOURCE_TYPES as readonly string[]).includes(value);
}

export function isQuoteRequired(sourceType: EvidenceSourceType, field: string | null): boolean {
  const rule = EVIDENCE_RULES[sourceType];
  return rule.quoteRequired.includes("*") || (field !== null && rule.quoteRequired.includes(field));
}

/** C-9: `project_detail.learnings` is the user's reflection, not a fact. */
export function isReflectionEvidence(e: { source_type: string; field?: string | null }): boolean {
  return e.source_type === "project_detail" && e.field === "learnings";
}

/**
 * Source types that support a claim about the user (V-4 count). JD sources
 * describe the job, not the user, so they never keep a judgment item alive on
 * their own. Features can pass their own set.
 */
export const CAREER_SUPPORT_SOURCE_TYPES: ReadonlySet<EvidenceSourceType> = new Set<EvidenceSourceType>([
  "profile",
  "experience",
  "education",
  "project",
  "project_detail",
  "achievement",
  "skill",
  "interview_answer",
  "user_note",
]);

/**
 * AI spec C-3 V-4 (v4.3, A10 — 확정 2026-11-05): the profile's wishes
 * (희망 직무·관심 산업) say what the user wants, not what they did. They are
 * context only and never count as support for a judgment, strength, or
 * positioning. `total_years_of_experience` stays a fact (연차 판정 근거).
 */
export const PROFILE_PREFERENCE_FIELDS: readonly string[] = ["desired_job_title", "interested_industries"];

export function isProfilePreferenceEvidence(e: { source_type: string; field?: string | null }): boolean {
  return e.source_type === "profile" && e.field != null && PROFILE_PREFERENCE_FIELDS.includes(e.field);
}

/**
 * Whether one (validated) evidence object counts as support for a claim about
 * the user (V-4): its source type is in `types` (default: career sources) and
 * it is not a profile wish (A10). Reflections (C-9) are checked separately.
 */
export function isCareerSupportEvidence(
  e: { source_type: string; field?: string | null },
  types: ReadonlySet<EvidenceSourceType> = CAREER_SUPPORT_SOURCE_TYPES,
): boolean {
  return isEvidenceSourceType(e.source_type) && types.has(e.source_type) && !isProfilePreferenceEvidence(e);
}

/**
 * A fact a question or a `met` verdict may rest on: a detail's action / result
 * or an achievement (AI spec AI-02 판정 기준, 4.1 사실 전제 v3 / A11).
 * Situation, task, summaries, skill tags and learnings are not enough.
 */
export function isActionResultEvidence(e: { source_type: string; field?: string | null }): boolean {
  return e.source_type === "achievement" || (e.source_type === "project_detail" && (e.field === "action" || e.field === "result"));
}
