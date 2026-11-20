"use client"

/**
 * S-16 인사이트 (FL-11, AI-02 비동기 작업). v4 BYOK: 키 없음 + 결과 없음 → C-18 영역형, 결과 있음 →
 * 결과는 그대로(D-36) + "다시 생성" 자리만 C-18 인라인. 생성 = AiRunButton(C-19) → C-03 진행(무료 등급
 * 줄·요청 한도 대기 줄, 부분 결과 판정 표) → 요건별 판정 표 · 핵심 강점 · 보완점 · 지원 방향. 실패 = C-20 block.
 *
 * (v5.21) **요건 추출 선행 없음**(JR-3) — AI-02가 공고 원문 문장을 그대로 읽는다. AI 연결 시 자기소개서를 만들면
 * **자동으로 시작**된다(JR-6): 작업이 있으면 처음부터 C-03 진행 표시, 끝나면 셸의 완료 토스트, 실패하면 C-20 + 다시 시도.
 * **임시 상태**(JR-Q2 보류): 요건별 판정 표 = 단계 1 원소(`requirement_text` + "공고 원문" 링크 `sids`), 카테고리·
 * "핵심" 배지 없음. **옛 인사이트**(`schemaVersion = 1`, JR-Q3 (b))는 본문 없이 "다시 만들어야 해요" + [다시 생성].
 * **공고가 바뀐 인사이트**(`staleReasons.rawText`, JR-7)는 "공고가 바뀌었어요 — 다시 생성".
 */
import * as React from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { Circle, CircleCheck, CircleDot, FileWarning, Info, RefreshCw, Sparkles, TextSearch } from "lucide-react"
import { toast } from "sonner"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card } from "@/components/ui/card"
import { Skeleton } from "@/components/ui/skeleton"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { AiProgress, useAiJob } from "@/components/common/ai-progress"
import { DataInsufficientGate } from "@/components/common/data-gate"
import { EvidenceChips, EvidenceProvider } from "@/components/common/evidence"
import { markCareerReturn, type ReturnTargetInput } from "@/components/common/return-target"
import { useAiConnection } from "@/components/common/ai-connection-context"
import { AiErrorNotice, aiErrorFromJob, type AiErrorInfo } from "@/components/common/ai-error-notice"
import { AiLock } from "@/components/common/ai-lock"
import { AiRunButton } from "@/components/common/ai-run-button"
import { ProviderResultTag } from "@/components/common/provider-badge"
import type { AiErrorCode, AiProviderName, AiRetryRefusalCode, DataReadiness, Insight, RequirementMatchStatus } from "@/types/db"
import type { EvidenceView } from "@/lib/data/evidence"
import type { AiFeatureStatusView } from "@/lib/data/ai-feature-status"
import { MATCH_STATUS_LABELS, formatDate } from "@/lib/data/labels"
import { routes } from "@/lib/routes"
import { useChooseProjectAffiliation } from "@/components/common/choose-project-affiliation"
import { GAP_ACTION_LABELS } from "./labels"
import { useRestoreReturnParams } from "./shared"
import { refusalOf } from "./start-refusal"
import { hideInternalAliases as plain, type MatchRow } from "./insight-parse"
import { isInputCausedFailure } from "@/lib/data/ai-errors"
import { JD_NO_SENTENCES_MESSAGE, isJdFixableFailure } from "@/lib/data/jd-raw-text"
import { usePreviewWriteGuard } from "@/components/common/preview-write-guard"
import { startInsightAction } from "@/app/(dashboard)/(gated)/applications/_lib/actions"
import { isAiRejected } from "@/components/common/ai-rejection"

/** R17 (schema 2): a requirement is its `requirement_text` (keyed by `match_key`, `MT-n`) */
export interface RequirementInfo {
  content: string
}

/** (v5.21, JR-Q2 보류) S-16 머리 "임시 상태" 줄 — 문구 출처 UX v5.21 5.1o "UI60" 표(UI60-D, decisions 3.30·4.25 UI #2) */
export const INSIGHT_INTERIM_NOTE = "지금 인사이트는 임시 구성이에요. AI가 공고 원문에서 요건을 찾아 내 커리어와 맞춰 봐요"
/** (v5.21, JR-Q3 (b)) 옛 인사이트 `[가정: 문구]` */
export const INSIGHT_OLD_SCHEMA_NOTE = "공고 처리 방식이 바뀌어 다시 만들어야 해요"
/** (v5.21, JR-7) 공고가 바뀐 인사이트 `[가정: 문구]` */
export const INSIGHT_RAW_TEXT_STALE = "공고가 바뀌었어요 — 다시 생성"

