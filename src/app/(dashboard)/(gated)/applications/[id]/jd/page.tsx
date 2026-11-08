import Link from "next/link"
import { notFound } from "next/navigation"
import { ArrowLeft, TriangleAlert } from "lucide-react"
import { Alert, AlertTitle } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"
import { Card } from "@/components/ui/card"
import { ScreenSuspense } from "@/components/common/screen-suspense"
import { PageHeader } from "@/components/common/basics"
import { ErrorState, ListSkeleton, TextSkeleton } from "@/components/common/state-views"
import { PageCrumbs } from "@/components/common/shell/breadcrumbs"
import { JdLockedNotice, JdRawEditProvider } from "@/components/applications/jd-raw-edit"
import { ExtractingLine, ExtractionFailed, JdView, RunExtraction } from "@/components/applications/jd-view"
import { AutoRefresh } from "@/components/applications/shared"
import { getApplicationProject, getJobDescription } from "@/lib/data/applications"
import { getAiJob } from "@/lib/data/ai-jobs"
import { isInputCausedJdFailure } from "@/lib/data/jd-raw-text"
import { applicationDisplayName } from "@/lib/data/labels"
import { getPreviewState, previewErrorCode, previewRetryRefusal } from "@/lib/preview-state"
import { routes } from "@/lib/routes"
import type { AiErrorCode } from "@/types/db"

// S-15 JD·요건. ?state=: loading · error · unauth · not-found · ai-sync(=wait-jd) · wait-jd · ai-failed · ai-failed-input · ai-failed-timeout · ai-failed-{C-20 7원인} · key-missing · ai-locked(키 없이 등록된 JD 미리보기) · key-invalid · key-check
//   · v5.3: consent-required · input-failed · request-wait · retry-refused-key-missing · retry-refused-consent · retry-refused-key-invalid
//     · retry-connection-changed · retry-not-retryable
//   · Q53-2 (저장소를 바꾸지 않음): raw-editable (not_a_jd 실패 + 고치기 버튼) · raw-edit (수정 중) · raw-save-failed · raw-save-refused
//     · raw-saved (저장 안내) · raw-unknown-cause · raw-has-requirements (요건이 있는 공고 안내)
// ?edit=1&from=insight|drafts|questions&draft=&cause= : C-20 "입력 원인 실패의 이동"에서 온 진입
type Props = { params: Promise<{ id: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> }

const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v)

/** S-15 "돌아가기": 재추출 성공 뒤 원래 화면으로 (자동 실행 없음). [UI-가정] 기능 이름 */
function returnLink(id: string, from: string | undefined, draft: string | undefined) {
  if (from === "insight") return { href: routes.applicationInsight(id), label: "인사이트로 돌아가기" }
  if (from === "drafts") return { href: routes.applicationDrafts(id), label: "서류 초안으로 돌아가기" }
  if (from === "questions" && draft) return { href: routes.draftQuestions(id, draft), label: "자소서 문항 설정으로 돌아가기" }
  return null
}

export default function Page({ params, searchParams }: Props) {
  return (
    <ScreenSuspense>
      <Screen params={params} searchParams={searchParams} />
    </ScreenSuspense>
  )
}

