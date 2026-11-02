/**
 * S-36 게이트 진입 배너 (C-09에서 들어온 대화, writing_chats.return_target).
 * "{원래 기능}을 위해 필요한 내용: {남은 부족 항목}" — 항목 문구는 C-09와 같음.
 */
import { CircleCheck, ClipboardList } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import type { DataReadiness, ReturnTargetFeature } from "@/types/db"
import { objectParticle } from "@/lib/data/labels"
import { routes } from "@/lib/routes"
import { RETURN_FEATURE_LABELS, RETURN_FEATURE_READINESS } from "@/components/common/return-banner"

/** where "{기능}으로 돌아가기" lands when the session has no stored target (다른 기기) */
export function featureHref(feature: ReturnTargetFeature, applicationProjectId: string, params?: Record<string, unknown> | null): string {
  if (feature === "insight") return routes.applicationInsight(applicationProjectId)
  if (feature === "job_interview") return routes.interviewPrep(applicationProjectId, "job")
  // UQ-80: 자기소개서 문항 설정 중이었으면 S-18로 (params.draft_id)
  const draftId = typeof params?.draft_id === "string" ? params.draft_id : null
  if (feature === "cover_letter" && draftId) return routes.draftQuestions(applicationProjectId, draftId)
  return routes.applicationDrafts(applicationProjectId)
}

const MISSING_COPY = {
  complete_experience: "완료된 경력 1건이 필요해요(교육만으로는 부족해요)",
  complete_project: "완료된 프로젝트 1건이 필요해요",
} as const

export function GateBanner({
  feature,
  applicationName,
  readiness,
  readyToReturn,
}: {
  feature: ReturnTargetFeature
  applicationName: string
  readiness: DataReadiness
  readyToReturn: boolean
}) {
  const label = RETURN_FEATURE_LABELS[feature]
  const f = readiness.features[RETURN_FEATURE_READINESS[feature]]
  const items: string[] = [...(f.missing ?? []).map((m) => MISSING_COPY[m])]
  if (f.hints?.includes("complete_project_detail")) items.push("프로젝트는 있지만 완료된 상세 내용이 없어요(제목·상황·행동)")
  return (
    <div className="flex flex-wrap items-start gap-2 rounded-lg border border-info/20 bg-info-subtle px-4 py-3 text-sm text-info-subtle-foreground" role="region" aria-label="원래 기능을 위해 필요한 내용">
      <ClipboardList className="mt-0.5 size-4 shrink-0" aria-hidden />
      <div className="min-w-0 flex-1 space-y-1">
        <p>
          <strong className="font-semibold">
            {label}
            {objectParticle(label)} 위해 필요한 내용
          </strong>
          <span className="text-info-subtle-foreground"> · {applicationName}</span>
        </p>
        {f.ready ? (
          <p>필요한 내용이 모두 채워졌어요</p>
        ) : (
          <ul className="list-disc space-y-0.5 pl-4">
            {items.map((t) => (
              <li key={t}>{t}</li>
            ))}
          </ul>
        )}
      </div>
      <span aria-live="polite">
        {readyToReturn && !f.ready ? (
          <Badge variant="success">
            <CircleCheck aria-hidden />
            저장하면 충족돼요
          </Badge>
        ) : null}
      </span>
    </div>
  )
}
