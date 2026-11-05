/**
 * "답을 받지 못한 메시지" (UX v5.13 S-10 패널 행·S-44 상태, OD-P11 / R-OD-8; AI v4.11 AI-12 / AI-13; DM v4.11 7장
 * 다시 보내기 ①·②). Pure, client-safe — the panel reads it for the open chat.
 *
 * When the chat's **last message is a user message without an AI answer** and **no turn is in progress**:
 * - no assistant row after it (tab closed, connection lost, the row was never started)  → `unanswered`
 * - the last assistant row is `failed` and its job is `canceled` (the user stopped it)  → `unanswered`
 * - the last assistant row is `failed` and its job `failed` (a real failure)            → `failed` (C-20 실패한 턴)
 * - a `failed` assistant row whose job status is unknown (no job row found — `turnFailure` null, R11) → `unanswered`
 * A `streaming` last row is a turn in progress (another tab) → nothing (the panel follows it, UX "진행 중인 턴이 있으면
 * 보이지 않는다"). "다시 보내기" re-runs the reply to `user` without a new user message (`?retry=1`).
 */
import type { TurnJobEnd, WritingChatMessageView } from "@/lib/data/career-v45-shared"

export const UNANSWERED_COPY = {
  line: "답을 받지 못한 메시지예요",
  resend: "다시 보내기",
} as const

export type ReopenedTurn =
  | { kind: "unanswered"; user: WritingChatMessageView }
  | { kind: "failed"; user: WritingChatMessageView; job: TurnJobEnd }

export function reopenedTurn(
  messages: readonly WritingChatMessageView[],
  opts: {
    /** a turn of this panel is running (starting / streaming / patching / drafting) */
    responding: boolean
    /** this panel already shows a live failure (C-20 from a turn in this visit) — that one wins */
    liveFailure: boolean
  },
): ReopenedTurn | null {
  if (opts.responding || opts.liveFailure) return null
  const last = messages[messages.length - 1]
  if (!last) return null
  if (last.role === "user") return { kind: "unanswered", user: last }
  if (last.status !== "failed" || last.is_greeting) return null
  const user = [...messages].reverse().find((m) => m.role === "user" && m.sequence < last.sequence)
  if (!user) return null
  if (last.turn_job?.status === "failed") return { kind: "failed", user, job: last.turn_job }
  return { kind: "unanswered", user }
}

/**
 * Assistant rows the thread doesn't draw as answers: a `failed` row keeps the partial text the server stored, but a
 * stopped turn's partial reply is dropped (AI v4.11 OD-P10) and a failed one is shown as C-20 instead.
 * [UI-가정] both are hidden — the line / C-20 under the user message stands for them.
 */
export function isHiddenAssistantRow(m: WritingChatMessageView): boolean {
  return m.role === "assistant" && m.status === "failed" && !m.is_greeting
}

/**
 * On a "다시 보내기" `turn_started`: the reused (case ①) failed assistant row leaves the list so the new reply
 * (same row id on the real path) isn't drawn twice.
 */
export function dropTrailingFailedReply(messages: readonly WritingChatMessageView[]): WritingChatMessageView[] {
  const last = messages[messages.length - 1]
  return last && isHiddenAssistantRow(last) ? messages.slice(0, -1) : [...messages]
}
