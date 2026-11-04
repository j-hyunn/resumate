/**
 * L-01 shell data: current user, menu badges, service status (S-28 AI 장애 배너). Server only.
 */
import type { AiProviderName } from "@/types/db"
import { mockRequest } from "@/lib/mock/store"
import { hasNewResult } from "./interviews"
import { previewOr } from "./source"
import { isAppError } from "@/lib/contracts/errors"
import { requireUser } from "@/server/auth/session"
import { loadActiveProvider } from "@/server/services/ai-connection/keys"
import { loadShellRows } from "@/server/services/shell"

/**
 * The shell's own slots stay up when the session ends under them: sign-out and deletion re-render the
 * page in the action response just before the screen leaves. The proxy keeps anonymous requests out.
 */
async function sessionOrNull() {
  try {
    return await requireUser()
  } catch (err) {
    if (isAppError(err) && err.code === "unauthenticated") return null
    throw err
  }
}

export interface CurrentUser {
  id: string
  email: string
  /** Google 프로필 이름 (user_metadata.full_name · name). 없으면 null */
  name: string | null
  /** Google 프로필 사진 URL (user_metadata.avatar_url · picture). 없으면 null → 이니셜 */
  avatar_url: string | null
}

function metaString(meta: Record<string, unknown> | undefined, ...keys: string[]): string | null {
  for (const key of keys) {
    const v = meta?.[key]
    if (typeof v === "string" && v.trim()) return v.trim()
  }
  return null
}

export async function getCurrentUser(): Promise<CurrentUser> {
  return previewOr(
    async () => {
      const db = await mockRequest(0)
      return { ...db.user, name: null, avatar_url: null }
    },
    async () => {
      const ctx = await sessionOrNull()
      const meta = ctx?.user.user_metadata
      return {
        id: ctx?.user.id ?? "",
        email: ctx?.user.email ?? "",
        name: metaString(meta, "full_name", "name"),
        avatar_url: metaString(meta, "avatar_url", "picture"),
      }
    },
  )
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
  return previewOr(
    async () => {
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
    },
    async () => {
      const rows = await loadShellRows((await requireUser()).supabase)
      return {
        career_active_chat: rows.activeChat,
        applications_running_jobs: rows.runningApplicationJobs,
        interviews_in_progress: rows.sessions.filter((s) => s.status === "in_progress").length,
        interviews_new_results: rows.sessions.filter((s) => hasNewResult(s as Parameters<typeof hasNewResult>[0])).length,
      }
    },
  )
}

/**
 * S-28 공급자별 장애 배너: affected providers + the active one. The banner shows only when the
 * active provider is affected (02 S-28 v5).
 */
export async function getServiceStatus(): Promise<{ affected_providers: AiProviderName[]; active_provider: AiProviderName | null }> {
  return previewOr(
    async () => {
      const db = await mockRequest(0)
      return { affected_providers: [...db.service_status.affected_providers], active_provider: db.profiles[0]?.active_ai_provider ?? null }
    },
    async () => {
      // [가정] No outage source exists in the backend (spec-gaps W1): the S-28 banner stays off.
      const ctx = await sessionOrNull()
      return { affected_providers: [], active_provider: ctx ? await loadActiveProvider(ctx.supabase, ctx.user.id) : null }
    },
  )
}
