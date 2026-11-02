"use client"

/**
 * S-10 프로젝트 편집 (v4: 기여 내용·팀·배경 없음 — 상세 내용 STAR로 이동).
 * 소속(경력 | 교육 | 없음) · 이름* · 역할* · 한 줄 요약(≤200) · 기간 · 팀 규모 · 사용 기술 ·
 * 상세 내용 목록(순서 변경) · AI로 보강(S-36) · AI 작성 대화 기록(대화만 삭제) · C-06 · C-05.
 */
import * as React from "react"
import Link from "next/link"
import { ArrowDown, ArrowUp, Info, Loader2, MessagesSquare, MoreHorizontal, PauseCircle, Plus, Sparkles, X } from "lucide-react"
import { cn } from "@/lib/utils"
import { Alert, AlertTitle } from "@/components/ui/alert"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectGroup, SelectItem, SelectLabel, SelectTrigger, SelectValue } from "@/components/ui/select"
import { PageHeader } from "@/components/common/basics"
import { DraftBadge, DraftNotice, SaveStatus } from "@/components/common/save-status"
import { CharCount, MonthField } from "@/components/common/input-guide"
import { DeleteConfirmDialog } from "@/components/common/delete-confirm-dialog"
import type { Education, Experience, Project, WritingChat } from "@/types/db"
import { WRITING_CHAT_MODE_LABELS, WRITING_CHAT_STATUS_LABELS, formatRelative } from "@/lib/data/labels"
import type { ProjectWithChildren } from "@/lib/data/career"
import { routes } from "@/lib/routes"
import { deleteCareerItemAction, reorderProjectDetailsAction, saveProjectAction, setProjectSkillsAction } from "./actions"
import { AiRunButton } from "@/components/common/ai-run-button"
import { chatLock } from "./gate-next-step"
import { DangerZone, FormSection, TextField, nn, useRowAutosave } from "./form-parts"
import { StarFill } from "./star-fill"
import { readCareerReturn } from "@/components/common/return-target"
import { RETURN_FEATURE_LABELS } from "@/components/common/return-banner"
import { useResumeChat } from "./writing-chat/abandon"

const FIELD_RING = "ring-2 ring-primary ring-offset-2 ring-offset-background"

const SUMMARY_LIMIT = 200

interface Values {
  affiliation: string // "none" | "exp:{id}" | "edu:{id}"
  name: string
  role: string
  summary: string
  start_month: string | null
  end_month: string | null
  team_size: string
}

function affiliationKey(p: { experience_id: string | null; education_id: string | null } | null): string {
  if (p?.experience_id) return `exp:${p.experience_id}`
  if (p?.education_id) return `edu:${p.education_id}`
  return "none"
}

function toValues(p: Project | null, initialAffiliation: { experience_id?: string; education_id?: string }): Values {
  return {
    affiliation: p
      ? affiliationKey(p)
      : affiliationKey({ experience_id: initialAffiliation.experience_id ?? null, education_id: initialAffiliation.education_id ?? null }),
    name: p?.name ?? "",
    role: p?.role ?? "",
    summary: p?.summary ?? "",
    start_month: p?.start_month ?? null,
    end_month: p?.end_month ?? null,
    team_size: p?.team_size === null || p?.team_size === undefined ? "" : String(p.team_size),
  }
}

