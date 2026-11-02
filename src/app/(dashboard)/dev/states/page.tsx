import { notFound } from "next/navigation"
import { ScreenSuspense } from "@/components/common/screen-suspense"
import { PageHeader } from "@/components/common/basics"
import { PageCrumbs } from "@/components/common/shell/breadcrumbs"
import { DevStateGallery } from "@/components/common/dev-state-gallery"
import { isPreviewEnabled } from "@/lib/preview-state"
import { getDataReadiness, insufficientReadinessPreview } from "@/lib/data/readiness"
import { getEvidence } from "@/lib/data/evidence"
import { listActiveAiJobs } from "@/lib/data/ai-jobs"
import { getInsightState, listApplicationProjects } from "@/lib/data/applications"
import type { EvidenceView } from "@/lib/data/evidence"
import { applicationDisplayName } from "@/lib/data/labels"

// Dev-only gallery of common components / ST-xx states (UQ-23). 404 in production.
export default function Page() {
  // UQ-25: check before any Suspense boundary so production answers with a real HTTP 404
  if (!isPreviewEnabled) notFound()
  return (
    <ScreenSuspense>
      <Screen />
    </ScreenSuspense>
  )
}

async function Screen() {
  const [readiness, jobs, apps] = await Promise.all([
    getDataReadiness(),
    listActiveAiJobs(),
    listApplicationProjects(),
  ])
  const insightOwner = apps.find((a) => a.insight_state === "ready")
  const evidenceByKey = insightOwner ? await getEvidenceFor(insightOwner.id) : {}
  const demo = apps.find((a) => a.stage === "job_interview") ?? apps[0]
  return (
    <div className="space-y-8">
      <PageCrumbs items={[{ label: "개발용 상태 갤러리" }]} />
      <PageHeader title="상태 갤러리 (개발용)" description="공통 컴포넌트와 ST-xx 상태를 ?state= 로 골라 볼 수 있어요" />
      <DevStateGallery
        runningJobId={jobs.find((j) => j.status === "running" || j.status === "queued")?.id ?? null}
        readiness={readiness}
        insufficient={insufficientReadinessPreview(readiness)}
        insufficientNoExperience={insufficientReadinessPreview(readiness, { noExperience: true })}
        insufficientProjectFields={insufficientReadinessPreview(readiness, { projectFields: true })}
        evidence={Object.values(evidenceByKey).flat().slice(0, 6)}
        demoApplication={{ id: demo.id, name: applicationDisplayName(demo.name, demo.name_source, demo.created_at), stage: "job_interview" }}
        scoredSession={{ score_status: "pending_method", score_value: null, score_max: null, score_counted_count: 3, unanswered_count: 0, question_count: 3 }}
      />
    </div>
  )
}

async function getEvidenceFor(applicationProjectId: string): Promise<Record<string, EvidenceView[]>> {
  const { latest } = await getInsightState(applicationProjectId)
  return latest ? getEvidence("insight", latest.id) : {}
}
