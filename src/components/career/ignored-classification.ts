/**
 * 분류 추천 [무시] — remembered per writing chat in this browser, so an ignored field is not shown again even when
 * a later turn proposes it anew. The server side only clears the slot (user `set` null, `origin` stays "ai"), which
 * lets the AI propose it again; a server "dismissed" flag is a spec gap (_workspace/backend/spec-gaps.md).
 * localStorage only (try/catch): a private window simply forgets.
 */
import type { ProjectProposalField } from "@/lib/data/career-v45-shared"

const key = (chatId: string) => `resumate:ignored-classification:${chatId}`

export function ignoredClassifications(chatId: string | null | undefined): ReadonlySet<ProjectProposalField> {
  if (!chatId || typeof window === "undefined") return new Set()
  try {
    const raw = window.localStorage.getItem(key(chatId))
    const list = raw ? (JSON.parse(raw) as unknown) : []
    return new Set(Array.isArray(list) ? (list.filter((x) => typeof x === "string") as ProjectProposalField[]) : [])
  } catch {
    return new Set()
  }
}

export function ignoreClassification(chatId: string, field: ProjectProposalField): void {
  try {
    const next = new Set(ignoredClassifications(chatId)).add(field)
    window.localStorage.setItem(key(chatId), JSON.stringify([...next]))
  } catch {
    // storage blocked: the server clear still applies for this turn
  }
}
