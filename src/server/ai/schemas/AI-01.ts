import { z } from "zod";
import {
  REQUIREMENT_CATEGORIES,
  REQUIREMENT_IMPORTANCES,
  type RequirementCategory,
  type RequirementImportance,
} from "@/lib/contracts/enums";

/**
 * AI-01 JD 요건 추출 model output, schema_version 1 (AI spec AI-01 "출력 스키마").
 * Keys match the spec exactly. Canonical form (C-10.2): every key present,
 * absent values as explicit null, depth ≤ 5. Length / count limits are
 * enforced by zod after parsing (V-6); the server validator
 * (validation/jd-extraction.ts) then checks sentence ids and normalizes.
 */

export const AI01_OUTPUT_SCHEMA_VERSION = 1;

// Single list shared with the DB CHECK mirror (src/lib/contracts/enums.ts).
export { REQUIREMENT_CATEGORIES, REQUIREMENT_IMPORTANCES, type RequirementCategory, type RequirementImportance };

/** [가정] S5 plan: requirement text ≤ 300 chars (DB content ≤ 500), ≤ 10 keywords. */
export const AI01_TEXT_MAX = 300;
export const AI01_KEYWORDS_MAX = 10;
/** [가정] generous caps so a long multi-position JD still parses; the validator trims nothing else. */
export const AI01_REQUIREMENTS_MAX = 100;
export const AI01_TECH_KEYWORDS_MAX = 60;
export const AI01_OTHER_SIDS_MAX = 1000;
export const AI01_WARNINGS_MAX = 5;

const Sids = z.array(z.string().max(12)).max(50);

export const NamedValueSchema = z.object({
  value: z.string().max(200),
  source_sids: Sids,
});

export const SenioritySchema = z.object({
  min_years: z.number().int().min(0).max(60).nullable(),
  max_years: z.number().int().min(0).max(60).nullable(),
  label: z.string().max(100),
  source_sids: Sids,
});

export const RequirementOutputSchema = z.object({
  category: z.enum(REQUIREMENT_CATEGORIES),
  text: z.string().max(AI01_TEXT_MAX),
  keywords: z.array(z.string().max(60)).max(AI01_KEYWORDS_MAX),
  importance: z.enum(REQUIREMENT_IMPORTANCES),
  source_sids: Sids,
});

export const TechKeywordSchema = z.object({
  keyword: z.string().max(60),
  source_sids: Sids,
});

export const Ai01OutputSchema = z.object({
  schema_version: z.literal(AI01_OUTPUT_SCHEMA_VERSION),
  detected_language: z.string().max(10).nullable(),
  is_likely_jd: z.boolean(),
  company_name: NamedValueSchema.nullable(),
  position_title: NamedValueSchema.nullable(),
  seniority: SenioritySchema.nullable(),
  requirements: z.array(RequirementOutputSchema).max(AI01_REQUIREMENTS_MAX),
  tech_keywords: z.array(TechKeywordSchema).max(AI01_TECH_KEYWORDS_MAX),
  other_sids: z.array(z.string().max(12)).max(AI01_OTHER_SIDS_MAX),
  warnings: z.array(z.string().max(200)).max(AI01_WARNINGS_MAX),
});

export type Ai01Output = z.infer<typeof Ai01OutputSchema>;
export type Ai01Requirement = z.infer<typeof RequirementOutputSchema>;
