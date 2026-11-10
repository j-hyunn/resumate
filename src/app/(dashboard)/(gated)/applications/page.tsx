import type * as React from "react"
import { notFound } from "next/navigation"
import { Briefcase } from "lucide-react"
import { ScreenSuspense } from "@/components/common/screen-suspense"
import { EmptyState, ErrorState, ListSkeleton } from "@/components/common/state-views"
import { PageCrumbs } from "@/components/common/shell/breadcrumbs"
import { ApplicationList, ApplicationSortNote } from "@/components/applications/application-list"
import { AddApplicationLauncher, AddApplicationLauncherButton } from "@/components/applications/add-application-launcher"
import { getPreviewState } from "@/lib/preview-state"
import { listCoverLetters } from "@/lib/data/cover-letters"

/**
 * S-13 자기소개서 목록 (메뉴: 자기소개서 관리) — (v5.20 재작성, CF-3·CF-9·CF-A8).
 *
 * 머리 = (58 런, 시안 1) 큰 제목 없이 한 줄: 바꿀 수 없는 표기 "최근 작성 순"(칩 모양) + 주 버튼 [⊕ 자기소개서 작성]
 * (→ S-14 2단계 모달, `?new=1`). 정렬은 `created_at desc` 하나이고 정렬 선택·전형 단계 거르기·
 * 검색·"보드로 보기"는 없다(CF-9). 행 → S-46.
 *
 * `?state=`: empty · loading · error · unauth · not-found
 * S-14 모달: `?new=1[&from=board]` + 모달 자신의 `?state=`(5절 표 — step1 · fetching · fetch-failed ·
 * extracting · extract-failed · step2 · close-confirm · creating · create-failed · invalid-source-url ·
 * consent-required · key-invalid · key-missing)
 */
type Props = { params: Promise<Record<string, never>>; searchParams: Promise<Record<string, string | string[] | undefined>> }

export default function Page({ params, searchParams }: Props) {
  return (
    <ScreenSuspense>
      <Screen params={params} searchParams={searchParams} />
    </ScreenSuspense>
  )
}

const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v)

async function Screen({ searchParams }: Props) {
  const sp = await searchParams
  const state = getPreviewState(sp)
  if (state === "not-found") notFound()
  // S-14 모달: 주소에는 화면 상태(`?new=1`)만 남고 입력 내용은 넣지 않는다 (CF-8)
  const modalOpen = one(sp.new) === "1"
  const fromBoard = one(sp.from) === "board"

  const launcher = <AddApplicationLauncher open={modalOpen} fromBoard={fromBoard} previewState={state} />

  const { body, isList } = await (async (): Promise<{ body: React.ReactNode; isList: boolean }> => {
    if (state === "loading") return { body: <ListSkeleton rows={5} />, isList: false }
    if (state === "error") return { body: <ErrorState kind="error" />, isList: false }
    if (state === "unauth") return { body: <ErrorState kind="unauth" />, isList: false }
    const rows = state === "empty" ? [] : await listCoverLetters()
    if (rows.length === 0)
      return {
        isList: false,
        body: (
        <EmptyState
          icon={Briefcase}
          title="아직 자기소개서가 없어요"
          // UX v5.20 S-13 상태 "빈 상태" 문구 그대로 (UQ-744 — "붙여넣어"를 URL 입력에 맞게 "넣어"로)
          description="지원하려는 공고를 넣어 첫 자기소개서를 만들어 보세요. 커리어 정리 전에도 만들 수 있어요"
          actions={<AddApplicationLauncherButton />}
        />
        ),
      }
    return { body: <ApplicationList rows={rows} />, isList: true }
  })()

  // 시안 1(뒤 배경): 별도 큰 페이지 제목 없이 — 상단 바가 "자기소개서 관리"를 보이고(L-01 이동 경로),
  // 본문 위 한 줄에 왼쪽 정렬 표기 "최근 작성 순"(바꿀 수 없음, CF-9) · 오른쪽 주 버튼 "⊕ 자기소개서 작성"
  return (
    // 시안 4 실측(그림 ÷ 1.389): 카드 끝 → 칩·버튼 바깥 끝이 양쪽 약 27px로 고정이고 콘텐츠는 카드 폭을 꽉 채운다
    // (가운데 정렬 폭 제한 없음). 셸 본문 여백 16px(#main p-4) + 여기 12px(px-3) = 28px. 칩 바로 아래에서 목록이 시작한다.
    <div className="flex flex-col px-3">
      <PageCrumbs items={[{ label: "자기소개서 관리" }]} />
      <h1 className="sr-only">자기소개서 관리</h1>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <ApplicationSortNote />
        <AddApplicationLauncherButton />
      </div>
      {/* 목록은 칩 바로 아래(행 위 여백 24px이 간격을 만든다), 빈 상태·오류·로딩은 한 칸 띄운다 */}
      <div className={isList ? undefined : "mt-6"}>{body}</div>
      {launcher}
    </div>
  )
}
