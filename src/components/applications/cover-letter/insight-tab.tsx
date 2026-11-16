import { InsightView, type RequirementInfo } from "@/components/applications/insight-view"
import { parseMatchStage, requirementsByIdFrom } from "@/components/applications/insight-parse"
import { getApplicationProject, getInsightState, getJobDescription } from "@/lib/data/applications"
import { getProject } from "@/lib/data/career"
import { getEvidence, type EvidenceView } from "@/lib/data/evidence"
import { getDataReadiness } from "@/lib/data/readiness"
import { listActiveWritingChats } from "@/lib/data/writing-chats"
import { applicationDisplayName } from "@/lib/data/labels"
import { getPreviewState, previewErrorCode, previewRetryRefusal } from "@/lib/preview-state"
import { routes } from "@/lib/routes"
import { gateChatFailurePreview, gateReadinessPreview } from "@/app/(dashboard)/(gated)/applications/_lib/gate-preview"

/**
 * S-46 **"인사이트" 탭** = S-16 규칙 그대로 (v5.20 재정의, CF-7·CF-A12 — ID 유지 · v5.21, JR-3·JR-6·JR-7·JR-Q2 보류·JR-Q3).
 * 옛 `/applications/{id}/insight` 페이지의 판정을 그대로 옮겼고, 화면 머리·이동 경로만 뺐다(S-46 머리가 하나뿐이다).
 *
 * - 요건 추출 선행 없음 — 키가 있고 데이터가 충분하면 바로 생성한다(JR-3).
 * - AI 연결 시 자기소개서를 만들면 자동으로 시작된다(JR-6) — 진행 중 작업이 있으면 처음부터 C-03 진행 표시로 연다.
 * - **옛 인사이트**(`schemaVersion = 1`, JR-Q3 (b)) → 본문 없이 "공고 처리 방식이 바뀌어 다시 만들어야 해요" + [다시 생성].
 * - **공고가 바뀐 인사이트**(`staleReasons.rawText` — 인사이트의 `raw_text_hash` ≠ 지금 JD `raw_text_hash`, JR-7) →
 *   "공고가 바뀌었어요 — 다시 생성", 그 인사이트의 `jd_sentence` 칩은 "변경됨"이고 강조 없이 탭만 연다(C-01·C-02).
 *
 * `?state=`: `empty` · `ai-pending` · `ai-waiting` · `ai-failed*` · `insufficient*` · `ai-locked` · `key-invalid` ·
 * `consent-required` · `retry-*` · `input-failed` · (v5.21) `schema-v1` · `raw-text-stale` · `jd-no-sentences`
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
    state === "jd-no-sentences"
  const latest = previewEmpty ? null : insightState.latest
  // JR-Q3 (b): a schema-1 insight (made from the dropped requirement list) shows no body — the real read returns its
  // result with empty lists, so the evidence is not read either
  const oldSchema = state === "schema-v1" || (!!latest && (latest.schema_version ?? latest.result?.schema_version ?? 2) === 1)
  // JR-7: the server rule (DM v4.16) — the insight's `raw_text_hash` against the JD's current one (not edit times)
  const rawTextStale =
    !!latest && !oldSchema && (state === "raw-text-stale" || (!!jd && !!latest.raw_text_hash && latest.raw_text_hash !== jd.raw_text_hash))
  const stored = latest && !oldSchema ? await getEvidence("insight", latest.id) : {}
  const evidence = rawTextStale ? withRawTextStale(stored, id) : stored
  const generating = previewEmpty ? null : insightState.generating
  const partialMatches = generating ? parseMatchStage(generating.match_stage_result) : null
  const partialEvidence = generating && partialMatches ? await getEvidence("insight", generating.id) : {}
  const projectNames: Record<string, string> = {}
  for (const p of oldSchema ? [] : (latest?.result?.strategy.project_priorities ?? [])) {
    const project = await getProject(p.project_id)
    if (project) projectNames[p.project_id] = project.name ?? "이름 없는 프로젝트"
  }
  // R17 (schema 2): the insight carries its own requirements (`MT-n` → requirement_text)
  const requirements: Record<string, RequirementInfo> = requirementsByIdFrom([...(oldSchema ? [] : (latest?.result?.requirement_matches ?? [])), ...(partialMatches ?? [])])
  // F-P2-07 "데이터 변경됨" = career sources only (`jd_sentence` follows the raw-text rule above)
  const careerChanged = Object.values(stored).some((list) => list.some((e) => e.source_type !== "jd_sentence" && e.status !== "ok"))
  const failed = previewErrorCode(state)

  return (
    <InsightView
      applicationProjectId={id}
      applicationName={name}
      requirements={requirements}
      latest={latest}
      oldSchema={oldSchema}
      rawTextStale={rawTextStale}
      generatingJobId={generating?.ai_job_id ?? null}
      partialMatches={partialMatches}
      partialEvidence={partialEvidence}
      evidence={evidence}
      projectNames={projectNames}
      readiness={readiness}
      activeChatId={chats[0]?.id ?? null}
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
        noSentences: state === "jd-no-sentences",
      }}
    />
  )
}

/**
 * C-01 (v5.21, JR-7 — DM v4.16): when the posting changed, this insight's `jd_sentence` chips read "변경됨" and open the
 * 채용 공고 tab without a highlight (the old sentence ids may point at other text now). Career chips stay as they are.
 */
function withRawTextStale(evidence: Record<string, EvidenceView[]>, applicationProjectId: string): Record<string, EvidenceView[]> {
  const out: Record<string, EvidenceView[]> = {}
  for (const [key, list] of Object.entries(evidence)) {
    out[key] = list.map((e) =>
      e.source_type !== "jd_sentence" || e.status === "deleted" ? e : { ...e, status: "changed", href: routes.coverLetter(applicationProjectId, { tab: "jd" }) },
    )
  }
  return out
}
