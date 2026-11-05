import { notFound, redirect } from "next/navigation"
import { CardGridSkeleton, ErrorState } from "@/components/common/state-views"
import { PageCrumbs } from "@/components/common/shell/breadcrumbs"
import { ResultView } from "@/components/interviews/result-view"
import { getApplicationProject, getJobDescription } from "@/lib/data/applications"
import { getLatestJobFor } from "@/lib/data/ai-jobs"
import { getEvidenceForOwners } from "@/lib/data/evidence"
import { getInterviewSession, listInterviewSessions, type InterviewSessionDetail } from "@/lib/data/interviews"
import { buildGradingFacts, gradingDecision, isInputCausedGrading } from "@/lib/data/interview-grading"
import { applicationDisplayName } from "@/lib/data/labels"
import { APPLICATION_DELETED_BADGE, DELETED_APPLICATION_SEGMENT, SCORE_MAX_DEFAULT } from "@/lib/data/interview-session-view"
import { previewErrorCode, type PreviewState } from "@/lib/preview-state"
import { routes } from "@/lib/routes"
import { getAiConnection } from "@/lib/data/ai-connection"
import type { AiErrorCode } from "@/types/db"

/**
 * S-22 면접 결과 화면 (shared by `/applications/[id]/interview/[sessionId]/result` and, for 자기소개서 삭제됨
 * sessions, `/interviews/[sessionId]/result`). Server component; the page resolves `?state=` and redirects.
 * S-22 면접 결과. Sessions not yet submitted go back to S-33.
 * ?state=: loading · error · unauth · not-found · ai-pending · scored (C-17 scored 분기 미리보기, 임의 값) ·
 * empty / no-answers (응답 0개 → not_scored) · BYOK: ai-locked (다시 채점 → C-18 inline) · key-invalid ·
 * key-check · key-missing (ST-AI-KEY-MISSING) · C-20: ai-failed / -timeout / -rate-limited / -daily-quota /
 * -billing / -key-invalid / -model / -provider / -input-rejected (채점 실패 + 다시 채점) ·
 * v5.3: regrading (다시 채점 진행 · 이전 종합 흐리게) · no-failures (완료 · 버튼 없음) · consent-required ·
 * input-failed (= grading-input-only).
 * 04 §2.7.1 판정표: grading-regrade · grading-summary-only (종합 평가 다시 정리) · grading-summary-input ·
 * grading-input-only · grading-mixed (입력 원인 + 다른 원인) · grading-completed-regrade · grading-completed-input.
 * v5.13 OD-I1·I2: scored (d14.v1 "{n}점 / 100") · pending-method (점수 산정 방식 준비 중 · 항목 등급·다음 연습 숨김) ·
 * empty / no-answers (모든 질문 미응답 → 0점 / 100 "답변이 없어 0점이에요") · not-scored (응답 있음 + 모두 채점 실패).
 * OD-I6: application-deleted (이 세션을 "자기소개서 삭제됨" 읽기 전용으로). 실제 삭제된 세션은 U36-1
 * `/interviews/{sessionId}/result` (모의 면접 메뉴 아래, routes.interviewDeletedResult).
 * 미리보기는 저장소를 바꾸지 않는다 (다시 채점 없음, 표식 유지).
 */
export interface ResultScreenProps {
  /** null = 자기소개서 삭제됨 session (U36-1 route) */
  applicationProjectId: string | null
  sessionId: string
  state: PreviewState | null
}

/** Re-run the shared decision on a previewed session, so previews can't drift from S-22's real logic */
function withGrading(s: InterviewSessionDetail, summaryErrorCode: AiErrorCode | null): InterviewSessionDetail {
  const answers = s.questions
    .filter((q) => q.answer?.status === "submitted")
    .map((q) => ({ evaluation_status: q.evaluation?.status ?? null, error_code: q.evaluation?.error_code ?? null }))
  const facts = buildGradingFacts(s.status, answers, summaryErrorCode)
  return { ...s, failed_answer_count: facts.regrade_target_count, grading: gradingDecision(facts) }
}

