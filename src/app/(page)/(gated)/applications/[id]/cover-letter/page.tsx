import { notFound } from "next/navigation"
import { ScreenSuspense } from "@/components/common/screen-suspense"
import { PageShellSkeleton } from "@/components/common/shell/page-shell-skeleton"
import { getPreviewState, previewErrorCode } from "@/lib/preview-state"
import { getApplicationProject, getJobDescription } from "@/lib/data/applications"
import { getCoverLetterDocument } from "@/lib/data/cover-letters"
import { getCoverLetterChat, listCoverLetterChats } from "@/lib/data/cover-letter-chats"
import { getEvidence } from "@/lib/data/evidence"
import { CoverLetterScreen, type CoverLetterTab } from "@/components/applications/cover-letter/cover-letter-screen"
import { JdTab } from "@/components/applications/cover-letter/jd-tab"
import { InsightTab } from "@/components/applications/cover-letter/insight-tab"
import { extractFirstPreviewFail, jdRunState } from "@/app/(dashboard)/(gated)/applications/_lib/jd-state"

/**
 * S-46 자기소개서 작성 — **한 주소 두 상태** (UX v5.20 S-46, CF-A11).
 * `/applications/{id}/cover-letter[?tab=jd|insight][&chat=][&edit=1&from=&cause=]`
 *
 * 세 탭의 데이터를 **한 번에** 읽어 클라이언트로 넘긴다 — 탭을 주소 이동으로 바꾸면 서버가 다시
 * 렌더되어 저장하지 않은 제목·본문이 사라지기 때문이다(CF-A12 "탭을 옮겨도 폼을 잃지 않는다").
 * 탭 전환은 클라이언트 상태이고 주소는 `replaceState`로만 맞춘다.
 *
 * `?state=`:
 * - 문항 설정 상태: `questions` · `questions-invalid` · `questions-max` · `extracting` ·
 *   `extract-failed` · `extract-failed-input` · `extract-failed-wait`
 * - 작성 상태: `writing` · `empty-answers` · `save-failed` · `save-conflict` ·
 *   `too-many-questions` · `not-found` · `unauth` · `loading` · `error`
 * - 탭: `?tab=jd` / `?tab=insight`는 S-15·S-16의 기존 키(`raw-edit` · `raw-save-failed` ·
 *   `raw-saved` · `raw-editable` · `raw-has-requirements` · `ai-*` · `insufficient*` …)를 그대로 쓴다
 */
type Props = { params: Promise<{ id: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> }

export default function Page({ params, searchParams }: Props) {
  return (
    <ScreenSuspense fallback={<PageShellSkeleton />}>
      <Screen params={params} searchParams={searchParams} />
    </ScreenSuspense>
  )
}

const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v)

function parseRange(v: string | undefined): { start: number; end: number } | null {
  if (!v) return null
  const [a, b] = v.split("-", 2).map(Number)
  return Number.isFinite(a) && Number.isFinite(b) ? { start: a, end: b } : null
}

async function Screen({ params, searchParams }: Props) {
  const { id } = await params
  const sp = await searchParams
  const state = getPreviewState(sp)
  if (state === "not-found") notFound()

  const ap = await getApplicationProject(id)
  if (!ap) notFound()

  const [jd, docRow] = await Promise.all([getJobDescription(id), getCoverLetterDocument(id)])
  // 미리 보기: `questions*`는 정본 행을 무시하고 문항 설정 상태를 그린다 / `writing`은 그 반대가 없다
  const document = state?.startsWith("questions") || state === "extracting" || state?.startsWith("extract-failed") ? null : docRow
  const evidence = document ? await getEvidence("application_document", document.id) : {}
  // 패널 — 대화 기록 목록과 `?chat=`으로 연 대화. 읽기 계약이 없는 real 경로에서는 목록이 비고
  // 이번 방문에 시작한 대화만 패널이 들고 있다 (보고서 "백엔드 요청")
  const chatIdParam = one(sp.chat)
  const chats = document ? await listCoverLetterChats(id) : []
  // `?chat=`이 다른 지원 건의 대화면 열지 않는다(UQ-758) — 대화 없이 화면은 정상으로 연다.
  // 이 `catch → null`은 **대화**에만 있다. 정본 읽기(`getCoverLetterDocument`)에는 두지 않는다
  const openChat = chatIdParam ? await getCoverLetterChat(chatIdParam, id).catch(() => null) : null

  const tabParam = one(sp.tab)
  const initialTab: CoverLetterTab = tabParam === "jd" ? "jd" : tabParam === "insight" ? "insight" : "cover_letter"
  const run = jdRunState(jd, state)

  return (
    <CoverLetterScreen
      data={{
        application_project_id: id,
        name: ap.name,
        name_source: ap.name_source,
        created_at: ap.created_at,
        deadline: ap.deadline,
        position_title: jd?.position_title ?? null,
        source_url: jd?.source_url ?? null,
        document,
        evidence,
        // 키가 있고 요건이 아직 없을 때만 [자기소개서 작성 시작]이 AI-01을 먼저 돌린다 (FL-03)
        extract_first: run.extractFirst,
        chats,
        open_chat: openChat,
        preview: { state, extractFail: extractFirstPreviewFail(state) ?? previewErrorCode(state) },
      }}
      initialTab={initialTab}
      jdTab={<JdTab applicationProjectId={id} searchParams={sp} />}
      insightTab={<InsightTab applicationProjectId={id} searchParams={sp} />}
      highlight={
        one(sp.slot) && parseRange(one(sp.range))
          ? { slot: one(sp.slot) as string, ...(parseRange(one(sp.range)) as { start: number; end: number }) }
          : null
      }
    />
  )
}
