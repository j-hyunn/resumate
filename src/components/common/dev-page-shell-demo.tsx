"use client"

/**
 * /dev/page-shell (development only): the A0 L-02 foundation wired end to end on the v4.5 mock — PageShell,
 * SaveButton (all states), CrumbRow, LeaveGuard, input preservation, StaleWriteDialog, DocTitleInput,
 * FieldRows / ChipSelect / CompetencyChips / MonthField sm, DocTextarea, DocBody + ResizeHandle, and the
 * Resumate AI panel core with a placeholder proposal slot. NOT S-10 / S-44 (A2 builds those); this is the
 * reference QA and the area engineers can open with `?state=`.
 */
import * as React from "react"
import { MoreHorizontal, TriangleAlert } from "lucide-react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { Label } from "@/components/ui/label"
import { Separator } from "@/components/ui/separator"
import { MonthField } from "@/components/common/input-guide"
import { ChipSelect, CompetencyChips, DocTextarea, DocTitleInput, FieldRow, FieldRows, flashElement } from "@/components/common/doc-inputs"
import { DocBody } from "@/components/common/shell/doc-body"
import {
  CrumbRow,
  InputRestoreBanner,
  PageShell,
  SaveButton,
  ShellBanners,
  StaleWriteDialog,
  preservationKey,
  useInputPreservation,
  useLeaveGuard,
  type SaveUiState,
} from "@/components/common/shell/page-shell"
import { SourceChip, SourceChips } from "@/components/common/source-chip"
import { AiPanel, useAiPanel, type AiPanelController } from "@/components/career/ai-panel"
import { saveProjectDeliverableAction, saveProjectPageAction } from "@/lib/data/career-v45-actions"
import {
  PAGE_SAVE_SKIP_COPY,
  STAR_FIELDS_ORDER,
  toProjectFormSnapshot,
  type AppliedDeliverableProposal,
  type AppliedProjectProposal,
  type DeliverablePageData,
  type ProjectPageData,
  type ProjectPageValues,
} from "@/lib/data/career-v45-shared"
import { COMPETENCY_LABELS, EXPERIENCE_TYPE_LABELS, PROJECT_TYPE_LABELS, STAR_FIELD_LABELS, projectSpanLabel } from "@/lib/data/labels"
import { routes } from "@/lib/routes"
import type { DeliverableStructuredDraft, ProjectStructuredDraft } from "@/types/db"

type Data = ProjectPageData | DeliverablePageData

export function DevPageShellDemo({ data }: { data: Data }) {
  return data.kind === "project" ? <ProjectDemo data={data} /> : <DeliverableDemo data={data} />
}

function useSaveUi(preview: Data["preview"]) {
  const [state, setState] = React.useState<SaveUiState>("idle")
  const [savedAt, setSavedAt] = React.useState<string | null>(null)
  return { state, setState, savedAt, setSavedAt, previewState: preview?.state ?? null }
}

// ---------------------------------------------------------------------------
// project (S-10 foundation wiring)
// ---------------------------------------------------------------------------