/** The previewed row of each answer: "ok" 평가 성공 / failed with that cause (null = 원인 모름, 다시 채점 대상) */
function setEvaluations(s: InterviewSessionDetail, outcome: (index: number) => "ok" | AiErrorCode | null): InterviewSessionDetail {
  const donor = s.questions.find((q) => q.evaluation?.status === "succeeded")?.evaluation ?? s.questions.find((q) => q.evaluation)?.evaluation ?? null
  return {
    ...s,
    questions: s.questions.map((q, i) => {
      if (q.answer?.status !== "submitted") return q
      const r = outcome(i)
      const base = q.evaluation ?? donor
      if (!base) return q
      const evaluation =
        r === "ok"
          ? { ...base, status: "succeeded" as const, error_code: null, result: base.result ?? donor?.result ?? null }
          : { ...base, status: "failed" as const, error_code: r, result: null }
      return {
        ...q,
        evaluation,
        evaluation_error: r === "ok" || r === null ? null : { error_code: r, provider: "gemini" as const, retry_after: null, quota_resets_at: null },
        answer: { ...q.answer, score_status: r === "ok" ? ("pending_method" as const) : ("not_scored" as const) },
      }
    }),
  }
}

/** Preview-only overrides of the stored score slots (values are illustrative; the server computes d14.v1). */
function previewSession(s: InterviewSessionDetail, state: PreviewState | null): InterviewSessionDetail {
  const failedShell = { status: "evaluation_failed" as const, score_status: null, feedback: null }
  const doneShell = { status: "completed" as const, score_status: "pending_method" as const }
  switch (state) {
    case "grading-regrade":
      return withGrading(setEvaluations({ ...s, ...failedShell }, (i) => (i === 0 ? "ok" : null)), "provider_unavailable")
    case "grading-summary-only":
      return withGrading(setEvaluations({ ...s, ...failedShell }, () => "ok"), "provider_unavailable")
    case "grading-summary-input":
      return withGrading(setEvaluations({ ...s, ...failedShell }, () => "ok"), "input_too_long")
    case "grading-input-only":
    case "input-failed":
      return withGrading(setEvaluations({ ...s, ...failedShell }, () => "input_too_long"), "input_too_long")
    case "grading-mixed":
      return withGrading(setEvaluations({ ...s, ...failedShell }, (i) => (i === 0 ? "safety_blocked" : i === 1 ? "ok" : null)), "provider_unavailable")
    case "grading-completed-regrade":
      return withGrading(setEvaluations({ ...s, ...doneShell }, (i) => (i === 0 ? null : "ok")), null)
    case "grading-completed-input":
      return withGrading(setEvaluations({ ...s, ...doneShell }, (i) => (i === 0 ? "safety_blocked" : "ok")), null)
  }
  if (state === "scored")
    return {
      ...s,
      status: "completed",
      score_status: "scored",
      score_value: 72,
      score_max: SCORE_MAX_DEFAULT,
      score_method_version: "d14.v1",
      score_counted_count: s.question_count,
      score_rationale: "미리보기용 값이에요. 질문 점수의 평균이고 미응답 질문은 0점으로 들어가요.",
      questions: s.questions.map((q) =>
        q.answer && q.answer.status === "submitted"
          ? { ...q, answer: { ...q.answer, score_status: "scored", score_value: 72, score_max: SCORE_MAX_DEFAULT } }
          : q.answer?.status === "unanswered"
            ? { ...q, answer: { ...q.answer, score_status: "unanswered", score_value: 0, score_max: SCORE_MAX_DEFAULT } }
            : q,
      ),
    }
  // OD-I2: before the formula / backfill every slot is pending_method → criteria grades and 다음 연습 hidden
  if (state === "pending-method")
    return {
      ...s,
      status: "completed",
      score_status: "pending_method",
      score_value: null,
      score_max: null,
      score_rationale: null,
      questions: s.questions.map((q) =>
        q.answer?.status === "submitted" ? { ...q, answer: { ...q.answer, score_status: "pending_method", score_value: null, score_max: null } } : q,
      ),
    }
  // R-OD-3: answers exist but none could be graded → "점수를 계산하지 못했어요"
  if (state === "not-scored")
    return {
      ...setEvaluations({ ...s, status: "completed" }, () => null),
      score_status: "not_scored",
      score_value: null,
      score_max: null,
      score_rationale: null,
    }
  // OD-I1 / R-OD-3: every question unanswered → scored 0 / 100 + "답변이 없어 0점이에요"
  if (state === "empty" || state === "no-answers")
    return {
      ...s,
      status: "completed",
      score_status: "scored",
      score_value: 0,
      score_max: SCORE_MAX_DEFAULT,
      score_method_version: "d14.v1",
      score_rationale: null,
      score_counted_count: s.question_count,
      unanswered_count: s.question_count,
      answered_count: 0,
      feedback: null,
      questions: s.questions.map((q) => ({
        ...q,
        evaluation: null,
        evaluation_error: null,
        answer: q.answer ? { ...q.answer, answer_text: "", status: "unanswered", score_status: "unanswered", score_value: 0, score_max: SCORE_MAX_DEFAULT } : null,
      })),
    }
  if (state === "ai-pending")
    return {
      ...s,
      status: "evaluating",
      score_status: null,
      feedback: null,
      questions: s.questions.map((q, i) => (i === 0 ? q : { ...q, evaluation: null })),
    }
  // v5.3 A9 다시 채점 진행: C-03 + 이전 종합 흐리게 ("종합 평가를 다시 정리하는 중")
  if (state === "regrading")
    return {
      ...s,
      status: "evaluating",
      score_status: null,
      completed_at: null,
      result_viewed_at: null,
      feedback: s.feedback ? { ...s.feedback, status: "pending" } : null,
      questions: s.questions.map((q, i) => (i === 0 ? q : { ...q, evaluation: null })),
    }
  // ST-AI-KEY-MISSING: the key was deleted while grading → the grading job ended (answers kept).
  // A9 "실패한 답변 {n}개": every submitted answer after the first ends without an evaluation.
  if (state?.startsWith("ai-failed") || state === "key-missing") {
    const code = previewErrorCode(state)
    if (isInputCausedGrading(code)) return withGrading(setEvaluations({ ...s, ...failedShell }, () => code), code)
    return withGrading(setEvaluations({ ...s, ...failedShell }, (i) => (i === 0 ? "ok" : code)), code)
  }
  // A9: completed with no failed answer → no 다시 채점 button. UQ-554: failed answers borrow a
  // succeeded evaluation of the same session (preview only); without one they are left out.
  if (state === "no-failures") {
    const donor = s.questions.find((q) => q.evaluation?.status === "succeeded")?.evaluation ?? null
    const failedQ = (q: InterviewSessionDetail["questions"][number]) => q.answer?.status === "submitted" && q.evaluation?.status !== "succeeded"
    const questions = donor
      ? s.questions.map((q) =>
          failedQ(q)
            ? {
                ...q,
                evaluation_error: null,
                evaluation: { ...donor, id: `${donor.id}-${q.id}`, answer_id: q.answer!.id },
                answer: q.answer ? { ...q.answer, score_status: "pending_method" as const } : null,
              }
            : q,
        )
      : s.questions.filter((q) => !failedQ(q))
    return withGrading(
      {
        ...s,
        status: "completed",
        score_status: s.score_status ?? "pending_method",
        feedback: s.feedback?.result ? { ...s.feedback, status: "succeeded" } : s.feedback,
        questions,
      },
      null,
    )
  }
  return s
}

