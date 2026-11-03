"use client"

/**
 * S-16 인사이트 (FL-11, AI-02 비동기 작업). v4 BYOK: 키 없음 + 결과 없음 → C-18 영역형, 결과 있음 →
 * 결과는 그대로(D-36) + "다시 생성" 자리만 C-18 인라인. 생성 = AiRunButton(C-19) → C-03 진행(무료 등급
 * 순차 줄·요청 한도 대기 줄, 부분 결과 판정 표) → 요건별 판정 표 · 핵심 강점 · 보완점 · 지원 방향.
 * 실패 = C-20 block. 요건이 아직 없으면(키 없이 만든 JD) 요건 추출 먼저(D-30).
 */
import * as React from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { Circle, CircleCheck, CircleDot, Info, RefreshCw, Sparkles } from "lucide-react"
import { toast } from "sonner"
import { Alert, AlertTitle } from "@/components/ui/alert"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card } from "@/components/ui/card"
import { Skeleton } from "@/components/ui/skeleton"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { AiProgress, useAiJob } from "@/components/common/ai-progress"
import { DataInsufficientGate } from "@/components/common/data-gate"
import { EvidenceChips, EvidenceProvider } from "@/components/common/evidence"
import { markCareerReturn, type ReturnTargetInput } from "@/components/common/return-target"
import { WaitJd } from "@/components/common/state-views"
import { useAiConnection } from "@/components/common/ai-connection-context"
import { AiErrorNotice, aiErrorFromJob, type AiErrorInfo } from "@/components/common/ai-error-notice"
import { AiLock } from "@/components/common/ai-lock"
import { AiRunButton } from "@/components/common/ai-run-button"
import { ProviderResultTag } from "@/components/common/provider-badge"
import type {
  AiErrorCode,
  AiProviderName,
  AiRetryRefusalCode,
  DataReadiness,
  Insight,
  JdRequirementCategory,
  JdRequirementImportance,
  RequirementMatchStatus,
} from "@/types/db"
import type { EvidenceView } from "@/lib/data/evidence"
import type { AiFeatureStatusView } from "@/lib/data/ai-feature-status"
import { MATCH_STATUS_LABELS, formatDate } from "@/lib/data/labels"
import { routes } from "@/lib/routes"
import { useChooseProjectAffiliation } from "@/components/common/choose-project-affiliation"
import { GAP_ACTION_LABELS, IMPORTANCE_HIGH_LABEL, REQUIREMENT_CATEGORY_LABELS } from "./labels"
import { useRestoreReturnParams } from "./shared"
import { refusalOf } from "./extract-first"
import { EXTRACT_FIRST_NOTE } from "@/app/(dashboard)/(gated)/applications/_lib/jd-state"
import { hideInternalAliases as plain, type MatchRow } from "./insight-parse"
import { isInputCausedFailure } from "@/lib/data/ai-errors"
import { isInputCausedJdFailure } from "@/lib/data/jd-raw-text"
import { usePreviewWriteGuard } from "@/components/common/preview-write-guard"
import { startInsightAction } from "@/app/(dashboard)/(gated)/applications/_lib/actions"
import { isAiRejected } from "@/components/common/ai-rejection"

export interface RequirementInfo {
  content: string
  category: JdRequirementCategory
  importance: JdRequirementImportance
}

export interface InsightViewProps {
  applicationProjectId: string
  applicationName: string
  requirements: Record<string, RequirementInfo>
  latest: Insight | null
  generatingJobId: string | null
  /** stage-1 partial result of the generating row (`insights.match_stage_result`, A3 UQ-65) */
  partialMatches: MatchRow[] | null
  /** evidence of the generating row (partial table chips) */
  partialEvidence: Record<string, EvidenceView[]>
  evidence: Record<string, EvidenceView[]>
  projectNames: Record<string, string>
  readiness: DataReadiness
  activeChatId: string | null
  waitJd: boolean
  /** 요건 없음(추출 전·실패) → 작업 첫 단계 `prepare`에서 추출 (D-30, 02 S-16 v5.3) */
  extractFirst: boolean
  /** Q53-2: 공고 원문을 고친 뒤 아직 재추출 전 (raw_text_edited_at + extraction_status = 'pending') */
  rawTextEdited?: boolean
  /** C-09 대화 시작 실패 분기 (?state=insufficient-chat-failed) */
  gateChatFailure?: AiErrorCode | null
  /** F-P2-07 "데이터 변경됨" (근거 원본이 바뀌었거나 삭제됨) */
  careerChanged: boolean
  /**
   * v5.3 C-03 진행 표시 우선순위: a failure that ended after the visible result (from
   * `ApplicationSummary.insight_status.failure`) — shown on entry when no job is being tracked
   */
  lateFailure: AiFeatureStatusView["failure"]
  preview: {
    pending: boolean
    waiting?: boolean
    failed: AiErrorCode | null
    fail: AiErrorCode | null
    /** `?state=retry-*`: refused same-row retry (409) */
    refusal?: AiRetryRefusalCode | null
    /** `?state=retry-other-provider`: the failed job ran on another provider / tier */
    otherProvider?: boolean
  }
}

