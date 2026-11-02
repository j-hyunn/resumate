"use client"

/**
 * S-08 커리어 (v5.5 재설계, CR-3·CR-4): 왼쪽 커리어 목록 + 오른쪽 커리어 상세 패널.
 * Experiences, educations and independent projects show once under their start year; the
 * selected item lives in the URL (`?item={kind}:{id}`) and the panel is S-09 / S-34 / S-43.
 *
 * // [UI-가정] 이번 단계는 레이아웃만 바꾼다. C-24 섹션 인라인 편집·C-23 이름 입력·S-44 산출물과
 * DM v4.4 새 컬럼(project_type·is_current·link_url·description·project_deliverables)은 아직 없어서,
 * "수정"·"추가"는 기존 편집 화면으로 보내고 종류 태그·Link·산출물은 그리지 않는다.
 */
import * as React from "react"
import Link from "next/link"
import { useSearchParams } from "next/navigation"
import { toast } from "sonner"
import { ArrowLeft, Briefcase, CirclePlus, FolderKanban, GraduationCap, Layers, MoreHorizontal, Pencil, Plus } from "lucide-react"
import { cn } from "@/lib/utils"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Separator } from "@/components/ui/separator"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { EmptyState } from "@/components/common/state-views"
import { DeleteConfirmDialog, type DeleteTarget } from "@/components/common/delete-confirm-dialog"
import type { Education, Experience } from "@/types/db"
import type { CareerTree, ProjectWithChildren } from "@/lib/data/career"
import {
  EDUCATION_TYPE_LABELS,
  EMPLOYMENT_TYPE_LABELS,
  ENROLLMENT_STATUS_LABELS,
  formatMonthSpan,
  formatRange,
} from "@/lib/data/labels"
import { routes } from "@/lib/routes"
import { deleteCareerItemAction } from "./actions"

type ItemKind = "experience" | "education" | "project"

type CareerItem =
  | { kind: "experience"; id: string; start: string | null; created_at: string; experience: Experience; projects: ProjectWithChildren[] }
  | { kind: "education"; id: string; start: string | null; created_at: string; education: Education; projects: ProjectWithChildren[] }
  | { kind: "project"; id: string; start: string | null; created_at: string; project: ProjectWithChildren }

type YearGroup = { key: string; label: string; items: CareerItem[] }

const KIND_LABELS: Record<ItemKind, string> = { experience: "경력", education: "교육", project: "프로젝트" }
const KIND_ICONS: Record<ItemKind, typeof Briefcase> = { experience: Briefcase, education: GraduationCap, project: FolderKanban }

const itemKey = (item: Pick<CareerItem, "kind" | "id">) => `${item.kind}:${item.id}`

function itemName(item: CareerItem): string {
  if (item.kind === "experience") return item.experience.company_name ?? "이름 없는 경력"
  if (item.kind === "education") return item.education.institution_name ?? "이름 없는 교육"
  return item.project.name ?? "이름 없는 프로젝트"
}

/** start_month desc, then newest created; no start month last */
function byStartDesc(a: { start: string | null; created_at: string }, b: { start: string | null; created_at: string }) {
  if (a.start !== b.start) {
    if (!a.start) return 1
    if (!b.start) return -1
    return b.start.localeCompare(a.start)
  }
  return b.created_at.localeCompare(a.created_at)
}

/**
 * Flattens the year tree (which repeats an affiliation in every year a project started) into one
 * row per experience / education / independent project, grouped once by start year (CR-4).
 */
