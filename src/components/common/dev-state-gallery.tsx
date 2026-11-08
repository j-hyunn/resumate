"use client"

/**
 * Dev-only gallery of the common components and ST-xx states (UQ-23). Route: /dev/states.
 * `?state=` narrows to one section (ai-pending, ai-waiting, ai-stream, ai-failed*, ai-locked,
 * key-invalid, key-check, key-missing, insufficient*, wait-jd, move-failed, save-failed, ai-sync,
 * consent, ai-outage …); no state shows everything. v4: ST-LIMIT removed.
 */
import * as React from "react"
import { Loader2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import { routes } from "@/lib/routes"
import { Card } from "@/components/ui/card"
import type { DataReadiness } from "@/types/db"
import type { EvidenceView } from "@/lib/data/evidence"
import { FAILURE_CAUSES, codeForCause } from "@/lib/data/ai-errors"
import { AiProgress, AiProgressInline, useAiJob } from "./ai-progress"
import { AiErrorNotice, useNow } from "./ai-error-notice"
import { AiLock } from "./ai-lock"
import { AiRunButton } from "./ai-run-button"
import { DataUseConsent } from "./data-use-consent"
import { ProviderBadge, ProviderResultTag } from "./provider-badge"
import { DataInsufficientGate } from "./data-gate"
import { DeleteConfirmDialog, type DeleteTarget } from "./delete-confirm-dialog"
import { EvidenceChips, EvidenceProvider } from "./evidence"
import { BlockFlagBadges, PlaceholderText } from "./placeholders"
import { usePreviewState } from "./preview-state-client"
import { DraftBadge, DraftNotice, SaveStatus } from "./save-status"
import { StageCardMenu, StageChip, useStageMove } from "./stage-menu"
import { AiFailedInline, AiOutageAlert, EmptyState, WaitJd } from "./state-views"
import { PendingBlock, StreamingBlock, StreamingHeader, StreamRegion, useAiStream } from "./streaming"
import { DevStateGalleryV53 } from "./dev-state-gallery-v53"

function Section({ id, title, show, children }: { id: string; title: string; show: boolean; children: React.ReactNode }) {
  if (!show) return null
  return (
    <section aria-labelledby={`sec-${id}`} className="space-y-3">
      <h2 id={`sec-${id}`} className="text-lg leading-7 font-semibold">
        {title} <code className="text-sm font-normal text-muted-foreground">?state={id}</code>
      </h2>
      {children}
    </section>
  )
}

export function DevStateGallery({
  runningJobId,
  readiness,
  insufficient,
  insufficientNoExperience,
  insufficientProjectFields,
  evidence,
  demoApplication,
}: {
  runningJobId: string | null
  readiness: DataReadiness
  insufficient: DataReadiness
  insufficientNoExperience: DataReadiness
  /** v5.3 C-09 hint project_fields preview */
  insufficientProjectFields: DataReadiness
  evidence: EvidenceView[]
  demoApplication: { id: string; name: string; stage: "document" }
}) {
  const state = usePreviewState()
  const show = (...ids: string[]) => !state || ids.includes(state)
  const job = useAiJob(show("ai-pending") ? runningJobId : null)
  const stream = useAiStream()
  const move = useStageMove({
    applicationProjectId: demoApplication.id,
    name: demoApplication.name,
    stage: demoApplication.stage,
    outcome: null,
    failMove: state === "move-failed",
  })
  const [deleteTarget, setDeleteTarget] = React.useState<DeleteTarget | null>(null)
  const [syncing, setSyncing] = React.useState(state === "ai-sync")
  const now = useNow()
  // C-03 요청 한도 대기 줄: waiting_retry_until 12 s ahead, re-armed every minute
  const waitUntil = now ? new Date(Math.ceil(now / 60_000) * 60_000 - 48_000).toISOString() : null
  const at = (sec: number) => (now ? new Date(now + sec * 1000).toISOString() : null)

  return (
    <EvidenceProvider>
      <div className="mx-auto max-w-3xl space-y-10">
        {/* v5.3 (기획 v5.3 / DM v4.2) states first */}
        <DevStateGalleryV53 state={state} projectFields={insufficientProjectFields} demoApplication={demoApplication} />
        <Section id="ai-pending" title="C-03 AI 작업 상태 (ST-AI-PENDING)" show={show("ai-pending")}>
          <AiProgress jobType="insight" progress={job.progress ?? { stage: "match", done: 1, total: 2 }} title="인사이트 생성" />
          <AiProgressInline progress={{ stage: "match", done: 2, total: 5 }} jobType="insight" />
        </Section>

        <Section id="ai-waiting" title="C-03 무료 등급 순차 · 요청 한도 대기 줄" show={show("ai-waiting")}>
          <AiProgress
            jobType="insight"
            connectionTier="free"
            progress={{ stage: "match", done: 2, total: 6, waiting_retry_until: waitUntil }}
            title="인사이트 생성"
          />
          <AiProgressInline progress={{ stage: "match", done: 3, total: 5, waiting_retry_until: waitUntil }} jobType="insight" />
        </Section>

        <Section id="ai-stream" title="C-04 스트리밍 (ST-AI-STREAM)" show={show("ai-stream")}>
          <Card className="gap-4 p-5">
            {stream.status === "streaming" ? <StreamingHeader onStop={stream.cancel} /> : null}
            <StreamRegion status={stream.status} className="space-y-4">
              {stream.blocks.map((b) => (
                <StreamingBlock key={b.block_id} block={b}>
                  <EvidenceChips items={evidence.slice(0, b.evidence_count)} leading={<BlockFlagBadges flags={b.flags} />} />
                </StreamingBlock>
              ))}
              {stream.status === "idle" ? <PendingBlock /> : null}
            </StreamRegion>
            {stream.status === "error" && stream.error ? (
              <AiErrorNotice code={stream.error} size="inline" onRetry={() => stream.reset()} />
            ) : null}
            <div className="flex flex-wrap gap-2">
              <Button
                size="sm"
                onClick={() =>
                  stream.start({
                    blocks: [
                      { block_id: "b1", text: "결제 승인 API 구조 개선으로 p95 응답 시간 1.2초 → 0.7초 단축", evidence_count: 2 },
                      { block_id: "b2", text: "정산 배치 재설계로 처리 시간 [수치 입력 필요] 단축", flags: ["number_check_needed"], evidence_count: 1 },
                    ],
                  })
                }
              >
                스트리밍 시작
              </Button>
              <Button
                size="sm"
                variant="outline"
                onClick={() => stream.start({ blocks: [{ block_id: "b1", text: "첫 블록만 쓰고 실패하는 예시입니다." }, { block_id: "b2", text: "…" }], fail: "provider_unavailable", failAfterBlocks: 1 })}
              >
                실패하는 스트림
              </Button>
            </div>
          </Card>
        </Section>

        <Section id="ai-sync" title="ST-AI-SYNC (버튼 안 스피너)" show={show("ai-sync")}>
          <Button disabled={syncing} onClick={() => setSyncing(true)}>
            {syncing ? <Loader2 className="animate-spin" aria-hidden /> : null}
            요건 다시 추출
          </Button>
        </Section>

        <Section
          id="ai-failed"
          title="C-20 한도·오류 안내 (ST-AI-FAILED 대체)"
          show={show(
            "ai-failed",
            "ai-failed-input",
            "ai-failed-timeout",
            "ai-failed-rate-limited",
            "ai-failed-daily-quota",
            "ai-failed-daily-quota-reset",
            "ai-failed-billing",
            "ai-failed-key-invalid",
            "ai-failed-model",
            "ai-failed-provider",
            "ai-failed-input-rejected",
            "ai-failed-safety",
          )}
        >
          <h3 className="text-sm font-semibold">block · 원인 7종</h3>
          {FAILURE_CAUSES.map((cause) => (
            <AiErrorNotice
              key={cause}
              code={codeForCause(cause)}
              provider="gemini"
              retryAfter={cause === "rate_limited" || cause === "provider_unavailable" ? at(150) : null}
              onRetry={() => undefined}
              reduceTarget="공고 원문"
              inputHref="/applications/new"
            />
          ))}
          <h3 className="text-sm font-semibold">block · daily_quota_exhausted + 초기화 줄 (quota_resets_at 있음, OD-B1)</h3>
          <AiErrorNotice code="daily_quota_exhausted" provider="gemini" quotaResetsAt={at(3 * 60 * 60)} onRetry={() => undefined} />
          <h3 className="text-sm font-semibold">block · 시스템·입력</h3>
          <AiErrorNotice code="safety_blocked" provider="gemini" onRetry={() => undefined} inputHref="/applications/new" inputLabel="입력으로 이동" />
          <AiErrorNotice code="schema_invalid" onRetry={() => undefined} />
          <AiErrorNotice code="timeout" onRetry={() => undefined} />
          <AiErrorNotice code="not_a_jd" inputHref="/applications/new" />
          <h3 className="text-sm font-semibold">inline (대화 턴·섹션·답변 카드)</h3>
          <AiErrorNotice code="rate_limited" provider="gemini" size="inline" retryLabel="다시 보내기" retryAfter={at(45)} onRetry={() => undefined} />
          <AiErrorNotice code="provider_unavailable" provider="anthropic" size="inline" retryLabel="다시 생성" onRetry={() => undefined} />
          <AiFailedInline message="이 섹션을 만들지 못했어요" />
          <h3 className="text-sm font-semibold">field (S-41 ③ 키 입력란 아래)</h3>
          <AiErrorNotice code="key_invalid" provider="openai" size="field" />
          <AiErrorNotice code="daily_quota_exhausted" provider="gemini" size="field" />
        </Section>

        <Section id="key-missing" title="ST-AI-KEY-MISSING (C-20 key_missing)" show={show("key-missing")}>
          <AiErrorNotice code="key_missing" inputHref="/career" />
        </Section>

        <Section id="ai-locked" title="C-18 AI 잠금 (ST-AI-LOCKED)" show={show("ai-locked")}>
          <AiLock entry="insight" size="area" featureLabel="인사이트" alternativeHref="/career" />
          <AiLock entry="requirements" size="area" featureLabel="요건 정리" alternativeNote="공고 원문은 그대로 볼 수 있어요" />
          <AiLock entry="usage" size="area" featureLabel="AI 사용량" />
          <AiLock entry="writing_chat" size="inline" actionName="AI와 대화하며 정리" alternativeHref={routes.projectPageNew({ experience: "00000000-0000-4e01-8000-000000000001" })} />
          <AiLock entry="draft" size="inline" actionName="초안 생성" />
        </Section>

        <Section id="key-invalid" title="C-19 배지 · AiRunButton (key-invalid / key-check)" show={show("key-invalid", "key-check")}>
          <p className="text-sm text-muted-foreground">
            ?state=key-invalid → 배지 경고형, 누르면 C-20 key_invalid · ?state=key-check → 주의형, 실행 허용 · ?state=ai-locked → C-18 인라인
          </p>
          <div className="flex flex-wrap items-center gap-3">
            <ProviderBadge />
            <ProviderBadge connection={{ active_provider: "anthropic", key_status: "valid", connection_tier: "paid", consent_required: false }} />
          </div>
          <AiRunButton lock={{ entry: "insight" }} onRun={() => undefined}>
            인사이트 생성
          </AiRunButton>
          <AiRunButton lock={{ entry: "draft" }} variant="ghost" size="sm" rerun onRun={() => undefined}>
            다시 생성
          </AiRunButton>
          <AiRunButton lock={{ entry: "draft" }} running runningSlot={<AiProgressInline progress={{ stage: "generate" }} />}>
            초안 생성
          </AiRunButton>
          <div className="space-y-1">
            <ProviderResultTag provider="gemini" model_tier="default" model="gemini-mock-default" />
          </div>
        </Section>

        <Section id="consent" title="C-21 데이터 사용 고지·동의" show={show("consent")}>
          <Card className="p-5">
            <DataUseConsent provider="gemini" tier="free" onBack={() => undefined} onNext={() => undefined} />
          </Card>
          <Card className="p-5">
            <DataUseConsent provider="anthropic" tier="paid" agreedAt={new Date().toISOString()} />
          </Card>
        </Section>

        <Section id="ai-outage" title="S-28 공급자 장애 배너" show={show("ai-outage")}>
          <AiOutageAlert providerLabel="Gemini" />
        </Section>

        <Section id="insufficient" title="C-09 데이터 부족 (ST-INSUFFICIENT)" show={show("insufficient", "insufficient-no-experience")}>
          {show("insufficient") ? (
            <DataInsufficientGate
              feature="draft"
              featureLabel="경력기술서"
              returnFeature="career_description"
              readiness={insufficient}
              applicationProjectId={demoApplication.id}
              applicationName={demoApplication.name}
              returnHref={`/applications/${demoApplication.id}/drafts`}
            />
          ) : null}
          {show("insufficient-no-experience") ? (
            <DataInsufficientGate
              feature="insight"
              featureLabel="인사이트"
              returnFeature="insight"
              readiness={insufficientNoExperience}
              applicationProjectId={demoApplication.id}
              applicationName={demoApplication.name}
              returnHref={`/applications/${demoApplication.id}/insight`}
            />
          ) : null}
          <p className="text-sm text-muted-foreground">실제 준비 상태: 인사이트 {readiness.features.insight.ready ? "준비됨" : "부족"}</p>
        </Section>

        <Section id="wait-jd" title="ST-WAIT-JD" show={show("wait-jd")}>
          <Button disabled>인사이트 생성</Button>
          <WaitJd />
        </Section>

        <Section id="move-failed" title="C-12 단계 이동 · C-13 (ST-MOVE-FAILED)" show={show("move-failed")}>
          <div className="flex flex-wrap items-center gap-3">
            <StageChip controller={move} />
            <StageCardMenu controller={move} />
          </div>
          <p className="text-sm text-muted-foreground">?state=move-failed 이면 이동이 실패하고 원위치 + 토스트가 떠요. 실제 픽스처 데이터를 바꿔요(개발용).</p>
          {move.dialogs}
        </Section>

        <Section id="save-failed" title="C-06 저장 상태 (ST-SAVE-FAILED)" show={show("save-failed")}>
          <div className="flex flex-wrap items-center gap-4">
            <SaveStatus state="saving" />
            <SaveStatus state="saved" savedAt={new Date()} />
            <SaveStatus state="failed" onRetry={() => undefined} />
            <DraftBadge />
          </div>
          <DraftNotice />
        </Section>

        <Section id="empty" title="ST-EMPTY · C-01 · C-05 · C-08" show={show("empty")}>
          <EmptyState title="빈 상태 예시" description="설명 문구" actions={<Button size="sm">주 동작</Button>} />
          <EvidenceChips items={evidence} />
          <p className="text-base leading-[1.75]">
            <PlaceholderText text="정산 배치 처리 시간을 [수치 입력 필요] 줄였습니다." placeholders={[{ token: "[수치 입력 필요]", hint: "개선 전후 값" }]} />
          </p>
          <Button variant="outline" onClick={() => setDeleteTarget({ kind: "application_project", entity_id: demoApplication.id, label: demoApplication.name })}>
            C-05 자기소개서 삭제 확인 열기
          </Button>
          <DeleteConfirmDialog
            target={deleteTarget}
            open={deleteTarget !== null}
            onOpenChange={(o) => !o && setDeleteTarget(null)}
            onConfirm={async () => undefined}
          />
        </Section>
      </div>
    </EvidenceProvider>
  )
}