export function ProjectForm({
  project,
  experiences,
  educations,
  initialAffiliation = {},
  focusFields = null,
}: {
  project: ProjectWithChildren | null
  experiences: Pick<Experience, "id" | "company_name">[]
  educations: Pick<Education, "id" | "institution_name">[]
  initialAffiliation?: { experience_id?: string; education_id?: string }
  /** v5.3 A18: opened from C-09 hint project_fields (`?focus=fields`) */
  focusFields?: { applicationProjectId: string | null } | null
}) {
  const [values, setValues] = React.useState<Values>(() => toValues(project, initialAffiliation))
  const [skills, setSkills] = React.useState<string[]>(() => project?.skills.map((s) => s.name) ?? [])
  const [skillInput, setSkillInput] = React.useState("")
  const [details, setDetails] = React.useState(() => project?.details ?? [])
  const [chats, setChats] = React.useState<WritingChat[]>(() => project?.writing_chats ?? [])
  const [deletingChat, setDeletingChat] = React.useState<WritingChat | null>(null)
  const [announce, setAnnounce] = React.useState("")
  const { resume, pendingId: resumingId } = useResumeChat()

  const { autosave, row, id } = useRowAutosave<Values, Project>({
    initialId: project?.id ?? null,
    initialRow: project,
    editHref: routes.project,
    save: (rowId, v, opts) => {
      const [kind, affId] = v.affiliation.split(":")
      const team = Number(v.team_size)
      return saveProjectAction(
        rowId,
        {
          experience_id: kind === "exp" ? affId : null,
          education_id: kind === "edu" ? affId : null,
          name: nn(v.name),
          role: nn(v.role),
          summary: nn(v.summary.slice(0, SUMMARY_LIMIT)),
          start_month: v.start_month,
          end_month: v.end_month,
          team_size: v.team_size.trim() && Number.isFinite(team) && team > 0 ? Math.round(team) : null,
        },
        opts,
      )
    },
  })

  const set = (patch: Partial<Values>) => {
    const next = { ...values, ...patch }
    setValues(next)
    autosave.schedule(next)
  }
  const blur = () => void autosave.flush()

  // v5.3 A18 (design-system 6장 A2 S-10): highlight the empty name / role, focus the first one and
  // flash it once. The ring of a field goes away once it has a value. No error styling.
  const nameEmpty = !values.name.trim()
  const roleEmpty = !values.role.trim()
  const [flashField, setFlashField] = React.useState<"name" | "role" | null>(null)
  // UQ-484: undefined until the browser-session return target is read → the note renders once,
  // already with the real feature name (no "AI 기능" → "인사이트" flicker)
  const [featureLabel, setFeatureLabel] = React.useState<string | null | undefined>(undefined)
  const focusOnce = React.useRef(false)
  React.useEffect(() => {
    if (!focusFields || featureLabel !== undefined) return
    // the C-09 return target (browser session) names the feature: "{기능}에 바로 쓸 수 있어요"
    const stored = readCareerReturn()
    const label =
      stored && (!focusFields.applicationProjectId || stored.application_project_id === focusFields.applicationProjectId)
        ? RETURN_FEATURE_LABELS[stored.feature]
        : null
    // eslint-disable-next-line react-hooks/set-state-in-effect -- one-shot read of session storage
    setFeatureLabel(label)
  }, [focusFields, featureLabel])
  React.useEffect(() => {
    // focus after the note exists, so the input's aria-describedby reads it (UQ-484)
    if (!focusFields || featureLabel === undefined || focusOnce.current) return
    focusOnce.current = true
    const first = !values.name.trim() ? "name" : !values.role.trim() ? "role" : null
    if (!first) return
    document.getElementById(first === "name" ? "prj-name" : "prj-role")?.focus()
    // eslint-disable-next-line react-hooks/set-state-in-effect -- one-shot arrival flash
    setFlashField(first)
    const t = window.setTimeout(() => setFlashField(null), 1400)
    return () => window.clearTimeout(t)
  }, [focusFields, featureLabel, values.name, values.role])
  const fieldsNoteShown = Boolean(focusFields) && featureLabel !== undefined && (nameEmpty || roleEmpty)
  const fieldClass = (field: "name" | "role", empty: boolean) =>
    focusFields ? cn(empty && FIELD_RING, flashField === field && "animate-field-flash") : undefined
  const status = row?.status ?? project?.status ?? "draft"
  const title = values.name.trim() || "새 프로젝트"

  const updateSkills = async (next: string[]) => {
    setSkills(next)
    if (id) await setProjectSkillsAction(id, next)
  }
  const addSkill = () => {
    const name = skillInput.trim()
    if (!name || skills.some((s) => s.toLowerCase() === name.toLowerCase())) return setSkillInput("")
    setSkillInput("")
    void updateSkills([...skills, name])
  }

  const move = async (index: number, dir: -1 | 1) => {
    const target = index + dir
    if (target < 0 || target >= details.length || !id) return
    const next = [...details]
    ;[next[index], next[target]] = [next[target], next[index]]
    setDetails(next)
    setAnnounce(`'${next[target].title ?? "제목 없음"}'을 ${target + 1}번째로 옮겼어요`)
    await reorderProjectDetailsAction(id, next.map((d) => d.id))
  }

  return (
    <div className="mx-auto max-w-3xl space-y-8">
      <PageHeader
        title={title}
        badge={id && status === "draft" ? <DraftBadge /> : null}
        description="이름·역할 + 완료된 상세 내용 1개 이상이면 완료돼요"
        status={<SaveStatus state={autosave.state} savedAt={autosave.savedAt} onRetry={autosave.retry} />}
      />
      {id && status === "draft" ? <DraftNotice /> : null}

      <FormSection title="기본 정보">
        {fieldsNoteShown ? (
          // [UI-가정] the note stays while either field is empty; {기능} falls back to "AI 기능"
          // when the return target is gone (e.g. a new tab)
          <Alert variant="info" className="py-2 text-sm" id="prj-fields-note">
            <Info aria-hidden />
            <AlertTitle className="font-normal">이름과 역할을 채우면 {featureLabel ?? "AI 기능"}에 바로 쓸 수 있어요</AlertTitle>
          </Alert>
        ) : null}
        <div className="space-y-1.5">
          <Label htmlFor="prj-affiliation" className="text-sm font-medium">
            소속
          </Label>
          <Select value={values.affiliation} onValueChange={(v) => set({ affiliation: v })}>
            <SelectTrigger id="prj-affiliation" className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="none">없음 (기타 프로젝트)</SelectItem>
              {experiences.length ? (
                <SelectGroup>
                  <SelectLabel>경력</SelectLabel>
                  {experiences.map((e) => (
                    <SelectItem key={e.id} value={`exp:${e.id}`}>
                      {e.company_name ?? "회사명 없음"}
                    </SelectItem>
                  ))}
                </SelectGroup>
              ) : null}
              {educations.length ? (
                <SelectGroup>
                  <SelectLabel>교육</SelectLabel>
                  {educations.map((e) => (
                    <SelectItem key={e.id} value={`edu:${e.id}`}>
                      {e.institution_name ?? "기관명 없음"}
                    </SelectItem>
                  ))}
                </SelectGroup>
              ) : null}
            </SelectContent>
          </Select>
          <p className="text-sm text-muted-foreground">경력·교육 중 하나에만 연결할 수 있어요</p>
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <TextField
            id="prj-name"
            label="프로젝트 이름"
            required
            value={values.name}
            inputClassName={fieldClass("name", nameEmpty)}
            describedBy={fieldsNoteShown ? "prj-fields-note" : undefined}
            onChange={(v) => set({ name: v })}
            onBlur={blur}
          />
          <TextField
            id="prj-role"
            label="역할"
            required
            value={values.role}
            inputClassName={fieldClass("role", roleEmpty)}
            describedBy={fieldsNoteShown ? "prj-fields-note" : undefined}
            onChange={(v) => set({ role: v })}
            onBlur={blur}
          />
        </div>
        <TextField
          id="prj-summary"
          label="한 줄 요약"
          value={values.summary}
          maxLength={SUMMARY_LIMIT}
          onChange={(v) => set({ summary: v })}
          onBlur={blur}
          help={
            <div className="flex justify-end">
              <CharCount count={values.summary.length} limit={SUMMARY_LIMIT} />
            </div>
          }
        />
        <div className="grid gap-4 sm:grid-cols-2">
          <MonthField id="prj-start" label="시작" value={values.start_month} onChange={(v) => set({ start_month: v })} />
          <MonthField id="prj-end" label="종료" value={values.end_month} onChange={(v) => set({ end_month: v })} />
        </div>
        <TextField
          id="prj-team"
          label="팀 규모(명)"
          inputMode="numeric"
          className="sm:w-40"
          value={values.team_size}
          onChange={(v) => set({ team_size: v.replace(/[^\d]/g, "") })}
          onBlur={blur}
        />
      </FormSection>

      <FormSection title="사용 기술">
        {skills.length ? (
          <ul className="flex flex-wrap gap-2" aria-label="사용 기술">
            {skills.map((s) => (
              <li key={s}>
                <Badge variant="secondary" className="h-8 gap-1 pr-1 pl-3 text-sm">
                  {s}
                  <Button
                    variant="ghost"
                    size="icon-xs" className="size-11 lg:size-7"
                    aria-label={`${s} 빼기`}
                    onClick={() => void updateSkills(skills.filter((x) => x !== s))}
                  >
                    <X aria-hidden />
                  </Button>
                </Badge>
              </li>
            ))}
          </ul>
        ) : null}
        <div className="flex gap-2">
          <Input
            aria-label="기술 이름"
            placeholder={id ? "기술 이름 입력 후 Enter" : "프로젝트 이름을 먼저 입력해 주세요"}
            disabled={!id}
            value={skillInput}
            onChange={(e) => setSkillInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.nativeEvent.isComposing) {
                e.preventDefault()
                addSkill()
              }
            }}
          />
          <Button variant="outline" onClick={addSkill} disabled={!id || !skillInput.trim()}>
            추가
          </Button>
        </div>
      </FormSection>

      <FormSection
        title="상세 내용"
        description="완료된 상세 내용이 1개 이상 있어야 AI 분석에 쓰여요"
        actions={
          id ? (
            <Button asChild variant="outline" size="sm">
              <Link href={routes.projectDetailNew(id)}>
                <Plus aria-hidden />
                상세 내용
              </Link>
            </Button>
          ) : null
        }
      >
        {details.length === 0 ? (
          <p className="flex items-start gap-1.5 rounded-md bg-muted p-3 text-sm">
            <Info className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden />
            {id
              ? "아직 상세 내용이 없어요. 상세 내용이 없으면 프로젝트를 완료할 수 없어요"
              : "프로젝트 이름을 입력하면 상세 내용을 추가할 수 있어요"}
          </p>
        ) : (
          <ol className="divide-y rounded-md border">
            {details.map((d, i) => (
              <li key={d.id} className="flex flex-wrap items-center gap-2 px-3 py-2.5">
                <Link href={routes.projectDetail(d.project_id, d.id)} className="min-w-0 flex-1 rounded-sm font-medium hover:underline">
                  {d.title ?? "제목 없음"}
                </Link>
                {d.status === "draft" ? <DraftBadge label="작성 중 — AI 미반영" /> : null}
                <StarFill detail={d} />
                <span className="text-xs font-medium text-muted-foreground tabular-nums">정량 성과 {d.achievements.length}</span>
                {d.source_writing_chat_id ? (
                  <Button asChild variant="link" size="sm" className="h-auto px-0">
                    <Link href={routes.writingChat(d.source_writing_chat_id)}>
                      <MessagesSquare aria-hidden />
                      출처 대화 보기
                    </Link>
                  </Button>
                ) : null}
                <span className="flex">
                  <Button variant="ghost" size="icon-sm" className="size-11 lg:size-8" aria-label={`'${d.title ?? "제목 없음"}' 위로`} disabled={i === 0} onClick={() => void move(i, -1)}>
                    <ArrowUp aria-hidden />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon-sm" className="size-11 lg:size-8"
                    aria-label={`'${d.title ?? "제목 없음"}' 아래로`}
                    disabled={i === details.length - 1}
                    onClick={() => void move(i, 1)}
                  >
                    <ArrowDown aria-hidden />
                  </Button>
                </span>
              </li>
            ))}
          </ol>
        )}
        <p className="sr-only" aria-live="polite">
          {announce}
        </p>
      </FormSection>

      <FormSection title="AI로 보강" description="이 프로젝트 내용을 바탕으로 AI가 질문하고, 답하면 상세 내용으로 정리해요">
        {/* C-18 인라인 (키 없음) / C-19 배지 — AiRunButton. 대안 = 직접 입력(S-35 새 상세 내용) */}
        <AiRunButton
          variant="outline"
          href={id ? routes.writingChatNew({ mode: "augment_project", project_id: id }) : undefined}
          disabled={!id}
          lock={chatLock("AI와 대화하며 상세 내용 추가", id ? routes.projectDetailNew(id) : undefined)}
        >
          <Sparkles aria-hidden />
          AI와 대화하며 상세 내용 추가
        </AiRunButton>
      </FormSection>

      {chats.length ? (
        <FormSection title="AI 작성 대화 기록">
          <ul className="divide-y rounded-md border">
            {chats.map((c) => (
              <li key={c.id} className="flex min-h-11 items-center gap-2 px-3 py-2">
                {c.status === "abandoned" ? (
                  <PauseCircle className="size-4 text-muted-foreground" aria-hidden />
                ) : (
                  <Sparkles className="size-4 text-ai" aria-hidden />
                )}
                <Link href={routes.writingChat(c.id)} className="min-w-0 flex-1 hover:underline">
                  {WRITING_CHAT_MODE_LABELS[c.mode]}
                </Link>
                <Badge
                  variant={c.status === "active" ? "ai" : "outline"}
                  className={c.status === "abandoned" ? "text-muted-foreground" : undefined}
                >
                  {WRITING_CHAT_STATUS_LABELS[c.status]}
                </Badge>
                <span className="text-sm text-muted-foreground">{formatRelative(c.last_activity_at)}</span>
                {c.status === "abandoned" ? (
                  // v5.3 A6: 다시 이어 하기 (→ active, no AI call / no key needed → S-36), no C-19 badge
                  <Button variant="outline" size="sm" disabled={resumingId !== null} onClick={() => void resume(c.id)}>
                    {resumingId === c.id ? <Loader2 className="animate-spin" aria-hidden /> : null}
                    다시 이어 하기
                  </Button>
                ) : (
                  <Button asChild variant="outline" size="sm">
                    {/* active → 이어서, saved / handed_off → 읽기 전용 */}
                    <Link href={routes.writingChat(c.id)}>{c.status === "active" ? "이어서" : "열기"}</Link>
                  </Button>
                )}
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      className="size-11 lg:size-8"
                      aria-label={`'${WRITING_CHAT_MODE_LABELS[c.mode]}' 대화(${WRITING_CHAT_STATUS_LABELS[c.status]}, ${formatRelative(c.last_activity_at)}) 메뉴`}
                    >
                      <MoreHorizontal aria-hidden />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end">
                    <DropdownMenuItem className="text-destructive" onSelect={() => setDeletingChat(c)}>
                      대화만 삭제
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              </li>
            ))}
          </ul>
          <DeleteConfirmDialog
            target={deletingChat ? { kind: "writing_chat", entity_id: deletingChat.id } : null}
            open={deletingChat !== null}
            onOpenChange={(open) => !open && setDeletingChat(null)}
            onConfirm={async () => {
              if (!deletingChat) return
              await deleteCareerItemAction("writing_chat", deletingChat.id)
              setChats((list) => list.filter((x) => x.id !== deletingChat.id))
            }}
          />
        </FormSection>
      ) : null}

      <DangerZone entityType="project" entityId={id} label={title} afterHref={routes.career()} buttonLabel="프로젝트 삭제" />
    </div>
  )
}
