/**
 * S-44 본문 초안 제안 카드 — 채우기 규칙 (UX v5.6 S-44 "반영 규칙", AI v4.6 AI-13 "교체와 덧붙이기" ·
 * "검토 필요 블록 채우기 규칙", DM v4.5 3.3). Pure functions, unit-tested (draft-fill.test.ts).
 *
 * - 채울 내용 블록 = `review` ∈ ok / accepted (수락하지 않은 needs_review는 교체·덧붙이기·넣기 모두에서 뺀다)
 * - 제목 블록은 그 아래 채울 내용 블록이 있을 때만 들어간다 (자식이 모두 빠진 제목은 뺀다)
 * - 덧붙이기 = 위 조건 + `basis = 'new'` 블록, 제목은 그 바로 앞 제목만
 * - 결과 마크다운 = 남은 블록을 순서대로 조립 (`blocksToMarkdown`, 블록 사이 빈 줄)
 */
import type { DeliverableAppliedMode, DeliverableDraftBlock } from "@/types/db"
import { PAGE_LIMITS, blocksToMarkdown, isBlank } from "@/lib/data/career-v45-shared"

export type FillMode = "replace" | "append"

const isContent = (b: DeliverableDraftBlock) => b.type !== "heading"
const isFillable = (b: DeliverableDraftBlock) => b.review === "ok" || b.review === "accepted"

/** The blocks a fill writes, in order. `append` keeps `basis = new` content and only the heading right before it. */
export function blocksToFill(blocks: readonly DeliverableDraftBlock[], mode: FillMode): DeliverableDraftBlock[] {
  const out: DeliverableDraftBlock[] = []
  // headings seen since the last emitted content, outermost first
  let pending: DeliverableDraftBlock[] = []
  const emitted = new Set<string>()
  for (const b of blocks) {
    if (!isContent(b)) {
      const level = b.level ?? 2
      pending = [...pending.filter((h) => (h.level ?? 2) < level), b]
      continue
    }
    if (!isFillable(b)) continue
    if (mode === "append" && b.basis !== "new") continue
    const headings = mode === "append" ? pending.slice(-1) : pending
    for (const h of headings) {
      if (!emitted.has(h.block_id)) {
        out.push(h)
        emitted.add(h.block_id)
      }
    }
    pending = pending.filter((h) => !emitted.has(h.block_id))
    out.push(b)
  }
  return out
}

/** 수락하지 않은 `needs_review` 내용 블록 수 ("검토하지 않은 문장 N개는 넣지 않아요") */
export function unreviewedCount(blocks: readonly DeliverableDraftBlock[]): number {
  return blocks.filter((b) => isContent(b) && b.review === "needs_review").length
}

/** 채울 수 있는 내용 블록이 하나라도 있나 (없으면 모든 반영 버튼 비활성) */
export function hasFillableContent(blocks: readonly DeliverableDraftBlock[]): boolean {
  return blocks.some((b) => isContent(b) && isFillable(b))
}

/** 덧붙일 `basis = new` 내용 블록 수 (0이면 [뒤에 덧붙이기] 비활성) */
export function appendableCount(blocks: readonly DeliverableDraftBlock[]): number {
  return blocks.filter((b) => isContent(b) && isFillable(b) && b.basis === "new").length
}

/** block ids an [뒤에 덧붙이기] preview highlights */
export function appendPreviewIds(blocks: readonly DeliverableDraftBlock[]): Set<string> {
  return new Set(blocksToFill(blocks, "append").map((b) => b.block_id))
}

export type FillButtons =
  /** 폼 본문이 비어 있음 → [본문에 넣기] 하나 (`mode = 'replace'`) */
  | { kind: "insert" }
  /** 폼 본문 있음 → [본문 교체](replace_allowed일 때만) · [뒤에 덧붙이기] */
  | { kind: "replace_append"; showReplace: boolean; appendDisabled: boolean }

export function fillButtons(formBody: string, blocks: readonly DeliverableDraftBlock[], replaceAllowed: boolean): FillButtons {
  if (isBlank(formBody)) return { kind: "insert" }
  return { kind: "replace_append", showReplace: replaceAllowed, appendDisabled: appendableCount(blocks) === 0 }
}

export type FillResult = { ok: true; body: string; mode: DeliverableAppliedMode } | { ok: false; reason: "nothing_to_fill" | "too_long" }

/**
 * The form body after a fill. `insert` = the empty body becomes the draft (`mode = 'replace'` [가정 UX]).
 * `append` = current body (unsaved input included) + one blank line + the new blocks.
 */
export function fillBody(formBody: string, blocks: readonly DeliverableDraftBlock[], action: "insert" | "replace" | "append"): FillResult {
  const mode: FillMode = action === "append" ? "append" : "replace"
  const picked = blocksToFill(blocks, mode)
  if (!picked.some(isContent)) return { ok: false, reason: "nothing_to_fill" }
  const md = blocksToMarkdown(picked)
  const body = action === "append" ? `${formBody.replace(/\s+$/, "")}\n\n${md}` : md
  if (body.length > PAGE_LIMITS.deliverableBody) return { ok: false, reason: "too_long" }
  return { ok: true, body, mode }
}
