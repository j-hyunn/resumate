"use client"

/**
 * S-08 커리어 연도 계층: 연도 > 경력/교육 > 프로젝트 > 상세 내용 (D-22 (b)).
 * Data from getCareerTree() (grouping is computed in the data layer). Every level folds;
 * fold state is remembered in the browser [가정] (localStorage, per-viewer convenience).
 */
import * as React from "react"
import Link from "next/link"
import {
  Briefcase,
  ChevronDown,
  ChevronRight,
  GraduationCap,
  Layers,
  Lock,
  MoreHorizontal,
  Plus,
  Sparkles,
  TriangleAlert,
  UserRound,
} from "lucide-react"
import { cn } from "@/lib/utils"
import { Alert, AlertTitle } from "@/components/ui/alert"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card } from "@/components/ui/card"
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu"
import { PageHeader } from "@/components/common/basics"
import { EmptyState } from "@/components/common/state-views"
import { DraftBadge } from "@/components/common/save-status"
import { DeleteConfirmDialog, type DeleteTarget } from "@/components/common/delete-confirm-dialog"
import type { WritingChat } from "@/types/db"
import type { CareerTree, CareerTreeAffiliationEntry, ProjectWithChildren } from "@/lib/data/career"
import { EDUCATION_TYPE_LABELS, ENROLLMENT_STATUS_LABELS, formatPeriod, AI_FEATURE_NAMES } from "@/lib/data/labels"
import { routes } from "@/lib/routes"
import { readCareerReturn } from "@/components/common/return-target"
import { AiRunButton } from "@/components/common/ai-run-button"
import { useAiConnection, useAiConnectHref } from "@/components/common/ai-connection-context"
import { markAiConnectReturn } from "@/components/common/ai-connect-return"
import { deleteCareerItemAction } from "./actions"
import { chatLock } from "./gate-next-step"
import { StarFill } from "./star-fill"
import { WritingChatLists } from "./writing-chat-list"

const STORAGE_KEY = "resumate.career-tree.collapsed"

function readCollapsed(): Record<string, boolean> {
  try {
    return JSON.parse(window.localStorage.getItem(STORAGE_KEY) ?? "{}") as Record<string, boolean>
  } catch {
    return {}
  }
}

function useFold() {
  const [collapsed, setCollapsed] = React.useState<Record<string, boolean>>({})
  React.useEffect(() => {
    // hydrate from browser storage after mount (server render = all open)
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setCollapsed(readCollapsed())
  }, [])
  const toggle = React.useCallback((key: string) => {
    setCollapsed((prev) => {
      const next = { ...prev, [key]: !prev[key] }
      try {
        window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next))
      } catch {
        // storage unavailable — fold state just isn't remembered
      }
      return next
    })
  }, [])
  return { isOpen: (key: string, defaultOpen = true) => (key in collapsed ? !collapsed[key] : defaultOpen), toggle }
}

type Fold = ReturnType<typeof useFold>

function FoldButton({ open, onToggle, label }: { open: boolean; onToggle: () => void; label: string }) {
  return (
    <Button variant="ghost" size="icon-sm" className="size-11 lg:size-8" aria-expanded={open} aria-label={`${label} ${open ? "접기" : "펴기"}`} onClick={onToggle}>
      {open ? <ChevronDown aria-hidden /> : <ChevronRight aria-hidden />}
    </Button>
  )
}

function allProjects(tree: CareerTree): ProjectWithChildren[] {
  const map = new Map<string, ProjectWithChildren>()
  for (const y of tree.years) {
    for (const e of y.entries) for (const p of e.projects) map.set(p.id, p)
    for (const p of y.other_projects) map.set(p.id, p)
  }
  for (const p of tree.undated_projects) map.set(p.id, p)
  return [...map.values()]
}

/**
 * UQ-81: C-10 is also sticky under the top bar; while a return target exists the year headers stop
 * sticking so the banner never covers them. // [UI-가정] (배너 높이가 줄바꿈에 따라 달라 고정 오프셋 대신)
 */
function useHasReturnTarget(): boolean {
  const [has, setHas] = React.useState(false)
  React.useEffect(() => {
    const check = () => setHas(readCareerReturn() !== null)
    check()
    window.addEventListener("resumate:return-target", check)
    return () => window.removeEventListener("resumate:return-target", check)
  }, [])
  return has
}