export interface InsightViewProps {
  applicationProjectId: string
  applicationName: string
  requirements: Record<string, RequirementInfo>
  latest: Insight | null
  /** JR-Q3 (b): the latest ready insight was made with the retired requirement list (`schemaVersion = 1`) — no body */
  oldSchema: boolean
  /** JR-7 `staleReasons.rawText`: the posting changed after this insight */
  rawTextStale: boolean
  generatingJobId: string | null
  /** stage-1 partial result of the generating row (`insights.match_stage_result`, A3 UQ-65) */
  partialMatches: MatchRow[] | null
  /** evidence of the generating row (partial table chips) */
  partialEvidence: Record<string, EvidenceView[]>
  evidence: Record<string, EvidenceView[]>
  projectNames: Record<string, string>
  readiness: DataReadiness
  activeChatId: string | null
  /** C-09 대화 시작 실패 분기 (?state=insufficient-chat-failed) */
  gateChatFailure?: AiErrorCode | null
  /** F-P2-07 "데이터 변경됨" (커리어 근거 원본이 바뀌었거나 삭제됨) */
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
    /** `?state=jd-no-sentences`: the start was refused (409 `jd_no_sentences`) */
    noSentences?: boolean
  }
}

export function InsightView(props: InsightViewProps) {
  const { applicationProjectId: apId, applicationName, latest, readiness, preview } = props
  const router = useRouter()
  // v5.3 (UQ-520): a late failure with a job row is the same row "다시 시도" target (aiErrorFromJob + useAiJob.retry)
  const lateJobId = props.generatingJobId ? null : (props.lateFailure?.job?.id ?? null)
  const [jobId, setJobId] = React.useState<string | null>(props.generatingJobId ?? lateJobId)
  // JR-6: an insight started by the create action (or another tab) shows up on a later read — follow it
  if (props.generatingJobId && props.generatingJobId !== jobId && !jobId) setJobId(props.generatingJobId)
  const [starting, setStarting] = React.useState(false)
  const [noSentences, setNoSentences] = React.useState(Boolean(preview.noSentences))
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

  // ?state=ai-pending / ai-waiting: static progress (ai-waiting = 요청 한도 대기 줄, C-03 v2). Stage 1 is one call.
  const [previewProgress] = React.useState(() => ({
    stage: "match" as const,
    waiting_retry_until: preview.waiting ? new Date(Date.now() + 12_000).toISOString() : null,
  }))
  const returnTarget: ReturnTargetInput = {
    application_project_id: apId,
    feature: "insight",
    application_name: applicationName,
    href: routes.coverLetter(apId, { tab: "insight" }),
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
    setNoSentences(false)
    try {
      const r = await startInsightAction(apId, preview.fail ?? undefined)
      if (isAiRejected(r)) return r
      if ("refused" in r) {
        // 0문장 공고 (DM v4.16 `begin_insight` 409) — 작업은 만들어지지 않았다
        setNoSentences(true)
        return undefined
      }
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
  const editJdHref = routes.coverLetter(apId, { tab: "jd", edit: 1, from: "insight" })

  // ---- action area: gate / button (C-18 inline when no key) ----
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
        returnHref={routes.coverLetter(apId, { tab: "insight" })}
        activeChatId={props.activeChatId}
        chatFailure={props.gateChatFailure}
      />
    ) : (
      <div className="space-y-2">
        <AiRunButton lock={{ entry: "insight", alternativeHref: routes.career() }} onRun={start} pending={starting} rerun={rerun} connection={connection}>
          {label}
        </AiRunButton>
        {noSentences ? <NoSentencesNotice href={editJdHref} /> : null}
      </div>
    )

  return (
    <EvidenceProvider returnTarget={returnTarget}>
      <div className="space-y-8">
        {/* (v5.21, JR-Q2 보류) 임시 상태 줄 — 재설계 사이클 전까지 이 탭은 임시 구조다 `[UI-가정]` 문구 */}
        <p className="flex items-start gap-1.5 text-sm text-muted-foreground">
          <Info className="mt-0.5 size-4 shrink-0" aria-hidden />
          {INSIGHT_INTERIM_NOTE}
        </p>

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
              <MatchTable apId={apId} matches={props.partialMatches} requirements={props.requirements} evidence={props.partialEvidence} partial rawTextStale={false} />
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
              v5.3 S-16: input-caused failures (input_too_long · safety_blocked · insufficient_data) have no retry —
              fix the input, then "다시 생성" (R-76). (v5.21, JR-7) the 공고 원문 can always be edited, so the move
              opens S-15 in its edit state. Other causes: same-row retry on the active provider (restarts from prepare
              when it differs, A1) — the auto-started job too (JR-6 "실패 다시 시도"). A refused retry (409) swaps the action row.
            */}
            <AiErrorNotice
              code={failedCategory}
              {...errorInfo}
              onRetry={preview.failed ? undefined : job.error || late?.job ? () => void job.retry() : () => void startFromNotice()}
              retryHref={preview.failed ? routes.coverLetter(apId, { tab: "insight" }) : undefined}
              retrying={job.retrying || (!job.error && starting)}
              refusal={preview.refusal ?? job.refusal ?? startRefusal}
              rerunLabel="다시 생성"
              // C-20 "입력 원인 실패의 이동" 인사이트 행 (v5.21, JR-7): S-15 공고 내용 수정 상태 + "커리어 정리하기"
              inputHref={isJdFixableFailure(failedCategory) ? editJdHref : routes.coverLetter(apId, { tab: "jd" })}
              inputLabel={isJdFixableFailure(failedCategory) ? "공고 원문 고치기" : "채용 공고 보기"}
              reduceTarget="공고 원문이나 커리어"
            />
            {inputCaused && !latest?.result ? <div className="max-w-xl">{action("다시 생성", true)}</div> : null}
          </div>
        ) : null}

        {!running && props.oldSchema ? (
          // JR-Q3 (b): the old insight's body is not shown or converted — only the way to make a new one
          <Card className="max-w-2xl gap-4 p-6">
            <p className="flex items-start gap-2 text-base">
              <FileWarning className="mt-0.5 size-5 shrink-0 text-warning" aria-hidden />
              {INSIGHT_OLD_SCHEMA_NOTE}
            </p>
            {action("다시 생성", true)}
          </Card>
        ) : !running && !latest && !failedCategory && connection && !connection.active_provider ? (
          // C-18 영역형 (기존 결과 없음)
          // 카드 안이 아니라 컨테이너에 바로 (2026-11-10 사용자 요청)
          <AiLock entry="insight" size="area" bare featureLabel="인사이트" alternativeHref={routes.career()} />
        ) : !running && !latest && !failedCategory ? (
          <Card className="max-w-2xl gap-4 p-6">
            <h2 className="text-lg leading-7 font-semibold">이 공고에 내 커리어가 얼마나 맞는지 정리해 드려요</h2>
            <p className="text-base text-muted-foreground">
              요건별 충족 판정, 핵심 강점, 보완점과 대응 방안, 지원 방향을 근거와 함께 보여 줘요. 인사이트 없이도 서류는 바로 쓸 수 있어요
            </p>
            {action("인사이트 생성")}
          </Card>
        ) : null}

        {latest?.result && !running && !props.oldSchema ? (
          <InsightResultView {...props} latest={latest} regenerate={action("다시 생성", true)} returnTarget={returnTarget} />
        ) : null}
      </div>
    </EvidenceProvider>
  )
}

