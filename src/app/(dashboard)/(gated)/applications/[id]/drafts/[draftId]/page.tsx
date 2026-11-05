import Link from "next/link"
import { notFound, redirect } from "next/navigation"
import { Button } from "@/components/ui/button"
import { ScreenSuspense } from "@/components/common/screen-suspense"
import { PageHeader } from "@/components/common/basics"
import { ErrorState, TextSkeleton } from "@/components/common/state-views"
import { PageCrumbs } from "@/components/common/shell/breadcrumbs"
import { DraftEditor } from "@/components/applications/draft-editor"
import { DRAFT_STATUS_LABELS, DRAFT_TYPE_LABELS } from "@/components/applications/labels"
import { getApplicationProject, getDraft, getJobDescription } from "@/lib/data/applications"
import { getEvidenceForOwners } from "@/lib/data/evidence"
import { getLatestJobFor } from "@/lib/data/ai-jobs"
import { getDataReadiness } from "@/lib/data/readiness"
import { listActiveWritingChats } from "@/lib/data/writing-chats"
import { applicationDisplayName } from "@/lib/data/labels"
import { getPreviewState, previewErrorCode } from "@/lib/preview-state"
import { routes } from "@/lib/routes"
import { getCareerSourceTree, settleAbandonedGeneration } from "@/lib/data/drafts"
import { jdRunState } from "../../../_lib/jd-state"
import { gateChatFailurePreview, gateReadinessPreview } from "../../../_lib/gate-preview"

// S-19 초안 편집기. ?generate=1|all|{sectionId} (S-17/S-18에서 진입)
// ?state=: loading · error · unauth · not-found · ai-stream · ai-failed(-input/-timeout) · ai-failed-{7원인} · key-missing · ai-locked
//   · key-invalid · key-check · insufficient · insufficient-no-experience · insufficient-key-invalid · insufficient-chat-failed · save-failed · wait-jd
//   · v5.3: consent-required · insufficient-project-fields · input-failed · request-wait (경력기술서 실패 C-20 / 자소서 실패 문항) · finalizing
type Props = { params: Promise<{ id: string; draftId: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> }

export default function Page({ params, searchParams }: Props) {
  return (
    <ScreenSuspense>
      <Screen params={params} searchParams={searchParams} />
    </ScreenSuspense>
  )
}

async function Screen({ params, searchParams }: Props) {
  const { id, draftId } = await params
  const sp = await searchParams
  const state = getPreviewState(sp)
  if (state === "not-found") notFound()
  await settleAbandonedGeneration(draftId)
  const [ap, draft] = await Promise.all([getApplicationProject(id), getDraft(id, draftId)])
  if (!ap || !draft) notFound()
  // Q53-7: a career description stopped on its first generation has no body — its settings live on S-17
  if (!state && draft.draft_type === "career_description" && draft.status === "composing") redirect(`${routes.applicationDrafts(id)}#new-draft`)
  // UQ-701 (02 S-19 실패 처리, A4): a failed career description keeps no blocks, whatever rows it left. The real
  // path leaves the `begin` section rows (heading only, `ai_content` null), so the status decides, not the row count.
  const failedCareer = draft.draft_type === "career_description" && draft.status === "failed"
  const name = applicationDisplayName(ap.name, ap.name_source, ap.created_at)
  const typeLabel = DRAFT_TYPE_LABELS[draft.draft_type]
  const crumbs = (
    <PageCrumbs
      items={[
        { label: "자기소개서 관리", href: routes.applications() },
        { label: name, href: routes.application(id) },
        { label: "서류 초안", href: routes.applicationDrafts(id) },
        { label: typeLabel },
      ]}
      applicationProjectId={id}
    />
  )
  const header = (
    <PageHeader
      title={typeLabel}
      // UQ-525: 블록 없는 실패 초안에는 편집 안내 없음
      description={
        failedCareer
          ? DRAFT_STATUS_LABELS.failed
          : `${DRAFT_STATUS_LABELS[draft.status]} · 문단을 눌러 고칠 수 있어요. 근거 칩을 누르면 원본을 볼 수 있어요`
      }
      actions={
        draft.draft_type === "cover_letter" ? (
          <Button variant="outline" size="sm" asChild>
            <Link href={routes.draftQuestions(id, draftId)}>문항 설정</Link>
          </Button>
        ) : null
      }
    />
  )
  if (state === "loading" || state === "error" || state === "unauth")
    return (
      <div className="mx-auto max-w-6xl space-y-8">
        {crumbs}
        {header}
        {state === "loading" ? <TextSkeleton lines={8} /> : <ErrorState kind={state === "unauth" ? "unauth" : "error"} />}
      </div>
    )

  const [evidence, tree, jd, baseReadiness, chats] = await Promise.all([
    getEvidenceForOwners(
      "draft_section",
      draft.sections.map((s) => s.id),
    ),
    getCareerSourceTree(),
    getJobDescription(id),
    getDataReadiness(),
    listActiveWritingChats(),
  ])
  const readiness = gateReadinessPreview(baseReadiness, state)
  const requirements: Record<string, string> = {}
  for (const r of jd?.requirements ?? []) requirements[r.id] = r.content
  const gen = Array.isArray(sp.generate) ? sp.generate[0] : sp.generate
  // v5.3 A4: a failed career description → C-20 from its job row (cause, provider, times) + "다시 시도" = 새 초안.
  // No failed job row to read (or no code on it) → the system failure copy.
  const failedJob = failedCareer ? await getLatestJobFor("draft", draftId, { jobType: "career_description" }) : null
  const storedFailure = failedCareer
    ? {
          code: (failedJob?.status === "failed" ? failedJob.error_code : null) ?? "schema_invalid",
          provider: failedJob?.provider ?? null,
          retryAfter: failedJob?.retry_after ?? null,
          quotaResetsAt: failedJob?.quota_resets_at ?? null,
        }
      : null

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      {crumbs}
      {header}
      <DraftEditor
        key={draft.id}
        applicationProjectId={id}
        applicationName={name}
        draft={draft}
        evidence={evidence}
        tree={tree}
        requirements={requirements}
        readiness={readiness}
        activeChatId={chats[0]?.id ?? null}
        {...jdRunState(jd, state)}
        gateChatFailure={gateChatFailurePreview(state)}
        autoGenerate={gen ?? null}
        storedFailure={storedFailure}
        preview={{ stream: state === "ai-stream", failed: previewErrorCode(state), failSave: state === "save-failed", finalizing: state === "finalizing", stopping: state === "stopping" }}
      />
    </div>
  )
}
