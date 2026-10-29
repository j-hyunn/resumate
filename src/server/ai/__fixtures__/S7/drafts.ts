import type { AliasMap } from "../../context-pack/aliases";
import type { CareerRows } from "../../context-pack/career-rows";
import type { EvidenceSourceType } from "../../evidence-rules";
import { koInput, JD_ID, JD_UPDATED_AT } from "../AI-02/insight";
import { careerRowsFixture, IDS } from "../career-rows";

/**
 * Synthetic S7 fixtures (AI-11, AI-03, AI-04). Fictional person and company.
 * Model outputs are built from the context's alias map so PRJ-n / DET-n
 * numbers always match the pack the pipeline builds.
 */

export { careerRowsFixture, IDS, JD_ID, JD_UPDATED_AT };
export const AS_OF = { year: 2026, month: 10 } as const;

export function jdParts() {
  const input = koInput();
  return { sentences: input.sentences, requirements: input.requirements, positionTitle: input.positionTitle };
}

export function a(aliases: AliasMap, type: EvidenceSourceType, id: string): string {
  const alias = aliases.aliasOf(type, id);
  if (!alias) throw new Error(`fixture: no alias for ${type} ${id}`);
  return alias;
}

/** Rows with many complete projects under one experience (8-project cap tests). */
export function manyProjectRows(count: number): CareerRows {
  const rows = careerRowsFixture();
  for (let i = 0; i < count; i++) {
    const id = `31000000-0000-4000-8000-${String(i + 1).padStart(12, "0")}`;
    const detailId = `41000000-0000-4000-8000-${String(i + 1).padStart(12, "0")}`;
    rows.projects.push({
      id,
      status: "complete",
      experience_id: IDS.expB,
      education_id: null,
      name: `추가 프로젝트 ${i + 1}`,
      start_month: `2020-${String((i % 12) + 1).padStart(2, "0")}-01`,
      end_month: null,
      role: "개발",
      team_size: null,
      summary: null,
      created_at: "2026-01-10T00:00:00.000Z",
      updated_at: "2026-01-10T00:00:00.000Z",
    });
    rows.projectDetails.push({
      id: detailId,
      status: "complete",
      project_id: id,
      title: `추가 상세 ${i + 1}`,
      situation: "상황",
      task: null,
      action: "기능을 개발했다",
      result: null,
      learnings: null,
      sort_order: 1,
      created_at: "2026-01-10T00:00:00.000Z",
      updated_at: "2026-01-10T00:00:00.000Z",
    });
  }
  return rows;
}

/** Long Korean text of n characters (no digits). */
export function koText(n: number): string {
  const base = "결제 승인 시스템의 안정성을 높이는 일을 했습니다 ";
  return base.repeat(Math.ceil(n / base.length)).slice(0, n);
}
