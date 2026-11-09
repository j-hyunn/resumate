"use client"

/**
 * S-39 지원 현황 보드 (02 S-39, FL-15, design-system 5.5, A-5).
 *
 * - 4 fixed columns (v5.19, RM-2); cards ordered by stage_changed_at desc (D-26 (a)); optimistic moves go to top.
 * - Every move (drag & drop, card ⋯ "단계 이동", "다음 단계로") goes through the foundation's
 *   C-12 controller (useStageMove → request(to)) — C-13 / 결과 지우기 확인 / ST-MOVE-FAILED
 *   / aria-live live there.
 * - Controllers live in <ControllerHost>s rendered in a stable list (keyed by id), not inside the
 *   column a card sits in — so a card changing columns does not lose its dialogs mid-flow.
 * - dnd-kit: pointer + keyboard sensors. Keyboard: focus the grip → Space picks up → ←/→ moves
 *   between columns → Space drops / Esc cancels.
 * - <768px: column tabs, drag off, moves via the card menu (D-UX-13 (a)).
 */
import * as React from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import {
  DndContext,
  DragOverlay,
  KeyboardSensor,
  PointerSensor,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
  type Announcements,
  type DragEndEvent,
  type DragOverEvent,
  type DragStartEvent,
  type KeyboardCoordinateGetter,
} from "@dnd-kit/core"
import { Check, CircleDashed, GripVertical, Lightbulb, MoreHorizontal, Plus } from "lucide-react"
import { toast } from "sonner"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { DropdownMenuItem } from "@/components/ui/dropdown-menu"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { DDay, OutcomeBadge, StatusDot } from "@/components/common/basics"
import { DeleteConfirmDialog, type DeleteTarget } from "@/components/common/delete-confirm-dialog"
import { StageCardMenu, useStageMove, type StageMoveController } from "@/components/common/stage-menu"
import { setNavOrigin } from "@/components/common/return-target"
import { AiProgressInline } from "@/components/common/ai-progress"
import { AiFeatureFailureLine } from "@/components/common/ai-feature-status"
import type { AiFeatureStatusView } from "@/lib/data/ai-feature-status"
import type { ApplicationSummary } from "@/lib/data/applications"
import type { ApplicationStage, StageOutcome } from "@/types/db"
import { applicationDeletedToast, applicationDisplayName, STAGE_LABELS, STAGE_ORDER } from "@/lib/data/labels"
import { routes } from "@/lib/routes"
import { cn } from "@/lib/utils"
import { deleteApplicationProjectAction } from "./actions"
import { BoardAddButton } from "./board-add-button"

export type BoardData = Record<ApplicationStage, ApplicationSummary[]>

/**
 * 카드별 자소서 표시 글자 (서버에서 `coverLetterProgressLabel()`로 판정해 넘긴다 —
 * `lib/data/cover-letters`는 `server-only`라 이 클라이언트 파일에서 부를 수 없다).
 * 행이 없거나 답변이 0개인 카드는 키가 없다.
 */
export type CoverLetterLabelMap = Record<string, "자소서 작성 중" | "자소서 작성됨">

/**
 * (v5.20, CF-3·CF-A14 / design-system 5.5 카드 3행) 카드의 서류 쪽 표시 = 배지 하나.
 * 행 없음 또는 `filled_slot_count = 0` → 아무것도 그리지 않는다. 숫자·분수는 보이지 않는다.
 */
function CoverLetterBadge({ label }: { label: CoverLetterLabelMap[string] | undefined }) {
  if (!label) return null
  const done = label === "자소서 작성됨"
  const Icon = done ? Check : CircleDashed
  return (
    <Badge variant={done ? "success" : "draft"}>
      <Icon className="size-3" aria-hidden />
      {label}
    </Badge>
  )
}

function cardTitle(card: ApplicationSummary) {
  const company = card.job_description?.company_name
  const position = card.job_description?.position_title
  const display = applicationDisplayName(card.name, card.name_source, card.created_at)
  // 회사명 + 포지션명(JD 값), 없으면 application_projects.name
  return company ? { title: company, subtitle: position ?? null, display } : { title: display, subtitle: null, display }
}

// ---------------------------------------------------------------------------
// controller hosts
// ---------------------------------------------------------------------------

