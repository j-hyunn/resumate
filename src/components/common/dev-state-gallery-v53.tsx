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

/**
 * Q53 진입점: 어느 행이든 `?state=`, 그리고 실제 흐름을 돌리는 픽스처(lib/mock/fixtures.ts).
 * (v5.20, CF-1·CF-7) S-31·S-17·S-19·S-45 주소가 없어져 S-15·S-16은 **S-46의 탭**(`?tab=`)이고
 * S-14는 **S-13 위 모달**(`?new=1`)이다. S-17 전용 줄(Q53-4·Q53-7·Q53-8)은 지웠다.
 */
const Q53_LINKS: Array<{ label: string; href: string }> = [
  { label: "Q53-1 S-14 동의 필요 → C-21", href: `${routes.applicationNew()}&state=consent-required` },
  { label: "Q53-1 S-14 키 무효 → C-20", href: `${routes.applicationNew()}&state=key-invalid` },
  { label: "Q53-1 S-14 서버 거부 (동의)", href: `${routes.applicationNew()}&state=create-refused-consent` },
  { label: "Q53-1 S-14 서버 거부 (키 무효)", href: `${routes.applicationNew()}&state=create-refused-key-invalid` },
  { label: "Q53-2 픽스처: 입력 원인 실패 JD", href: routes.coverLetter(IDS.ap(7), { tab: "jd" }) },
  { label: "Q53-11 픽스처: 요건 0개로 성공한 JD", href: routes.coverLetter(IDS.ap(8), { tab: "jd" }) },
  { label: "Q53-2 S-15 수정 중", href: `${routes.coverLetter(IDS.ap(1), { tab: "jd" })}&state=raw-edit` },
  { label: "Q53-2 S-15 저장 실패", href: `${routes.coverLetter(IDS.ap(1), { tab: "jd" })}&state=raw-save-failed` },
  { label: "Q53-2 S-15 저장 거부", href: `${routes.coverLetter(IDS.ap(1), { tab: "jd" })}&state=raw-save-refused` },
  { label: "Q53-2 S-15 저장 뒤", href: `${routes.coverLetter(IDS.ap(1), { tab: "jd" })}&state=raw-saved` },
  { label: "Q53-2 S-15 원인 모름", href: `${routes.coverLetter(IDS.ap(1), { tab: "jd" })}&state=raw-unknown-cause` },
  { label: "Q53-2 S-16 공고를 고친 뒤", href: `${routes.coverLetter(IDS.ap(1), { tab: "insight" })}&state=raw-edited` },
  { label: "Q53-8 C-09 project_fields", href: `${routes.coverLetter(IDS.ap(1))}?state=insufficient-project-fields` },
]

/**
 * (v5.20, CF-*) 자기소개서 흐름 재설계의 화면별 `?state=` 키. A0이 키를 정하고 A3·A4가 화면에서
 * 읽는다 — 화면이 아직 없는 줄은 404가 나며 그 화면이 들어오면 바로 열린다.
 */
