import { InsightView, type RequirementInfo } from "@/components/applications/insight-view"
import { parseMatchStage, requirementsByIdFrom } from "@/components/applications/insight-parse"
import { getApplicationProject, getInsightState, getJobDescription } from "@/lib/data/applications"
import { getProject } from "@/lib/data/career"
import { getEvidence } from "@/lib/data/evidence"
import { getDataReadiness } from "@/lib/data/readiness"
import { listActiveWritingChats } from "@/lib/data/writing-chats"
import { applicationDisplayName } from "@/lib/data/labels"
import { getPreviewState, previewErrorCode, previewRetryRefusal } from "@/lib/preview-state"
import { jdRunState } from "@/app/(dashboard)/(gated)/applications/_lib/jd-state"
import { gateChatFailurePreview, gateReadinessPreview } from "@/app/(dashboard)/(gated)/applications/_lib/gate-preview"

/**
 * S-46 **"인사이트" 탭** = S-16 규칙 그대로 (v5.20 재정의, CF-7·CF-A12 — ID 유지).
 * 옛 `/applications/{id}/insight` 페이지의 판정을 그대로 옮겼고, 화면 머리·이동 경로만 뺐다
 * (S-46 머리가 하나뿐이다). 생성은 버튼으로 하고 결과는 서버가 저장한다(UX-6).
 */
type SP = Record<string, string | string[] | undefined>

export async function InsightTab({ applicationProjectId: id, searchParams: sp }: { applicationProjectId: string; searchParams: SP }) {
  const state = getPreviewState(sp)
  const ap = await getApplicationProject(id)
  if (!ap) return <p className="text-sm text-muted-foreground">자기소개서를 찾을 수 없어요</p>
  const name = applicationDisplayName(ap.name, ap.name_source, ap.created_at)

  const [jd, insightState, baseReadiness, chats] = await Promise.all([
    getJobDescription(id),
    getInsightState(id),
    getDataReadiness(),
    listActiveWritingChats(),
  ])
  const readiness = gateReadinessPreview(baseReadiness, state)
  // ai-locked는 저장된 결과를 그대로 열람한다 (D-36) — 인사이트가 없으면 본문 C-18 영역형
  const previewEmpty =
    state === "empty" ||
    state === "ai-pending" ||
    state === "ai-waiting" ||
    !!previewErrorCode(state) ||
    state === "insufficient" ||
    state === "insufficient-no-experience" ||
    state === "insufficient-project-fields" ||
    state === "wait-jd" ||
    state === "raw-edited"
  const latest = previewEmpty ? null : insightState.latest
  const evidence = latest ? await getEvidence("insight", latest.id) : {}
  const generating = previewEmpty ? null : insightState.generating
  const partialMatches = generating ? parseMatchStage(generating.match_stage_result) : null
  const partialEvidence = generating && partialMatches ? await getEvidence("insight", generating.id) : {}
  const projectNames: Record<string, string> = {}
  for (const p of latest?.result?.strategy.project_priorities ?? []) {
    const project = await getProject(p.project_id)
    if (project) projectNames[p.project_id] = project.name ?? "이름 없는 프로젝트"
  }
  const legacyRequirements: Record<string, RequirementInfo> = {}
  for (const r of jd?.requirements ?? []) legacyRequirements[r.id] = { content: r.content, category: r.category, importance: r.importance }
  // R17: a v2 insight carries its own requirements (`M{n}`); v1 reads the legacy jd_requirements rows
  const requirements: Record<string, RequirementInfo> = requirementsByIdFrom([...(latest?.result?.requirement_matches ?? []), ...(partialMatches ?? [])], legacyRequirements)
  const careerChanged = Object.values(evidence).some((list) => list.some((e) => e.status !== "ok"))
  const failed = previewErrorCode(state)

  return (
    <InsightView
      applicationProjectId={id}
      applicationName={name}
      requirements={requirements}
      latest={latest}
      generatingJobId={generating?.ai_job_id ?? null}
      partialMatches={partialMatches}
      partialEvidence={partialEvidence}
      evidence={evidence}
      projectNames={projectNames}
      readiness={readiness}
      activeChatId={chats[0]?.id ?? null}
      {...jdRunState(jd, state)}
      rawTextEdited={state === "raw-edited" || (!state && Boolean(jd?.raw_text_edited_at) && jd?.extraction_status === "pending")}
      gateChatFailure={gateChatFailurePreview(state)}
      careerChanged={careerChanged}
      lateFailure={previewEmpty || generating ? null : ap.insight_status.failure}
      preview={{
        pending: state === "ai-pending" || state === "ai-waiting",
        waiting: state === "ai-waiting",
        failed,
        fail: null,
        refusal: previewRetryRefusal(state),
        otherProvider: state === "retry-other-provider",
      }}
    />
  )
}