function ControllerHost({
  card,
  failMove,
  onRegister,
}: {
  card: ApplicationSummary
  failMove: boolean
  onRegister: (id: string, controller: StageMoveController) => void
}) {
  const router = useRouter()
  const onMoved = React.useCallback(() => router.refresh(), [router])
  const move = useStageMove({
    applicationProjectId: card.id,
    name: cardTitle(card).display,
    stage: card.stage,
    outcome: card.stage_outcome,
    failMove,
    onMoved,
  })
  React.useEffect(() => {
    onRegister(card.id, move)
  })
  return <>{move.dialogs}</>
}

// ---------------------------------------------------------------------------
// keyboard: jump between columns with ←/→
// ---------------------------------------------------------------------------

const columnCoordinates: KeyboardCoordinateGetter = (event, { context }) => {
  const { active, over, droppableRects, collisionRect } = context
  if (!active || !collisionRect) return undefined
  const fromId = (over?.id ?? active.data.current?.stage) as ApplicationStage | undefined
  const index = fromId ? STAGE_ORDER.indexOf(fromId) : -1
  let next = index
  if (event.code === "ArrowRight") next = Math.min(STAGE_ORDER.length - 1, index + 1)
  else if (event.code === "ArrowLeft") next = Math.max(0, index - 1)
  else if (event.code === "ArrowDown" || event.code === "ArrowUp") {
    event.preventDefault()
    return { x: collisionRect.left, y: collisionRect.top }
  } else return undefined
  event.preventDefault()
  const rect = droppableRects.get(STAGE_ORDER[next])
  if (!rect) return undefined
  return { x: rect.left + (rect.width - collisionRect.width) / 2, y: rect.top + 48 }
}

// ---------------------------------------------------------------------------
// board
// ---------------------------------------------------------------------------

