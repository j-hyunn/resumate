"use client"

/**
 * S-37 모의 면접 — 전체 세션 (02 S-37, FL-17, design-system 5.2 / 6 A4).
 * 새 면접(AiRunButton: C-18 / C-19 → C-16) · 작성 중(맨 위 고정) · 필터(기업 JD / 유형 / 상태 / 실행 공급자) · 세션 목록(최신순) ·
 * "그만둔 면접" 묶음(접힘). Two empty states: 기업 JD 없음 / 세션 없음.
 */
import * as React from "react"
import Link from "next/link"
import { ChevronDown, MessagesSquare, Plus } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card } from "@/components/ui/card"
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { PageHeader } from "@/components/common/basics"
import { EmptyState } from "@/components/common/state-views"
import { setNavOrigin } from "@/components/common/return-target"
import type { ApplicationSummary } from "@/lib/data/applications"
import type { InterviewSessionRow } from "@/lib/data/interviews"
import type { AiProviderName, InterviewSessionStatus, InterviewType } from "@/types/db"
import { AiRunButton } from "@/components/common/ai-run-button"
import { AI_PROVIDER_LABELS, AI_PROVIDER_ORDER } from "@/lib/mock/ai-providers"
import { applicationDisplayName, INTERVIEW_TYPE_LABELS, SESSION_STATUS_LABELS } from "@/lib/data/labels"
import { routes } from "@/lib/routes"
import { JdPickerDialog } from "./jd-picker-dialog"
import { RelativeTime } from "./session-status"
import { SessionList } from "./session-list"

const ALL = "all"
const STATUS_FILTERS: InterviewSessionStatus[] = ["in_progress", "evaluating", "completed", "evaluation_failed"]

