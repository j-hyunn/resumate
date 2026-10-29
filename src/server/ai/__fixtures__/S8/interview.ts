import type { AliasMap } from "../../context-pack/aliases";
import type { CareerRows } from "../../context-pack/career-rows";
import { splitJdSentences } from "../../context-pack/jd";
import type { EvidenceSourceType } from "../../evidence-rules";
import { KO_JD_RAW, koInput, JD_ID, JD_UPDATED_AT, reqId } from "../AI-02/insight";
import { careerRowsFixture, IDS } from "../career-rows";

/**
 * Synthetic S8 fixtures (AI-05, AI-06, AI-07). Fictional person, company and
 * posting. Model outputs are built from the context's alias map so aliases
 * always match what the pipeline builds.
 */

export { careerRowsFixture, IDS, JD_ID, JD_UPDATED_AT, reqId };
export const AS_OF = { year: 2026, month: 10 } as const;

/** KO JD + two organisation / way-of-working lines (culture `jd` anchor sources). */
export const CULTURE_JD_RAW = [KO_JD_RAW, "[팀 문화]", "- 기획·개발·운영이 한 스쿼드로 일합니다", "- 매주 우선순위를 함께 조정합니다"].join("\n");

export function jdParts() {
  const base = koInput();
  const sentences = splitJdSentences(CULTURE_JD_RAW);
  const cultureSids = sentences.filter((s) => s.text.includes("스쿼드") || s.text.includes("우선순위를 함께")).map((s) => s.sid);
  return { sentences, requirements: base.requirements, positionTitle: base.positionTitle, cultureSids };
}

export function a(aliases: AliasMap, type: EvidenceSourceType, id: string): string {
  const alias = aliases.aliasOf(type, id);
  if (!alias) throw new Error(`fixture: no alias for ${type} ${id}`);
  return alias;
}

export function sid(aliases: AliasMap, needle: string): string {
  const entry = [...aliases.values()].find((e) => e.sourceType === "jd_sentence" && (e.fields[""] ?? "").includes(needle));
  if (!entry) throw new Error(`fixture: no sentence ${needle}`);
  return entry.alias;
}

/** Rows with profile + one experience (no projects) → culture `thin`. */
export function thinCultureRows(): CareerRows {
  const rows = careerRowsFixture();
  return { ...rows, projects: [], projectDetails: [], achievements: [], projectSkills: [] };
}

export function q(over: Record<string, unknown>) {
  return {
    order: 1,
    source_kind: "project_deep_dive",
    anchor: "experience",
    text: "질문",
    intent: "의도",
    focus_criteria: ["specificity"],
    target_requirement_refs: [],
    target_gap_requirement_refs: [],
    evidence: [],
    good_answer_signals: ["본인 역할 구분"],
    ...over,
  };
}

export function ai05Output(type: "job" | "culture_fit", questions: unknown[], weak: string[] = [], level: "ok" | "thin" | "none" = "ok") {
  return { schema_version: 2, interview_type: type, weak_requirement_refs: weak, questions, data_sufficiency: { level, hints: [] } };
}
