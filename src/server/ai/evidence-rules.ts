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