export function CareerTreeScreen({ tree, abandonedChats, now }: { tree: CareerTree; abandonedChats: WritingChat[]; now: number }) {
  const fold = useFold()
  const hasReturn = useHasReturnTarget()
  const [deleting, setDeleting] = React.useState<DeleteTarget | null>(null)
  const projects = allProjects(tree)
  const projectName = (id: string | null) => projects.find((p) => p.id === id)?.name ?? "프로젝트"

  const confirmDelete = async (opts: { result_mode?: "keep_results" | "delete_results"; affiliation_mode?: "keep_projects" | "delete_projects" }) => {
    if (!deleting) return
    const type = deleting.kind === "career" ? deleting.entity_type : "writing_chat"
    await deleteCareerItemAction(type, deleting.entity_id, opts.affiliation_mode, opts.result_mode)
  }

  // 작성 중인 AI 대화 + (v5.3 A6) 그만둔 대화 묶음 — shown even before any career item exists
  const chatLists = (
    <WritingChatLists
      active={tree.active_writing_chats}
      abandoned={abandonedChats}
      projectName={projectName}
      now={now}
      onDelete={(id) => setDeleting({ kind: "writing_chat", entity_id: id })}
    />
  )

  // v5: 키 없이도 되는 직접 입력이 기본 시작점, AI 작성 대화는 AiRunButton (키 없음 → C-18 인라인)
  const startButtons = (
    <div className="space-y-3">
    <div className="grid grid-cols-3 gap-2 sm:flex sm:flex-wrap sm:items-center">
      <Button asChild variant="outline" size="sm">
        <Link href={routes.experienceNew()}>
          <Plus aria-hidden />
          경력
        </Link>
      </Button>
      <Button asChild variant="outline" size="sm">
        <Link href={routes.educationNew()}>
          <Plus aria-hidden />
          교육
        </Link>
      </Button>
      <Button asChild variant="outline" size="sm">
        <Link href={routes.projectNew()}>
          <Plus aria-hidden />
          프로젝트
        </Link>
      </Button>
    </div>
      <AiRunButton href={routes.writingChatNew({ mode: "new_project" })} lock={chatLock("AI와 대화하며 프로젝트 정리하기", routes.projectNew())}>
        <Sparkles aria-hidden />
        AI와 대화하며 프로젝트 정리하기
      </AiRunButton>
    </div>
  )

  if (tree.is_empty) {
    return (
      <div className="mx-auto max-w-6xl space-y-8">
        <PageHeader title="커리어" />
        <EmptyState
          icon={Layers}
          title="커리어를 정리해 두면 기업 JD마다 인사이트·서류·면접에 바로 쓸 수 있어요"
          actions={
            <>
              {/* v5 (PRD 3.1): 기본 시작점 = 직접 입력 */}
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button>
                    직접 입력
                    <ChevronDown aria-hidden />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent>
                  <DropdownMenuItem asChild>
                    <Link href={routes.experienceNew()}>+ 경력</Link>
                  </DropdownMenuItem>
                  <DropdownMenuItem asChild>
                    <Link href={routes.educationNew()}>+ 교육</Link>
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
              <AiRunButton
                variant="outline"
                href={routes.writingChatNew({ mode: "new_project" })}
                lock={chatLock("AI와 대화하며 첫 프로젝트 정리하기", routes.experienceNew())}
                className="w-full [&>div]:justify-center"
              >
                <Sparkles aria-hidden />
                AI와 대화하며 첫 프로젝트 정리하기
              </AiRunButton>
            </>
          }
        />
        {/* [UI-가정] chats started before any career item stays reachable from the empty state */}
        {chatLists}
        <DeleteConfirmDialog target={deleting} open={deleting !== null} onOpenChange={(o) => !o && setDeleting(null)} onConfirm={confirmDelete} />
      </div>
    )
  }

  // 규칙 기반 안내 1줄 (F-P1-07 축소판 [가정])
  const noResult = projects.flatMap((p) => p.details.filter((d) => !d.result).map((d) => ({ p, d })))
  const noDetail = projects.filter((p) => p.details.length === 0)
  const hints: Array<{ text: string; href: string }> = []
  if (noResult.length) hints.push({ text: `결과가 빈 상세 내용 ${noResult.length}건`, href: routes.projectDetail(noResult[0].p.id, noResult[0].d.id, "result") })
  if (noDetail.length) hints.push({ text: `상세 내용 없는 프로젝트 ${noDetail.length}건`, href: routes.project(noDetail[0].id) })
  const profile = tree.profile
  const profileLine = [profile.desired_job_title, profile.total_years_of_experience !== null ? `경력 ${profile.total_years_of_experience}년` : null]
    .filter(Boolean)
    .join(" · ")

  return (
    <div className="mx-auto max-w-6xl space-y-8">
      <PageHeader title="커리어" />

      <Card className="gap-4 p-5" aria-label="커리어 요약" role="region">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <Link href={routes.profile()} className="flex items-center gap-2 rounded-sm text-base leading-6 font-semibold hover:underline">
            <UserRound className="size-4 text-muted-foreground" aria-hidden />
            {profileLine || "기본 프로필을 입력해 주세요"}
          </Link>
          <ul className="flex flex-wrap gap-1.5" aria-label="완료 개수">
            <li><Badge variant="outline" className="tabular-nums">완료 경력 {tree.counts.complete_experiences}</Badge></li>
            <li><Badge variant="outline" className="tabular-nums">교육 {tree.counts.complete_educations}</Badge></li>
            <li><Badge variant="outline" className="tabular-nums">프로젝트 {tree.counts.complete_projects}</Badge></li>
            <li><Badge variant="outline" className="tabular-nums">상세 내용 {tree.counts.complete_project_details}</Badge></li>
          </ul>
        </div>
        {hints.length ? (
          <Alert variant="info" className="py-2">
            <TriangleAlert aria-hidden />
            <AlertTitle className="flex flex-wrap gap-x-3 font-normal">
              {hints.map((h) => (
                <Link key={h.text} href={h.href} className="underline-offset-4 hover:underline">
                  {h.text}
                </Link>
              ))}
            </AlertTitle>
          </Alert>
        ) : null}
        {startButtons}
      </Card>

      {chatLists}

      <div className="space-y-6">
        {tree.years.map((y) => {
          const key = `y:${y.year}`
          const open = fold.isOpen(key)
          return (
            <section key={y.year} aria-label={`${y.year}년`}>
              <div className={cn("z-[5] flex items-center gap-1 bg-background/95 py-2", hasReturn ? "static" : "sticky top-16")}>
                <FoldButton open={open} onToggle={() => fold.toggle(key)} label={`${y.year}년`} />
                <h2 className="text-lg font-bold tabular-nums">{y.year}</h2>
              </div>
              {open ? (
                <div className="ml-2 space-y-2 border-l pl-4">
                  {y.entries.map((e) => (
                    <AffiliationBlock
                      key={`${e.kind}-${(e.experience ?? e.education)?.id}`}
                      entry={e}
                      year={y.year}
                      fold={fold}
                      onDelete={setDeleting}
                    />
                  ))}
                  {y.other_projects.length ? (
                    <GroupBlock label="기타 프로젝트" foldKey={`o:${y.year}`} fold={fold} projects={y.other_projects} onDelete={setDeleting} />
                  ) : null}
                </div>
              ) : null}
            </section>
          )
        })}
        {tree.undated_projects.length ? (
          <section aria-label="연도 미정">
            <div className="flex items-center gap-1 py-2">
              <FoldButton open={fold.isOpen("y:undated")} onToggle={() => fold.toggle("y:undated")} label="연도 미정" />
              <h2 className="text-lg font-bold">연도 미정</h2>
            </div>
            {fold.isOpen("y:undated") ? (
              <div className="ml-2 space-y-1 border-l pl-4">
                {tree.undated_projects.map((p) => (
                  <ProjectBlock key={p.id} project={p} fold={fold} onDelete={setDeleting} />
                ))}
              </div>
            ) : null}
          </section>
        ) : null}
      </div>

      <Link
        href={routes.skills()}
        className="flex min-h-11 items-center justify-between rounded-lg border bg-card px-4 py-3 transition-colors hover:bg-accent"
      >
        <span className="font-medium">스킬</span>
        <span className="flex items-center gap-1 text-sm text-muted-foreground tabular-nums">
          {tree.skill_count}개 보기
          <ChevronRight className="size-4" aria-hidden />
        </span>
      </Link>

      <DeleteConfirmDialog target={deleting} open={deleting !== null} onOpenChange={(o) => !o && setDeleting(null)} onConfirm={confirmDelete} />
    </div>
  )
}

