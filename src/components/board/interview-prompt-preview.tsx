"use client"

/**
 * S-39 `?state=interview-prompt` (dev preview of C-14 v5.3, F11): opens the interview-stage popup
 * for a board card as if it had just been moved into 컬처핏 전형 while a 직무 면접 session is
 * still in progress (the card's real in-progress session — UQ-560 — shown with generation_status
 * "generating" and the other type so every v5.3 line appears). The real flow
 * comes from move_application_stage → interview_prompt.in_progress_session (foundation stage-menu).
 */
import * as React from "react"
import { InterviewPromptDialog, type InterviewPromptState } from "@/components/common/stage-menu"
import type { InterviewSession } from "@/types/db"

export function InterviewPromptPreview({
  applicationProjectId,
  name,
  session,
}: {
  applicationProjectId: string
  name: string
  session: Pick<InterviewSession, "id" | "interview_type" | "answered_count" | "question_count" | "last_activity_at">
}) {
  const [prompt, setPrompt] = React.useState<InterviewPromptState | null>(() => ({
    interview_type: session.interview_type === "job" ? "culture_fit" : "job",
    session: { ...session, generation_status: "generating" },
  }))
  return (
    <InterviewPromptDialog
      open={prompt !== null}
      onOpenChange={(o) => !o && setPrompt(null)}
      applicationProjectId={applicationProjectId}
      name={name}
      prompt={prompt}
      origin="board"
    />
  )
}