function ProjectDemo({ data }: { data: ProjectPageData }) {
  const [projectId, setProjectId] = React.useState(data.project_id)
  // one id per new page, reused on every retry (idempotent create, UQ-PA-3)
  const [clientId] = React.useState(() => crypto.randomUUID())
  const [baseline, setBaseline] = React.useState<ProjectPageValues>(data.values)
  const [values, setValues] = React.useState<ProjectPageValues>(() =>
    data.preview?.dirty ? { ...data.values, learnings: `${data.values.learnings ?? ""}\n- 저장하지 않은 수정 (미리보기)`.trim() } : data.values,
  )
  const [updatedAt, setUpdatedAt] = React.useState(data.updated_at)
  const [applied, setApplied] = React.useState<AppliedProjectProposal[]>([])
  const [nameAttention, setNameAttention] = React.useState(false)
  const [nameError, setNameError] = React.useState<string | null>(null)
  const [stale, setStale] = React.useState(false)
  const [skippedLine, setSkippedLine] = React.useState<string | null>(null)
  const [appliedChats, setAppliedChats] = React.useState<string[]>([])
  const save = useSaveUi(data.preview)
  const titleRef = React.useRef<HTMLInputElement | null>(null)
  const dirty = JSON.stringify(values) !== JSON.stringify(baseline)
  const preserved = useInputPreservation<{ values: ProjectPageValues; applied: AppliedProjectProposal[] }>(
    preservationKey("project", projectId, data.parent.id),
  )
  React.useEffect(() => {
    preserved.write(dirty ? { values, applied } : null)
  }, [dirty, values, applied, preserved])

  const uiState: SaveUiState = save.state === "saving" || save.state === "failed" || save.state === "invalid" || save.state === "stale" ? save.state : dirty ? "dirty" : save.savedAt ? "saved" : "idle"

  const doSave = React.useCallback(
    async (overwrite = false): Promise<string | null> => {
      if (!values.name.trim()) {
        setNameError("프로젝트명을 입력해 주세요")
        save.setState("invalid")
        titleRef.current?.focus()
        return null
      }
      save.setState("saving")
      const r = await saveProjectPageAction(
        { project_id: projectId, client_id: projectId ? null : clientId, values, expected_updated_at: overwrite ? null : updatedAt, applied_proposals: applied },
        save.previewState,
      ).catch(() => null)
      if (!r || !r.ok) {
        // the row was created but the rest failed: keep it so the retry updates instead of creating again
        if (r?.error.created) {
          // the `:new` preservation key is done: drop it before the key switches to the row id (UQ-PA-21);
          // the write effect re-saves the unsaved edits under the new key
          if (!projectId) preserved.clear()
          setProjectId(r.error.created.project_id)
          setUpdatedAt(r.error.created.updated_at)
        }
        if (r?.error.code === "stale_write") {
          save.setState("stale")
          setStale(true)
        } else save.setState("failed")
        return null
      }
      setProjectId(r.project_id)
      setUpdatedAt(r.updated_at)
      setBaseline(values)
      setApplied([])
      save.setSavedAt(r.updated_at)
      save.setState("saved")
      preserved.clear()
      setSkippedLine(r.skipped.length ? PAGE_SAVE_SKIP_COPY[r.skipped[0].reason] : null)
      setAppliedChats(r.applied.map((a) => a.writing_chat_id))
      return r.project_id
    },
    [values, projectId, clientId, updatedAt, applied, save, preserved],
  )

  const guard = useLeaveGuard({ dirty, onSave: async () => Boolean(await doSave()), onDiscard: preserved.clear })
  const panel = useAiPanel({
    target: "project",
    targetId: projectId,
    initialChats: data.chats,
    initialChat: data.open_chat,
    formSnapshot: React.useMemo(() => toProjectFormSnapshot(values), [values]),
    preview: data.preview,
    requireName: () => {
      if (values.name.trim()) return true
      setNameAttention(true)
      titleRef.current?.focus()
      return false
    },
    savePage: () => doSave(),
  })

  const { markApplied } = panel
  React.useEffect(() => {
    if (appliedChats.length) markApplied(appliedChats)
  }, [appliedChats, markApplied])

  const set = <K extends keyof ProjectPageValues>(k: K, v: ProjectPageValues[K]) => {
    if (save.state !== "saving") save.setState("idle")
    setValues((x) => ({ ...x, [k]: v }))
  }

  return (
    <PageShell guard={guard} aiReopen={panel.reopen} save={<SaveButton state={uiState} savedAt={save.savedAt} onSave={() => void doSave()} />}>
      <CrumbRow
        back={{ href: routes.careerItem(data.parent.type, data.parent.id), label: data.parent.name }}
        items={[{ label: data.parent.name, href: routes.careerItem(data.parent.type, data.parent.id) }, { label: values.name, placeholder: "새 프로젝트" }]}
        current="프로젝트 상세"
      />
      <ShellBanners>
        {preserved.stored ? (
          <InputRestoreBanner
            onContinue={() => {
              setValues(preserved.stored!.values)
              setApplied(preserved.stored!.applied)
              preserved.resolve()
            }}
            onDiscard={preserved.clear}
          />
        ) : null}
      </ShellBanners>
      <div className="shrink-0 space-y-3 px-6 pt-2 pb-4 max-md:px-4">
        <div className="flex items-start gap-2">
          <DocTitleInput
            ref={titleRef}
            label="프로젝트명"
            placeholder="프로젝트명을 입력해 주세요"
            value={values.name}
            attention={nameAttention && !values.name.trim()}
            invalid={Boolean(nameError)}
            onChange={(e) => {
              setNameError(null)
              set("name", e.target.value)
            }}
          />
          <Button variant="ghost" size="icon-sm" aria-label="프로젝트 메뉴">
            <MoreHorizontal aria-hidden />
          </Button>
        </div>
        {nameAttention && !values.name.trim() ? (
          <p className="flex items-center gap-1.5 text-sm text-warning-subtle-foreground">
            <TriangleAlert className="size-4 text-warning" aria-hidden />
            대화를 시작하려면 프로젝트명을 먼저 입력해 주세요
          </p>
        ) : nameError ? (
          <p className="text-sm text-destructive">{nameError}</p>
        ) : null}
        <FieldRows>
          <FieldRow label="프로젝트 종류" labelId="f-type">
            <ChipSelect value={values.project_type} onChange={(v) => set("project_type", v)} options={PROJECT_TYPE_LABELS} labelledBy="f-type" />
          </FieldRow>
          <FieldRow label="경험 유형" labelId="f-exp">
            <ChipSelect value={values.experience_type} onChange={(v) => set("experience_type", v)} options={EXPERIENCE_TYPE_LABELS} labelledBy="f-exp" />
          </FieldRow>
          <FieldRow label="역량" labelId="f-comp">
            <CompetencyChips value={values.competencies} onChange={(v) => set("competencies", v)} options={COMPETENCY_LABELS} labelledBy="f-comp" />
          </FieldRow>
          <FieldRow label="진행 기간" labelId="f-period">
            <MonthField id="p-start" label="시작" size="sm" labelHidden value={values.start_month} onChange={(v) => set("start_month", v)} />
            <span aria-hidden>~</span>
            <MonthField id="p-end" label="종료" size="sm" labelHidden value={values.is_current ? null : values.end_month} disabled={values.is_current} onChange={(v) => set("end_month", v)} />
            <Label className="flex items-center gap-2 text-sm font-normal">
              <Checkbox checked={values.is_current} onCheckedChange={(c) => set("is_current", c === true)} />
              진행 중
            </Label>
            <span className="text-sm text-muted-foreground tabular-nums">{projectSpanLabel(values.start_month, values.end_month, values.is_current)}</span>
          </FieldRow>
        </FieldRows>
        {skippedLine ? <p className="text-sm text-muted-foreground">{skippedLine}</p> : null}
      </div>
      <Separator />
      <DocBody
        placement={panel.placement}
        left={
          <div className="space-y-10">
            {STAR_FIELDS_ORDER.map((f) => (
              <section key={f} aria-labelledby={`star-${f}`} className="space-y-1.5">
                <h3 id={`star-${f}`} className="flex items-center gap-2 text-base leading-6 font-medium">
                  {STAR_FIELD_LABELS[f].ko}
                  <span className="font-normal text-muted-foreground">{STAR_FIELD_LABELS[f].en}</span>
                </h3>
                <DocTextarea id={`star-field-${f}`} aria-labelledby={`star-${f}`} value={values[f] ?? ""} onValueChange={(v) => set(f, v)} placeholder="(A2가 명세 자리 표시를 넣음)" />
              </section>
            ))}
          </div>
        }
        aside={
          <AiPanel
            panel={panel}
            renderProposal={(p) => (
              <DevStarSlot
                panel={p}
                onFill={(field, value, rev) => {
                  const current = values[field] ?? ""
                  set(field, current.trim() ? `${current}\n${value}` : value)
                  setApplied((a) => [...a.filter((x) => x.field !== field), { writing_chat_id: p.chat!.id, field, rev }])
                  flashElement(document.getElementById(`star-field-${field}`))
                  toast(`${STAR_FIELD_LABELS[field].ko}에 채웠어요 · 저장하기를 눌러야 저장돼요`)
                }}
                filled={applied}
              />
            )}
            onDirectInput={() => document.getElementById("star-field-situation")?.focus()}
          />
        }
      />
      <StaleWriteDialog
        open={stale}
        entity="project"
        busy={save.state === "saving"}
        onOpenChange={setStale}
        onOverwrite={() => {
          setStale(false)
          void doSave(true)
        }}
        onReload={guard.reloadDiscarding}
      />
    </PageShell>
  )
}

