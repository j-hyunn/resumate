import Link from "next/link"
import { ArrowLeft, TriangleAlert } from "lucide-react"
import { Alert, AlertTitle } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"
import { Card } from "@/components/ui/card"
import { TextSkeleton } from "@/components/common/state-views"
import { JdLockedNotice, JdRawEditProvider } from "@/components/applications/jd-raw-edit"
import { ExtractingLine, ExtractionFailed, JdView, RunExtraction } from "@/components/applications/jd-view"
import { AutoRefresh } from "@/components/applications/shared"
import { getJobDescription } from "@/lib/data/applications"
import { getAiJob } from "@/lib/data/ai-jobs"
import { isInputCausedJdFailure } from "@/lib/data/jd-raw-text"
import { getPreviewState, previewErrorCode, previewRetryRefusal } from "@/lib/preview-state"
import { routes } from "@/lib/routes"
import type { AiErrorCode } from "@/types/db"

/**
 * S-46 **"채용 공고" 탭** = S-15 규칙 그대로 (v5.20 재정의, CF-7·CF-A12 — ID 유지).
 * 옛 `/applications/{id}/jd` 페이지의 판정을 그대로 옮겼고 바뀐 것은 세 가지다:
 * - 화면 머리(`PageHeader`)·이동 경로를 그리지 않는다 — S-46 머리가 하나뿐이다.
 * - 공고 원문 패널 머리에 `source_url`이 있으면 "원래 공고 열기"가 붙는다 (CF-A16).
 * - "돌아가기"는 **{인사이트 / 자소서} 탭으로** 간다(`?from=insight|cover_letter`, CF-A12).
 *
 * 공고 원문 수정(Q53-2·Q53-11)의 "저장"/"취소"는 **탭 안의 버튼**이고 상단 바 "저장하기"와 섞지 않는다.
 */
type SP = Record<string, string | string[] | undefined>

const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v)

/** "{인사이트 / 자소서} 탭으로 돌아가기" (v5.20, CF-A12) */
function returnLabel(from: string | undefined): string | null {
  if (from === "insight") return "인사이트 탭으로 돌아가기"
  if (from === "cover_letter") return "자소서 탭으로 돌아가기"
  return null
}

export async function JdTab({ applicationProjectId: id, searchParams: sp }: { applicationProjectId: string; searchParams: SP }) {
  const state = getPreviewState(sp)
  // UQ-530: 다른 경로가 추출 중이면 "이미 정리하고 있어요", 이 탭에서 시작했으면 "공고 요건 정리 중"
  const startedHere = one(sp.extracting) === "self"
  const jd = await getJobDescription(id)
  if (!jd) return <p className="text-sm text-muted-foreground">공고를 찾을 수 없어요</p>

  // Q53-2 미리 보기는 저장소를 바꾸지 않는다
  const rawPreview = state === "raw-editable" || state === "raw-edit" || state === "raw-save-failed" || state === "raw-save-refused" || state === "raw-saved"
  const previewSave = state === "raw-save-failed" ? "failed" : state === "raw-save-refused" ? "refused" : rawPreview ? "ok" : null
  const previewFail: AiErrorCode | null = rawPreview && state !== "raw-saved" ? "not_a_jd" : previewErrorCode(state)
  const job = jd.extraction_status === "failed" && jd.extraction_job_id ? await getAiJob(jd.extraction_job_id) : null
  // "원인을 알 수 없는 실패": 실패 기록이 정리됐다 (DM 2.6.1) → 수정 버튼 없음, "요건 정리하기"만
  const unknownFailure = state === "raw-unknown-cause" || (!previewFail && !rawPreview && jd.extraction_status === "failed" && !job?.error_code)
  // Q53-11: 추출은 됐는데 요건이 0개 → not_a_jd 문구 + 공고 원문 고치기
  const emptySuccess = !state && jd.extraction_status === "succeeded" && jd.requirements.length === 0
  const failCode = previewFail ?? (emptySuccess ? "not_a_jd" : jd.extraction_status === "failed" && !unknownFailure ? (job?.error_code ?? null) : null)
  const notStarted =
    state === "ai-locked" ||
    state === "raw-saved" ||
    unknownFailure ||
    (jd.extraction_status === "pending" && !jd.extraction_job_id && state !== "wait-jd" && state !== "ai-sync")
  const running = !notStarted && (state === "wait-jd" || state === "ai-sync" || jd.extraction_status === "running" || jd.extraction_status === "pending")
  const notJd = jd.extraction?.is_likely_jd === false
  const hasRequirements = jd.requirements.length > 0 && jd.extraction_status === "succeeded"
  const editable = rawPreview ? state !== "raw-saved" && one(sp.refused) !== "1" : !unknownFailure && jd.raw_text_editable
  // Q53-9 "요건이 있는 공고": 입력 원인 실패로 왔는데 요건이 있으면 읽기 전용 + 안내
  const causeParam = one(sp.cause)
  const lockedCause: AiErrorCode | null =
    state === "raw-has-requirements"
      ? "input_too_long"
      : hasRequirements && isInputCausedJdFailure(causeParam as AiErrorCode)
        ? (causeParam as AiErrorCode)
        : null
  const back = hasRequirements && !lockedCause && !previewFail ? returnLabel(one(sp.from)) : null

  const slot =
    hasRequirements && !previewFail && state !== "ai-locked" && state !== "raw-saved" && state !== "raw-unknown-cause" && state !== "wait-jd" && state !== "ai-sync" ? null : notStarted ? (
      <RunExtraction applicationProjectId={id} unknownFailure={unknownFailure} />
    ) : emptySuccess && jd.raw_text_lock === "jd_has_results" ? (
      <JdLockedNotice cause="not_a_jd" hasResults />
    ) : failCode && failCode !== "canceled" ? (
      <ExtractionFailed applicationProjectId={id} code={failCode} job={job} previewRefusal={previewRetryRefusal(state)} rerunnable={!emptySuccess} />
    ) : running ? (
      <>
        <AutoRefresh active={state !== "wait-jd" && state !== "ai-sync"} />
        <Card className="gap-4 p-5" aria-busy="true">
          <ExtractingLine already={!startedHere && state !== "wait-jd" && state !== "ai-sync"} />
          <TextSkeleton lines={4} />
        </Card>
      </>
    ) : null

  return (
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
          <Link href={routes.coverLetter(id, one(sp.from) === "insight" ? { tab: "insight" } : undefined)}>
            <ArrowLeft aria-hidden />
            {back}
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
          sourceUrl={jd.source_url ?? null}
          requirementsSlot={slot}
        />
      </JdRawEditProvider>
    </div>
  )
}