export function KanbanBoard({ board, coverLetterLabels, failMove }: { board: BoardData; coverLetterLabels: CoverLetterLabelMap; failMove: boolean }) {
  const router = useRouter()
  const [snapshot, setSnapshot] = React.useState<Record<string, { stage: ApplicationStage; outcome: StageOutcome | null; moving: boolean; controller: StageMoveController }>>({})
  const [activeId, setActiveId] = React.useState<string | null>(null)
  const [overStage, setOverStage] = React.useState<ApplicationStage | null>(null)
  const [deleteTarget, setDeleteTarget] = React.useState<DeleteTarget | null>(null)

  const cards = React.useMemo(() => STAGE_ORDER.flatMap((s) => board[s]), [board])
  const byId = React.useMemo(() => new Map(cards.map((c) => [c.id, c])), [cards])

  // re-store a controller only when what it closes over changed (stage / outcome / moving)
  const register = React.useCallback((id: string, controller: StageMoveController) => {
    setSnapshot((s) => {
      const prev = s[id]
      if (
        prev &&
        prev.stage === controller.stage &&
        prev.outcome === controller.outcome &&
        prev.moving === controller.moving
      )
        return s
      return { ...s, [id]: { stage: controller.stage, outcome: controller.outcome, moving: controller.moving, controller } }
    })
  }, [])

  // optimistic columns: controller stage wins over server data until refresh catches up
  const columns = React.useMemo(() => {
    const out = Object.fromEntries(STAGE_ORDER.map((s) => [s, [] as ApplicationSummary[]])) as BoardData
    for (const c of cards) out[snapshot[c.id]?.stage ?? c.stage].push(c)
    for (const s of STAGE_ORDER)
      out[s].sort((a, b) => {
        const am = (snapshot[a.id]?.stage ?? a.stage) !== a.stage
        const bm = (snapshot[b.id]?.stage ?? b.stage) !== b.stage
        if (am !== bm) return am ? -1 : 1
        return b.stage_changed_at.localeCompare(a.stage_changed_at)
      })
    return out
  }, [cards, snapshot])

  const controllerFor = (id: string) => snapshot[id]?.controller ?? null

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor, {
      coordinateGetter: columnCoordinates,
      keyboardCodes: { start: ["Space"], cancel: ["Escape"], end: ["Space"] },
    }),
  )

  const nameOf = (id: string | number) => {
    const c = byId.get(String(id))
    return c ? cardTitle(c).display : ""
  }
  // [UI-가정] 드래그 안내 문구 (A-5). 놓은 뒤 결과는 C-12의 "{카드}를 {단계}로 옮겼어요"가 알림
  const announcements: Announcements = {
    onDragStart: ({ active }) => `${nameOf(active.id)} 카드를 집었어요. 좌우 화살표로 열을 옮기고 Space로 놓아요. Esc로 취소해요`,
    onDragOver: ({ over }) => (over ? `${STAGE_LABELS[over.id as ApplicationStage]} 열 위에 있어요` : undefined),
    onDragEnd: () => undefined,
    onDragCancel: () => "이동을 취소했어요",
  }

  const onDragStart = (e: DragStartEvent) => setActiveId(String(e.active.id))
  const onDragOver = (e: DragOverEvent) => setOverStage((e.over?.id as ApplicationStage | undefined) ?? null)
  const onDragEnd = (e: DragEndEvent) => {
    setActiveId(null)
    setOverStage(null)
    const to = e.over?.id as ApplicationStage | undefined
    if (!to) return
    controllerFor(String(e.active.id))?.request(to)
  }
  const onDragCancel = () => {
    setActiveId(null)
    setOverStage(null)
  }

  const activeCard = activeId ? byId.get(activeId) : null
  const activeFrom = activeId ? (snapshot[activeId]?.stage ?? activeCard?.stage) : null

  const menuExtras = (card: ApplicationSummary) => (
    <>
      <DropdownMenuItem asChild>
        <Link href={routes.coverLetter(card.id)} onClick={() => setNavOrigin("board", card.id)}>
          자기소개서 열기
        </Link>
      </DropdownMenuItem>
      <DropdownMenuItem
        variant="destructive"
        onSelect={() => setDeleteTarget({ kind: "application_project", entity_id: card.id, label: cardTitle(card).display })}
      >
        삭제
      </DropdownMenuItem>
    </>
  )

  const renderCard = (card: ApplicationSummary, draggable: boolean) => {
    const controller = controllerFor(card.id)
    return (
      <BoardCard
        key={card.id}
        card={card}
        controller={controller}
        stage={snapshot[card.id]?.stage ?? card.stage}
        coverLetterLabel={coverLetterLabels[card.id]}
        draggable={draggable}
        menuExtras={menuExtras(card)}
      />
    )
  }

  return (
    <>
      {cards.map((card) => (
        <ControllerHost key={card.id} card={card} failMove={failMove} onRegister={register} />
      ))}

      {/* wide (≥768): columns side by side, horizontal scroll inside the board only */}
      <DndContext
        sensors={sensors}
        onDragStart={onDragStart}
        onDragOver={onDragOver}
        onDragEnd={onDragEnd}
        onDragCancel={onDragCancel}
        accessibility={{
          announcements,
          screenReaderInstructions: {
            // [UI-가정] 스크린 리더 안내 문구
            draggable: "Space로 카드를 집고, 좌우 화살표로 열을 옮긴 뒤 Space로 놓아요. Esc로 취소해요. 카드 메뉴의 단계 이동으로도 옮길 수 있어요",
          },
        }}
      >
        <div className="-mx-4 hidden overflow-x-auto px-4 pb-4 md:block">
          <div className="flex gap-3">
            {STAGE_ORDER.map((stage) => (
              <BoardColumn
                key={stage}
                stage={stage}
                count={columns[stage].length}
                dragging={activeId !== null}
                isOrigin={activeFrom === stage}
                isOver={overStage === stage}
              >
                {columns[stage].map((card) => (
                  <li key={card.id}>{renderCard(card, true)}</li>
                ))}
              </BoardColumn>
            ))}
          </div>
        </div>
        <DragOverlay>
          {activeCard ? (
            <div className="rotate-[1deg] rounded-md shadow-lg ring-1 ring-border motion-reduce:rotate-0">
              <CardBody card={activeCard} stage={activeFrom ?? activeCard.stage} coverLetterLabel={coverLetterLabels[activeCard.id]} />
            </div>
          ) : null}
        </DragOverlay>
      </DndContext>

      {/* narrow (<768): column tabs, moves via the card menu only */}
      <Tabs defaultValue={STAGE_ORDER[0]} className="md:hidden">
        <TabsList className="h-auto! w-full justify-start overflow-x-auto" aria-label="전형 단계">
          {STAGE_ORDER.map((stage) => (
            <TabsTrigger key={stage} value={stage} className="h-11 flex-none gap-1.5 px-3 md:h-9">
              <StatusDot stage={stage} />
              {STAGE_LABELS[stage]}
              <span className="text-xs tabular-nums text-muted-foreground">{columns[stage].length}</span>
            </TabsTrigger>
          ))}
        </TabsList>
        {STAGE_ORDER.map((stage) => (
          <TabsContent key={stage} value={stage} className="space-y-2 pt-2">
            {stage === "before_apply" ? (
              // UQ-742: 보드 위에서 S-14 모달을 연다 (S-13으로 이동하지 않는다)
              <BoardAddButton variant="outline" className="h-11 w-full">
                <Plus aria-hidden />
                자기소개서 추가
              </BoardAddButton>
            ) : null}
            <ul className="space-y-2" aria-label={`${STAGE_LABELS[stage]} ${columns[stage].length}개`}>
              {columns[stage].length === 0 ? <EmptyColumn /> : null}
              {columns[stage].map((card) => (
                <li key={card.id}>{renderCard(card, false)}</li>
              ))}
            </ul>
          </TabsContent>
        ))}
      </Tabs>

      <DeleteConfirmDialog
        target={deleteTarget}
        open={deleteTarget !== null}
        onOpenChange={(o) => !o && setDeleteTarget(null)}
        onConfirm={async () => {
          if (!deleteTarget) return
          await deleteApplicationProjectAction(deleteTarget.entity_id)
          // FL-06 "출발 화면으로 + 토스트" — S-13과 같은 문구 (UQ-383)
          toast.success(applicationDeletedToast(deleteTarget.label ?? ""))
          router.refresh()
        }}
      />
    </>
  )
}

