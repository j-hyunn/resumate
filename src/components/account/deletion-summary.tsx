/**
 * S-25 삭제 범위 — get_account_deletion_summary() counts in the C-05 impact-summary style
 * (`rounded-md bg-muted p-3 text-sm`, design-system 6 A1). Server- and client-safe.
 *
 * 02 S-25: 커리어 — 경력 N, 교육 N, 프로젝트 N, 산출물 N, 스킬 N, AI 작성 대화 N (v5.5) /
 *          자기소개서 N개 — 인사이트 N, 초안 N, 전형 이력 (v5.19, RM-1) /
 *          (v5) AI 연결 — 등록한 API 키 N개(즉시 파기), 토큰 사용 기록, AI 연결 동의 이력 (UQ-200)
 *          + "공급자 사이트에서도 키를 폐기하는 것을 권해요" (NFR-KEY-09) with provider dashboard links.
 */
import { Info } from "lucide-react"
import type { AccountDeletionSummary } from "@/types/db"
import { Alert, AlertDescription } from "@/components/ui/alert"
import { ExternalProviderLink } from "@/components/common/ai-error-notice"
import { AI_PROVIDER_LABELS, AI_PROVIDER_ORDER, AI_PROVIDERS } from "@/lib/mock/ai-providers"

export function DeletionSummary({ summary, runningAiJobs = 0 }: { summary: AccountDeletionSummary; runningAiJobs?: number }) {
  const c = summary.career
  const a = summary.applications
  const career: Array<[string, number]> = [
    ["경력", c.experiences],
    ["교육", c.educations],
    ["프로젝트", c.projects],
    ["산출물", c.project_deliverables],
    ["스킬", c.skills],
    ["AI 작성 대화", c.writing_chats],
  ]
  const apps: Array<[string, number]> = [
    ["인사이트", a.insights],
    ["초안", a.drafts],
    ["전형 이력", a.application_stage_events],
  ]
  const ai: Array<[string, number]> = [
    ["등록한 API 키", summary.ai.provider_keys],
    ["토큰 사용 기록", summary.ai.usage_records],
    ["AI 연결 동의 이력", summary.ai.data_use_consents],
  ]
  return (
    <div className="space-y-3">
    <div className="space-y-3 rounded-md bg-muted p-4 text-sm leading-5 tabular-nums">
      <SummaryGroup title="커리어" rows={career} />
      <SummaryGroup title={`자기소개서 ${a.application_projects}개`} rows={apps} />
      <SummaryGroup title="AI 연결" rows={ai} />
      <ul className="list-disc space-y-1 border-t pt-3 pl-4">
        {/* PRD NFR-KEY-06 · NFR-PRV-06 v4.1 (UQ-90 해소): 키는 즉시 파기, 사용 기록·동의 이력도 탈퇴 시 삭제 [가정] */}
        <li>API 키는 즉시 파기되고, 서비스 동의 이력과 AI 토큰 사용 기록도 함께 삭제돼요</li>
        {runningAiJobs ? <li>진행 중인 AI 작업 {runningAiJobs}건은 취소돼요</li> : null}
        <li>백업에 남은 데이터는 30일 안에 지워지고, 탈퇴 처리 기록만 개인을 알아볼 수 없는 형태로 3년 보관돼요</li>
      </ul>
    </div>
      {summary.ai.provider_keys > 0 ? (
        <Alert variant="info">
          <Info aria-hidden />
          <AlertDescription className="space-y-1">
            <p>공급자 사이트에서도 키를 폐기하는 것을 권해요</p>
            <p className="flex flex-wrap gap-x-3">
              {AI_PROVIDER_ORDER.map((p) => (
                <ExternalProviderLink key={p} href={AI_PROVIDERS[p].dashboard_url}>{`${AI_PROVIDER_LABELS[p]} 대시보드`}</ExternalProviderLink>
              ))}
            </p>
          </AlertDescription>
        </Alert>
      ) : null}
    </div>
  )
}

function SummaryGroup({ title, rows }: { title: string; rows: Array<[string, number]> }) {
  return (
    <div className="space-y-1">
      <h3 className="font-semibold">{title}</h3>
      <ul className="flex flex-wrap gap-x-3 gap-y-1">
        {rows.map(([label, n]) => (
          <li key={label}>
            {label} <span className="font-medium">{n}</span>
          </li>
        ))}
      </ul>
    </div>
  )
}
