import { notFound } from "next/navigation"
import { ScreenSuspense } from "@/components/common/screen-suspense"
import { PageShellSkeleton } from "@/components/common/shell/page-shell-skeleton"
import { getPreviewState } from "@/lib/preview-state"
import { getApplicationProject, getInsightState, getJobDescription } from "@/lib/data/applications"
import { COVER_LETTER_MAX_QUESTIONS } from "@/lib/data/cover-letter-defaults"
import { getCoverLetterDocument } from "@/lib/data/cover-letters"
import { getCoverLetterChat, listCoverLetterChats } from "@/lib/data/cover-letter-chats"
import { getEvidence } from "@/lib/data/evidence"
import { CoverLetterScreen, type CoverLetterTab } from "@/components/applications/cover-letter/cover-letter-screen"
import { JdTab } from "@/components/applications/cover-letter/jd-tab"
import { InsightTab } from "@/components/applications/cover-letter/insight-tab"
import type { CoverLetterInsightState } from "@/components/applications/cover-letter/insight-notice"

/**
 * S-46 자기소개서 작성 — **한 주소 두 상태** (UX v5.20 S-46, CF-A11).
 * `/applications/{id}/cover-letter[?tab=jd|insight][&s=S3,S4][&chat=][&edit=1&from=]`
 *
 * 세 탭의 데이터를 **한 번에** 읽어 클라이언트로 넘긴다 — 탭을 주소 이동으로 바꾸면 서버가 다시
 * 렌더되어 저장하지 않은 제목·본문이 사라지기 때문이다(CF-A12 "탭을 옮겨도 폼을 잃지 않는다").
 * 탭 전환은 클라이언트 상태이고 주소는 `replaceState`로만 맞춘다.
 *
 * (v5.21, JR-3) 요건 선행 추출이 없어 [자기소개서 작성 시작]은 검증 → 저장만 한다. (JR-5·JR-6) 이 자기소개서의
 * 인사이트 상태(없음 / 만드는 중 / 있음)를 문항 설정 상태의 안내 줄과 패널 시작 영역에 넘긴다.
 *
 * `?state=`:
 * - 문항 설정 상태: `questions` · `questions-invalid` · `questions-max` · (v5.21) `questions-insight-generating`
 * - 작성 상태: `writing` · `empty-answers` · `save-failed` · `save-conflict` ·
 *   `too-many-questions` · `not-found` · `unauth` · `loading` · `error` · (v5.21) `insight-none` · `insight-generating`
 * - 탭: `?tab=jd` / `?tab=insight`는 S-15·S-16의 키(`raw-*` · `ai-*` · `insufficient*` · `schema-v1` ·
 *   `raw-text-stale` · `jd-no-sentences` …)를 쓴다
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

  const [jd, docRow, insightState] = await Promise.all([getJobDescription(id), getCoverLetterDocument(id), getInsightState(id)])
  // 미리 보기: `questions*`는 정본 행을 무시하고 문항 설정 상태를 그린다 / `writing`은 그 반대가 없다
  const document = state?.startsWith("questions") ? null : docRow
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
  // JR-6: an insight job queued / running (incl. the one the create action auto-started) reads as "만드는 중"
  const insight: CoverLetterInsightState =
    state === "insight-generating" || state === "questions-insight-generating"
      ? "generating"
      : state === "insight-none"
        ? "none"
        : ap.insight_job_id || ap.insight_state === "generating"
          ? "generating"
          : // UQ-615: only a schema-2 insight counts — AI-04 reads the latest ready `schema_version = 2` (4.24 #19), so an old
            // schema-1 insight alone reads as "없음"
            insightState.latest && (insightState.latest.schema_version ?? insightState.latest.result?.schema_version ?? 2) !== 1
            ? "ready"
            : "none"

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
        // 문항 설정 상태의 첫 문항 id는 서버에서 한 번 만든다 — 브라우저가 다시 만들면 하이드레이션이 어긋난다
        seed_question_ids: Array.from({ length: COVER_LETTER_MAX_QUESTIONS }, () => crypto.randomUUID()),
        evidence,
        insight,
        chats,
        open_chat: openChat,
        preview: { state },
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
