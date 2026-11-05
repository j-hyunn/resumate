import { notFound, redirect } from "next/navigation"
import { ScreenSuspense } from "@/components/common/screen-suspense"
import { ErrorState, FormSkeleton } from "@/components/common/state-views"
import { PageCrumbs } from "@/components/common/shell/breadcrumbs"
import { AnswerSheet } from "@/components/interviews/answer-sheet"
import { getApplicationProject, getJobDescription } from "@/lib/data/applications"
import { getLatestJobFor } from "@/lib/data/ai-jobs"
import { getInterviewSession } from "@/lib/data/interviews"
import { getEvidenceForOwners } from "@/lib/data/evidence"
import { applicationDisplayName } from "@/lib/data/labels"
import { isDeletedApplicationSegment } from "@/lib/data/interview-session-view"
import { getPreviewState, previewErrorCode, previewRetryRefusal } from "@/lib/preview-state"
import { routes } from "@/lib/routes"
import { getAiConnection } from "@/lib/data/ai-connection"

/**
 * S-33 면접 답변지. Submitted sessions go to S-22 (02 S-33 "제출 후: S-22로").
 * ?state=: loading · error · unauth · not-found · ai-pending · save-failed · BYOK: ai-locked (제출 → C-18
 * inline, 답변·자동 저장은 그대로) · key-invalid (제출 → C-20 key_invalid) · key-check · key-missing
 * (ST-AI-KEY-MISSING in the 생성 영역) · C-20 질문 생성 실패: ai-failed / -input / -timeout / -rate-limited /
 * -daily-quota / -billing / -key-invalid / -model / -provider / -input-rejected · ai-waiting (대기 줄).
 * v5.3: abandoned (그만둔 세션 읽기 전용, A8) · questions-partial (일부 생성 실패 → 남은 질문 다시 만들기) ·
 * input-failed (입력 원인 → 다시 시도 없음) · insufficient (insufficient_data 생성 실패 → 면접 준비로) · consent-required · retry-other-provider ·
 * retry-refused-* / retry-connection-changed / retry-not-retryable (전체 실패 같은 행 다시 시도 거부).
 * Q53-9: input-failed / ai-failed-input → "공고 원문 고치기" (S-15) · input-failed-has-requirements → "공고 확인하기" ·
 * abandoned-no-questions · raw-edited-stale / raw-edited-no-job (S-15 "이전 실패 안내"). 미리보기는 저장소를 바꾸지 않는다.
 * OD-I6: /applications/deleted/interview/[sessionId] (자기소개서 삭제됨, [UI-가정] 라우트) → S-22.
 */
type Props = {
  params: Promise<{ id: string; sessionId: string }>
  searchParams: Promise<Record<string, string | string[] | undefined>>
}

export default function Page({ params, searchParams }: Props) {
  return (
    <ScreenSuspense>
      <Screen params={params} searchParams={searchParams} />
    </ScreenSuspense>
  )
}

async function Screen({ params, searchParams }: Props) {
  const { id, sessionId } = await params
  const state = getPreviewState(await searchParams)
  if (state === "not-found") notFound()
  // 02 S-33 v5.13 OD-I6: a kept session of a deleted 자기소개서 is completed → always S-22 (read-only)
  if (isDeletedApplicationSegment(id)) redirect(routes.interviewResult(id, sessionId))

  const ap = await getApplicationProject(id)
  if (!ap) notFound()
  const name = applicationDisplayName(ap.name, ap.name_source, ap.created_at)
  const crumbs = (
    <PageCrumbs
      items={[
        { label: "기업 JD 관리", href: routes.applications() },
        { label: name, href: routes.application(id) },
        { label: "면접 준비", href: routes.interviewPrep(id) },
        { label: "면접 답변지" },
      ]}
      applicationProjectId={id}
    />
  )

  if (state === "loading")
    return (
      <div className="mx-auto max-w-[42rem] space-y-6">
        {crumbs}
        <FormSkeleton fields={3} />
      </div>
    )
  if (state === "error" || state === "unauth")
    return (
      <div className="mx-auto max-w-[42rem]">
        {crumbs}
        <ErrorState kind={state === "unauth" ? "unauth" : "error"} />
      </div>
    )

  // advance the AI-05 job first so questions produced so far are written
  const latestJob = await getLatestJobFor("interview_session", sessionId)
  const stored = await getInterviewSession(id, sessionId)
  if (!stored) notFound()
  if (stored.submitted_at && !state) redirect(routes.interviewResult(id, sessionId))
  const job = latestJob?.job_type === "interview_questions" ? latestJob : null
  const partial = state === "questions-partial"
  // preview-only overrides: A8 그만둔 세션 / 일부 질문만 저장된 생성 실패
  const session =
    state === "abandoned"
      ? { ...stored, status: "abandoned" as const, submitted_at: null, abandoned_at: stored.abandoned_at ?? stored.last_activity_at }
      : state === "abandoned-no-questions"
        ? { ...stored, status: "abandoned" as const, submitted_at: null, abandoned_at: stored.abandoned_at ?? stored.last_activity_at, questions: [] }
        : partial
          ? { ...stored, generation_status: "failed" as const, questions: stored.questions.slice(0, Math.max(1, Math.floor(stored.question_count / 2))) }
          : state === "generation-canceled"
            ? { ...stored, generation_status: "failed" as const, questions: [] }
            : stored
  // UQ-550: `insufficient` → question generation ended with insufficient_data (no retry, → S-20)
  const fail =
    partial ? "schema_invalid" : state === "insufficient" ? "insufficient_data" : state === "input-failed-has-requirements" ? "input_too_long" : previewErrorCode(state)
  const jd = await getJobDescription(id)
  const hasRequirements = state === "input-failed-has-requirements" || (state !== "input-failed" && (jd?.requirements.length ?? 0) > 0)
  // 02 S-33 v5.3: question evidence chips (owner interview_question) before submit too
  const evidence = await getEvidenceForOwners(
    "interview_question",
    session.questions.map((q) => q.id),
  )

  return (
    <>
      {crumbs}
      {/* UQ-324: server ai_connection so AI buttons are right on the first render */}
      <AnswerSheet
        serverConnection={await getAiConnection()}
        applicationProjectId={id}
        applicationName={name}
        initialSession={session}
        initialJob={job}
        initialEvidence={evidence}
        jd={{ has_requirements: hasRequirements, raw_text_edited_at: jd?.raw_text_edited_at ?? null }}
        preview={{
          generating: state === "ai-pending" || state === "ai-waiting",
          waiting: state === "ai-waiting",
          stale: state === "raw-edited-stale" ? "edited" : state === "raw-edited-no-job" ? "no_job" : null,
          failed: fail,
          saveFail: state === "save-failed",
          refusal: previewRetryRefusal(state),
          otherProvider: state === "retry-other-provider",
          canceled: state === "generation-canceled",
        }}
      />
    </>
  )
}