export function InterviewsOverview({
  sessions,
  applications,
  retryAfter,
}: {
  /** newest first */
  sessions: InterviewSessionRow[]
  /** 최근 활동순 (C-16) */
  applications: ApplicationSummary[]
  /** session id → failed grading job's retry_after (UQ-558) */
  retryAfter?: Record<string, string>
}) {
  const [pickerOpen, setPickerOpen] = React.useState(false)
  // [UI-가정] 필터는 화면 안 상태(URL에 남기지 않음)
  const [apFilter, setApFilter] = React.useState<string>(ALL)
  const [typeFilter, setTypeFilter] = React.useState<InterviewType | typeof ALL>(ALL)
  const [statusFilter, setStatusFilter] = React.useState<InterviewSessionStatus | typeof ALL>(ALL)

  const [providerFilter, setProviderFilter] = React.useState<AiProviderName | typeof ALL>(ALL)

  // 02 S-37 새 면접: 키 있음 → 버튼 + C-19 배지 / 키 없음 → C-18 인라인(목록 열람은 그대로, FL-17).
  // Opens C-16 only (no AI call yet) — the run itself is S-20 시작하기.
  const newButton = (
    <AiRunButton
      lock={{ entry: "interview_new", returnHref: routes.interviews() }}
      onRun={() => setPickerOpen(true)}
      buttonClassName="max-md:h-8"
    >
      <Plus aria-hidden />새 면접
    </AiRunButton>
  )
  const picker = <JdPickerDialog open={pickerOpen} onOpenChange={setPickerOpen} applications={applications} />

  if (applications.length === 0) {
    return (
      <div className="mx-auto max-w-6xl space-y-8">
        <PageHeader title="모의 면접" />
        <EmptyState
          icon={MessagesSquare}
          title="기업 JD를 먼저 추가하면 그 공고에 맞춘 면접을 연습할 수 있어요"
          actions={
            <Button asChild className="max-md:h-8">
              <Link href={routes.applicationNew()}>
                <Plus aria-hidden />
                기업 JD 추가
              </Link>
            </Button>
          }
        />
      </div>
    )
  }

  const inProgress = sessions.filter((s) => s.status === "in_progress")
  const matches = (s: InterviewSessionRow) =>
    (apFilter === ALL || s.application_project_id === apFilter) &&
    (typeFilter === ALL || s.interview_type === typeFilter) &&
    (statusFilter === ALL || s.status === statusFilter) &&
    (providerFilter === ALL || s.question_provider === providerFilter || s.evaluation_provider === providerFilter)
  const active = sessions.filter((s) => s.status !== "abandoned" && matches(s))
  const abandoned = sessions.filter((s) => s.status === "abandoned" && (apFilter === ALL || s.application_project_id === apFilter) && (typeFilter === ALL || s.interview_type === typeFilter) && (providerFilter === ALL || s.question_provider === providerFilter || s.evaluation_provider === providerFilter))
  const filtered = apFilter !== ALL || typeFilter !== ALL || statusFilter !== ALL || providerFilter !== ALL
  // [가정] 02 S-37 필터 "실행 공급자": only providers that ran at least one session
  const usedProviders = AI_PROVIDER_ORDER.filter((p) =>
    sessions.some((s) => s.question_provider === p || s.evaluation_provider === p),
  )

  return (
    <div className="mx-auto max-w-6xl space-y-8">
      <PageHeader title="모의 면접" actions={sessions.length > 0 ? newButton : undefined} />
      {picker}

      {sessions.length === 0 ? (
        <EmptyState icon={MessagesSquare} title="새 면접으로 첫 연습을 시작해 보세요" actions={newButton} />
      ) : (
        <>
          {inProgress.length > 0 ? (
            <Card className="gap-3 p-5" aria-labelledby="in-progress-title">
              <h2 id="in-progress-title" className="text-base leading-6 font-semibold">
                작성 중
              </h2>
              <ul className="divide-y">
                {inProgress.map((s) => (
                  <li key={s.id} className="flex flex-col gap-2 py-3 first:pt-0 last:pb-0 sm:flex-row sm:items-center sm:justify-between">
                    <div className="min-w-0 space-y-0.5">
                      <p className="truncate font-medium">{s.application_name}</p>
                      <p className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
                        <Badge variant="outline">{INTERVIEW_TYPE_LABELS[s.interview_type]}</Badge>
                        <span className="tabular-nums">
                          {s.answered_count}/{s.question_count} 작성
                        </span>
                        <span>
                          · 마지막 활동 <RelativeTime iso={s.last_activity_at} />
                        </span>
                      </p>
                    </div>
                    <Button asChild variant="outline" className="shrink-0 max-md:h-8">
                      <Link
                        // R11 최소 수정 (OD-I6): an in-progress session always has its project (only completed ones are kept detached).
                        href={routes.interviewSession(s.application_project_id!, s.id)}
                        onClick={() => setNavOrigin("interviews", s.application_project_id!)}
                      >
                        이어서 쓰기
                      </Link>
                    </Button>
                  </li>
                ))}
              </ul>
            </Card>
          ) : null}

          <section className="space-y-4" aria-labelledby="sessions-title">
            <h2 id="sessions-title" className="sr-only">
              면접 세션 목록
            </h2>
            <div className="flex flex-wrap gap-2" role="group" aria-label="필터">
              <Select value={apFilter} onValueChange={setApFilter}>
                <SelectTrigger size="sm" className="w-full max-md:h-8 sm:w-64" aria-label="기업 JD 필터">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={ALL}>모든 기업 JD</SelectItem>
                  {applications.map((ap) => (
                    <SelectItem key={ap.id} value={ap.id}>
                      {applicationDisplayName(ap.name, ap.name_source, ap.created_at)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Select value={typeFilter} onValueChange={(v) => setTypeFilter(v as InterviewType | typeof ALL)}>
                <SelectTrigger size="sm" className="w-[calc(50%-0.25rem)] max-md:h-8 sm:w-40" aria-label="유형 필터">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={ALL}>모든 유형</SelectItem>
                  <SelectItem value="job">{INTERVIEW_TYPE_LABELS.job}</SelectItem>
                  <SelectItem value="culture_fit">{INTERVIEW_TYPE_LABELS.culture_fit}</SelectItem>
                </SelectContent>
              </Select>
              <Select value={statusFilter} onValueChange={(v) => setStatusFilter(v as InterviewSessionStatus | typeof ALL)}>
                <SelectTrigger size="sm" className="w-[calc(50%-0.25rem)] max-md:h-8 sm:w-40" aria-label="상태 필터">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={ALL}>모든 상태</SelectItem>
                  {STATUS_FILTERS.map((s) => (
                    <SelectItem key={s} value={s}>
                      {SESSION_STATUS_LABELS[s]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {usedProviders.length > 0 ? (
                <Select value={providerFilter} onValueChange={(v) => setProviderFilter(v as AiProviderName | typeof ALL)}>
                  <SelectTrigger size="sm" className="w-[calc(50%-0.25rem)] max-md:h-8 sm:w-40" aria-label="실행 공급자 필터">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={ALL}>모든 공급자</SelectItem>
                    {usedProviders.map((p) => (
                      <SelectItem key={p} value={p}>
                        {AI_PROVIDER_LABELS[p]}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              ) : null}
            </div>

            <SessionList
              rows={active}
              showApplication
              origin="interviews"
              caption="면접 세션 목록"
              retryAfter={retryAfter}
              // [UI-가정] 필터 결과 없음 문구
              emptyText={filtered ? "조건에 맞는 면접이 없어요" : undefined}
            />
          </section>

          {abandoned.length > 0 && (statusFilter === ALL || statusFilter === "abandoned") ? (
            <Collapsible className="space-y-3">
              <CollapsibleTrigger asChild>
                <Button variant="ghost" className="group px-0 max-md:h-8">
                  그만둔 면접
                  <span className="text-sm text-muted-foreground tabular-nums">{abandoned.length}개</span>
                  <ChevronDown className="transition-transform group-data-[state=open]:rotate-180" aria-hidden />
                </Button>
              </CollapsibleTrigger>
              <CollapsibleContent>
                <SessionList rows={abandoned} showApplication origin="interviews" caption="그만둔 면접 목록" />
              </CollapsibleContent>
            </Collapsible>
          ) : null}
        </>
      )}
    </div>
  )
}

