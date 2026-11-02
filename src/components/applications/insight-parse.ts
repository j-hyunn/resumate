/**
 * Server- and client-safe helpers for S-16 (no "use client": the page calls parseMatchStage on the server).
 */
import type { InsightResult, RequirementMatchStatus } from "@/types/db"

export type MatchRow = InsightResult["requirement_matches"][number]

/** match_stage_result (stage-1 stored form) → rows; tolerant until the foundation types it (UQ-65) */
export function parseMatchStage(value: unknown): MatchRow[] | null {
  if (!value || typeof value !== "object") return null
  const v = value as Record<string, unknown>
  const list = (Array.isArray(v.requirement_matches) ? v.requirement_matches : Array.isArray(v.matches) ? v.matches : null) as Array<Record<string, unknown>> | null
  if (!list) return null
  const rows = list
    .filter((m) => typeof m.requirement_id === "string" && (m.status === "met" || m.status === "partial" || m.status === "no_evidence"))
    .map((m) => ({
      item_key: typeof m.item_key === "string" ? m.item_key : `requirement_matches.${m.requirement_id as string}`,
      requirement_id: m.requirement_id as string,
      status: m.status as RequirementMatchStatus,
      rationale: typeof m.rationale === "string" ? m.rationale : "",
      missing_aspect: typeof m.missing_aspect === "string" ? m.missing_aspect : null,
    }))
  return rows.length ? rows : null
}

/**
 * v5.3 S-16 (AI 명세 v4.3 C-3): stored sentences must not show internal context aliases (EXP-1, PRJ-3,
 * DET-2, EDU-1, REQ-4, S12 …) — the backend replaces them with project / requirement names. This is a
 * display guard for anything that slips through: an alias in parentheses / brackets is dropped, a bare
 * alias becomes "해당 항목". // [UI-가정] 대체어
 */
// 03 C-3 aliases: EXP·EDU·PRJ·DET·ACH·SKL-n, requirements REQ-n, JD sentences Sn (UQ-517).
// `Sn` is only removed inside brackets — a bare "S3" can be real text (e.g. "AWS S3"). // [UI-가정]
const ALIAS = String.raw`(?:EXP|PRJ|DET|EDU|ACH|SKL|REQ)-\d+`
const ALIAS_OR_SENTENCE = String.raw`(?:${ALIAS}|S\d+)`
const ALIAS_WRAPPED = new RegExp(String.raw`\s?[(\[]\s*${ALIAS_OR_SENTENCE}(?:\s*[,·/]\s*${ALIAS_OR_SENTENCE})*\s*[)\]]`, "g")
const ALIAS_BARE = new RegExp(String.raw`\b${ALIAS}\b`, "g")

export function hideInternalAliases(text: string): string
export function hideInternalAliases(text: string | null): string | null
export function hideInternalAliases(text: string | null): string | null {
  if (!text) return text
  return text.replace(ALIAS_WRAPPED, "").replace(ALIAS_BARE, "해당 항목")
}