function groupItems(tree: CareerTree): YearGroup[] {
  const affiliations = new Map<string, CareerItem & { kind: "experience" | "education" }>()
  const independents = new Map<string, ProjectWithChildren>()
  const entries = [...tree.years.flatMap((y) => y.entries), ...tree.undated_entries]
  for (const e of entries) {
    const row = e.experience ?? e.education
    if (!row) continue
    const key = `${e.kind}:${row.id}`
    const found = affiliations.get(key)
    if (found) {
      for (const p of e.projects) if (!found.projects.some((q) => q.id === p.id)) found.projects.push(p)
      continue
    }
    const base = { id: row.id, start: row.start_month, created_at: row.created_at, projects: [...e.projects] }
    affiliations.set(key, e.experience ? { kind: "experience", experience: e.experience, ...base } : { kind: "education", education: e.education!, ...base })
  }
  for (const p of [...tree.years.flatMap((y) => y.other_projects), ...tree.undated_projects]) independents.set(p.id, p)

  const items: CareerItem[] = [
    ...affiliations.values(),
    ...[...independents.values()].map((p): CareerItem => ({ kind: "project", id: p.id, start: p.start_month, created_at: p.created_at, project: p })),
  ]
  for (const item of items)
    if (item.kind !== "project")
      item.projects.sort((a, b) => byStartDesc({ start: a.start_month, created_at: a.created_at }, { start: b.start_month, created_at: b.created_at }))
  items.sort(byStartDesc)

  const groups: YearGroup[] = []
  for (const item of items) {
    const label = item.start ? item.start.slice(0, 4) : "연도 미정"
    const last = groups.at(-1)
    if (last?.label === label) last.items.push(item)
    else groups.push({ key: label, label, items: [item] })
  }
  return groups
}

function parseItemParam(value: string | null): { kind: ItemKind; id: string } | null {
  const [kind, id] = value?.split(":") ?? []
  return id && (kind === "experience" || kind === "education" || kind === "project") ? { kind, id } : null
}

export function CareerOverview({ tree }: { tree: CareerTree }) {
  const groups = React.useMemo(() => groupItems(tree), [tree])
  const items = React.useMemo(() => groups.flatMap((g) => g.items), [groups])
  const searchParams = useSearchParams()
  const requested = parseItemParam(searchParams.get("item"))
  const requestedItem = requested ? items.find((i) => itemKey(i) === itemKey(requested)) : undefined
  // 기본 선택 = 목록 맨 위 [가정]
  const selected = requestedItem ?? items[0]
  const [deleting, setDeleting] = React.useState<DeleteTarget | null>(null)

  const missing = requested !== null && requestedItem === undefined
  React.useEffect(() => {
    if (missing) toast("찾을 수 없는 항목이에요")
  }, [missing])

  const select = React.useCallback((item: CareerItem | null) => {
    const url = new URL(window.location.href)
    if (item) url.searchParams.set("item", itemKey(item))
    else url.searchParams.delete("item")
    window.history.pushState(null, "", url)
  }, [])

  const confirmDelete = async (opts: { result_mode?: "keep_results" | "delete_results"; affiliation_mode?: "keep_projects" | "delete_projects" }) => {
    if (!deleting || deleting.kind !== "career") return
    await deleteCareerItemAction(deleting.entity_type, deleting.entity_id, opts.affiliation_mode, opts.result_mode)
    if (selected && deleting.entity_id === selected.id) select(null)
  }

  // 좁은 화면: URL에 항목이 있으면 상세부터, 없으면 목록부터 [가정]
  const showDetailOnNarrow = requestedItem !== undefined

  return (
    <div className="flex flex-1 flex-col gap-4 lg:flex-row lg:gap-0">
      <nav aria-label="커리어 목록" className={cn("flex w-full shrink-0 flex-col gap-4 lg:w-60 lg:px-3", showDetailOnNarrow && "hidden lg:flex")}>
        <h2 className="text-sm font-semibold text-muted-foreground">커리어</h2>
        <AddCareerMenu />
        <CareerList groups={groups} selectedKey={selected ? itemKey(selected) : null} onSelect={select} />
      </nav>

      <section
        aria-label="커리어 상세"
        className={cn("flex min-w-0 flex-1 flex-col gap-4 lg:px-3", !showDetailOnNarrow && items.length > 0 && "hidden lg:flex")}
      >
        {showDetailOnNarrow ? (
          <Button variant="ghost" size="sm" className="-ml-2 self-start lg:hidden" onClick={() => select(null)}>
            <ArrowLeft aria-hidden />
            커리어
          </Button>
        ) : null}
        <h2 className="hidden text-sm font-semibold text-muted-foreground lg:block">커리어 상세</h2>
        {selected ? (
          <DetailPanel key={itemKey(selected)} item={selected} onDelete={setDeleting} />
        ) : (
          <EmptyState
            icon={Layers}
            title="커리어를 정리해 두면 자기소개서마다 인사이트·서류·면접에 바로 쓸 수 있어요"
            description="경력·교육 아래에 프로젝트를 만들면 Resumate AI와 대화하며 내용을 채울 수 있어요(AI 연결 필요)"
            actions={<AddCareerMenu primary />}
          />
        )}
      </section>

      <DeleteConfirmDialog target={deleting} open={deleting !== null} onOpenChange={(o) => !o && setDeleting(null)} onConfirm={confirmDelete} />
    </div>
  )
}

