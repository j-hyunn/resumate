"use client"

/**
 * C-11 변경 트리 (design-system 3.10): 완료 상태 경력·교육 → 프로젝트 → (선택) 완료된 상세 내용.
 * Used by S-17 경력기술서 포함 항목 (projects only) and S-19 자소서 문항 근거 변경 (projects + details).
 */
import * as React from "react"
import { Briefcase, ChevronDown, ChevronRight, FolderOpen, GraduationCap } from "lucide-react"
import { Checkbox } from "@/components/ui/checkbox"
import { Label } from "@/components/ui/label"
import { cn } from "@/lib/utils"
import type { SourceTree, SourceTreeProject } from "@/lib/data/drafts"

export interface TreeSelection {
  /** project_id → selected detail ids ([] = AI가 고름 / all) */
  projects: Record<string, string[]>
}

export function SourceCheckTree({
  tree,
  selection,
  onChange,
  disabled = false,
  withDetails = false,
  idPrefix,
  maxProjects,
}: {
  tree: SourceTree
  selection: TreeSelection
  onChange: (next: TreeSelection) => void
  disabled?: boolean
  withDetails?: boolean
  idPrefix: string
  /**
   * v5.3 선택 개수 상한 (design-system 6장 A3): 경력기술서 프로젝트 8개, 자소서 문항당 근거 5개. At the limit
   * the unchecked project checkboxes are disabled; the caller shows the meta line above the tree.
   */
  maxProjects?: number
}) {
  const full = maxProjects !== undefined && Object.keys(selection.projects).length >= maxProjects
  const toggleProject = (id: string, on: boolean) => {
    const next = { ...selection.projects }
    if (on) next[id] = next[id] ?? []
    else delete next[id]
    onChange({ projects: next })
  }
  const toggleDetail = (projectId: string, detailId: string, on: boolean) => {
    const current = selection.projects[projectId] ?? []
    const nextDetails = on ? [...current, detailId] : current.filter((d) => d !== detailId)
    onChange({ projects: { ...selection.projects, [projectId]: nextDetails } })
  }
  const empty = tree.affiliations.every((a) => a.projects.length === 0) && tree.standalone.length === 0
  if (empty)
    return <p className="text-sm text-muted-foreground">완료된 프로젝트가 없어요. 커리어에서 프로젝트를 완료하면 고를 수 있어요</p>

  return (
    <div className="space-y-3">
      {tree.affiliations
        .filter((a) => a.projects.length > 0)
        .map((a) => {
          const Icon = a.kind === "experience" ? Briefcase : GraduationCap
          return (
            <div key={a.id} className="space-y-1">
              <p className="flex flex-wrap items-center gap-2 text-sm font-medium">
                <Icon className="size-4 text-muted-foreground" aria-hidden />
                {a.name}
                {a.meta ? <span className="font-normal text-muted-foreground">{a.meta}</span> : null}
              </p>
              <ul className="ml-2 space-y-1 border-l pl-4">
                {a.projects.map((p) => (
                  <ProjectRow
                    key={p.id}
                    project={p}
                    checked={p.id in selection.projects}
                    details={selection.projects[p.id] ?? []}
                    onProject={toggleProject}
                    onDetail={toggleDetail}
                    disabled={disabled}
                    full={full}
                    withDetails={withDetails}
                    idPrefix={idPrefix}
                  />
                ))}
              </ul>
            </div>
          )
        })}
      {tree.standalone.length ? (
        <div className="space-y-1">
          <p className="flex items-center gap-2 text-sm font-medium">
            <FolderOpen className="size-4 text-muted-foreground" aria-hidden />
            독립 프로젝트
          </p>
          <ul className="ml-2 space-y-1 border-l pl-4">
            {tree.standalone.map((p) => (
              <ProjectRow
                key={p.id}
                project={p}
                checked={p.id in selection.projects}
                details={selection.projects[p.id] ?? []}
                onProject={toggleProject}
                onDetail={toggleDetail}
                disabled={disabled}
                full={full}
                withDetails={withDetails}
                idPrefix={idPrefix}
              />
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  )
}

function ProjectRow({
  project,
  checked,
  details,
  onProject,
  onDetail,
  disabled,
  full = false,
  withDetails,
  idPrefix,
}: {
  project: SourceTreeProject
  checked: boolean
  details: string[]
  onProject: (id: string, on: boolean) => void
  onDetail: (projectId: string, detailId: string, on: boolean) => void
  disabled: boolean
  /** the selection limit is reached → an unchecked project cannot be added */
  full?: boolean
  withDetails: boolean
  idPrefix: string
}) {
  const [open, setOpen] = React.useState(details.length > 0)
  const id = `${idPrefix}-${project.id}`
  return (
    <li className="space-y-1">
      <div className="flex min-h-11 items-center gap-2">
        <Checkbox id={id} checked={checked} disabled={disabled || (full && !checked)} onCheckedChange={(v) => onProject(project.id, v === true)} />
        <Label htmlFor={id} className={cn("flex-1 cursor-pointer text-base font-normal", (disabled || (full && !checked)) && "cursor-default")}>
          {project.name}
          {project.period ? <span className="ml-2 text-sm text-muted-foreground tabular-nums">{project.period}</span> : null}
        </Label>
        {withDetails && checked && project.details.length ? (
          <button
            type="button"
            onClick={() => setOpen((o) => !o)}
            aria-expanded={open}
            className="inline-flex items-center gap-1 rounded-sm text-sm text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            {open ? <ChevronDown className="size-4" aria-hidden /> : <ChevronRight className="size-4" aria-hidden />}
            상세 내용 {details.length ? `${details.length}개 지정` : "AI가 고름"}
          </button>
        ) : null}
      </div>
      {withDetails && checked && open ? (
        <ul className="ml-6 space-y-1">
          {project.details.map((d) => {
            const did = `${id}-${d.id}`
            return (
              <li key={d.id} className="flex min-h-11 items-center gap-2">
                <Checkbox id={did} checked={details.includes(d.id)} disabled={disabled} onCheckedChange={(v) => onDetail(project.id, d.id, v === true)} />
                <Label htmlFor={did} className="cursor-pointer text-sm font-normal">
                  {d.title}
                </Label>
              </li>
            )
          })}
        </ul>
      ) : null}
    </li>
  )
}