export function InsightView(props: InsightViewProps) {
  const { applicationProjectId: apId, applicationName, latest, readiness, waitJd, preview } = props
  const router = useRouter()
  // v5.3 (UQ-520): a late failure with a job row is the same row "다시 시도" target (aiErrorFromJob + useAiJob.retry)
  const lateJobId = props.generatingJobId ? null : (props.lateFailure?.job?.id ?? null)
  const [jobId, setJobId] = React.useState<string | null>(props.generatingJobId ?? lateJobId)
  const [starting, setStarting] = React.useState(false)
  const job = useAiJob(jobId, { onDone: () => router.refresh() })
  useRestoreReturnParams(apId, "insight")

  React.useEffect(() => {
    if (job.status === "canceled") router.refresh()
  }, [job.status, router])
  // stage 1 (match) finished → re-read the generating row so its partial table shows (C-03 부분 결과)
  const stage = job.progress?.stage
  React.useEffect(() => {
    if (stage === "synthesize" || stage === "validate") router.refresh()
  }, [stage, router])

  // ?state=ai-pending / ai-waiting: static progress (ai-waiting = 요청 한도 대기 줄, C-03 v2)
  const [previewProgress] = React.useState(() => ({
    stage: "match" as const,
    done: 1,
    total: connectionTierIsFree(readiness) ? 6 : 2,
    waiting_retry_until: preview.waiting ? new Date(Date.now() + 12_000).toISOString() : null,
  }))
  const returnTarget: ReturnTargetInput = {
    application_project_id: apId,
    feature: "insight",
    application_name: applicationName,
    href: routes.applicationInsight(apId),
  }
  const ready = readiness.features.insight.ready
  const connection = useAiConnection(readiness.ai_connection)

  // v5.3 C-03: a failure that ended after the visible result stays visible on entry (no tracked job)
  const [dismissedLate, setDismissedLate] = React.useState(false)
  /** new run (인사이트 생성 / 다시 생성). A start refusal goes back to AiRunButton (C-18 / C-21 / key_invalid). */
  const previewWrite = usePreviewWriteGuard()
  const start = async () => {
    if (previewWrite.stop()) return undefined
    setStarting(true)
    try {
      const r = await startInsightAction(apId, preview.fail ?? undefined)
      if (isAiRejected(r)) return r
      setDismissedLate(true)
      setJobId(r.job_id)
    } catch {
      toast.error("인사이트를 시작하지 못했어요")
    } finally {
      setStarting(false)
    }
    return undefined
  }

  // a late failure's job row is still loading on the first frames → C-20 (not a progress flash)
  const loadingLate = jobId !== null && jobId === lateJobId && !job.job
  const running = preview.pending || (jobId !== null && !loadingLate && (job.status === "queued" || job.status === "running"))
  const late = !dismissedLate ? props.lateFailure : null
  /** UQ-520: a late failure without a job row re-runs as a new job — a refusal shows in the C-20 action row */
  const [startRefusal, setStartRefusal] = React.useState<AiRetryRefusalCode | null>(null)
  const startFromNotice = async () => {
    setStartRefusal(null)
    const r = await start()
    if (r && isAiRejected(r)) setStartRefusal(await refusalOf(r))
  }
  const failedCategory = preview.failed ?? job.error ?? late?.error_code ?? null
  /**
   * C-20 props (UQ-409): same-row retry info from the job (`aiErrorFromJob` → sameRow / jobTier for
   * "{활성 공급자}로 처음부터 다시 해요"); previews fake the job row.
   */
  const active = connection?.active_provider ?? null
  const errorInfo: Omit<AiErrorInfo, "code"> = preview.failed
    ? preview.otherProvider
      ? { provider: otherProviderThan(active), jobTier: "paid", sameRow: true }
      : { sameRow: true }
    : job.error
      ? { ...aiErrorFromJob(job.job) }
      : late?.job
        ? { ...aiErrorFromJob(late.job) }
        : { provider: late?.provider ?? null }
  const inputCaused = isInputCausedFailure(failedCategory)
  const hasRequirements = Object.keys(props.requirements).length > 0

  // ---- action area: gate / wait-jd / button (C-18 inline when no key) ----
  const locked = !!connection && !connection.active_provider
  // FL-08: 키 확인이 데이터 준비 상태보다 먼저 (키 없음 → C-18, 게이트는 키가 있을 때만)
  const action = (label: string, rerun = false) =>
    !ready && !locked ? (
      <DataInsufficientGate
        feature="insight"
        featureLabel="인사이트"
        returnFeature="insight"
        readiness={readiness}
        applicationProjectId={apId}
        applicationName={applicationName}
        returnHref={routes.applicationInsight(apId)}
        activeChatId={props.activeChatId}
        chatFailure={props.gateChatFailure}
      />
    ) : (
      <div className="space-y-2">
        <AiRunButton
          lock={{ entry: "insight", alternativeHref: routes.career() }}
          onRun={start}
          pending={starting}
          disabled={waitJd}
          rerun={rerun}
          connection={connection}
          footer={props.extractFirst && !locked ? <p className="text-sm leading-5 text-muted-foreground">{EXTRACT_FIRST_NOTE}</p> : null}
        >
          {label}
        </AiRunButton>
        {/* UQ-519: 추출 실패 JD도 실행하면 `prepare`에서 다시 추출한다 (S-15로 보내지 않음) */}
        {waitJd ? <WaitJd /> : null}
      </div>
    )

  return (
    <EvidenceProvider returnTarget={returnTarget}>
      <div className="space-y-8">
        {running ? (
          <div className="space-y-4">
            <AiProgress
              jobType="insight"
              progress={preview.pending ? previewProgress : job.progress}
              title="인사이트 생성"
              connectionTier={connection?.connection_tier}
            />
            {/* 부분 결과 — 단계 1 판정 표가 나오면 먼저 보여 준다 (FL-11) */}
            {props.partialMatches ? (
              <MatchTable matches={props.partialMatches} requirements={props.requirements} evidence={props.partialEvidence} partial />
            ) : null}
            <Card className="gap-3 p-5">
              <Skeleton className="h-5 w-40" />
              <Skeleton className="h-4 w-full" />
              <Skeleton className="h-4 w-5/6" />
              <Skeleton className="h-4 w-2/3" />
            </Card>
          </div>
        ) : failedCategory ? (
          <div className="space-y-4">
            {/*
              v5.3 S-16: input-caused failures (not_a_jd · input_too_long · safety_blocked) have no retry —
              fix the JD, then "다시 생성" (R-76). Other causes: same-row retry on the active provider
              (restarts from prepare when it differs, A1). A refused retry (409) swaps the action row.
            */}
            <AiErrorNotice
              code={failedCategory}
              {...errorInfo}
              onRetry={preview.failed ? undefined : job.error || late?.job ? () => void job.retry() : () => void startFromNotice()}
              retryHref={preview.failed ? routes.applicationInsight(apId) : undefined}
              retrying={job.retrying || (!job.error && starting)}
              refusal={preview.refusal ?? job.refusal ?? startRefusal}
              rerunLabel="다시 생성"
              // Q53-2 · C-20 "입력 원인 실패의 이동": 요건이 없으면 S-15 공고 원문 수정, 있으면 S-15 "요건이 있는 공고" 안내
              inputHref={
                !isInputCausedJdFailure(failedCategory)
                  ? routes.applicationJd(apId)
                  : hasRequirements
                    ? routes.applicationJd(apId, { from: "insight", cause: failedCategory as "not_a_jd" | "input_too_long" | "safety_blocked" })
                    : routes.applicationJd(apId, { edit: 1, from: "insight" })
              }
              inputLabel={isInputCausedJdFailure(failedCategory) ? (hasRequirements ? "공고 확인하기" : "공고 원문 고치기") : "JD·요건 보기"}
              hideFixCaption={isInputCausedJdFailure(failedCategory) && hasRequirements}
              reduceTarget="공고 원문"
            />
            {inputCaused && !latest?.result ? <div className="max-w-xl">{action("다시 생성", true)}</div> : null}
          </div>
        ) : null}

        {!running && !latest && !failedCategory && connection && !connection.active_provider ? (
          // C-18 영역형 (기존 결과 없음)
          <AiLock entry="insight" size="area" featureLabel="인사이트" alternativeHref={routes.career()} />
        ) : !running && !latest && !failedCategory ? (
          <Card className="max-w-2xl gap-4 p-6">
            <h2 className="text-lg leading-7 font-semibold">이 공고에 내 커리어가 얼마나 맞는지 정리해 드려요</h2>
            <p className="text-base text-muted-foreground">
              요건별 충족 판정, 핵심 강점, 보완점과 대응 방안, 지원 방향을 근거와 함께 보여 줘요. 인사이트 없이도 서류·면접은 바로 쓸 수 있어요
            </p>
            {/* S-15 "이전 실패 안내" (Q53-2): extraction_status = 'pending'일 때만. 재추출 성공 뒤에는 문구 없이 버튼만 */}
            {props.rawTextEdited ? <p className="text-sm text-muted-foreground">공고를 고쳤어요. 생성하면 요건부터 다시 정리해요</p> : null}
            {action("인사이트 생성")}
          </Card>
        ) : null}

        {latest?.result && !running ? <InsightResultView {...props} latest={latest} regenerate={action("다시 생성", true)} returnTarget={returnTarget} /> : null}
      </div>
    </EvidenceProvider>
  )
}

