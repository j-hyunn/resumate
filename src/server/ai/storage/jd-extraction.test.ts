import { describe, expect, it } from "vitest";
import { KO_BACKEND } from "../__fixtures__/AI-01/jds";
import { computeRequirementsHash, splitJdSentences } from "../context-pack/jd";
import { validateJdExtraction } from "../validation/jd-extraction";
import { toApplyJdExtractionPayload, toApplyJdRequirements } from "./jd-extraction";

/**
 * p_result must match db-engineer's apply_jd_extraction shape
 * (_workspace/backend/S5/02_db-engineer_notes.md "p_result 모양"; leader decision
 * 2026-10-28: company_name / position_title as {value, source_sids} | null,
 * sort_order from 0).
 */
describe("toApplyJdExtractionPayload (apply_jd_extraction p_result)", () => {
  const sentences = splitJdSentences(KO_BACKEND.raw);
  const { value, report } = validateJdExtraction(KO_BACKEND.output, new Set(sentences.map((s) => s.sid)));
  const hash = computeRequirementsHash(toApplyJdRequirements(value));
  const payload = toApplyJdExtractionPayload({ output: value, report, requirementsHash: hash, promptVersion: "p" });

  it("has the db keys with the db types", () => {
    expect(Object.keys(payload).sort()).toEqual(
      [
        "company_name",
        "detected_language",
        "extraction",
        "is_likely_jd",
        "other_sids",
        "position_title",
        "prompt_version",
        "requirements",
        "requirements_hash",
        "schema_version",
        "seniority",
        "tech_keywords",
        "warnings",
      ].sort(),
    );
    expect(payload.company_name).toEqual({ value: "에이비씨페이", source_sids: ["S1"] });
    expect(payload.position_title).toEqual({ value: "백엔드 엔지니어 (결제)", source_sids: ["S1"] });
    expect(typeof payload.detected_language === "string" && payload.detected_language.length <= 16).toBe(true);
    expect(payload.requirements_hash).toMatch(/^[0-9a-f]{64}$/);
    expect(payload.extraction.schema_version).toBe(1);
    expect(payload.extraction.validation_report.requirements_kept).toBe(6);
  });

  it("requirements: content ← text, sort_order from 0, 1–500 chars, ≥ 1 real sid", () => {
    const sids = new Set(sentences.map((s) => s.sid));
    expect(payload.requirements.length).toBeGreaterThan(0);
    payload.requirements.forEach((r, i) => {
      expect(Object.keys(r).sort()).toEqual(["category", "content", "importance", "keywords", "sort_order", "source_sids"]);
      expect(r.sort_order).toBe(i);
      expect(r.content).toBe(value.requirements[i].text);
      expect(r.content.length).toBeGreaterThanOrEqual(1);
      expect(r.content.length).toBeLessThanOrEqual(500);
      expect(r.source_sids.length).toBeGreaterThan(0);
      expect(r.source_sids.every((s) => sids.has(s))).toBe(true);
      expect(r.keywords.every((k) => k.length >= 1 && k.length <= 100)).toBe(true);
    });
  });

  it("tech_keywords keep {keyword, source_sids}; null names stay null", () => {
    expect(payload.tech_keywords[0]).toEqual({ keyword: "Java", source_sids: ["S7"] });
    const bare = toApplyJdExtractionPayload({
      output: { ...value, company_name: null, position_title: null },
      report,
      requirementsHash: hash,
      promptVersion: "p",
    });
    expect(bare.company_name).toBeNull();
    expect(bare.position_title).toBeNull();
  });

  it("is plain JSON (round-trips unchanged)", () => {
    expect(JSON.parse(JSON.stringify(payload))).toEqual(payload);
  });
});
