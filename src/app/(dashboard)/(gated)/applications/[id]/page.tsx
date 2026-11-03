import Link from "next/link"
import { notFound } from "next/navigation"
import { CircleCheck, FileText, Lightbulb, ListChecks, Loader2, Lock, MessagesSquare, RefreshCw, TriangleAlert } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card } from "@/components/ui/card"
import { ScreenSuspense } from "@/components/common/screen-suspense"
import { CardGridSkeleton, ErrorState } from "@/components/common/state-views"
import { SessionScoreBadge } from "@/components/common/score-display"
import { PageCrumbs } from "@/components/common/shell/breadcrumbs"
import { AiProgressInline } from "@/components/common/ai-progress"
import { HubHeader } from "@/components/applications/hub-header"
import { AutoRefresh, JobInline } from "@/components/applications/shared"
import { AiFeatureFailureLine } from "@/components/common/ai-feature-status"
import { DRAFT_STATUS_LABELS, DRAFT_TYPE_LABELS } from "@/components/applications/labels"
import { getApplicationProject, getInsightState, getJobDescription, listDrafts } from "@/lib/data/applications"
import { listInterviewSessions } from "@/lib/data/interviews"
import { getEvidence } from "@/lib/data/evidence"
import { getAiConnection, previewAiConnection } from "@/lib/data/ai-connection"
import { INTERVIEW_TYPE_LABELS, SESSION_STATUS_LABELS, applicationDisplayName, countsAsDraft, countsAsInterview, formatDate } from "@/lib/data/labels"
import { getPreviewState } from "@/lib/preview-state"
import { routes } from "@/lib/routes"