// ---------------------------------------------------------------------------
// column + card
// ---------------------------------------------------------------------------

function EmptyColumn() {
  // [UI-가정] 빈 열 문구 (design-system P-4)
  return <li className="rounded-md border border-dashed p-4 text-center text-xs font-medium text-muted-foreground">카드 없음</li>
}

function BoardColumn({
  stage,
  count,
  dragging,
  isOrigin,
  isOver,
  children,
}: {
  stage: ApplicationStage
  count: number
  dragging: boolean
  isOrigin: boolean
  isOver: boolean
  children: React.ReactNode
}) {
  const { setNodeRef } = useDroppable({ id: stage })
  const headingId = `board-col-${stage}`
  return (
    <section
      ref={setNodeRef}
      aria-labelledby={headingId}
      className={cn(
        "flex max-h-[calc(100dvh-12rem)] min-h-64 w-72 shrink-0 flex-col rounded-xl bg-muted/60 p-2 transition-colors duration-150",
        dragging && !isOrigin && "ring-1 ring-primary/40",
        isOver && !isOrigin && "bg-primary-subtle/60 ring-2 ring-primary/40",
      )}
    >
      <div className="flex items-center gap-2 px-2 py-1.5">
        <StatusDot stage={stage} />
        <h2 id={headingId} className="text-sm leading-5 font-medium">
          {STAGE_LABELS[stage]}
        </h2>
        <Badge variant="count-neutral">
          {count}
        </Badge>
        {stage === "before_apply" ? (
          // UQ-742: 보드 위에서 S-14 모달을 연다 (S-13으로 이동하지 않는다)
          <BoardAddButton variant="ghost" size="icon-sm" className="ml-auto" aria-label="자기소개서 추가">
            <Plus aria-hidden />
          </BoardAddButton>
        ) : null}
      </div>
      <ul className="flex-1 space-y-2 overflow-y-auto p-0.5" aria-label={`${STAGE_LABELS[stage]} ${count}개`}>
        {count === 0 ? <EmptyColumn /> : null}
        {children}
      </ul>
    </section>
  )
}