async function Screen({ params, searchParams }: Props) {
  const { id } = await params
  const sp = await searchParams
  const state = getPreviewState(sp)
  // UQ-530: entering while another path (S-14 자동 추출 · 인사이트 prepare · 서류 선행 추출) extracts →
  // "이미 정리하고 있어요"; started on this screen (`?extracting=self`) → "공고 요건 정리 중"
  const startedHere = sp.extracting === "self"
  if (state === "not-found") notFound()
  const jd = await getJobDescription(id)
  const ap = await getApplicationProject(id)
  if (!ap || !jd) notFound()
  const name = applicationDisplayName(ap.name, ap.name_source, ap.created_at)

  // Q53-2 previews draw the states on any JD without touching the store
  const rawPreview = state === "raw-editable" || state === "raw-edit" || state === "raw-save-failed" || state === "raw-save-refused" || state === "raw-saved"
  const previewSave = state === "raw-save-failed" ? "failed" : state === "raw-save-refused" ? "refused" : rawPreview ? "ok" : null
  const previewFail: AiErrorCode | null = rawPreview && state !== "raw-saved" ? "not_a_jd" : previewErrorCode(state)
  const job = jd.extraction_status === "failed" && jd.extraction_job_id ? await getAiJob(jd.extraction_job_id) : null
  // S-15 "원인을 알 수 없는 실패": the failure record is gone (04 §2.6.1) → no edit button, 다시 정리만
  const unknownFailure = state === "raw-unknown-cause" || (!previewFail && !rawPreview && jd.extraction_status === "failed" && !job?.error_code)
  // Q53-11: 추출은 됐는데 요건이 0개 → not_a_jd 문구 + 공고 원문 고치기 (재추출은 저장 뒤에만)
  const emptySuccess = !state && jd.extraction_status === "succeeded" && jd.requirements.length === 0
  const failCode = previewFail ?? (emptySuccess ? "not_a_jd" : jd.extraction_status === "failed" && !unknownFailure ? (job?.error_code ?? null) : null)
  // v4 (D-30): created without a key → pending with no job → C-18 / "요건 정리하기" (RunExtraction).
  // ?state=ai-locked previews the key-less JD (requirements not organised yet)
  const notStarted =
    state === "ai-locked" ||
    state === "raw-saved" ||
    unknownFailure ||
    (jd.extraction_status === "pending" && !jd.extraction_job_id && state !== "wait-jd" && state !== "ai-sync")
  const running = !notStarted && (state === "wait-jd" || state === "ai-sync" || jd.extraction_status === "running" || jd.extraction_status === "pending")
  const notJd = jd.extraction?.is_likely_jd === false
  const hasRequirements = jd.requirements.length > 0 && jd.extraction_status === "succeeded"
  // `refused=1`: the read-back after a refused `?state=raw-save-refused` save. The prop turns false like the
  // real read-back does, so the preview runs the same path (UQ-601)
  const editable = rawPreview ? state !== "raw-saved" && one(sp.refused) !== "1" : !unknownFailure && jd.raw_text_editable
  // Q53-9 "요건이 있는 공고": 인사이트 입력 원인 실패로 왔는데 요건이 있으면 읽기 전용 + 안내
  const causeParam = one(sp.cause)
  const lockedCause: AiErrorCode | null =
    state === "raw-has-requirements"
      ? "input_too_long"
      : hasRequirements && isInputCausedJdFailure(causeParam as AiErrorCode)
        ? (causeParam as AiErrorCode)
        : null
  // S-15 "돌아가기": 재추출 성공 뒤에만
  const back = hasRequirements && !lockedCause && !previewFail ? returnLink(id, one(sp.from), one(sp.draft)) : null

  const slot =
    hasRequirements && !previewFail && state !== "ai-locked" && state !== "raw-saved" && state !== "raw-unknown-cause" && state !== "wait-jd" && state !== "ai-sync" ? null : notStarted ? (
      <RunExtraction applicationProjectId={id} unknownFailure={unknownFailure} />
    ) : emptySuccess && jd.raw_text_lock === "jd_has_results" ? (
      <JdLockedNotice cause="not_a_jd" hasResults />
    ) : failCode && failCode !== "canceled" ? (
      // C-20 block in the 요건 영역 ("채용 공고가 아닌 텍스트로 보여요"는 error_code = 'not_a_jd'일 때만)
      <ExtractionFailed applicationProjectId={id} code={failCode} job={job} previewRefusal={previewRetryRefusal(state)} rerunnable={!emptySuccess} />
    ) : running ? (
      <>
        <AutoRefresh active={state !== "wait-jd" && state !== "ai-sync"} />
        {/* AI-01 동기 · ST-AI-SYNC — v5.3 S-15: "공고 요건 정리 중" */}
        <Card className="gap-4 p-5" aria-busy="true">
          <ExtractingLine already={!startedHere && state !== "wait-jd" && state !== "ai-sync"} />
          <TextSkeleton lines={4} />
        </Card>
      </>
    ) : null

  return (
    <div className="mx-auto max-w-6xl space-y-8">
      <PageCrumbs
        items={[{ label: "자기소개서 관리", href: routes.applications() }, { label: name, href: routes.application(id) }, { label: "JD·요건" }]}
        applicationProjectId={id}
      />
      <PageHeader
        title="JD·요건"
        description={
          hasRequirements
            ? "AI가 공고에서 주요 업무·자격요건·우대사항·기술 키워드를 정리했어요. 요건마다 공고 원문 문장이 연결돼 있어요"
            : // [UI-가정] 요건 정리 전 설명
              "공고 원문을 보관하고 있어요. 요건은 AI가 정리해 드려요"
        }
      />
      {state === "loading" ? (
        <ListSkeleton rows={5} />
      ) : state === "error" || state === "unauth" ? (
        <ErrorState kind={state === "unauth" ? "unauth" : "error"} />
      ) : (
        <div className="space-y-6">
          {notJd && !slot ? (
            <Alert variant="warning">
              <TriangleAlert aria-hidden />
              <AlertTitle className="font-normal">채용 공고가 아닌 텍스트로 보여요. 요건이 정확하지 않을 수 있어요</AlertTitle>
            </Alert>
          ) : null}
          {lockedCause ? <JdLockedNotice cause={lockedCause} /> : null}
          {back ? (
            <Button asChild variant="outline" size="sm">
              <Link href={back.href}>
                <ArrowLeft aria-hidden />
                {back.label}
              </Link>
            </Button>
          ) : null}
          <JdRawEditProvider
            key={state ?? "stored"}
            editable={editable}
            initialEditing={state === "raw-edit" || state === "raw-save-failed" || state === "raw-save-refused" || one(sp.edit) === "1"}
            initialSaved={state === "raw-saved"}
          >
            <JdView
              applicationProjectId={id}
              previewSave={previewSave}
              rawText={jd.raw_text}
              sentences={jd.sentences}
              requirements={jd.requirements}
              techKeywords={jd.tech_keywords}
              seniority={jd.extraction?.seniority?.label ?? null}
              requirementsSlot={slot}
            />
          </JdRawEditProvider>
        </div>
      )}
    </div>
  )
}
