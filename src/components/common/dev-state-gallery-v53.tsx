"use client"

/**
 * /dev/states sections for the v5.3 states (기획 v5.3 / DM v4.2). `?state=` narrows to one section.
 * Mock controls at the bottom reproduce the server-side states with real data flow
 * (consent_required, retry refusals, account deletion busy / incomplete).
 */
import * as React from "react"
import Link from "next/link"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Card } from "@/components/ui/card"
import type { AiRetryRefusalCode, DataReadiness } from "@/types/db"
import type { AiFeatureStatusView } from "@/lib/data/ai-feature-status"
import { publishMockReconsentDisclosureAction, setMockControlsAction } from "@/lib/data/actions"
import { IDS } from "@/lib/mock/ids"
import { routes } from "@/lib/routes"
import { notifyAiConnectionChanged, useAiConnection } from "./ai-connection-context"
import { AiErrorNotice, useNow } from "./ai-error-notice"
import { AiFeatureStatus } from "./ai-feature-status"
import { AiProgress } from "./ai-progress"
import { AiRunButton } from "./ai-run-button"
import { DataInsufficientGate } from "./data-gate"
import { DataUseConsentDialog } from "./data-use-consent"
import { ProviderBadge } from "./provider-badge"
import { InterviewPromptDialog, type InterviewPromptState } from "./stage-menu"
import { StreamingBlock, StreamingHeader, StreamRegion, useAiStream } from "./streaming"

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

/** Q53-1~10 entry points: `?state=` on any row, plus the fixtures (lib/mock/fixtures.ts) that run the real flow */
const Q53_LINKS: Array<{ label: string; href: string }> = [
  { label: "Q53-1 S-14 동의 필요 → C-21", href: `${routes.applicationNew()}?state=consent-required` },
  { label: "Q53-1 S-14 키 무효 → C-20", href: `${routes.applicationNew()}?state=key-invalid` },
  { label: "Q53-1 S-14 서버 거부 (동의)", href: `${routes.applicationNew()}?state=create-refused-consent` },
  { label: "Q53-1 S-14 서버 거부 (키 무효)", href: `${routes.applicationNew()}?state=create-refused-key-invalid` },
  { label: "Q53-2 픽스처: 입력 원인 실패 JD", href: routes.applicationJd(IDS.ap(7)) },
  { label: "Q53-11 픽스처: 요건 0개로 성공한 JD", href: routes.applicationJd(IDS.ap(8)) },
  { label: "Q53-2 S-15 수정 중", href: `${routes.applicationJd(IDS.ap(1))}?state=raw-edit` },
  { label: "Q53-2 S-15 저장 실패", href: `${routes.applicationJd(IDS.ap(1))}?state=raw-save-failed` },
  { label: "Q53-2 S-15 저장 거부", href: `${routes.applicationJd(IDS.ap(1))}?state=raw-save-refused` },
  { label: "Q53-2 S-15 저장 뒤", href: `${routes.applicationJd(IDS.ap(1))}?state=raw-saved` },
  { label: "Q53-2 S-15 원인 모름", href: `${routes.applicationJd(IDS.ap(1))}?state=raw-unknown-cause` },
  { label: "Q53-2 S-16 공고를 고친 뒤", href: `${routes.applicationInsight(IDS.ap(1))}?state=raw-edited` },
  { label: "Q53-3 픽스처: 입력 원인만", href: routes.interviewResult(IDS.ap(5), IDS.ses(7)) },
  { label: "Q53-3 픽스처: 입력 원인 + 다른 원인", href: routes.interviewResult(IDS.ap(5), IDS.ses(14)) },
  { label: "Q53-4 S-17 요건 없는 JD", href: `${routes.applicationDrafts(IDS.ap(1))}?state=no-requirements` },
  { label: "Q53-4 S-17 동의 필요", href: `${routes.applicationDrafts(IDS.ap(1))}?state=no-requirements-consent` },
  { label: "Q53-4 S-17 키 무효", href: `${routes.applicationDrafts(IDS.ap(1))}?state=no-requirements-key-invalid` },
  { label: "Q53-5 픽스처: 종합만 실패", href: routes.interviewResult(IDS.ap(5), IDS.ses(8)) },
  { label: "Q53-5 픽스처: 종합이 입력 원인", href: routes.interviewResult(IDS.ap(5), IDS.ses(9)) },
  { label: "Q53-6 픽스처: 완료 + 실패 답변 (S-37 메뉴)", href: routes.interviews() },
  { label: "Q53-6 픽스처: 완료 + 입력 원인 답변", href: routes.interviewResult(IDS.ap(4), IDS.ses(10)) },
  { label: "Q53-7 픽스처: 작성 중 경력기술서", href: `${routes.applicationDrafts(IDS.ap(3))}#new-draft` },
  { label: "Q53-8 C-09 project_fields", href: `${routes.applicationDrafts(IDS.ap(1))}?state=insufficient-project-fields` },
  { label: "Q53-9 픽스처: 요건 없음 → 공고 원문 고치기", href: routes.interviewSession(IDS.ap(7), IDS.ses(6)) },
  { label: "Q53-9 픽스처: 요건 있음 → 공고 확인하기", href: routes.interviewSession(IDS.ap(2), IDS.ses(13)) },
  { label: "Q53-9 S-20 그만두고 새로 시작", href: routes.interviewPrep(IDS.ap(7)) },
  { label: "Q53-9 픽스처: 질문 0개 그만둔 세션", href: routes.interviewSession(IDS.ap(7), IDS.ses(12)) },
  { label: "Q53-9 S-33 공고를 고친 뒤", href: `${routes.interviewSession(IDS.ap(1), IDS.ses(1))}?state=raw-edited-stale` },
]