/**
 * C-22 커리어 추가 — 유형 선택. // [UI-가정] 명세는 작은 다이얼로그. 새 경력·교육 패널과 C-23이 아직 없어
 * 기존 새 항목 화면으로 보내는 메뉴로 둔다.
 */
function AddCareerMenu({ primary = false }: { primary?: boolean }) {
  const options = [
    { href: routes.experienceNew(), label: "경력", hint: "회사에서 일한 기간" },
    { href: routes.educationNew(), label: "교육", hint: "학위 과정, 부트캠프·교육 과정" },
    { href: routes.projectNew(), label: "프로젝트", hint: "회사·학교에 속하지 않은 개인·사이드 프로젝트" },
  ]
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant={primary ? "default" : "secondary"} className={cn(!primary && "w-full")}>
          <CirclePlus aria-hidden />
          커리어 추가
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align={primary ? "center" : "start"} className="w-72">
        <DropdownMenuLabel>어떤 커리어를 추가할까요?</DropdownMenuLabel>
        {options.map((o) => (
          <DropdownMenuItem key={o.label} asChild>
            <Link href={o.href} className="flex flex-col items-start gap-0.5">
              <span className="font-medium">{o.label}</span>
              <span className="text-xs text-muted-foreground">{o.hint}</span>
            </Link>
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

function CareerList({
  groups,
  selectedKey,
  onSelect,
}: {
  groups: YearGroup[]
  selectedKey: string | null
  onSelect: (item: CareerItem) => void
}) {
  // 위아래 화살표로 항목 사이를 옮긴다 [가정]
  const onKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (e.key !== "ArrowDown" && e.key !== "ArrowUp") return
    const rows = [...e.currentTarget.querySelectorAll<HTMLButtonElement>("[data-career-item]")]
    const at = rows.indexOf(document.activeElement as HTMLButtonElement)
    if (at === -1) return
    e.preventDefault()
    rows[Math.min(rows.length - 1, Math.max(0, at + (e.key === "ArrowDown" ? 1 : -1)))]?.focus()
  }
  return (
    <div className="flex flex-col gap-4" onKeyDown={onKeyDown}>
      {groups.map((g) => (
        <section key={g.key} aria-label={g.label === "연도 미정" ? g.label : `${g.label}년`} className="flex flex-col gap-1">
          <h3 className="text-sm text-muted-foreground tabular-nums">{g.label}</h3>
          <ul className="flex flex-col">
            {g.items.map((item) => {
              const key = itemKey(item)
              const active = key === selectedKey
              const Icon = KIND_ICONS[item.kind]
              return (
                <li key={key}>
                  <button
                    type="button"
                    data-career-item
                    aria-current={active ? "true" : undefined}
                    onClick={() => onSelect(item)}
                    className={cn(
                      "flex min-h-11 w-full items-center gap-2 rounded-xl px-3 py-2.5 text-left text-base transition-colors outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50",
                      active ? "bg-muted" : "hover:bg-muted/60",
                    )}
                  >
                    {/* 종류가 섞인 목록이라 작은 표식을 함께 둔다 [가정] */}
                    <Icon className="size-4 shrink-0 text-muted-foreground" aria-hidden />
                    <span className="sr-only">{KIND_LABELS[item.kind]}</span>
                    <span className="min-w-0 flex-1 truncate">{itemName(item)}</span>
                  </button>
                </li>
              )
            })}
          </ul>
        </section>
      ))}
    </div>
  )
}

function DetailPanel({ item, onDelete }: { item: CareerItem; onDelete: (t: DeleteTarget) => void }) {
  const name = itemName(item)
  const head = (
    <div className="flex items-start gap-2">
      <h3 className="min-w-0 flex-1 text-xl font-semibold break-words">{name}</h3>
      {/* 머리 메뉴 (⋯) — 삭제 진입점 [가정] */}
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="icon-sm" className="size-11 lg:size-8" aria-label={`${name} 메뉴`}>
            <MoreHorizontal aria-hidden />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem
            className="text-destructive"
            onSelect={() => onDelete({ kind: "career", entity_type: item.kind, entity_id: item.id, label: name })}
          >
            {KIND_LABELS[item.kind]} 삭제
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  )

  if (item.kind === "experience") {
    const e = item.experience
    const edit = routes.experience(e.id)
    return (
      <div className="flex flex-col gap-6">
        {head}
        <PanelSection title="재직 정보" action={<EditLink href={edit} label="재직 정보 수정" />}>
          <InfoList
            rows={[
              ["재직 기간 / 고용 형태", [formatRange(e.start_month, e.end_month, e.is_current), e.employment_type ? EMPLOYMENT_TYPE_LABELS[e.employment_type] : null].filter(Boolean).join(" · ")],
              ["부서", e.department],
              ["직급 / 직무", [e.job_rank, e.job_position].filter(Boolean).join(" / ")],
            ]}
          />
        </PanelSection>
        <Separator />
        <PanelSection title="근무 내용" action={<EditLink href={edit} label="근무 내용 수정" />}>
          <LongText text={e.summary} href={edit} />
        </PanelSection>
        <Separator />
        <ProjectsSection
          title="프로젝트"
          projects={item.projects}
          addHref={routes.projectNew({ experience_id: e.id })}
          empty="이 회사에서 한 프로젝트를 추가해 보세요"
        />
      </div>
    )
  }

  if (item.kind === "education") {
    const e = item.education
    const edit = routes.education(e.id)
    return (
      <div className="flex flex-col gap-6">
        {head}
        <PanelSection title="교육 정보" action={<EditLink href={edit} label="교육 정보 수정" />}>
          <InfoList
            rows={[
              [
                "교육 기간",
                [formatRange(e.start_month, e.end_month, e.enrollment_status === "enrolled"), e.enrollment_status ? ENROLLMENT_STATUS_LABELS[e.enrollment_status] : null]
                  .filter(Boolean)
                  .join(" · "),
              ],
              ["구분", e.education_type ? EDUCATION_TYPE_LABELS[e.education_type] : null],
              ["전공/과정명", e.program_name],
            ]}
          />
        </PanelSection>
        <Separator />
        <PanelSection title="교육 내용" action={<EditLink href={edit} label="교육 내용 수정" />}>
          <LongText text={e.description} href={edit} />
        </PanelSection>
        <Separator />
        <ProjectsSection
          title="진행 프로젝트"
          projects={item.projects}
          addHref={routes.projectNew({ education_id: e.id })}
          empty="이 과정에서 한 프로젝트를 추가해 보세요"
        />
      </div>
    )
  }

  // S-43 독립 프로젝트 — STAR·AI 패널 없음 (CR-7). // [UI-가정] Link·산출물은 DM v4.4 컬럼이 생기면 추가
  const p = item.project
  const edit = routes.project(p.id)
  const span = formatMonthSpan(p.start_month, p.end_month)
  return (
    <div className="flex flex-col gap-6">
      {head}
      <PanelSection title="프로젝트 정보" action={<EditLink href={edit} label="프로젝트 정보 수정" />}>
        <InfoList
          rows={[
            ["프로젝트 기간", [formatRange(p.start_month, p.end_month), span ? `(${span})` : null].filter(Boolean).join(" ")],
            ["담당 업무", p.role],
            [
              "사용 기술",
              p.skills.length ? (
                <span className="flex flex-wrap gap-1">
                  {p.skills.map((s) => (
                    <Badge key={s.id} variant="secondary">
                      {s.name}
                    </Badge>
                  ))}
                </span>
              ) : null,
            ],
          ]}
        />
      </PanelSection>
      <Separator />
      <PanelSection title="프로젝트 내용" action={<EditLink href={edit} label="프로젝트 내용 수정" />}>
        {/* [UI-가정] DM v4.4 `projects.description` 전까지는 기존 summary를 보여 준다 */}
        <LongText text={p.summary} href={edit} />
      </PanelSection>
    </div>
  )
}

function PanelSection({ title, action, children, className }: { title: string; action?: React.ReactNode; children: React.ReactNode; className?: string }) {
  return (
    <section aria-label={title} className={cn("flex flex-col gap-2", className)}>
      <div className="flex min-h-8 items-center gap-2">
        <h4 className="min-w-0 flex-1 text-base font-medium">{title}</h4>
        {action}
      </div>
      {children}
    </section>
  )
}

function EditLink({ href, label }: { href: string; label: string }) {
  return (
    <Button asChild variant="ghost" size="sm" className="text-muted-foreground">
      <Link href={href} aria-label={label}>
        <Pencil aria-hidden />
        수정
      </Link>
    </Button>
  )
}

function InfoList({ rows }: { rows: Array<[string, React.ReactNode]> }) {
  return (
    <dl className="flex flex-col gap-2 text-sm">
      {rows.map(([label, value]) => (
        <div key={label} className="flex flex-col gap-0.5 sm:flex-row sm:items-center sm:gap-0">
          <dt className="shrink-0 font-medium text-muted-foreground sm:w-[140px]">{label}</dt>
          <dd className="min-w-0 break-words">{value || <span className="text-muted-foreground">—</span>}</dd>
        </div>
      ))}
    </dl>
  )
}

/** 긴 글 보기. 비면 "내용을 입력해주세요" — 누르면 수정과 같음 (C-24 빈 섹션) */
function LongText({ text, href }: { text: string | null; href: string }) {
  if (!text?.trim())
    return (
      <Link href={href} className="rounded-sm py-2.5 text-base text-muted-foreground hover:underline">
        내용을 입력해주세요
      </Link>
    )
  return <p className="text-base leading-relaxed whitespace-pre-wrap break-words">{text}</p>
}

function ProjectsSection({ title, projects, addHref, empty }: { title: string; projects: ProjectWithChildren[]; addHref: string; empty: string }) {
  return (
    <PanelSection
      title={title}
      action={
        <Button asChild variant="ghost" size="sm" className="text-muted-foreground">
          <Link href={addHref}>
            <Plus aria-hidden />
            프로젝트 추가
          </Link>
        </Button>
      }
    >
      {projects.length ? (
        <ul className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          {projects.map((p) => (
            <li key={p.id} className="min-w-0">
              <ProjectCard project={p} />
            </li>
          ))}
        </ul>
      ) : (
        <p className="py-2.5 text-sm text-muted-foreground">{empty}</p>
      )}
    </PanelSection>
  )
}

/** C-25 프로젝트 카드: (종류 태그) + 이름 한 줄 + 기간 (N년 N개월) → S-10 */
function ProjectCard({ project: p }: { project: ProjectWithChildren }) {
  const name = p.name ?? "이름 없는 프로젝트"
  const span = formatMonthSpan(p.start_month, p.end_month)
  const period = [formatRange(p.start_month, p.end_month), span ? `(${span})` : null].filter(Boolean).join(" ")
  return (
    <Link
      href={routes.project(p.id)}
      className="flex h-full min-h-11 flex-col justify-center gap-2 rounded-[10px] px-3 py-2.5 transition-colors outline-none hover:bg-muted focus-visible:ring-[3px] focus-visible:ring-ring/50"
    >
      {/* [UI-가정] 종류 태그(projects.project_type)는 컬럼이 생기면 여기에 Badge로 */}
      <span className="truncate text-base" title={name}>
        {name}
      </span>
      {period ? <span className="text-sm text-muted-foreground tabular-nums">{period}</span> : null}
    </Link>
  )
}