const STATUS_BADGE: Record<RequirementMatchStatus, React.ReactNode> = {
  met: (
    <Badge variant="success">
      <CircleCheck aria-hidden />
      {MATCH_STATUS_LABELS.met}
    </Badge>
  ),
  partial: (
    <Badge variant="warning">
      <CircleDot aria-hidden />
      {MATCH_STATUS_LABELS.partial}
    </Badge>
  ),
  no_evidence: (
    <Badge variant="muted">
      <Circle aria-hidden />
      {MATCH_STATUS_LABELS.no_evidence}
    </Badge>
  ),
}

function InsightResultView({
  latest,
  requirements,
  evidence,
  projectNames,
  careerChanged,
  regenerate,
  returnTarget,
}: InsightViewProps & { latest: Insight; regenerate: React.ReactNode; returnTarget: ReturnTargetInput }) {
  const r = latest.result!
  const reqLabel = (id: string) => requirements[id]?.content ?? "삭제된 요건"
  // F-P2-09 보완점 "관련 경험 추가하기" (UX v5.6 C-23 ②): 소속을 고른 뒤 S-10 새 페이지 / 독립 프로젝트
  const choose = useChooseProjectAffiliation()

  return (
    <div className="space-y-8">
      {choose.dialog}
      {/* 머리: 기준 안내 + 데이터 변경됨(F-P2-07) + 다시 생성 */}
      <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div className="space-y-1">
          <p className="flex items-center gap-1.5 text-sm text-muted-foreground">
            <Info className="size-4" aria-hidden />
            {plain(r.basis_note)} · {formatDate(latest.completed_at)} 생성
          </p>
          <ProviderResultTag provider={latest.provider} model_tier={latest.model_tier} model={latest.model} />
          <p className="text-sm tabular-nums">
            충족 {r.summary_counts.met} · 부분 충족 {r.summary_counts.partial} · 근거 없음 {r.summary_counts.no_evidence}
          </p>
          {careerChanged ? (
            <Badge variant="warning">
              <RefreshCw aria-hidden />
              커리어가 바뀌었어요
            </Badge>
          ) : null}
        </div>
        <div className="lg:max-w-xl">{regenerate}</div>
      </div>
      {r.data_sufficiency.level === "thin" ? (
        <Alert variant="info">
          <Info aria-hidden />
          {/* [UI-가정] data_sufficiency = thin 안내 문구 */}
          <AlertTitle className="font-normal">입력된 커리어가 적어 판단 근거가 제한적이에요. 프로젝트와 정량 성과를 더하면 더 정확해져요</AlertTitle>
        </Alert>
      ) : null}

      {/* 요건별 판정 */}
      <MatchTable matches={r.requirement_matches} requirements={requirements} evidence={evidence} />

      {/* 핵심 강점 */}
      <section className="space-y-3" aria-labelledby="ins-strengths">
        <h2 id="ins-strengths" className="text-lg leading-7 font-semibold">
          핵심 강점
        </h2>
        {r.strengths.length === 0 ? (
          // [UI-가정] 강점 0개 문구 (AI-02: 억지로 채우지 않음)
          <p className="text-muted-foreground">입력된 데이터에서 근거가 충분한 강점을 찾지 못했어요</p>
        ) : (
          r.strengths.map((s) => (
            <Card key={s.item_key} className="gap-2 p-5">
              <h3 className="text-base leading-6 font-semibold">{plain(s.title)}</h3>
              <p className="text-base leading-[1.75]">{plain(s.description)}</p>
              <RequirementRefs ids={s.requirement_ids} label={reqLabel} />
              <EvidenceChips items={evidence[s.item_key]} />
            </Card>
          ))
        )}
      </section>

      {/* 보완점 */}
      <section className="space-y-3" aria-labelledby="ins-gaps">
        <h2 id="ins-gaps" className="text-lg leading-7 font-semibold">
          보완점
        </h2>
        {r.gaps.length === 0 ? (
          <p className="text-muted-foreground">눈에 띄는 보완점이 없어요</p>
        ) : (
          r.gaps.map((g) => (
            <Card key={g.item_key} className="gap-3 p-5">
              <div className="flex flex-wrap items-center gap-2">{STATUS_BADGE[g.gap_kind]}</div>
              <p className="text-base leading-[1.75]">{plain(g.description)}</p>
              <RequirementRefs ids={g.requirement_ids} label={reqLabel} />
              <EvidenceChips items={evidence[g.item_key]} />
              <ul className="space-y-3 border-t pt-3">
                {g.actions.map((a) => (
                  <li key={a.item_key} className="space-y-1.5">
                    <p className="text-sm font-medium text-muted-foreground">{GAP_ACTION_LABELS[a.type]}</p>
                    <p className="text-base leading-[1.75]">{plain(a.text)}</p>
                    <EvidenceChips items={evidence[a.item_key]} className="mt-1" />
                    {a.type === "add_data" ? (
                      <div className="space-y-1.5 pt-1">
                        {/* F-P2-09: "관련 경험이 있다면 추가하기" → 두 선택지 + C-10 */}
                        <p className="text-sm">관련 경험이 있다면 추가하기</p>
                        <div className="flex flex-wrap items-center gap-2">
                          {/* v5.6: both go through C-23 소속 선택 (the chat is S-10's panel; the return target stays in the session) */}
                          <AiRunButton
                            lock={{ entry: "writing_chat" }}
                            variant="outline"
                            size="sm"
                            onRun={() => {
                              markCareerReturn({ ...returnTarget, params: { gap_item_key: g.item_key, requirement_ids: g.requirement_ids } })
                              choose.open({ requirementId: g.requirement_ids[0] ?? null })
                            }}
                          >
                            <Sparkles aria-hidden />
                            AI와 대화하며 추가
                          </AiRunButton>
                          <Button
                            variant="ghost"
                            size="sm"
                            disabled={choose.loading}
                            onClick={() => {
                              markCareerReturn({ ...returnTarget, params: { gap_item_key: g.item_key, requirement_ids: g.requirement_ids } })
                              choose.open({ requirementId: g.requirement_ids[0] ?? null })
                            }}
                          >
                            직접 입력
                          </Button>
                        </div>
                      </div>
                    ) : null}
                  </li>
                ))}
              </ul>
            </Card>
          ))
        )}
      </section>

      {/* 지원 방향 */}
      <section className="space-y-3" aria-labelledby="ins-strategy">
        <h2 id="ins-strategy" className="text-lg leading-7 font-semibold">
          지원 방향
        </h2>
        <Card className="gap-4 p-5">
          <div>
            <p className="text-base leading-[1.75]">{plain(r.strategy.positioning)}</p>
            <EvidenceChips items={evidence["strategy.positioning"]} />
          </div>
          {r.strategy.project_priorities.length ? (
            <div className="space-y-2 border-t pt-4">
              <h3 className="text-base leading-6 font-semibold">어필할 프로젝트 순서</h3>
              <ol className="space-y-3">
                {[...r.strategy.project_priorities]
                  .sort((a, b) => a.rank - b.rank)
                  .map((p) => (
                    <li key={p.item_key} className="flex gap-3">
                      <span className="grid size-6 shrink-0 place-items-center rounded-full bg-muted text-xs font-medium tabular-nums">{p.rank}</span>
                      <div className="min-w-0 space-y-1">
                        {projectNames[p.project_id] ? (
                          <Link href={routes.projectPage(p.project_id)} onClick={() => markCareerReturn(returnTarget)} className="font-medium text-primary-text hover:underline">
                            {projectNames[p.project_id]}
                          </Link>
                        ) : (
                          <span className="font-medium text-muted-foreground">삭제된 프로젝트</span>
                        )}
                        <p className="text-sm text-muted-foreground">{plain(p.reason)}</p>
                        <RequirementRefs ids={p.requirement_ids} label={reqLabel} />
                        <EvidenceChips items={evidence[p.item_key]} className="mt-1" />
                      </div>
                    </li>
                  ))}
              </ol>
            </div>
          ) : null}
        </Card>
      </section>
    </div>
  )
}