/** Placeholder for StarProposalCard (A2): shows the slot API — draft fields, rev, a minimal [반영]. */
function DevStarSlot({ panel, onFill, filled }: { panel: AiPanelController; onFill: (f: (typeof STAR_FIELDS_ORDER)[number], value: string, rev: number) => void; filled: AppliedProjectProposal[] }) {
  const draft = panel.chat?.structured_draft as ProjectStructuredDraft | undefined
  if (!draft) return null
  const rows = STAR_FIELDS_ORDER.flatMap((f) => (draft.star[f]?.value ? [[f, draft.star[f]!] as const] : []))
  if (!rows.length) return null
  return (
    <div className="mb-1 space-y-2 rounded-lg border bg-card p-3 text-sm">
      <p className="font-medium">제안 독 슬롯 (A2: StarProposalCard) {panel.phase === "patching" ? "· 정리 중" : ""}</p>
      {rows.map(([f, obj]) => {
        const isFilled = filled.some((a) => a.field === f && a.writing_chat_id === panel.chat?.id)
        const n = panel.chat?.messages.find((m) => m.id === obj.source_message_ids[0])?.user_number
        return (
          <div key={f} className="space-y-1 border-t pt-2 first:border-0 first:pt-0">
            <p className="text-xs text-muted-foreground">
              {STAR_FIELD_LABELS[f].ko} · rev {obj.rev ?? 1} · {obj.op} · {obj.review} {obj.applied_at ? "· 반영됨" : isFilled ? "· 폼에 채움" : ""}
            </p>
            <p>{obj.value}</p>
            <SourceChips>
              {n ? <SourceChip kind="utterance" userNumber={n} onSelect={() => panel.flashMessage(obj.source_message_ids[0], obj.source_quotes)} /> : null}
            </SourceChips>
            <Button variant="outline" size="sm" disabled={Boolean(obj.applied_at) || isFilled || obj.review === "needs_review"} onClick={() => onFill(f, obj.value ?? "", obj.rev ?? 1)}>
              반영
            </Button>
          </div>
        )
      })}
    </div>
  )
}

