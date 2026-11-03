/** Server-only preview helpers (imports the data layer) — keep out of client bundles. */
// ---------------------------------------------------------------------------
// C-09 preview (A3 gate screens): ?state=insufficient · insufficient-no-experience ·
// insufficient-key-invalid (키 무효 → 폼 경로) · insufficient-chat-failed (대화 첫 턴 실패 → 폼 경로)
// · insufficient-project-fields (v5.3 A18: 이름·역할만 빠진 프로젝트 → S-10 폼)
// ---------------------------------------------------------------------------

import type { AiErrorCode, DataReadiness } from "@/types/db"
import { insufficientReadinessPreview } from "@/lib/data/readiness"

export function gateReadinessPreview(base: DataReadiness, state: string | null): DataReadiness {
  if (!state?.startsWith("insufficient")) return base
  // v5.3 UQ-409 메모: `?state=insufficient-project-fields` → hint project_fields + 주 버튼 "'{프로젝트명}' 마저 채우기" (A18)
  const r = insufficientReadinessPreview(base, {
    noExperience: state === "insufficient-no-experience",
    projectFields: state === "insufficient-project-fields",
    // DM §6 v4.4 (UQ-INT-4): 채울 프로젝트 없음 → create_project (C-23) / AI 못 씀 + STAR 미완 → form + 제안 프로젝트
    createProject: state === "insufficient-create-project",
    starForm: state === "insufficient-star-form",
  })
  if (state === "insufficient-key-invalid") {
    // v5 C-09: key invalid → the server answers next_action = 'form' (v4.4 keeps the STAR project: "'{이름}' 마저 채우기")
    const provider = base.ai_connection.active_provider ?? "gemini"
    const form = (f: DataReadiness["features"]["insight"]) => ({ ...f, next_action: "form" as const, suggested_mode: undefined })
    return {
      ...r,
      ai_connection: { active_provider: provider, key_status: "invalid", connection_tier: base.ai_connection.connection_tier ?? "free", consent_required: false },
      features: { ...r.features, insight: form(r.features.insight), draft: form(r.features.draft), job_interview: form(r.features.job_interview) },
    }
  }
  return r
}

/** C-09 대화 시작 실패 분기 미리보기 */
export function gateChatFailurePreview(state: string | null): AiErrorCode | null {
  return state === "insufficient-chat-failed" ? "provider_unavailable" : null
}