function RequirementText({ info, fallback }: { info: RequirementInfo | undefined; fallback: string }) {
  return (
    <div className="space-y-0.5">
      <p className="flex flex-wrap items-center gap-1.5">
        {info?.importance === "high" ? <Badge variant="secondary">{IMPORTANCE_HIGH_LABEL}</Badge> : null}
        <span>{info?.content ?? fallback}</span>
      </p>
      {info ? <p className="text-sm text-muted-foreground">{REQUIREMENT_CATEGORY_LABELS[info.category]}</p> : null}
    </div>
  )
}

function RequirementRefs({ ids, label }: { ids: string[]; label: (id: string) => string }) {
  if (!ids.length) return null
  return (
    <p className="text-sm text-muted-foreground">
      관련 요건: {ids.map(label).join(" · ")}
    </p>
  )
}


/** 요건별 판정 표 — final result and the stage-1 partial result (A3 UQ-65) */
function MatchTable({
  matches,
  requirements,
  evidence,
  partial = false,
}: {
  matches: MatchRow[]
  requirements: Record<string, RequirementInfo>
  evidence: Record<string, EvidenceView[]>
  partial?: boolean
}) {
  const reqLabel = (id: string) => requirements[id]?.content ?? "삭제된 요건"
  return (
      <section className="space-y-3" aria-labelledby="ins-matches">
        <h2 id="ins-matches" className="text-lg leading-7 font-semibold">
          요건별 판정
        </h2>
        {partial ? (
          // [UI-가정] 부분 결과 안내 문구
          <p className="text-sm text-muted-foreground">요건 대조가 끝난 결과를 먼저 보여 드려요. 강점·보완점·지원 방향은 정리 중이에요</p>
        ) : null}
        <div className="hidden rounded-lg border bg-card md:block">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-[38%]">요건</TableHead>
                <TableHead>판정</TableHead>
                <TableHead>판단 이유 · 근거</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {matches.map((m) => (
                <TableRow key={m.item_key}>
                  <TableCell className="align-top whitespace-normal">
                    <RequirementText info={requirements[m.requirement_id]} fallback={reqLabel(m.requirement_id)} />
                  </TableCell>
                  <TableCell className="align-top">{STATUS_BADGE[m.status]}</TableCell>
                  <TableCell className="align-top whitespace-normal">
                    <p className="text-sm">{plain(m.rationale)}</p>
                    {m.missing_aspect ? <p className="text-sm text-muted-foreground">부족한 점: {plain(m.missing_aspect)}</p> : null}
                    <EvidenceChips items={evidence[m.item_key]} max={2} />
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
        <ul className="space-y-2 md:hidden">
          {matches.map((m) => (
            <li key={m.item_key}>
              <Card size="sm" className="gap-2 px-4">
                <div className="flex items-start justify-between gap-2">
                  <RequirementText info={requirements[m.requirement_id]} fallback={reqLabel(m.requirement_id)} />
                  {STATUS_BADGE[m.status]}
                </div>
                <p className="text-sm">{plain(m.rationale)}</p>
                {m.missing_aspect ? <p className="text-sm text-muted-foreground">부족한 점: {plain(m.missing_aspect)}</p> : null}
                <EvidenceChips items={evidence[m.item_key]} max={2} />
              </Card>
            </li>
          ))}
        </ul>
      </section>
  )
}

function connectionTierIsFree(readiness: DataReadiness): boolean {
  return readiness.ai_connection.connection_tier === "free"
}

/** `?state=retry-other-provider`: a provider other than the active one (the failed job's provider) */
function otherProviderThan(active: AiProviderName | null): AiProviderName {
  return active === "openai" ? "gemini" : "openai"
}