// S-31 지원 프로젝트 허브. ?state=: loading · error · unauth · not-found · move-failed · save-failed · wait-jd · ai-pending · ai-locked · key-invalid · key-check
type Props = { params: Promise<{ id: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> }

export default function Page({ params, searchParams }: Props) {
  return (
    <ScreenSuspense>
      <Screen params={params} searchParams={searchParams} />
    </ScreenSuspense>
  )
}

async function Screen({ params, searchParams }: Props) {
  const { id } = await params
  const state = getPreviewState(await searchParams)
  if (state === "not-found") notFound()
  const ap = await getApplicationProject(id)
  if (!ap) notFound()
  const name = applicationDisplayName(ap.name, ap.name_source, ap.created_at)
  const crumbs = <PageCrumbs items={[{ label: "기업 JD 관리", href: routes.applications() }, { label: name }]} applicationProjectId={id} />
  if (state === "error" || state === "unauth")
    return (
      <div className="mx-auto max-w-6xl">
        {crumbs}
        <ErrorState kind={state === "unauth" ? "unauth" : "error"} />
      </div>
    )

  const [jd, insight, allDrafts, allSessions, baseConnection] = await Promise.all([
    getJobDescription(id),
    getInsightState(id),
    listDrafts(id),
    listInterviewSessions({ application_project_id: id }),
    getAiConnection(),
  ])
  // 서류 초안 수 · 면접 세션 수: 경력기술서 `composing` (Q53-7), 질문 0개인 그만둔 세션 (Q53-9) 제외
  const drafts = allDrafts.filter(countsAsDraft)
  const sessions = allSessions.filter((s) => countsAsInterview(s, s.saved_question_count))
  // v5 S-31 "AI 카드 공통": 키가 없으면 AI 카드에 표식 (결과가 있으면 그대로 요약 + "새로 만들려면 AI 연결")
  const locked = !previewAiConnection(baseConnection, state).active_provider
  // getJobDescription may have finished a mock extraction → re-read the header values
  const fresh = (await getApplicationProject(id)) ?? ap
  // D-30: a JD created without a key stays `pending` with no job → "요건 정리 전"
  const notOrganised = state !== "wait-jd" && jd?.extraction_status === "pending" && !jd.extraction_job_id
  const extracting = state === "wait-jd" || jd?.extraction_status === "running" || (jd?.extraction_status === "pending" && !notOrganised)
  const extractionFailed = jd?.extraction_status === "failed"
  // v5.3 C-03 진행 표시 우선순위: 작업이 대기·실행 중이면 이전 결과가 있어도 "생성 중"
  const insightStatus = fresh.insight_status
  const interviewStatus = fresh.interview_status
  const generating = state === "ai-pending" || insightStatus.kind === "generating"
  const latestSession = sessions[0] ?? null
  const inProgress = sessions.find((s) => s.status === "in_progress") ?? null
  const reqCount = jd?.requirements.length ?? 0
  // F-P2-07 "데이터 변경됨" on the hub too (A3 UQ-69) — same rule as S-16: a source changed or was deleted
  const insightEvidence = insight.latest ? await getEvidence("insight", insight.latest.id) : {}
  const careerChanged = Object.values(insightEvidence).some((list) => list.some((e) => e.status !== "ok"))

  return (
    <div className="mx-auto max-w-6xl space-y-8">
      {crumbs}
      <AutoRefresh active={extracting && state !== "wait-jd"} />
      {state === "loading" ? (
        <CardGridSkeleton />
      ) : (
        <>
          <HubHeader ap={fresh} failMove={state === "move-failed"} failSave={state === "save-failed"} />
          <div className="grid gap-4 md:grid-cols-2">
            {/* JD·요건 */}
            <FeatureCard
              title="JD·요건"
              icon={<ListChecks className="size-5 text-muted-foreground" aria-hidden />}
              href={routes.applicationJd(id)}
              badge={locked && (notOrganised || extractionFailed) ? <LockMarker hasResult={false} /> : null}
            >
              {notOrganised ? (
                // 공고 원문 보기는 키 없이도 항상 가능 (S-31 v5)
                <p className="text-sm text-muted-foreground">요건 정리 전 · 공고 원문은 열어 볼 수 있어요</p>
              ) : extracting ? (
                <AiProgressInline label="공고 요건 정리 중" />
              ) : extractionFailed ? (
                <span className="inline-flex items-center gap-1.5 text-sm text-destructive">
                  <TriangleAlert className="size-4" aria-hidden />
                  요건을 정리하지 못했어요
                </span>
              ) : (
                <p className="text-sm text-muted-foreground tabular-nums">
                  요건 {reqCount}개 · 기술 키워드 {jd?.tech_keywords.length ?? 0}개
                </p>
              )}
            </FeatureCard>

            {/* 인사이트 */}
            <FeatureCard
              title="인사이트"
              icon={<Lightbulb className="size-5 text-muted-foreground" aria-hidden />}
              href={routes.applicationInsight(id)}
              badge={
                insight.latest && !generating ? (
                  <>
                    <Badge variant="success">
                      <CircleCheck aria-hidden />
                      있음
                    </Badge>
                    {careerChanged ? (
                      <Badge variant="warning">
                        <RefreshCw aria-hidden />
                        커리어가 바뀌었어요
                      </Badge>
                    ) : null}
                    {locked ? <LockMarker hasResult /> : null}
                  </>
                ) : locked && !generating ? (
                  <LockMarker hasResult={false} />
                ) : null
              }
            >
              {generating ? (
                fresh.insight_job_id && state !== "ai-pending" ? (
                  <JobInline jobId={fresh.insight_job_id} />
                ) : (
                  <AiProgressInline progress={insightStatus.progress ?? { stage: "match", done: 1, total: 2 }} jobType="insight" />
                )
              ) : (
                <div className="space-y-1">
                  {insight.latest?.result ? (
                    <p className="text-sm text-muted-foreground tabular-nums">
                      충족 {insight.latest.result.summary_counts.met} · 부분 충족 {insight.latest.result.summary_counts.partial} · 근거 없음{" "}
                      {insight.latest.result.summary_counts.no_evidence} · {formatDate(insight.latest.completed_at)}
                    </p>
                  ) : (
                    <p className="text-sm text-muted-foreground">아직 없어요. 다른 기능은 인사이트 없이도 쓸 수 있어요</p>
                  )}
                  {/* 결과보다 늦게 끝난 실패 한 줄 (버튼 없음 G-30 — 카드를 열면 C-20 전체) */}
                  {insightStatus.failure ? <AiFeatureFailureLine failure={insightStatus.failure} /> : null}
                </div>
              )}
            </FeatureCard>

            {/* 서류 초안 */}
            <FeatureCard
              title="서류 초안"
              icon={<FileText className="size-5 text-muted-foreground" aria-hidden />}
              href={routes.applicationDrafts(id)}
              badge={
                <>
                  {drafts.length ? <Badge variant="count">{drafts.length}</Badge> : null}
                  {locked ? <LockMarker hasResult={drafts.length > 0} /> : null}
                </>
              }
            >
              {drafts.length === 0 ? (
                <p className="text-sm text-muted-foreground">경력기술서나 자기소개서 초안을 만들어 보세요</p>
              ) : (
                <ul className="space-y-1 text-sm">
                  {drafts.slice(0, 3).map((d) => (
                    <li key={d.id} className="flex items-center gap-2">
                      <span>{DRAFT_TYPE_LABELS[d.draft_type]}</span>
                      <span className="text-muted-foreground">· {DRAFT_STATUS_LABELS[d.status]}</span>
                      {d.status === "generating" ? <Loader2 className="size-3.5 animate-spin text-ai" aria-hidden /> : null}
                    </li>
                  ))}
                </ul>
              )}
            </FeatureCard>

            {/* 면접 */}
            <FeatureCard
              title="모의 면접"
              icon={<MessagesSquare className="size-5 text-muted-foreground" aria-hidden />}
              href={routes.interviewPrep(id)}
              badge={
                <>
                  {sessions.length ? <Badge variant="count">{sessions.length}</Badge> : null}
                  {locked ? <LockMarker hasResult={sessions.length > 0} /> : null}
                </>
              }
              extra={
                inProgress ? (
                  <Button size="sm" asChild>
                    <Link href={routes.interviewSession(id, inProgress.id)}>이어서 쓰기</Link>
                  </Button>
                ) : null
              }
            >
              {sessions.length === 0 ? (
                <p className="text-sm text-muted-foreground">이 기업 JD로 직무·컬처핏 면접을 연습할 수 있어요</p>
              ) : (
                <div className="space-y-1.5 text-sm">
                  {inProgress ? (
                    <p className="flex flex-wrap items-center gap-2">
                      <Badge variant="draft">작성 중</Badge>
                      {INTERVIEW_TYPE_LABELS[inProgress.interview_type]}
                      <span className="text-muted-foreground tabular-nums">
                        {inProgress.answered_count}/{inProgress.question_count} 작성
                      </span>
                    </p>
                  ) : null}
                  {latestSession ? (
                    <p className="flex flex-wrap items-center gap-2 text-muted-foreground">
                      최근: {INTERVIEW_TYPE_LABELS[latestSession.interview_type]} · {SESSION_STATUS_LABELS[latestSession.status]}
                      {latestSession.running_job_id ? <JobInline jobId={latestSession.running_job_id} /> : <SessionScoreBadge session={latestSession} />}
                    </p>
                  ) : null}
                  {/* v5.3 C-03: 면접 작업이 늦게 실패했으면 한 줄 (생성 중은 위 축약형) */}
                  {interviewStatus.kind !== "generating" && interviewStatus.failure ? <AiFeatureFailureLine failure={interviewStatus.failure} /> : null}
                </div>
              )}
            </FeatureCard>
          </div>
          {/* (Should) 전형 이력 S-38 — MVP 제외 (F-ST-06) */}
        </>
      )}
    </div>
  )
}

/**
 * v5 S-31 키 없음 표식: 결과 없음 "AI 연결 필요" / 결과 있음 "새로 만들려면 AI 연결".
 * 카드는 그대로 열리고, 그 화면 안에서 C-18이 보인다. // [UI-가정] outline 배지 + Lock 모양
 */
function LockMarker({ hasResult }: { hasResult: boolean }) {
  return (
    <Badge variant="muted">
      <Lock aria-hidden />
      {hasResult ? "새로 만들려면 AI 연결" : "AI 연결 필요"}
    </Badge>
  )
}

function FeatureCard({
  title,
  icon,
  href,
  badge,
  extra,
  children,
}: {
  title: string
  icon: React.ReactNode
  href: string
  badge?: React.ReactNode
  extra?: React.ReactNode
  children: React.ReactNode
}) {
  return (
    <Card className="gap-3 p-5">
      <div className="flex flex-wrap items-center gap-2">
        {icon}
        <h2 className="text-lg leading-7 font-semibold">{title}</h2>
        {badge}
      </div>
      <div className="min-h-10">{children}</div>
      <div className="mt-auto flex flex-wrap gap-2">
        <Button variant="outline" size="sm" asChild>
          <Link href={href} aria-label={`${title} 열기`}>
            열기
          </Link>
        </Button>
        {extra}
      </div>
    </Card>
  )
}
