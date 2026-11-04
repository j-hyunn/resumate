import Link from "next/link"
import { KanbanSquare, Plus } from "lucide-react"
import { ScreenSuspense } from "@/components/common/screen-suspense"
import { PageHeader } from "@/components/common/basics"
import { EmptyState, ErrorState } from "@/components/common/state-views"
import { PageCrumbs } from "@/components/common/shell/breadcrumbs"
import { Button } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"
import { KanbanBoard, type BoardData } from "@/components/board/kanban-board"
import { InterviewPromptPreview } from "@/components/board/interview-prompt-preview"
import { getBoard } from "@/lib/data/applications"
import { applicationDisplayName, STAGE_ORDER } from "@/lib/data/labels"
import { getPreviewState } from "@/lib/preview-state"
import { routes } from "@/lib/routes"

/**
 * S-39 지원 현황 보드.
 * ?state=: loading · error · unauth · empty · move-failed (모든 이동이 실패 → 원위치 + 토스트) ·
 * ai-locked (카드를 인터뷰 열로 옮기면 C-14 키 없음 변형 — common stage-menu → AiLockDialog) ·
 * v5.3: interview-prompt (C-14 작성 중 세션: 마지막 활동 · 질문 만드는 중 · 유형 다름, 첫 카드 기준)
 */
type Props = {
  params: Promise<Record<string, never>>
  searchParams: Promise<Record<string, string | string[] | undefined>>
}

export default function Page({ params, searchParams }: Props) {
  return (
    <ScreenSuspense>
      <Screen params={params} searchParams={searchParams} />
    </ScreenSuspense>
  )
}

function BoardSkeleton() {
  return (
    <div className="flex gap-3 overflow-hidden" aria-hidden>
      {STAGE_ORDER.slice(0, 4).map((s) => (
        <div key={s} className="w-72 shrink-0 space-y-2 rounded-xl bg-muted/60 p-2">
          <Skeleton className="h-6 w-32" />
          <Skeleton className="h-24 w-full" />
          <Skeleton className="h-24 w-full" />
        </div>
      ))}
    </div>
  )
}

async function Screen({ searchParams }: Props) {
  const state = getPreviewState(await searchParams)
  const crumbs = <PageCrumbs items={[{ label: "지원 현황" }]} />
  const header = <PageHeader title="지원 현황" />

  if (state === "loading")
    return (
      <div className="space-y-6">
        {crumbs}
        {header}
        <BoardSkeleton />
      </div>
    )
  if (state === "error" || state === "unauth")
    return (
      <div>
        {crumbs}
        <ErrorState kind={state === "unauth" ? "unauth" : "error"} />
      </div>
    )

  const raw = await getBoard()
  const board: BoardData =
    state === "empty" ? (Object.fromEntries(STAGE_ORDER.map((s) => [s, []])) as unknown as BoardData) : raw
  const total = STAGE_ORDER.reduce((n, s) => n + board[s].length, 0)

  return (
    <div className="space-y-6">
      {crumbs}
      {header}
      {total === 0 ? (
        <EmptyState
          icon={KanbanSquare}
          title="기업 JD를 추가하면 여기서 전형 단계를 관리할 수 있어요"
          actions={
            <>
              <Button asChild className="max-md:h-8">
                <Link href={routes.applicationNew({ from: "board" })}>
                  <Plus aria-hidden />
                  기업 JD 추가
                </Link>
              </Button>
              <Button asChild variant="outline" className="max-md:h-8">
                <Link href={routes.applications()}>기업 JD 관리로</Link>
              </Button>
            </>
          }
        />
      ) : (
        <KanbanBoard board={board} failMove={state === "move-failed"} />
      )}
      {state === "interview-prompt" ? <PromptPreview board={board} /> : null}
    </div>
  )
}

/** UQ-560: a card with a real in-progress session so "이어서 쓰기" opens that S-33 */
function PromptPreview({ board }: { board: BoardData }) {
  const cards = STAGE_ORDER.flatMap((st) => board[st])
  const card = cards.find((c) => c.in_progress_session) ?? cards[0]
  if (!card?.in_progress_session) return null
  return (
    <InterviewPromptPreview
      applicationProjectId={card.id}
      name={applicationDisplayName(card.name, card.name_source, card.created_at)}
      session={card.in_progress_session}
    />
  )
}
