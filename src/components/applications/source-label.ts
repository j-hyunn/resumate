import type { DraftSectionSource } from "@/types/db"

/**
 * 02 S-19 자소서 문항별 목록 (A3 UQ-84 (e)): "회사명 또는 교육 표시 이름 › 프로젝트명" from the source as it is now;
 * the stored `source_label` snapshot only when the source is gone (or not in the tree — e.g. back to 작성 중).
 */
export function sourceRowLabel(src: Pick<DraftSectionSource, "project_id" | "source_label" | "source_deleted_at">, projectLabels: Record<string, string>): string | null {
  if (src.source_deleted_at || !src.project_id) return src.source_label
  return projectLabels[src.project_id] ?? src.source_label
}