const COVER_LETTER_LINKS: Array<{ label: string; href: string }> = [
  // S-13 자기소개서 목록
  { label: "S-13 빈 상태", href: `${routes.applications()}?state=empty` },
  { label: "S-13 로딩", href: `${routes.applications()}?state=loading` },
  { label: "S-13 목록 읽기 실패", href: `${routes.applications()}?state=error` },
  // S-14 2단계 모달 (S-13 위, ?new=1)
  { label: "S-14 ① JD 입력", href: `${routes.applicationNew()}&state=step1` },
  { label: "S-14 ① 공고 가져오는 중", href: `${routes.applicationNew()}&state=fetching` },
  { label: "S-14 ① 가져오기 실패", href: `${routes.applicationNew()}&state=fetch-failed` },
  { label: "S-14 ① 공고 내용 정리하는 중", href: `${routes.applicationNew()}&state=extracting` },
  { label: "S-14 ① 미리 보기 추출 실패", href: `${routes.applicationNew()}&state=extract-failed` },
  { label: "S-14 ② 지원 기업 / 포지션", href: `${routes.applicationNew()}&state=step2` },
  { label: "S-14 닫기 확인", href: `${routes.applicationNew()}&state=close-confirm` },
  { label: "S-14 만드는 중", href: `${routes.applicationNew()}&state=creating` },
  { label: "S-14 생성 실패", href: `${routes.applicationNew()}&state=create-failed` },
  { label: "S-14 주소 저장 불가 (invalid_source_url)", href: `${routes.applicationNew()}&state=invalid-source-url` },
  // S-46 문항 설정 상태
  { label: "S-46 문항 설정 (기본 3문항)", href: `${routes.coverLetter(IDS.ap(3))}?state=questions` },
  { label: "S-46 문항 설정 검증 오류", href: `${routes.coverLetter(IDS.ap(3))}?state=questions-invalid` },
  { label: "S-46 문항 설정 요건 정리 중", href: `${routes.coverLetter(IDS.ap(3))}?state=extracting` },
  { label: "S-46 문항 설정 요건 추출 실패", href: `${routes.coverLetter(IDS.ap(3))}?state=extract-failed` },
  { label: "S-46 문항 5개 (추가 비활성)", href: `${routes.coverLetter(IDS.ap(3))}?state=questions-max` },
  // S-46 작성 상태
  { label: "S-46 작성 상태 (픽스처: 일부 채움)", href: routes.coverLetter(IDS.ap(1)) },
  { label: "S-46 작성 상태 (픽스처: 전부 채움)", href: routes.coverLetter(IDS.ap(2)) },
  { label: "S-46 답변 없음 빈 상태", href: `${routes.coverLetter(IDS.ap(1))}?state=empty-answers` },
  { label: "S-46 저장 실패", href: `${routes.coverLetter(IDS.ap(1))}?state=save-failed` },
  { label: "S-46 다른 곳에서 바뀜", href: `${routes.coverLetter(IDS.ap(1))}?state=save-conflict` },
  { label: "S-46 문항 상한 거부 (too_many_questions)", href: `${routes.coverLetter(IDS.ap(1))}?state=too-many-questions` },
  { label: "S-46 찾을 수 없음", href: `${routes.coverLetter(IDS.ap(1))}?state=not-found` },
  // S-46 패널 (자소서 대화)
  { label: "S-46 패널 초안 작성 중", href: `${routes.coverLetter(IDS.ap(1))}?state=draft-stream` },
  { label: "S-46 패널 초안 실패", href: `${routes.coverLetter(IDS.ap(1))}?state=draft-failed` },
  { label: "S-46 패널 초안 상한 (6회)", href: `${routes.coverLetter(IDS.ap(1))}?state=draft-limit` },
  { label: "S-46 패널 AI 잠금 (C-18)", href: `${routes.coverLetter(IDS.ap(1))}?state=ai-locked` },
  // 탭
  { label: "S-46 채용 공고 탭 (S-15)", href: routes.coverLetter(IDS.ap(1), { tab: "jd" }) },
  { label: "S-46 인사이트 탭 (S-16)", href: routes.coverLetter(IDS.ap(1), { tab: "insight" }) },
  // S-39 카드 서류 표시
  { label: "S-39 보드 (자소서 작성 중 / 작성됨)", href: routes.board() },
  { label: "S-39 보드 (자소서 수 연결 대기 — 배지 없음)", href: `${routes.board()}?state=cl-pending` },
  // UQ-742: 보드 위에서 모달이 열린다 — 보드로 가서 "지원 전" 열 "+"를 누른다
  { label: "S-39 보드 (지원 전 + → 보드 위 추가 모달)", href: routes.board() },
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
        <AiErrorNotice code="timeout" provider="openai" jobTier="paid" sameRow size="inline" retryLabel="다시 생성" onRetry={ranOnce} />
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
                  blocks: [{ block_id: "b1", text: "문항 초안 첫 블록입니다." }, { block_id: "b2", text: "…" }],
                  fail: "rate_limited",
                  failAfterBlocks: 1,
                  discardOnError: true,
                })
              }
            >
              초안 턴 실패 (블록 남기지 않음 + 대기)
            </Button>
          </div>
        </Card>
      </Section>

      <Section id="ai-stages" title="C-03 v5.3 단계 (prepare · synthesize_regen)" show={show("ai-stages", "ai-pending")}>
        <AiProgress jobType="insight" progress={{ stage: "prepare" }} title="인사이트 생성" />
        <AiProgress jobType="insight" progress={{ stage: "synthesize_regen" }} title="인사이트 생성" />
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
          returnHref={routes.coverLetter(demoApplication.id, { tab: "insight" })}
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

      <Section id="cover-letter" title="자기소개서 흐름 (v5.20 CF-*) 화면별 미리보기" show={show("cover-letter")}>
        <p className="text-sm text-muted-foreground">
          S-13 · S-14 2단계 모달 · S-46(문항 설정 / 작성, 탭 3개) · S-39 카드. A0이 정한 `?state=` 키이고 화면은 A3·A4가 만든다 —
          아직 없는 화면은 404가 나요.
        </p>
        <ul className="grid gap-2 text-sm sm:grid-cols-2">
          {COVER_LETTER_LINKS.map((l) => (
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