/** (v5.21) `jd_no_sentences` on start — fix the posting first `[가정]` 문구 */
function NoSentencesNotice({ href }: { href: string }) {
  return (
    <Alert variant="warning">
      <FileWarning aria-hidden />
      <AlertTitle className="font-normal">{JD_NO_SENTENCES_MESSAGE}</AlertTitle>
      <AlertDescription>
        <Button asChild variant="outline" size="sm">
          <Link href={href}>공고 원문 고치기</Link>
        </Button>
      </AlertDescription>
    </Alert>
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
  applicationProjectId: apId,
  latest,
  requirements,
  evidence,
  projectNames,
  careerChanged,
  rawTextStale,
  regenerate,
  returnTarget,
}: InsightViewProps & { latest: Insight; regenerate: React.ReactNode; returnTarget: ReturnTargetInput }) {
  const r = latest.result!
  const reqLabel = (id: string) => plain(requirements[id]?.content ?? "") || "삭제된 요건"
  // F-P2-09 보완점 "관련 경험 추가하기" (UX v5.9 C-23): 소속을 고른 뒤 S-10 새 페이지 / 독립 프로젝트 추가 모달
  const choose = useChooseProjectAffiliation()

  return (
    <div className="space-y-8">
      {choose.dialog}
      {/* 머리: 기준 안내 + 데이터 변경됨(F-P2-07) + 공고가 바뀜(JR-7) + 다시 생성 */}
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
          {/* 커리어 변경과 겹치면 두 줄을 함께 보인다 `[가정]` — 같은 자리·모양 */}
          {careerChanged || rawTextStale ? (
            <div className="flex flex-wrap gap-1.5">
              {careerChanged ? (
                <Badge variant="warning">
                  <RefreshCw aria-hidden />
                  커리어가 바뀌었어요
                </Badge>
              ) : null}
              {rawTextStale ? (
                <Badge variant="warning">
                  <RefreshCw aria-hidden />
                  {INSIGHT_RAW_TEXT_STALE}
                </Badge>
              ) : null}
            </div>
          ) : null}
        </div>
        <div className="lg:max-w-xl">{regenerate}</div>
      </div>
      {r.data_sufficiency.level === "thin" ? (
        <Alert variant="info">
          <Info aria-hidden />
          {/* data_sufficiency = thin 안내 (UX v5.15 S-16, U38-3) */}
          <AlertTitle className="font-normal">입력된 커리어가 적어 판단 근거가 제한적이에요. 프로젝트·STAR·산출물을 더 채우면 더 정확해져요</AlertTitle>
        </Alert>
      ) : null}

      {/* 요건별 판정 (임시 — 단계 1 원소) */}
      <MatchTable apId={apId} matches={r.requirement_matches} requirements={requirements} evidence={evidence} rawTextStale={rawTextStale} />

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
              <RequirementRefs ids={s.match_keys} label={reqLabel} />
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
              <RequirementRefs ids={g.match_keys} label={reqLabel} />
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
                          {/* v5.6: both go through C-23 소속 선택 (the chat is S-10's panel; the return target stays in the session).
                              (v5.21, JR-5) the gate chat's start context = this gap (`insight_id`·`insight_item_key`, AI-12) */}
                          <AiRunButton
                            lock={{ entry: "writing_chat" }}
                            variant="outline"
                            size="sm"
                            onRun={() => {
                              markCareerReturn({ ...returnTarget, params: { insight_id: latest.id, insight_item_key: g.item_key } })
                              choose.open()
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
                              markCareerReturn({ ...returnTarget, params: { insight_id: latest.id, insight_item_key: g.item_key } })
                              choose.open()
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
                        <RequirementRefs ids={p.match_keys} label={reqLabel} />
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

/** 강점·보완점·지원 방향이 가리키는 요건 — `match_keys`(값 `MT-n`)로 표의 행을 찾아 요건 문구로 (S-16) */
function RequirementRefs({ ids, label }: { ids: string[]; label: (id: string) => string }) {
  if (!ids.length) return null
  return <p className="text-sm text-muted-foreground">관련 요건: {ids.map(label).join(" · ")}</p>
}

/**
 * "공고 원문" link of a requirement row — all its `sids` highlighted on the 채용 공고 tab (S-15, `?tab=jd&s=S3,S4`).
 * The only place that highlights several sentences at once (AI-5). When the posting changed (JR-7) the old sentence
 * ids may point at other text, so the link opens the tab without a highlight `[UI-가정]` (C-02 칩 규칙과 같게).
 */
function SourceLink({ apId, row, rawTextStale }: { apId: string; row: MatchRow; rawTextStale: boolean }) {
  if (!row.sids.length) return null
  const href = routes.coverLetter(apId, { tab: "jd", s: rawTextStale ? undefined : row.sids.join(",") })
  return (
    <Button asChild variant="ghost" size="sm" className="h-7 px-2">
      <Link href={href} aria-label={`${plain(row.requirement_text)} 공고 원문 보기`}>
        <TextSearch aria-hidden />
        공고 원문
      </Link>
    </Button>
  )
}

/** 요건별 판정 표 — final result and the stage-1 partial result (A3 UQ-65). (v5.21) 행 = 단계 1 원소(임시) */
function MatchTable({
  apId,
  matches,
  requirements,
  evidence,
  partial = false,
  rawTextStale,
}: {
  apId: string
  matches: MatchRow[]
  requirements: Record<string, RequirementInfo>
  evidence: Record<string, EvidenceView[]>
  partial?: boolean
  rawTextStale: boolean
}) {
  const text = (m: MatchRow) => plain(m.requirement_text || requirements[m.match_key]?.content || "") || "삭제된 요건"
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
                  <div className="space-y-1">
                    <p>{text(m)}</p>
                    <SourceLink apId={apId} row={m} rawTextStale={rawTextStale} />
                  </div>
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
                <p>{text(m)}</p>
                {STATUS_BADGE[m.status]}
              </div>
              <p className="text-sm">{plain(m.rationale)}</p>
              {m.missing_aspect ? <p className="text-sm text-muted-foreground">부족한 점: {plain(m.missing_aspect)}</p> : null}
              <EvidenceChips items={evidence[m.item_key]} max={2} />
              <SourceLink apId={apId} row={m} rawTextStale={rawTextStale} />
            </Card>
          </li>
        ))}
      </ul>
    </section>
  )
}

/** `?state=retry-other-provider`: a provider other than the active one (the failed job's provider) */
function otherProviderThan(active: AiProviderName | null): AiProviderName {
  return active === "openai" ? "gemini" : "openai"
}