const REFUSALS: Array<{ state: string; code: AiRetryRefusalCode }> = [
  { state: "retry-refused-key-missing", code: "key_missing" },
  { state: "retry-refused-consent", code: "ai_consent_required" },
  { state: "retry-refused-key-invalid", code: "key_invalid" },
  { state: "retry-connection-changed", code: "ai_connection_changed" },
  { state: "retry-not-retryable", code: "ai_job_not_retryable" },
]

export function DevStateGalleryV53({
  state,
  projectFields,
  demoApplication,
}: {
  state: string | null
  projectFields: DataReadiness
  demoApplication: { id: string; name: string }
}) {
  const show = (...ids: string[]) => !state || ids.includes(state)
  const now = useNow()
  const at = (sec: number) => (now ? new Date(Math.ceil(now / 60_000) * 60_000 + sec * 1000).toISOString() : null)
  const connection = useAiConnection()
  const [consentOpen, setConsentOpen] = React.useState(false)
  const [prompt, setPrompt] = React.useState<InterviewPromptState | null>(null)
  const stream = useAiStream()
  const ranOnce = () => {
    toast("실행했어요 (개발용)")
  }

  const control = async (patch: Parameters<typeof setMockControlsAction>[0], message: string) => {
    await setMockControlsAction(patch)
    toast(message)
  }

  const statuses: Array<{ label: string; status: AiFeatureStatusView }> = [
    { label: "① 생성 중", status: { kind: "generating", job_type: "insight", progress: { stage: "match", done: 1, total: 3 }, failure: null } },
    { label: "② 있음", status: { kind: "present", job_type: "insight", progress: null, failure: null } },
    { label: "③ 없음", status: { kind: "none", job_type: null, progress: null, failure: null } },
    {
      label: "② + 늦게 끝난 실패",
      status: { kind: "present", job_type: "insight", progress: null, failure: { error_code: "provider_unavailable", provider: "gemini", job: null } },
    },
    { label: "③ + stalled", status: { kind: "none", job_type: "insight", progress: null, failure: { error_code: "stalled", provider: null, job: null } } },
  ]

  return (
    <div className="space-y-10">
      <Section id="consent-required" title="C-18 동의 필요 (R-67) · C-19 동의 필요형 · C-21 동의 창형" show={show("consent-required")}>
        <p className="text-sm text-muted-foreground">
          ?state=consent-required 이면 배지가 동의 필요형이 되고, 실행 버튼을 누르면 요청 전에 동의 창이 열려요. 동의하면 누른 실행이 이어져요.
        </p>
        <div className="flex flex-wrap items-center gap-3">
          <ProviderBadge connection={{ active_provider: "gemini", key_status: "valid", connection_tier: "free", consent_required: true }} />
          <ProviderBadge />
        </div>
        <AiRunButton lock={{ entry: "insight" }} onRun={ranOnce}>
          인사이트 생성
        </AiRunButton>
        {connection?.active_provider ? (
          <>
            <Button variant="outline" onClick={() => setConsentOpen(true)}>
              동의 창 열기 (활성 공급자·등급)
            </Button>
            <DataUseConsentDialog
              open={consentOpen}
              onOpenChange={setConsentOpen}
              provider={connection.active_provider}
              tier={connection.connection_tier ?? "free"}
              onConsented={ranOnce}
            />
          </>
        ) : null}
        <AiErrorNotice code="key_missing" provider="gemini" onRetry={ranOnce} inputHref={routes.career()} />
      </Section>

      <Section id="retry-other-provider" title="C-20 다시 시도 배지 · 처음부터 다시 (A1)" show={show("retry-other-provider")}>
        <AiErrorNotice code="provider_unavailable" provider="openai" jobTier="paid" sameRow onRetry={ranOnce} />
        <AiErrorNotice code="timeout" provider="openai" jobTier="paid" sameRow size="inline" retryLabel="다시 채점" onRetry={ranOnce} />
      </Section>

      <Section
        id="retry-refused"
        title="C-20 다시 시도 거부 (409, 04 §2.11.7 ②)"
        show={show(...REFUSALS.map((r) => r.state))}
      >
        {REFUSALS.filter((r) => !state || state === r.state).map((r) => (
          <div key={r.code} className="space-y-1">
            <p className="text-xs font-medium text-muted-foreground">
              refusal = <code>{r.code}</code> (?state={r.state})
            </p>
            <AiErrorNotice
              code="provider_unavailable"
              provider="gemini"
              sameRow
              onRetry={ranOnce}
              refusal={r.code}
              inputHref={routes.career()}
              inputLabel="공고 원문으로 이동"
            />
          </div>
        ))}
      </Section>

      <Section id="input-failed" title="C-20 입력 원인 실패 — 다시 시도 없음 (R-69)" show={show("input-failed")}>
        <AiErrorNotice code="input_too_long" provider="gemini" reduceTarget="공고 원문" inputHref={routes.career()} rerunLabel="다시 생성" onRetry={ranOnce} />
        <AiErrorNotice code="safety_blocked" provider="gemini" inputHref={routes.career()} inputLabel="입력으로 이동" rerunLabel="시작하기" />
        <AiErrorNotice code="not_a_jd" inputHref={routes.applicationNew()} rerunLabel="요건 정리하기" />
        <AiErrorNotice code="input_too_long" size="inline" reduceTarget="문항 메모" onFocusInput={() => undefined} rerunLabel="생성" />
      </Section>

      <Section id="request-wait" title="C-20 요청 안 경로 대기 (A14) — 카운트다운" show={show("request-wait")}>
        <AiErrorNotice code="rate_limited" provider="gemini" size="inline" requestPath retryLabel="다시 보내기" retryAfter={at(15)} onRetry={ranOnce} />
        <AiErrorNotice code="provider_unavailable" provider="gemini" requestPath retryAfter={at(75)} onRetry={ranOnce} />
      </Section>

      <Section id="finalizing" title="C-04 마무리 중 · 글자 수 맞추는 중 · validated 통째 교체" show={show("finalizing")}>
        <Card className="gap-4 p-5">
          <StreamingHeader phase="adjusting" adjusting={{ current_chars: 1180, char_limit: 1000 }} onStop={() => undefined} />
          <StreamingHeader phase="finalizing" onStop={() => undefined} />
          <StreamRegion status={stream.status} className="space-y-3 border-t pt-4">
            {stream.status === "streaming" ? <StreamingHeader onStop={stream.cancel} phase={stream.phase} adjusting={stream.adjusting} /> : null}
            {stream.blocks.map((b) => (
              <StreamingBlock key={b.block_id} block={b}>
                <p className="mt-1 text-xs text-muted-foreground">확정 블록 · 근거 {b.evidence_count}개</p>
              </StreamingBlock>
            ))}
            {stream.notes[""] ? (
              <p className="rounded-md bg-muted p-3 text-sm">생성 직후 안내(A3 GenerationNotes 자리): {stream.notes[""].notes_for_user?.join(" · ")}</p>
            ) : null}
            {stream.status === "error" && stream.errorInfo ? (
              <AiErrorNotice {...stream.errorInfo} requestPath hidePreserved onRetry={() => stream.reset()} />
            ) : null}
          </StreamRegion>
          <div className="flex flex-wrap gap-2">
            <Button
              size="sm"
              onClick={() =>
                stream.start({
                  blocks: [
                    { block_id: "q1-p1", text: "결제 승인 API의 병목을 지표로 찾아 응답 시간을 줄인 경험이 있습니다.", evidence_count: 2 },
                    { block_id: "q1-p2", text: "이 경험을 바탕으로 대규모 트래픽을 다루는 팀에 기여하겠습니다.", evidence_count: 1 },
                  ],
                  adjustLength: { current_chars: 1180, char_limit: 1000 },
                  notes: { notes_for_user: ["지원 동기에 회사 관련 내용이 부족해 [지원 동기 입력 필요]를 넣었어요"] },
                })
              }
            >
              스트리밍 (글자 수 보정 → 마무리 중 → 확정)
            </Button>
            <Button
              size="sm"
              variant="outline"
              onClick={() =>
                stream.start({
                  blocks: [{ block_id: "b1", text: "경력기술서 첫 블록입니다." }, { block_id: "b2", text: "…" }],
                  fail: "rate_limited",
                  failAfterBlocks: 1,
                  discardOnError: true,
                })
              }
            >
              경력기술서 실패 (블록 남기지 않음 + 대기)
            </Button>
          </div>
        </Card>
      </Section>

      <Section id="ai-stages" title="C-03 v5.3 단계 (prepare · synthesize_regen · complete · 질문 n/N)" show={show("ai-stages", "ai-pending")}>
        <AiProgress jobType="insight" progress={{ stage: "prepare" }} title="인사이트 생성" />
        <AiProgress jobType="insight" progress={{ stage: "synthesize_regen" }} title="인사이트 생성" />
        <AiProgress jobType="interview_questions" progress={{ stage: "generate", done: 2, total: 5 }} title="면접 질문 생성" />
        <AiProgress jobType="interview_evaluation" progress={{ stage: "prepare" }} title="답변 채점" />
        <AiProgress jobType="interview_evaluation" progress={{ stage: "complete" }} title="답변 채점" />
      </Section>

      <Section id="feature-status" title="C-03 진행 표시 우선순위 (AiFeatureStatus)" show={show("feature-status")}>
        <ul className="space-y-2">
          {statuses.map((s) => (
            <li key={s.label} className="flex items-start gap-4">
              <span className="w-40 shrink-0 text-sm text-muted-foreground">{s.label}</span>
              <AiFeatureStatus status={s.status}>
                <span className="text-sm">충족 3 · 부분 1 · 근거 없음 1</span>
              </AiFeatureStatus>
            </li>
          ))}
        </ul>
      </Section>

      <Section id="insufficient-project-fields" title="C-09 hint project_fields (A18)" show={show("insufficient-project-fields")}>
        <DataInsufficientGate
          feature="insight"
          featureLabel="인사이트"
          returnFeature="insight"
          readiness={projectFields}
          applicationProjectId={demoApplication.id}
          applicationName={demoApplication.name}
          returnHref={routes.applicationInsight(demoApplication.id)}
        />
      </Section>

      <Section id="interview-prompt" title="C-14 작성 중 세션 (마지막 활동 · generation_status · 유형 다름)" show={show("interview-prompt")}>
        <div className="flex flex-wrap gap-2">
          <Button
            variant="outline"
            onClick={() =>
              setPrompt({
                interview_type: "job",
                session: { id: "dev", interview_type: "job", answered_count: 2, question_count: 5, generation_status: "generating", last_activity_at: new Date(Date.now() - 3 * 3_600_000).toISOString() },
              })
            }
          >
            질문 생성 중
          </Button>
          <Button
            variant="outline"
            onClick={() =>
              setPrompt({
                interview_type: "culture_fit",
                session: { id: "dev", interview_type: "job", answered_count: 1, question_count: 5, generation_status: "failed", last_activity_at: new Date(Date.now() - 26 * 3_600_000).toISOString() },
              })
            }
          >
            생성 실패 · 유형 다름
          </Button>
        </div>
        <InterviewPromptDialog
          open={prompt !== null}
          onOpenChange={(o) => !o && setPrompt(null)}
          applicationProjectId={demoApplication.id}
          name={demoApplication.name}
          prompt={prompt}
        />
      </Section>

      <Section id="q53" title="Q53 화면별 미리보기 · 픽스처" show={show("q53")}>
        <p className="text-sm text-muted-foreground">
          ?state= 미리보기는 저장소를 바꾸지 않아요. 실제 흐름은 픽스처 행에서 확인해요 (dev 서버를 다시 켜야 새 픽스처가 들어와요).
        </p>
        <ul className="grid gap-2 text-sm sm:grid-cols-2">
          {Q53_LINKS.map((l) => (
            <li key={l.label}>
              <Link className="underline underline-offset-4" href={l.href}>
                {l.label}
              </Link>
            </li>
          ))}
        </ul>
      </Section>

      <Section id="mock-controls" title="개발용 mock 제어 (실제 데이터 흐름으로 재현)" show={show("mock-controls", "deletion-busy", "deletion-incomplete")}>
        <div className="flex flex-wrap gap-2">
          <Button
            size="sm"
            variant="outline"
            onClick={async () => {
              await publishMockReconsentDisclosureAction()
              notifyAiConnectionChanged()
              toast("새 고지 버전을 게시했어요 — consent_required = true")
            }}
          >
            재동의 필요한 고지 게시
          </Button>
          {REFUSALS.map((r) => (
            <Button key={r.code} size="sm" variant="outline" onClick={() => void control({ next_retry_refusal: r.code }, `다음 다시 시도 → 409 ${r.code}`)}>
              다음 다시 시도 거부: {r.code}
            </Button>
          ))}
        </div>
        <div className="flex flex-wrap gap-2">
          <Button size="sm" variant="outline" onClick={() => void control({ account_deletion_failure: "account_deletion_busy" }, "다음 탈퇴 요청 → busy")}>
            다음 탈퇴: busy
          </Button>
          <Button size="sm" variant="outline" onClick={() => void control({ account_deletion_failure: "account_deletion_incomplete" }, "다음 탈퇴 요청 → incomplete")}>
            다음 탈퇴: incomplete
          </Button>
          <Button size="sm" variant="outline" onClick={() => void control({ account_deletion_state: "deletion_incomplete" }, "계정 상태 → 탈퇴 미완료 (셸이 S-25로 보냄)")}>
            계정 상태: 탈퇴 미완료
          </Button>
          <Button size="sm" variant="outline" onClick={() => void control({ next_send_refusal: "key_missing" }, "다음 대화 보내기 → 서버 key_missing (경로 ④)")}>
            다음 대화 보내기 거부: key_missing
          </Button>
          <Button size="sm" variant="outline" onClick={() => void control({ next_send_refusal: "key_invalid" }, "다음 대화 보내기 → 서버 key_invalid")}>
            다음 대화 보내기 거부: key_invalid
          </Button>
          <Button size="sm" variant="outline" onClick={() => void control({ next_jd_extraction_failure: "rate_limited" }, "다음 요건 추출 → rate_limited 실패")}>
            다음 요건 추출 실패: rate_limited
          </Button>
          <Button size="sm" variant="outline" onClick={() => void control({ next_jd_extraction_failure: "not_a_jd" }, "다음 요건 추출 → not_a_jd 실패")}>
            다음 요건 추출 실패: not_a_jd
          </Button>
          <Button size="sm" variant="outline" onClick={() => void control({ next_jd_extraction_failure: "input_too_long" }, "다음 요건 추출 → input_too_long 실패")}>
            다음 요건 추출 실패: input_too_long
          </Button>
          <Button
            size="sm"
            variant="outline"
            onClick={() =>
              void control(
                { account_deletion_state: "active", account_deletion_failure: null, next_retry_refusal: null, next_send_refusal: null, next_jd_extraction_failure: null },
                "mock 제어 초기화",
              )
            }
          >
            초기화
          </Button>
          <Button size="sm" variant="link" asChild>
            <Link href={routes.withdraw()}>S-25로 이동</Link>
          </Button>
        </div>
      </Section>
    </div>
  )
}