// [UI-가정] 프로젝트 행에도 메뉴(삭제)를 둠 — 명세는 경력·교육 머리에만 "메뉴: 삭제"
/**
 * 프로젝트 행 "AI와 상세 내용 추가". 키 없음이면 행마다 C-18 카드를 넣는 대신 잠금 표시 버튼이
 * AI 연결로 간다(FL-19 복귀 대상 기억). // [UI-가정] 트리 행은 공간이 좁아 인라인 카드 대신 축약형
 */
function RowAiAugment({ projectId }: { projectId: string }) {
  const connection = useAiConnection()
  const connectHref = useAiConnectHref()
  if (connection && !connection.active_provider)
    return (
      <Button asChild variant="ghost" size="sm" className="text-muted-foreground">
        <Link
          href={connectHref}
          onClick={() => markAiConnectReturn({ feature_label: AI_FEATURE_NAMES.writing_chat })}
          aria-label="AI와 상세 내용 추가 — AI 연결하면 사용할 수 있어요"
          title="AI 연결하면 사용할 수 있어요"
        >
          <Lock aria-hidden />
          AI와 상세 내용 추가
        </Link>
      </Button>
    )
  return (
    <Button asChild variant="ghost" size="sm">
      <Link href={routes.writingChatNew({ mode: "augment_project", project_id: projectId })}>
        <Sparkles aria-hidden />
        AI와 상세 내용 추가
      </Link>
    </Button>
  )
}

