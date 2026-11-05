import { describe, expect, it } from "vitest"
import type { WritingChatMessageView } from "@/lib/data/career-v45-shared"
import { UNANSWERED_COPY, dropTrailingFailedReply, isHiddenAssistantRow, reopenedTurn } from "./unanswered"

let n = 0
const msg = (role: "user" | "assistant", extra: Partial<WritingChatMessageView> = {}): WritingChatMessageView => {
  n += 1
  return { id: `m${n}`, sequence: n, role, content: `${role} ${n}`, status: "done", provider: null, created_at: "2026-11-05T00:00:00Z", user_number: role === "user" ? n : null, is_greeting: false, ...extra }
}
const greeting = () => msg("assistant", { is_greeting: true, sequence: 0 })
const idle = { responding: false, liveFailure: false }
const job = (status: "failed" | "canceled") => ({ status, error_code: status === "failed" ? ("rate_limited" as const) : null, provider: "gemini" as const, retry_after: null, quota_resets_at: null })

describe("OD-P11 reopenedTurn", () => {
  it("copy is UX v5.13 verbatim", () => {
    expect(`${UNANSWERED_COPY.line} · ${UNANSWERED_COPY.resend}`).toBe("답을 받지 못한 메시지예요 · 다시 보내기")
  })

  it("last message is a user message with no assistant row → unanswered", () => {
    const u = msg("user")
    expect(reopenedTurn([greeting(), msg("user"), msg("assistant"), u], idle)).toEqual({ kind: "unanswered", user: u })
  })

  it("R-OD-8: failed reply whose job was canceled (user stop) → unanswered, not a failure", () => {
    const u = msg("user")
    expect(reopenedTurn([greeting(), u, msg("assistant", { status: "failed", turn_job: job("canceled") })], idle)).toEqual({ kind: "unanswered", user: u })
  })

  it("R-OD-8: failed reply whose job failed → the failed turn (C-20) with the job's cause", () => {
    const u = msg("user")
    const r = reopenedTurn([greeting(), u, msg("assistant", { status: "failed", turn_job: job("failed") })], idle)
    expect(r).toMatchObject({ kind: "failed", user: u, job: { status: "failed", error_code: "rate_limited" } })
  })

  it("[UI-가정] a failed reply with unknown job status (real DTO, 연결 대기) → unanswered", () => {
    const u = msg("user")
    expect(reopenedTurn([u, msg("assistant", { status: "failed" })], idle)).toEqual({ kind: "unanswered", user: u })
  })

  it("nothing while a turn runs, a live failure shows, the reply is streaming (another tab) or done", () => {
    const list = [greeting(), msg("user")]
    expect(reopenedTurn(list, { responding: true, liveFailure: false })).toBeNull()
    expect(reopenedTurn(list, { responding: false, liveFailure: true })).toBeNull()
    expect(reopenedTurn([msg("user"), msg("assistant", { status: "streaming" })], idle)).toBeNull()
    expect(reopenedTurn([msg("user"), msg("assistant")], idle)).toBeNull()
    expect(reopenedTurn([greeting()], idle)).toBeNull()
    expect(reopenedTurn([], idle)).toBeNull()
  })
})

describe("failed reply rows", () => {
  it("are hidden from the thread (the greeting never is)", () => {
    expect(isHiddenAssistantRow(msg("assistant", { status: "failed" }))).toBe(true)
    expect(isHiddenAssistantRow(msg("assistant"))).toBe(false)
    expect(isHiddenAssistantRow(msg("user", { status: "failed" }))).toBe(false)
  })

  it("다시 보내기 drops only a trailing failed reply (no new user message is added)", () => {
    const u = msg("user")
    const failed = msg("assistant", { status: "failed" })
    expect(dropTrailingFailedReply([u, failed])).toEqual([u])
    expect(dropTrailingFailedReply([u])).toEqual([u])
  })
})