// ---------------------------------------------------------------------------
// deliverable (S-44 foundation wiring)
// ---------------------------------------------------------------------------

function DeliverableDemo({ data }: { data: DeliverablePageData }) {
  const [id, setId] = React.useState(data.project_deliverable_id)
  const [clientId] = React.useState(() => crypto.randomUUID())
  const [baseline, setBaseline] = React.useState({ title: data.title, body: data.body })
  const [form, setForm] = React.useState({ title: data.title, body: data.preview?.dirty ? `${data.body}\n저장하지 않은 수정 (미리보기)`.trim() : data.body })
  const [updatedAt, setUpdatedAt] = React.useState(data.updated_at)
  const [applied, setApplied] = React.useState<AppliedDeliverableProposal[]>([])
  const [titleAttention, setTitleAttention] = React.useState(false)
  const [stale, setStale] = React.useState(false)
  const save = useSaveUi(data.preview)
  const titleRef = React.useRef<HTMLInputElement | null>(null)
  const bodyRef = React.useRef<HTMLTextAreaElement | null>(null)
  const dirty = form.title !== baseline.title || form.body !== baseline.body
  const preserved = useInputPreservation<{ form: typeof form; applied: AppliedDeliverableProposal[] }>(preservationKey("deliverable", id, data.project.id))
  React.useEffect(() => {
    preserved.write(dirty ? { form, applied } : null)
  }, [dirty, form, applied, preserved])
  const uiState: SaveUiState = save.state === "saving" || save.state === "failed" || save.state === "invalid" || save.state === "stale" ? save.state : dirty ? "dirty" : save.savedAt ? "saved" : "idle"

  const doSave = async (overwrite = false): Promise<string | null> => {
    if (!form.title.trim()) {
      save.setState("invalid")
      titleRef.current?.focus()
      return null
    }
    save.setState("saving")
    const r = await saveProjectDeliverableAction(
      { project_deliverable_id: id, client_id: id ? null : clientId, project_id: data.project.id, title: form.title, body: form.body, expected_updated_at: overwrite ? null : updatedAt, applied_proposals: applied },
      save.previewState,
    ).catch(() => null)
    if (!r || !r.ok) {
      if (r?.error.code === "stale_write") {
        save.setState("stale")
        setStale(true)
      } else save.setState("failed")
      return null
    }
    setId(r.project_deliverable_id)
    setUpdatedAt(r.updated_at)
    setBaseline(form)
    setApplied([])
    save.setSavedAt(r.updated_at)
    save.setState("saved")
    preserved.clear()
    return r.project_deliverable_id
  }

  const guard = useLeaveGuard({ dirty, onSave: async () => Boolean(await doSave()), onDiscard: preserved.clear })
  const panel = useAiPanel({
    target: "deliverable",
    targetId: id,
    initialChats: data.chats,
    initialChat: data.open_chat,
    formSnapshot: React.useMemo(() => ({ title: form.title, body: form.body }), [form]),
    preview: data.preview,
    deliverableLimitReached: data.limit_reached,
    requireName: () => {
      if (form.title.trim()) return true
      setTitleAttention(true)
      titleRef.current?.focus()
      return false
    },
    savePage: () => doSave(),
  })

  return (
    <PageShell guard={guard} aiReopen={panel.reopen} save={<SaveButton state={uiState} savedAt={save.savedAt} onSave={() => void doSave()} />}>
      <CrumbRow
        back={{ href: routes.careerItem("project", data.project.id), label: data.project.name }}
        items={[{ label: data.project.name, href: routes.careerItem("project", data.project.id) }, { label: form.title, placeholder: "새 산출물" }]}
        current="산출물 상세"
      />
      <ShellBanners>
        {preserved.stored ? (
          <InputRestoreBanner
            onContinue={() => {
              setForm(preserved.stored!.form)
              setApplied(preserved.stored!.applied)
              preserved.resolve()
            }}
            onDiscard={preserved.clear}
          />
        ) : null}
      </ShellBanners>
      <div className="shrink-0 space-y-3 px-6 pt-2 pb-4 max-md:px-4">
        <DocTitleInput
          ref={titleRef}
          label="산출물 제목"
          placeholder="산출물 제목을 입력해 주세요"
          value={form.title}
          attention={titleAttention && !form.title.trim()}
          onChange={(e) => {
            save.setState("idle")
            setForm((f) => ({ ...f, title: e.target.value }))
          }}
        />
        {titleAttention && !form.title.trim() ? (
          <p className="flex items-center gap-1.5 text-sm text-warning-subtle-foreground">
            <TriangleAlert className="size-4 text-warning" aria-hidden />
            대화를 시작하려면 산출물 제목을 먼저 입력해 주세요
          </p>
        ) : null}
      </div>
      <Separator />
      <DocBody
        placement={panel.placement}
        left={
          <DocTextarea
            ref={bodyRef}
            aria-label="본문"
            className="min-h-[24rem]"
            value={form.body}
            onValueChange={(body) => {
              save.setState("idle")
              setForm((f) => ({ ...f, body }))
            }}
            placeholder="(A2가 명세 자리 표시를 넣음)"
          />
        }
        aside={
          <AiPanel
            panel={panel}
            renderProposal={(p) => {
              const draft = p.chat?.structured_draft as DeliverableStructuredDraft | undefined
              const body = draft?.deliverable?.body
              if (p.draftStarted) return <p className="mb-1 rounded-lg border bg-card p-3 text-sm">초안 작성 중 · 블록 {p.provisionalBlocks.length}개 (A2: DraftProposalCard)</p>
              if (!body) return null
              return (
                <div className="mb-1 space-y-2 rounded-lg border bg-card p-3 text-sm">
                  <p className="font-medium">제안 독 슬롯 (A2: DraftProposalCard) · rev {body.rev} · 초안 남은 횟수 {6 - (draft?.draft_count ?? 0)} / 6</p>
                  <p className="text-xs text-muted-foreground">블록 {body.blocks.length}개 · 검토 필요 {body.blocks.filter((b) => b.review === "needs_review").length}개</p>
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={Boolean(body.applied_at) || applied.some((a) => a.writing_chat_id === p.chat?.id)}
                    onClick={() => {
                      setForm((f) => ({ ...f, body: f.body.trim() ? `${f.body}\n\n${body.value}` : body.value }))
                      setApplied((a) => [...a, { writing_chat_id: p.chat!.id, rev: body.rev, mode: form.body.trim() ? "append" : "replace" }])
                      flashElement(bodyRef.current)
                    }}
                  >
                    {form.body.trim() ? "뒤에 덧붙이기" : "본문에 넣기"}
                  </Button>
                </div>
              )
            }}
            onDirectInput={() => bodyRef.current?.focus()}
          />
        }
      />
      <StaleWriteDialog
        open={stale}
        entity="deliverable"
        busy={save.state === "saving"}
        onOpenChange={setStale}
        onOverwrite={() => {
          setStale(false)
          void doSave(true)
        }}
        onReload={guard.reloadDiscarding}
      />
    </PageShell>
  )
}