export async function ResultScreen({ applicationProjectId, sessionId, state }: ResultScreenProps) {
  // OD-I6 / U36-1: null = a kept session of a deleted 자기소개서 (/interviews/{sessionId}/result). ?state=application-deleted
  // previews any live session that way.
  const deletedRoute = applicationProjectId === null
  const id = applicationProjectId ?? DELETED_APPLICATION_SEGMENT
  const ap = deletedRoute ? null : await getApplicationProject(id)
  if (!deletedRoute && !ap) notFound()
  const deleted = deletedRoute || state === "application-deleted"
  const stored = deletedRoute ? await getInterviewSession(DELETED_APPLICATION_SEGMENT, sessionId) : null
  if (deletedRoute && !stored) notFound()
  const name = ap ? applicationDisplayName(ap.name, ap.name_source, ap.created_at) : stored!.application_name
  // 02 S-22 "자기소개서 삭제됨": 이동 경로 첫 마디는 "모의 면접"(S-37), 자기소개서로 가는 링크 없음
  const crumbs = deleted ? (
    <PageCrumbs items={[{ label: "모의 면접", href: routes.interviews() }, { label: `${name} · ${APPLICATION_DELETED_BADGE}` }, { label: "면접 결과" }]} />
  ) : (
    <PageCrumbs
      items={[
        { label: "자기소개서 관리", href: routes.applications() },
        { label: name, href: routes.application(id) },
        { label: "면접 준비", href: routes.interviewPrep(id) },
        { label: "면접 결과" },
      ]}
      applicationProjectId={id}
    />
  )

  if (state === "loading")
    return (
      <div className="mx-auto max-w-[42rem] space-y-6">
        {crumbs}
        <CardGridSkeleton cards={3} />
      </div>
    )
  if (state === "error" || state === "unauth")
    return (
      <div className="mx-auto max-w-[42rem]">
        {crumbs}
        <ErrorState kind={state === "unauth" ? "unauth" : "error"} />
      </div>
    )

  const latestJob = await getLatestJobFor("interview_session", sessionId) // advances the evaluation job
  const loaded = stored ?? (await getInterviewSession(id, sessionId))
  if (!loaded) notFound()
  if (!loaded.submitted_at && !state && !deletedRoute) redirect(routes.interviewSession(id, sessionId))
  const previewed = previewSession(loaded, state)
  const session: InterviewSessionDetail = deleted && !previewed.application_deleted ? { ...previewed, application_deleted: true } : previewed

  const evalIds = session.questions.flatMap((q) => (q.evaluation ? [q.evaluation.id] : []))
  const [evidence, jd, siblings] = await Promise.all([
    getEvidenceForOwners("answer_evaluation", evalIds),
    // OD-I6: the JD went with the 자기소개서 (and the method comparison has no siblings to read)
    deleted ? null : getJobDescription(id),
    deleted ? [] : listInterviewSessions({ application_project_id: id }),
  ])
  const weakRequirements = (jd?.requirements ?? [])
    .filter((r) => session.weak_requirement_ids.includes(r.id))
    .map((r) => ({ id: r.id, content: r.content }))
  // [UI-가정] "지난 세션과 방식이 다르면": 가장 최근의 다른 채점 세션과 score_method_version 비교
  const previous = siblings.find((s) => s.id !== session.id && s.score_method_version && s.created_at < session.created_at)
  const methodChanged = Boolean(
    session.score_method_version && previous?.score_method_version && previous.score_method_version !== session.score_method_version,
  )
  const job = latestJob?.job_type === "interview_evaluation" ? latestJob : null

  return (
    <>
      {crumbs}
      {/* UQ-324: server ai_connection so AI buttons are right on the first render */}
      <ResultView
        serverConnection={await getAiConnection()}
        applicationProjectId={deletedRoute ? "" : id}
        applicationName={name}
        session={session}
        evidence={evidence}
        weakRequirements={weakRequirements}
        job={job}
        methodChanged={methodChanged}
        preview={{ pending: state === "ai-pending" || state === "regrading", failed: previewErrorCode(state), active: Boolean(state) }}
      />
    </>
  )
}