function BoardCard({
  card,
  controller,
  stage,
  coverLetterLabel,
  draggable,
  menuExtras,
}: {
  card: ApplicationSummary
  controller: StageMoveController | null
  stage: ApplicationStage
  coverLetterLabel: CoverLetterLabelMap[string] | undefined
  draggable: boolean
  menuExtras: React.ReactNode
}) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: card.id,
    data: { stage },
    disabled: !draggable,
  })
  const { display } = cardTitle(card)
  return (
    <div
      ref={draggable ? setNodeRef : undefined}
      className={cn("relative", isDragging && "rounded-md border border-dashed opacity-50 [&>*]:bg-transparent")}
    >
      <CardBody
        card={card}
        stage={stage}
        coverLetterLabel={coverLetterLabel}
        handle={
          draggable ? (
            <button
              type="button"
              className="relative z-10 -ml-1 grid size-6 shrink-0 cursor-grab place-items-center rounded-sm text-muted-foreground opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring active:cursor-grabbing"
              aria-label={`${display} 카드 옮기기`}
              {...attributes}
              {...listeners}
            >
              <GripVertical className="size-4" aria-hidden />
            </button>
          ) : null
        }
        menu={
          // UQ-45: <768px the ⋯ trigger (foundation StageCardMenu, icon-sm) gets a 44px hit area
          <span className="relative z-10">
            {controller ? (
              <StageCardMenu controller={controller} extraItems={menuExtras} label={`${display} 카드 메뉴`} />
            ) : (
              // before the controller registers (first paint): same trigger, inert
              <Button variant="ghost" size="icon-sm" disabled className="max-md:size-8" aria-label={`${display} 카드 메뉴`}>
                <MoreHorizontal aria-hidden />
              </Button>
            )}
          </span>
        }
        link
      />
    </div>
  )
}

function CardBody({
  card,
  stage,
  coverLetterLabel,
  handle,
  menu,
  link = false,
}: {
  card: ApplicationSummary
  stage: ApplicationStage
  coverLetterLabel: CoverLetterLabelMap[string] | undefined
  handle?: React.ReactNode
  menu?: React.ReactNode
  /** stretched link to S-46 ("지원 현황 › …", v5.20 — S-31 폐기) */
  link?: boolean
}) {
  const { title, subtitle } = cardTitle(card)
  // v5.3 C-03 진행 표시 우선순위 (F8, design-system 3.3 AiFeatureStatus): generating > present > none
  const insight = card.insight_status
  const hasInsight = insight.kind === "present"
  return (
    <article className="group relative space-y-2 rounded-md border bg-card p-3 transition-colors duration-150 hover:border-foreground/20 hover:shadow-sm focus-within:ring-2 focus-within:ring-ring">
      <div className="flex items-center gap-1">
        {handle}
        <h3 className="min-w-0 flex-1 truncate text-base font-semibold">
          {link ? (
            <Link
              href={routes.coverLetter(card.id)}
              onClick={() => setNavOrigin("board", card.id)}
              className="after:absolute after:inset-0 after:rounded-md focus-visible:outline-none"
            >
              {title}
            </Link>
          ) : (
            title
          )}
        </h3>
        {menu}
      </div>
      {subtitle ? <p className="line-clamp-2 text-sm text-muted-foreground">{subtitle}</p> : null}
      <div className="flex flex-wrap items-center gap-2 text-xs font-medium">
        {stage === "closed" ? <OutcomeBadge outcome={card.stage_outcome} /> : null}
        <DDay deadline={card.deadline} className="text-xs" />
        {insight.kind === "generating" ? null : (
          <span className="inline-flex items-center gap-1">
            <Lightbulb className={cn("size-3.5", hasInsight ? "text-foreground" : "text-muted-foreground/60")} aria-hidden />
            <span className="sr-only">{hasInsight ? "인사이트 있음" : "인사이트 없음"}</span>
          </span>
        )}
        <CoverLetterBadge label={coverLetterLabel} />
      </div>
      <FeatureStatusLines label="인사이트" status={insight} />
    </article>
  )
}

/**
 * F8 card lines (design-system 3.3 v3): ① generating → C-03 축약형 (the indicator above is hidden),
 * late failure → one line without a button (the card opens S-46, where C-20 is shown in full).
 */
function FeatureStatusLines({ label, status }: { label: string; status: AiFeatureStatusView }) {
  if (status.kind === "generating")
    return (
      <p className="flex min-w-0 items-center gap-1.5">
        <span className="sr-only">{label}: </span>
        <AiProgressInline progress={status.progress} jobType={status.job_type} />
      </p>
    )
  if (!status.failure) return null
  return (
    <p className="flex min-w-0">
      <span className="sr-only">{label}: </span>
      <AiFeatureFailureLine failure={status.failure} />
    </p>
  )
}
