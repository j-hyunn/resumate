/**
 * AI spec C-3 근거 형식 table as typed constants (V-2 and the quote-required rule).
 * `writing_chat_message` is AI-12 only and never stored in evidence_links (DM-15).
 *
 * (v4.12, SD-6) **`profile` (`PROFILE`) is gone.** No profile value reaches a
 * prompt, so the source type was dropped from C-3: a model output that still
 * cites it fails V-1 (no `PROFILE` in the pack) and V-2 (unknown source type).
 * The DB CHECK list keeps `profile` and existing `evidence_links` rows stay as
 * they are (SD-A19) — only this code-side allow list narrows; an insert trigger
 * rejects new rows (DM 2.8).
 *
 * (R14, AI spec v4.14 RM-1) `interview_answer` (`ANS-n`) is gone with the mock
 * interview features (AI-05/06/07).
 */

export const EVIDENCE_SOURCE_TYPES = [
  "experience",
  "education",
  "project",
  "project_deliverable",
  "skill",
  "jd_sentence",
  "jd_requirement",
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
  experience: { ref: /^EXP-\d+$/, fields: ["job_rank", "job_position", "department", "summary", "period"], quoteRequired: ["summary"] },
  education: {
    ref: /^EDU-\d+$/,
    fields: ["institution_name", "program_name", "education_type", "enrollment_status", "period", "description"],
    quoteRequired: ["description"],
  },
  // v4.5 (CR-2·CR-7·CR-10): STAR fields on affiliated projects, role/description on
  // standalone ones. Which subset applies to one PRJ-n is PROJECT_SCOPE_FIELDS (V-2).
  project: {
    ref: /^PRJ-\d+$/,
    fields: ["name", "period", "situation", "task", "action", "result", "learnings", "role", "description"],
    quoteRequired: ["situation", "task", "action", "result", "learnings", "role", "description"],
  },
  // v4.5 (CR-8, C-1.1): quote-based evidence on the normalized text that entered the pack.
  project_deliverable: { ref: /^DLV-\d+$/, fields: ["title", "body"], quoteRequired: ["body"] },
  skill: { ref: /^SKL-\d+$/, fields: ["name"], quoteRequired: [] },
  jd_sentence: { ref: /^S\d+$/, fields: [], quoteRequired: [] },
  jd_requirement: { ref: /^REQ-\d+$/, fields: [], quoteRequired: [] },
  user_note: { ref: /^NOTE-\d+$/, fields: [], quoteRequired: ["*"] },
  writing_chat_message: { ref: /^M-\d+$/, fields: [], quoteRequired: ["*"] },
};

/**
 * AI spec C-3 v4.5 `project` row: a PRJ-n alias is either an affiliated project
 * (experience/education, STAR) or a standalone project (role/description).
 * Classification (project_type / experience_type / competencies) and link_url
 * are never citable (C-1.2).
 */
export const PROJECT_SCOPES = ["affiliated", "standalone"] as const;
export type ProjectScope = (typeof PROJECT_SCOPES)[number];
export const PROJECT_SCOPE_FIELDS: Readonly<Record<ProjectScope, readonly string[]>> = {
  affiliated: ["name", "period", "situation", "task", "action", "result", "learnings"],
  standalone: ["name", "period", "role", "description"],
};

/** Key used in alias entries for sources without fields (JD sentence, note, …). */
export const WHOLE_SOURCE_FIELD = "";

export function isEvidenceSourceType(value: unknown): value is EvidenceSourceType {
  return typeof value === "string" && (EVIDENCE_SOURCE_TYPES as readonly string[]).includes(value);
}

export function isQuoteRequired(sourceType: EvidenceSourceType, field: string | null): boolean {
  const rule = EVIDENCE_RULES[sourceType];
  return rule.quoteRequired.includes("*") || (field !== null && rule.quoteRequired.includes(field));
}

/** C-9 (v4.5): `project.learnings` (affiliated project STAR) is the user's reflection, not a fact. */
export function isReflectionEvidence(e: { source_type: string; field?: string | null }): boolean {
  return e.source_type === "project" && e.field === "learnings";
}

/**
 * Source types that support a claim about the user (V-4 count). JD sources
 * describe the job, not the user, so they never keep a judgment item alive on
 * their own. Features can pass their own set.
 */
export const CAREER_SUPPORT_SOURCE_TYPES: ReadonlySet<EvidenceSourceType> = new Set<EvidenceSourceType>([
  "experience",
  "education",
  "project",
  "project_deliverable",
  "skill",
  "user_note",
]);

/**
 * Whether one (validated) evidence object counts as support for a claim about
 * the user (V-4): its source type is in `types` (default: career sources).
 * (v4.12, SD-6) V-4 has no exception list any more — the profile-wish carve-out
 * (A10) is gone with the profile block, so the rule is just "a judgment item
 * with no valid evidence has zero evidence". Reflections (C-9) are checked
 * separately (V-8), and `computed_total_months` is not an evidence object at
 * all, so it never enters this count (C-1).
 */
export function isCareerSupportEvidence(
  e: { source_type: string; field?: string | null },
  types: ReadonlySet<EvidenceSourceType> = CAREER_SUPPORT_SOURCE_TYPES,
): boolean {
  return isEvidenceSourceType(e.source_type) && types.has(e.source_type);
}

/**
 * A fact a `met` verdict may rest on (AI spec AI-02 판정 기준, v4.5): an affiliated project's action / result, a
 * standalone project's description, or a deliverable body (C-1.1).
 * Situation, task, role, skill tags, classification, and learnings are not enough.
 * V-2 already guarantees `description` only comes from a standalone project.
 */
export function isActionResultEvidence(e: { source_type: string; field?: string | null }): boolean {
  if (e.source_type === "project") return e.field === "action" || e.field === "result" || e.field === "description";
  return e.source_type === "project_deliverable" && e.field === "body";
}