function RowMenu({ label, onDelete, extra }: { label: string; onDelete: () => void; extra?: React.ReactNode }) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon-sm" className="size-11 lg:size-8" aria-label={`${label} 메뉴`}>
          <MoreHorizontal aria-hidden />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        {extra}
        <DropdownMenuItem className="text-destructive" onSelect={onDelete}>
          삭제
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

function AffiliationBlock({
  entry,
  year,
  fold,
  onDelete,
}: {
  entry: CareerTreeAffiliationEntry
  year: number
  fold: Fold
  onDelete: (t: DeleteTarget) => void
}) {
  const isExp = entry.kind === "experience"
  const exp = entry.experience
  const edu = entry.education
  const id = (exp ?? edu)!.id
  const name = (isExp ? exp?.company_name : edu?.institution_name) ?? (isExp ? "회사명 없음" : "기관명 없음")
  const href = isExp ? routes.experience(id) : routes.education(id)
  const status = (exp ?? edu)!.status
  const meta = isExp
    ? [exp?.job_rank ?? exp?.job_position, formatPeriod(exp?.start_month ?? null, exp?.end_month ?? null, exp?.is_current ? "재직 중" : undefined)]
    : [
        edu?.education_type ? EDUCATION_TYPE_LABELS[edu.education_type] : null,
        edu?.program_name,
        formatPeriod(edu?.start_month ?? null, edu?.end_month ?? null, edu?.enrollment_status === "enrolled" ? "재학 중" : undefined),
        edu?.enrollment_status ? ENROLLMENT_STATUS_LABELS[edu.enrollment_status] : null,
      ]
  const key = `a:${year}:${id}`
  const open = !entry.collapsed && fold.isOpen(key)
  const Icon = isExp ? Briefcase : GraduationCap
  return (
    <div>
      <div className={cn("flex min-h-11 flex-wrap items-center gap-2 rounded-md px-1 py-1.5", entry.collapsed && "text-muted-foreground")}>
        {entry.collapsed ? <span className="size-8" aria-hidden /> : <FoldButton open={open} onToggle={() => fold.toggle(key)} label={name} />}
        <Icon className="size-4 shrink-0" aria-hidden />
        <Link href={href} className={cn("rounded-sm hover:underline", entry.collapsed ? "font-medium" : "font-semibold")}>
          {name}
        </Link>
        <span className="text-sm text-muted-foreground">{meta.filter(Boolean).join(" · ")}</span>
        {status === "draft" ? <DraftBadge label="작성 중 — AI 미반영" /> : null}
        <span className="ml-auto flex items-center gap-1">
          <Button asChild variant="ghost" size="sm">
            <Link href={routes.projectNew(isExp ? { experience_id: id } : { education_id: id })}>
              <Plus aria-hidden />
              프로젝트
            </Link>
          </Button>
          <RowMenu
            label={name}
            onDelete={() => onDelete({ kind: "career", entity_type: entry.kind, entity_id: id, label: name })}
          />
        </span>
      </div>
      {open && entry.projects.length ? (
        <div className="ml-4 space-y-1 border-l pl-4">
          {entry.projects.map((p) => (
            <ProjectBlock key={p.id} project={p} fold={fold} onDelete={onDelete} />
          ))}
        </div>
      ) : null}
    </div>
  )
}

