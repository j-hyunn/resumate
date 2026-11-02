import type { RequirementCategory, RequirementImportance } from "../schemas/AI-01";
import type { Ai01NormalizedOutput, Ai01ValidationReport } from "../validation/jd-extraction";

/**
 * AI-01 → `apply_jd_extraction(p_result jsonb)` (S5 plan "계약 — DB" 5, AI-01
 * "저장"). Shape owned by db-engineer (_workspace/backend/S5/02_db-engineer_notes.md
 * "p_result 모양", leader decision 2026-10-28). Requirements become
 * jd_requirements rows (model `text` → `content`, sort_order = output order
 * from 0); the validated output plus its validation_report is stored as
 * `job_descriptions.extraction`. requirements_hash is computed in TS only
 * (context-pack/jd.ts computeRequirementsHash).
 *
 * AI-01 has no evidence_links: the JD sentence ids are the evidence (C-2).
 */

export const APPLY_JD_EXTRACTION_PAYLOAD_VERSION = 1;

export type ApplyJdRequirement = {
  category: RequirementCategory;
  content: string;
  keywords: string[];
  importance: RequirementImportance;
  source_sids: string[];
  /** 0-based output order (db notes: "요건 순서 = sort_order(0부터)"). */
  sort_order: number;
};

export type ApplyJdExtractionResult = {
  /** Our payload version (DB ignores it). */
  schema_version: typeof APPLY_JD_EXTRACTION_PAYLOAD_VERSION;
  prompt_version: string;
  detected_language: string | null;
  is_likely_jd: boolean;
  company_name: { value: string; source_sids: string[] } | null;
  position_title: { value: string; source_sids: string[] } | null;
  seniority: Ai01NormalizedOutput["seniority"];
  requirements: ApplyJdRequirement[];
  tech_keywords: { keyword: string; source_sids: string[] }[];
  other_sids: string[];
  warnings: string[];
  requirements_hash: string;
  extraction: Ai01NormalizedOutput & { validation_report: Ai01ValidationReport };
};

export function toApplyJdRequirements(output: Pick<Ai01NormalizedOutput, "requirements">): ApplyJdRequirement[] {
  return output.requirements.map((r, i) => ({
    category: r.category,
    content: r.text,
    keywords: [...r.keywords],
    importance: r.importance,
    source_sids: [...r.source_sids],
    sort_order: i,
  }));
}

export function toApplyJdExtractionPayload(input: {
  output: Ai01NormalizedOutput;
  report: Ai01ValidationReport;
  requirementsHash: string;
  promptVersion: string;
}): ApplyJdExtractionResult {
  const { output } = input;
  const named = (v: Ai01NormalizedOutput["company_name"]) => (v ? { value: v.value, source_sids: [...v.source_sids] } : null);
  return {
    schema_version: APPLY_JD_EXTRACTION_PAYLOAD_VERSION,
    prompt_version: input.promptVersion,
    detected_language: output.detected_language,
    is_likely_jd: output.is_likely_jd,
    company_name: named(output.company_name),
    position_title: named(output.position_title),
    seniority: output.seniority ? { ...output.seniority, source_sids: [...output.seniority.source_sids] } : null,
    requirements: toApplyJdRequirements(output),
    tech_keywords: output.tech_keywords.map((t) => ({ keyword: t.keyword, source_sids: [...t.source_sids] })),
    other_sids: [...output.other_sids],
    warnings: [...output.warnings],
    requirements_hash: input.requirementsHash,
    extraction: { ...output, validation_report: { ...input.report } },
  };
}
