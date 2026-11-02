/**
 * L-01 shell data: current user, menu badges, service status (S-28 AI 장애 배너). Server only.
 */
import type { AiProviderName } from "@/types/db"
import { mockRequest } from "@/lib/mock/store"
import { hasNewResult } from "./interviews"

export interface CurrentUser {
  id: string
  email: string
}

export async function getCurrentUser(): Promise<CurrentUser> {
  const db = await mockRequest(0)
  return { ...db.user }
}

export interface ShellBadges {
  /** 커리어: 작성 중 AI 대화가 있으면 점 [가정] */
  career_active_chat: boolean
  /** 기업 JD 관리: 진행 중 AI 작업 수 */
  applications_running_jobs: number
  /** 모의 면접: 작성 중 세션 수 */
  interviews_in_progress: number
  /** 모의 면접: 새 채점 결과 수 (A9: submitted + completed | evaluation_failed + result_viewed_at null) */
  interviews_new_results: number
}

export async function getShellBadges(): Promise<ShellBadges> {
  const db = await mockRequest(0)
  return {
    career_active_chat: db.writing_chats.some((c) => c.status === "active"),
    applications_running_jobs: db.ai_jobs.filter(
      (j) =>
        j.application_project_id &&
        (j.status === "queued" || j.status === "running") &&
        j.job_type !== "jd_extraction" &&
        j.job_type !== "writing_chat_turn",
    ).length,
    interviews_in_progress: db.interview_sessions.filter((s) => s.status === "in_progress").length,
    interviews_new_results: db.interview_sessions.filter(hasNewResult).length,
  }
}

/**
 * S-28 공급자별 장애 배너: affected providers + the active one. The banner shows only when the
 * active provider is affected (02 S-28 v5).
 */
export async function getServiceStatus(): Promise<{ affected_providers: AiProviderName[]; active_provider: AiProviderName | null }> {
  const db = await mockRequest(0)
  return { affected_providers: [...db.service_status.affected_providers], active_provider: db.profiles[0]?.active_ai_provider ?? null }
}