function GroupBlock({
  label,
  foldKey,
  fold,
  projects,
  onDelete,
}: {
  label: string
  foldKey: string
  fold: Fold
  projects: ProjectWithChildren[]
  onDelete: (t: DeleteTarget) => void
}) {
  const open = fold.isOpen(foldKey)
  return (
    <div>
      <div className="flex min-h-11 items-center gap-2 px-1 py-1.5">
        <FoldButton open={open} onToggle={() => fold.toggle(foldKey)} label={label} />
        <Layers className="size-4" aria-hidden />
        <span className="font-semibold">{label}</span>
      </div>
      {open ? (
        <div className="ml-4 space-y-1 border-l pl-4">
          {projects.map((p) => (
            <ProjectBlock key={p.id} project={p} fold={fold} onDelete={onDelete} />
          ))}
        </div>
      ) : null}
    </div>
  )
}

function ProjectBlock({ project: p, fold, onDelete }: { project: ProjectWithChildren; fold: Fold; onDelete: (t: DeleteTarget) => void }) {
  const key = `p:${p.id}`
  const open = fold.isOpen(key)
  const name = p.name ?? "이름 없는 프로젝트"
  return (
    <div>
      <div className="group flex min-h-11 flex-wrap items-center gap-x-2 gap-y-1 rounded-md px-1 py-1.5 hover:bg-accent/50">
        {p.details.length ? <FoldButton open={open} onToggle={() => fold.toggle(key)} label={name} /> : <span className="size-8" aria-hidden />}
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <Link href={routes.project(p.id)} className="rounded-sm font-medium hover:underline">
              {name}
            </Link>
            {p.role ? <span className="text-sm text-muted-foreground">{p.role}</span> : null}
            {p.start_month ? <span className="text-sm text-muted-foreground tabular-nums">{formatPeriod(p.start_month, p.end_month)}</span> : null}
            {p.status === "draft" ? <DraftBadge label="작성 중 — AI 미반영" /> : null}
          </div>
          {p.summary ? <p className="line-clamp-1 text-sm text-muted-foreground">{p.summary}</p> : null}
          <div className="mt-1 flex flex-wrap items-center gap-1">
            {p.skills.slice(0, 3).map((s) => (
              <Badge key={s.id} variant="secondary">
                {s.name}
              </Badge>
            ))}
            <span className="text-xs font-medium text-muted-foreground tabular-nums">상세 내용 {p.details.length}</span>
          </div>
        </div>
        <span className="flex items-center gap-1">
          <Button asChild variant="ghost" size="sm">
            <Link href={routes.projectDetailNew(p.id)}>
              <Plus aria-hidden />
              상세 내용
            </Link>
          </Button>
          <RowAiAugment projectId={p.id} />
          <RowMenu label={name} onDelete={() => onDelete({ kind: "career", entity_type: "project", entity_id: p.id, label: name })} />
        </span>
      </div>
      {open && p.details.length ? (
        <ul className="ml-4 border-l pl-4">
          {p.details.map((d) => (
            <li key={d.id}>
              <Link
                href={routes.projectDetail(p.id, d.id)}
                className="flex min-h-11 flex-wrap items-center gap-2 rounded-md px-2 py-1.5 transition-colors hover:bg-accent"
              >
                <span className="min-w-0 flex-1 text-sm">{d.title ?? "제목 없음"}</span>
                {d.status === "draft" ? <DraftBadge label="작성 중 — AI 미반영" /> : null}
                <StarFill detail={d} />
                <span className="text-xs font-medium text-muted-foreground tabular-nums">정량 성과 {d.achievements.length}</span>
              </Link>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  )
}
